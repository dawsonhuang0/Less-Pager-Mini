import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import { search, startSearch, searchInputKey, execSearch,
  incrementalSearch, restoreSearchOrigin, highlightLine, clearHighlight }
  from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import {
  opt,
  option,
  startOption,
  optionKey,
  optQuitAtEof,
  optQuotes,
  optLinenums,
  gutterWidth
} from '../../src/options';

import { resetProtos } from '../../src/features/prompt';

import { startSetMark, marksKey, resetMarks }
  from '../../src/features/jumping';

import { lineForward, lineBackward, windowForward, windowBackward }
  from '../../src/features/moving';

import { screenRows, calculateEOF } from '../../src/helpers';

import { transformContent } from '../../src/lines/helpers';

import { BOLD_ON, BOLD_OFF, INVERSE_ON, INVERSE_OFF } from '../../src/state/constants';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const content = Array.from({ length: 30 }, (_, i) => `m${i + 1}`);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 80;
  config.halfScreenWidth = 40;
  config.window = 6;
  config.chopLongLines = true;
  config.keyPrefix = '';
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;
  mode.BUFFERING = false;

  search.message = '';
  search.input = null;
  option.pending = '';
  option.name = null;
  option.spec = null;

  opt.tabStops = [];
  opt.tabDefault = 8;

  clearHighlight();
  resetMarks();
  resetProtos();
  initContent(content);
  calculateEOF(content);
});

/** Feeds an option command: `-a`, `_x`, `-+a`, long names with `\r`. */
function toggle(keys: string): void {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey(content, key);
}

const longToggle = (name: string): void => toggle(`--${name}\x0D`);

describe('less option table', () => {
  it('toggles -a through its triple states with less messages', () => {
    toggle('-a');
    expect(search.message).toBe('Search skips displayed screen');

    toggle('-a');
    expect(search.message).toBe('Search includes displayed screen');

    toggle('-+a');
    expect(search.message).toBe('Search includes all of displayed screen');
  });

  it('selects the upper state with an uppercase long name', () => {
    longToggle('QUIT-AT-EOF');
    expect(search.message).toBe('Quit immediately at end-of-file');
    expect(optQuitAtEof()).toBe(2);

    toggle('-+e');
    expect(optQuitAtEof()).toBe(0);
  });

  it('refuses no-toggle options at runtime like less', () => {
    toggle('-d');
    expect(search.message).toBe('Cannot change the -d (--dumb) option');

    toggle('-p');
    expect(search.message).toBe('Cannot change the -p (--pattern) option');

    toggle('-X');
    expect(search.message).toBe('Cannot change the -X (--no-init) option');

    toggle('-?');
    expect(search.message).toBe('Use "h" for help');
  });

  it('caps --line-num-width at 16 like less', () => {
    toggle('--line-num-width=20\x0D');
    expect(search.message)
      .toBe('Line number width must not be larger than 16');
  });

  it('sets and reports -x tab stops', () => {
    toggle('-x9,17\x0D');
    toggle('_x');
    expect(search.message).toBe('Tab stops 9,17 and then every 8 spaces');

    expect(transformContent(['a\tb'])).toEqual(['a        b']);

    // an empty answer queries instead of setting, like less's
    // toggle_option downgrading OPT_TOGGLE to OPT_NO_TOGGLE
    toggle('-x\x0D');
    expect(search.message).toBe('Tab stops 9,17 and then every 8 spaces');

    // less's set_tabs skips non-increasing entries without ending the
    // list
    toggle('-x4,2,8\x0D');
    toggle('_x');
    expect(search.message).toBe('Tab stops 4,8 and then every 4 spaces');
  });

  it('sets the -" shell quote characters', () => {
    toggle('-"[]\x0D');
    expect(optQuotes()).toEqual({ open: '[', close: ']' });

    toggle('_"');
    expect(search.message).toBe('quotes []');

    toggle('-""\x0D');
    expect(optQuotes()).toEqual({ open: '"', close: '"' });
  });
});

describe('long option name completion', () => {
  it('completes a unique prefix and swallows further letters', () => {
    toggle('--hel');
    expect(option.name).toBe('help');
    expect(option.match).toBe(true);

    optionKey(content, 'x');
    expect(option.name).toBe('help');

    optionKey(content, '\x0D');
    expect(search.message).toBe('Use "h" for help');
  });

  it('keeps collecting while the prefix is ambiguous', () => {
    toggle('--line-num');
    expect(option.name).toBe('line-num');
    expect(option.match).toBe(false);

    // one more char makes it unique
    optionKey(content, '-');
    expect(option.name).toBe('line-num-width');
  });

  it('completes uppercase prefixes to the triple upper name', () => {
    toggle('--QUIT');
    expect(option.name).toBe('QUIT-AT-EOF');

    optionKey(content, '\x0D');
    expect(optQuitAtEof()).toBe(2);

    toggle('-+e');
  });

  it('backspace after completion aborts to a clean prompt', () => {
    toggle('--hel');
    expect(option.match).toBe(true);

    optionKey(content, '\x7F');
    expect(option.pending).toBe('');
    expect(option.name).toBe(null);
  });

  it('keeps unmatched text and reports it on RETURN', () => {
    toggle('--zz');
    expect(option.name).toBe('zz');
    expect(option.match).toBe(false);

    optionKey(content, '\x0D');
    expect(search.message).toBe('There is no --zz option');
  });
});

describe('display transforms', () => {
  it('expands tabs at the default 8-column stops', () => {
    expect(transformContent(['a\tb', '\tx'])).toEqual([
      'a       b',
      '        x',
    ]);
  });

  it('squeezes runs of blank lines with -s', () => {
    toggle('-s');
    expect(transformContent(['a', '', '', '', 'b', '', 'c'])).toEqual(
      ['a', '', 'b', '', 'c']
    );

    toggle('-s');
    expect(transformContent(['a', '', '', 'b']))
      .toEqual(['a', '', '', 'b']);
  });

  it('shows control chars in caret standout, ANSI passing under -R', () => {
    expect(transformContent(['a\x01b'])).toEqual(
      ['a' + INVERSE_ON + '^A' + INVERSE_OFF + 'b']
    );

    // less's default carets data escapes (prchar's "ESC", charset.c:534)
    expect(transformContent(['\x1b[31mred'])).toEqual(
      [INVERSE_ON + 'ESC' + INVERSE_OFF + '[31mred']
    );

    // -R (CD_ANSI) passes style sequences through
    toggle('-R');
    expect(transformContent(['\x1b[31mred'])).toEqual(['\x1b[31mred']);

    // and back to the default: -R also makes pdone close every line
    // with a literal "\033[m", which the tests after this one draw
    toggle('-+R');
  });

  it('renders -N line numbers in the gutter', () => {
    toggle('-N');
    expect(optLinenums()).toBe(2);
    expect(gutterWidth()).toBe(8);
    expect(config.screenWidth).toBe(72);

    // less pads AT_NORMAL and bolds only the digits (line.c:449)
    const rows = screenRows(content, []);
    expect(rows[0]).toBe('      ' + BOLD_ON + '1' + BOLD_OFF + ' m1');
    expect(rows[1]).toBe('      ' + BOLD_ON + '2' + BOLD_OFF + ' m2');

    toggle('-N');
    expect(config.screenWidth).toBe(80);
    toggle('-+n');
  });

  it('marks marked and matched lines in the -J status column', () => {
    startSetMark(false, 0);
    marksKey(content, 'a');

    // the mark letter stands out (less's AT_HILITE|AT_COLOR_MARK);
    // the padding stays normal
    toggle('-J');
    const rows = screenRows(content, []);
    expect(rows[0]).toBe(INVERSE_ON + 'a' + INVERSE_OFF + ' m1');
    expect(rows[1]).toBe('  m2');

    toggle('-J');
  });
});

describe('search options', () => {
  const type = (chars: string): void => {
    for (const char of chars) searchInputKey(char);
  };

  it('-a fresh searches skip the displayed screen', () => {
    toggle('-a');

    startSearch('/', 1);
    type('m');
    execSearch(content);

    // window 6 shows rows 0-4; the first match past it is row 5
    expect(config.row).toBe(5);

    toggle('-+a');
    config.row = 0;

    startSearch('/', 1);
    type('m');
    execSearch(content);
    expect(config.row).toBe(0);
  });

  it('-g highlights only the found match row, -G none', () => {
    startSearch('/', 1);
    type('m');
    execSearch(content);

    toggle('-g');
    expect(highlightLine('m1', 0)).toContain(INVERSE_ON);
    expect(highlightLine('m2', 1)).toBe('m2');

    toggle('-g');
    expect(highlightLine('m1', 0)).toBe('m1');

    toggle('-+g');
    expect(highlightLine('m2', 1)).toContain(INVERSE_ON);
  });

  it('incremental search moves while typing and restores on cancel', () => {
    config.row = 0;
    startSearch('/', 1);

    const origin = {
      originRow: 0,
      originSubRow: 0,
      originEof: false,
    };

    type('m9');
    incrementalSearch(content);
    expect(config.row).toBe(8);

    restoreSearchOrigin(origin);
    expect(config.row).toBe(0);
  });

  it('--no-histdups removes older duplicate patterns', () => {
    longToggle('no-histdups');

    search.history = [];

    for (const pattern of ['aa', 'bb', 'aa']) {
      startSearch('/', 1);
      type(pattern);
      execSearch(content);
    }

    expect(search.history).toEqual(['bb', 'aa']);

    longToggle('no-histdups');
  });
});

describe('-w unread highlight', () => {
  it('tracks unread lines both directions, like less v693', () => {
    toggle('-W');

    // -W line moves need a count (command.c:1702: ONPLUS && n > 1)
    config.row = 0;
    lineForward(content, 1);
    expect(config.attnRow).toBe(-1);

    // window 6 showed rows 0-4: row 5 was the first unread line
    config.row = 0;
    lineForward(content, 2);
    expect(config.attnRow).toBe(5);

    // backward marks the line just above the old top
    // (command.c:1715: toppos-1)
    config.row = 10;
    lineBackward(content, 2);
    expect(config.attnRow).toBe(9);

    // a single k clears without marking (cmd_exec's clear_attn)
    config.row = 10;
    lineBackward(content, 1);
    expect(config.attnRow).toBe(-1);

    toggle('-+w');
  });

  it('-w only marks full window movements', () => {
    toggle('-w');

    config.row = 0;
    lineForward(content, 1);
    expect(config.attnRow).toBe(-1);

    config.row = 0;
    windowForward(content, []);
    expect(config.attnRow).toBe(5);

    // b marks above the old top under plain -w too (v693)
    config.row = 10;
    windowBackward(content, []);
    expect(config.attnRow).toBe(9);

    // less keeps the current highlight when -w turns off; the next
    // movement clears it (clear_attn), not the toggle
    toggle('-+w');
    expect(config.attnRow).toBe(9);

    lineBackward(content, 1);
    expect(config.attnRow).toBe(-1);
  });
});

describe('prompt styles', () => {
  it('-m switches to the medium prompt, -P redefines the short one', () => {
    toggle('-m');
    expect(search.message).toBe('Medium prompt');
    search.message = '';

    // a pipe's length is unknown mid-file, so the medium prompt falls
    // back to "byte %bB" like less's ?pB conditional
    let rows = screenRows(content, []);
    expect(rows[rows.length - 1]).toMatch(/byte \d+/);

    toggle('-m');
    expect(search.message).toBe('Short prompt');
    search.message = '';

    // less reports the new prototype after the set (toggle_option's
    // string QUERY), then the redefined prompt shows
    toggle('-PsHI\x0D');
    expect(search.message).toBe('Prompt (short): HI');
    search.message = '';

    rows = screenRows(content, []);
    expect(rows[rows.length - 1]).toBe(INVERSE_ON + 'HI' + INVERSE_OFF);

    resetProtos();
  });
});
