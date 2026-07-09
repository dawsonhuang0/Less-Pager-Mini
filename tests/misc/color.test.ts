import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search, startSearch, searchInputKey, execSearch, highlightLine }
  from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { option, startOption, optionKey } from '../../src/options';

import { colorSgr, colored, attrText, resetColors }
  from '../../src/features/color';

import { formatContent, calculateEOF } from '../../src/helpers';

import { INVERSE_ON, INVERSE_OFF, STYLE_RESET } from '../../src/constants';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const content = ['alpha one', 'bravo two', 'alpha three'];

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 40;
  config.halfScreenWidth = 20;
  config.window = 6;
  config.chopLongLines = true;
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;
  mode.DUMB = false;

  search.message = '';
  search.input = null;
  search.regex = null;
  search.highlight = true;
  search.subs = new Set();
  option.pending = '';

  initContent(content);
  calculateEOF(content);

  resetColors();
  toggle('-+-use-color\x0D');
  search.message = '';
});

/** Feeds an option command key by key, like the other option tests. */
function toggle(keys: string): void {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey(content, key);
}

function doSearch(pattern: string): void {
  startSearch('/', 1);
  for (const char of pattern) searchInputKey(char);
  execSearch(content);
}

describe('color string parsing', () => {
  it('parses 4-bit pairs like parse_color4/sgr_color', () => {
    expect(colorSgr('kG')).toBe('\x1B[30m\x1B[102m');
    expect(colorSgr('Wm')).toBe('\x1B[97m\x1B[45m');
    expect(colorSgr('r')).toBe('\x1B[31m');
    expect(colorSgr('-b')).toBe('\x1B[44m');
  });

  it('parses attributes and 256-color values', () => {
    expect(colorSgr('c*')).toBe('\x1B[36m\x1B[1m');
    expect(colorSgr('-d')).toBe('\x1B[1m');
    expect(colorSgr('_')).toBe('\x1B[4m');
    expect(colorSgr('208.17')).toBe('\x1B[38;5;208m\x1B[48;5;17m');
    expect(colorSgr('.4')).toBe('\x1B[48;5;4m');
    expect(colorSgr('*')).toBe(STYLE_RESET);
  });

  it('rejects invalid strings like set_color_map', () => {
    expect(colorSgr('q')).toBeNull();
    expect(colorSgr('k9')).toBeNull();
  });
});

describe('-D option', () => {
  it('requires --use-color for color kinds, like opt_D', () => {
    toggle('-DSrb\x0D');
    expect(search.message).toBe('Set --use-color before changing colors');

    toggle('--use-color\x0D');
    toggle('-DSrb\x0D');
    expect(colored('search', 'x')).toBe('\x1B[31m\x1B[44m' + 'x' +
      STYLE_RESET);
  });

  it('reports og error messages for bad input', () => {
    toggle('-DZx\x0D');
    expect(search.message).toBe("Invalid color specifier 'Z'");

    toggle('--use-color\x0D');
    toggle('-DSqq\x0D');
    expect(search.message).toBe('Invalid color string "qq"');
  });

  it('allows attribute remaps without --use-color', () => {
    toggle('-Ddr\x0D');
    expect(search.message).toBe('');
    expect(attrText('bold', 'x')).toBe('\x1B[31mx' + STYLE_RESET);

    // a +color extends the mode string instead of replacing it
    toggle('-Dd+r\x0D');
    expect(attrText('bold', 'x'))
      .toBe('\x1B[1m\x1B[31mx' + STYLE_RESET);
  });
});

describe('color application', () => {
  it('falls back to attributes without --use-color', () => {
    expect(colored('search', 'x', INVERSE_ON, INVERSE_OFF))
      .toBe(INVERSE_ON + 'x' + INVERSE_OFF);
  });

  it('applies the default search color kG with --use-color', () => {
    toggle('--use-color\x0D');
    doSearch('alpha');

    const lines = formatContent(content);
    expect(lines[0]).toContain('\x1B[30m\x1B[102malpha' + STYLE_RESET);
  });

  it('colors capture groups with the subsearch defaults', () => {
    toggle('--use-color\x0D');
    doSearch('al(ph)a');

    const line = highlightLine(content[0], 0);

    // "al" and "a" in search kG, "ph" in sub1 ky
    expect(line).toContain('\x1B[30m\x1B[102mal' + STYLE_RESET);
    expect(line).toContain('\x1B[30m\x1B[43mph' + STYLE_RESET);
    expect(line).toContain('\x1B[30m\x1B[102ma' + STYLE_RESET);
  });

  it('keeps standout when a color is cleared without --use-color', () => {
    doSearch('alpha');

    const line = highlightLine(content[0], 0);
    expect(line).toContain(INVERSE_ON + 'alpha' + INVERSE_OFF);
  });
});
