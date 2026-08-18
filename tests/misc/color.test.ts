import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import { search, startSearch, searchInputKey, execSearch, highlightLine }
  from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { option, startOption, optionKey } from '../../src/options';

import { colorSgr, colored, attrText, resetColors, setColor }
  from '../../src/features/color';

import { formatContent, calculateEOF, screenRows } from '../../src/helpers';

import { INVERSE_ON, INVERSE_OFF, STYLE_RESET, COLOR_RESET }
  from '../../src/state/constants';

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
      COLOR_RESET);
  });

  it('reports less error messages for bad input', () => {
    toggle('-DZx\x0D');
    expect(search.message).toBe("Invalid color specifier 'Z'");

    toggle('--use-color\x0D');
    toggle('-DSqq\x0D');
    expect(search.message).toBe('Invalid color string "qq"');
  });

  it('rejects -Dn like set_color_map with no AT_NORMAL slot', () => {
    toggle('-Dnr\x0D');
    expect(search.message).toBe('Invalid color string "r"');

    toggle('-Dn\x0D');
    expect(search.message).toBe('Invalid color string ""');
  });

  it('rejects strings past the 12-byte color_map entry', () => {
    toggle('--use-color\x0D');
    toggle('-DS123.123_____\x0D');
    expect(search.message).toBe('Invalid color string "123.123_____"');

    search.message = '';
    toggle('-DS123.123____\x0D');
    expect(search.message).toBe('');
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
    expect(lines[0]).toContain('\x1B[30m\x1B[102malpha' + COLOR_RESET);
  });

  it('colors capture groups with the subsearch defaults', () => {
    toggle('--use-color\x0D');
    doSearch('al(ph)a');

    const line = highlightLine(content[0], 0);

    // "al" and "a" in search kG, "ph" in sub1 ky
    expect(line).toContain('\x1B[30m\x1B[102mal' + COLOR_RESET);
    expect(line).toContain('\x1B[30m\x1B[43mph' + COLOR_RESET);
    expect(line).toContain('\x1B[30m\x1B[102ma' + COLOR_RESET);
  });

  it('keeps standout when a color is cleared without --use-color', () => {
    doSearch('alpha');

    const line = highlightLine(content[0], 0);
    expect(line).toContain(INVERSE_ON + 'alpha' + INVERSE_OFF);
  });

  it("colors the bare ':' prompt, never standout (command.c:1007)", () => {
    // burn the short prompt's one-time ?n file name display
    screenRows(content, []);

    expect(screenRows(content, []).pop()).toBe(':');

    toggle('--use-color\x0D');
    toggle('-DPrb\x0D');
    search.message = '';
    expect(screenRows(content, []).pop())
      .toBe('\x1B[31m\x1B[44m:' + COLOR_RESET);
  });
});

describe('lowercase -D types without --use-color, like less', () => {
  it('recolors standout-rendered text once -Ds is set', () => {
    expect(setColor('s9.7')).toBeNull();
    const out = colored('search', 'hit', INVERSE_ON, INVERSE_OFF);
    expect(out).not.toContain(INVERSE_ON);
    expect(out).toMatch(/\x1b\[/);
  });

  it('refuses uppercase color types, like opt_D', () => {
    expect(setColor('SG')).toBe('Set --use-color before changing colors');
  });
});
