import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search, startSearch, searchInputKey, execSearch,
  chgCaseless }
  from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import {
  option,
  startOption,
  optionKey,
  optDefSearchType,
  optAutosaveAction,
  optMatchShift,
  optWheelEnabled,
  optPastEof,
  checkModelines,
  nextTabStop
} from '../../src/options';

import { lineForward, lineBackward } from '../../src/features/moving';

import { formatContent, calculateEOF } from '../../src/helpers';

import { transformContent } from '../../src/lines/helpers';

import {
  INVERSE_ON,
  INVERSE_OFF,
  BOLD_ON,
  BOLD_OFF,
  UNDERLINE_ON,
  UNDERLINE_OFF
} from '../../src/constants';

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
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  search.input = null;
  search.regex = null;
  option.pending = '';

  initContent(content);
  calculateEOF(content);

  // restore defaults for the options exercised here
  toggle('--search-options=-\x0D');
  toggle('--match-shift=0\x0D');
  toggle('--autosave=-\x0D');
  toggle('-+-past-eof\x0D');
  toggle('-+-form-feed\x0D');
  toggle('-+-status-line\x0D');
  toggle('-+-proc-backspace\x0D');
  toggle('-+-proc-tab\x0D');
  toggle('-+-proc-return\x0D');
  toggle('--modelines=0\x0D');
  toggle('--emouse=-\x0D');
  toggle('-+-wordwrap\x0D');
  toggle('-+x');
  search.message = '';
});

/** Feeds an option command key by key, like newOptions.test.ts. */
function toggle(keys: string): void {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey(content, key);
}

describe('state toggles with og messages', () => {
  it.each([
    ['file-size', 'Get size of each file', "Don't get size of each file"],
    ['no-vbell', "Don't display visual bell", 'Display visual bell'],
    ['no-edit-warn', "Don't warn when editing a file opened via LESSOPEN",
      'Warn when editing a file opened via LESSOPEN'],
    ['exit-follow-on-close', 'Exit F command when input closes',
      "Don't exit F command when input closes"],
    ['show-preproc-errors', 'Show error message if preprocessor fails',
      "Don't show error message if preprocessor fails"],
    ['redraw-on-quit', 'Redraw last screen when quitting',
      "Don't redraw screen when quitting"],
    ['no-paste', 'Ignore pasted input', 'Accept pasted input'],
    ['hilite-target', 'Highlight target line', "Don't highlight target line"],
  ])('--%s toggles like og', (name, onMsg, offMsg) => {
    toggle(`--${name}\x0D`);
    expect(search.message).toBe(onMsg);

    toggle(`--${name}\x0D`);
    expect(search.message).toBe(offMsg);
  });
});

describe('--intr and --end-prompt', () => {
  it('parses ^X notation and queries like prchar', () => {
    toggle('--intr=^C\x0D');
    toggle('__intr\x0D');
    expect(search.message).toBe('interrupt character is ^C');
  });

  it('stores per style end prompts and reports (nothing)', () => {
    toggle('__end-prompt\x0D');
    expect(search.message).toBe('Print after short prompt: (nothing)');

    toggle('--end-prompt=done\x0D');
    toggle('__end-prompt\x0D');
    expect(search.message).toBe('Print after short prompt: done');
  });
});

describe('--emouse', () => {
  it('parses feature lists with combinations and queries', () => {
    toggle('--emouse=scroll,lclick\x0D');
    expect(optWheelEnabled()).toBe(true);

    toggle('__emouse\x0D');
    expect(search.message).toBe('Mouse features enabled: scroll,lclick');

    toggle('--emouse=all\x0D');
    toggle('__emouse\x0D');
    expect(search.message).toBe('Mouse features enabled: all');

    toggle('--emouse=-\x0D');
    toggle('__emouse\x0D');
    expect(search.message).toBe('Ignore mouse input');
    expect(optWheelEnabled()).toBe(false);
  });

  it('rejects unknown names like parse_csl_bitmap', () => {
    toggle('--emouse=bogus\x0D');
    expect(search.message).toBe('--emouse: invalid name "bogus"');
  });
});

describe('--search-options', () => {
  it('presets modifiers for a fresh search and queries', () => {
    toggle('--search-options=WN2\x0D');

    startSearch('/', 1);
    expect(search.input?.wrap).toBe(true);
    expect(search.input?.invert).toBe(true);
    expect(search.input?.subs.has(2)).toBe(true);

    toggle('__search-options\x0D');
    expect(search.message).toBe('search options: NW2');

    toggle('--search-options=-\x0D');
    startSearch('/', 1);
    expect(search.input?.wrap).toBe(false);
    expect(optDefSearchType().invert).toBe(false);
  });

  it('rejects invalid letters like opt_search_type', () => {
    toggle('--search-options=X\x0D');
    expect(search.message).toBe("invalid search option 'X'");
  });
});

describe('--match-shift', () => {
  it('accepts a number or a fraction of the screen width', () => {
    toggle('--match-shift=8\x0D');
    expect(optMatchShift()).toBe(8);

    toggle('--match-shift=.25\x0D');
    expect(optMatchShift()).toBe(20);

    toggle('__match-shift\x0D');
    expect(search.message)
      .toBe('Search match shift is .25 of screen width');
  });

  it('shifts an off-screen match into view on search', () => {
    const wide = ['x'.repeat(60) + 'NEEDLE' + 'y'.repeat(40), 'plain'];
    initContent(wide);
    config.screenWidth = 20;
    calculateEOF(wide);
    toggle('--match-shift=4\x0D');

    startSearch('/', 1);
    for (const char of 'NEEDLE') searchInputKey(char);
    execSearch(wide);

    // the match starts at col 60; it lands 4 columns from the edge
    expect(config.col).toBe(56);
  });
});

describe('--autosave', () => {
  it('stores actions and answers action checks', () => {
    expect(optAutosaveAction('/')).toBe(false);

    toggle('--autosave=m/\x0D');
    expect(optAutosaveAction('/')).toBe(true);
    expect(optAutosaveAction('m')).toBe(true);
    expect(optAutosaveAction('!')).toBe(false);

    toggle('--autosave=*\x0D');
    expect(optAutosaveAction('!')).toBe(true);

    toggle('__autosave\x0D');
    expect(search.message).toBe('Autosave actions: *');
  });
});

describe('--past-eof', () => {
  it('lets forward scrolls continue past (END)', () => {
    config.row = 25;
    calculateEOF(content);
    mode.EOF = true;

    lineForward(content, 2);
    expect(config.row).toBe(25);

    toggle('--past-eof\x0D');
    expect(optPastEof()).toBe(true);

    lineForward(content, 2);
    expect(config.row).toBe(27);

    // the last line stops at the top of the screen
    lineForward(content, 10);
    expect(config.row).toBe(29);
  });
});

describe('--form-feed', () => {
  it('stops with the \\f line at the bottom forward, top backward', () => {
    const paged = ['a1', 'a2', 'a3', 'a4', 'a5', '\fb1', 'b2', 'b3',
      'b4', 'b5', 'b6', 'b7'];
    initContent(paged);
    calculateEOF(paged);
    toggle('--form-feed\x0D');

    // og's forw checks each NEWLY printed bottom line
    // (forwback.c:366): the scroll stops with \f as the last
    // visible row
    lineForward(paged, 4);
    expect(config.row).toBe(1);

    // an already-visible \f is not newly printed: no re-stop
    lineForward(paged, 4);
    expect(config.row).toBe(5);

    lineForward(paged, 2);
    expect(config.row).toBe(7);

    // og's back prints at the top and stops on the \f line there
    lineBackward(paged, 5);
    expect(config.row).toBe(5);
  });
});

describe('--status-line', () => {
  it('pads the attn highlight to the full screen width', () => {
    config.attnRow = 1;
    config.screenWidth = 10;
    toggle('--status-line\x0D');

    const lines = formatContent(content);
    expect(lines[1]).toBe(INVERSE_ON + 'm2' + ' '.repeat(8) + INVERSE_OFF);
  });
});

describe('--proc options', () => {
  it('processes overstrikes with --proc-backspace', () => {
    toggle('--proc-backspace\x0D');
    expect(search.message)
      .toBe('Display underline text in underline mode');

    const out = transformContent(['_\x08ub\x08b', 'x\x08y']);
    expect(out[0]).toBe(
      UNDERLINE_ON + 'u' + UNDERLINE_OFF + BOLD_ON + 'b' + BOLD_OFF
    );
    expect(out[1]).toBe('y');
  });

  it('prints tabs as ^I with --PROC-TAB', () => {
    toggle('--PROC-TAB\x0D');
    expect(search.message).toBe('Print tabs as ^I');

    const out = transformContent(['a\tb']);
    expect(out[0]).toBe('a' + INVERSE_ON + '^I' + INVERSE_OFF + 'b');
  });

  it('deletes a trailing carriage return with --proc-return', () => {
    toggle('--proc-return\x0D');

    const out = transformContent(['dos line\r']);
    expect(out[0]).toBe('dos line');
  });
});

describe('--wordwrap', () => {
  it('breaks wrapped lines at spaces like forw_line_seg', () => {
    const text = ['aaa bbb cccc dd'];
    initContent(text);
    config.chopLongLines = false;
    config.screenWidth = 10;

    toggle('--wordwrap\x0D');
    expect(search.message).toBe('Wrap lines at spaces');

    const lines = formatContent(text);
    expect(lines[0]).toBe('aaa bbb ');
    expect(lines[1]).toBe('cccc dd');
  });

  it('hard-breaks a single long word and swallows space runs', () => {
    const text = ['abcdefghijklmno', 'aaaaaaaaaa   bb'];
    initContent(text);
    config.chopLongLines = false;
    config.screenWidth = 10;

    toggle('--wordwrap\x0D');

    const lines = formatContent(text);
    expect(lines[0]).toBe('abcdefghij');
    expect(lines[1]).toBe('klmno');
    expect(lines[2]).toBe('aaaaaaaaaa');
    expect(lines[3]).toBe('bb');
  });

  it('keeps fixed-width wrapping when off', () => {
    const text = ['aaa bbb cccc dd'];
    initContent(text);
    config.chopLongLines = false;
    config.screenWidth = 10;

    const lines = formatContent(text);
    expect(lines[0]).toBe('aaa bbb cc');
    expect(lines[1]).toBe('cc dd');
  });
});

describe('--modelines', () => {
  it('honors ts= from vim modelines, like check_modeline', () => {
    toggle('--modelines=5\x0D');
    expect(search.message).toBe('Read 5 lines looking for modelines');

    checkModelines(['# vim: set ts=3: other', 'text']);
    expect(nextTabStop(0)).toBe(3);
    expect(nextTabStop(3)).toBe(6);

    // "less:" requires "set"
    checkModelines(['less: ts=5']);
    expect(nextTabStop(0)).toBe(3);

    checkModelines(['code // vi:ts=7']);
    expect(nextTabStop(0)).toBe(7);
  });
});

describe('--tag-file', () => {
  it('expands the name at a toggle, like opt__T lglob', () => {
    process.env.LMN_TAGS_DIR = '/tmp/tdir';

    try {
      // skipspc strips the leading blanks before the expansion
      toggle('-T  $LMN_TAGS_DIR/tags2\x0D');
    } finally {
      delete process.env.LMN_TAGS_DIR;
    }

    toggle('_T');
    expect(search.message).toBe('Tags file "/tmp/tdir/tags2"');

    toggle('-Ttags\x0D');
  });
});

describe('_i query reports the caseless triple, like og', () => {
  it('shows the state-2 message from either flag', () => {
    toggle('-I\x0D');
    search.message = '';
    toggle('_i');
    expect(search.message).toBe('Ignore case in searches and in patterns');

    search.message = '';
    toggle('_I');
    expect(search.message).toBe('Ignore case in searches and in patterns');
    chgCaseless(0);
  });
});
