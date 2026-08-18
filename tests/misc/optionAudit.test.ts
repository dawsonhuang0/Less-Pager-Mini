import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import {
  BOLD_ON,
  BOLD_OFF,
  UNDERLINE_ON,
  UNDERLINE_OFF,
  INVERSE_ON,
  INVERSE_OFF
} from '../../src/state/constants';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import {
  opt,
  option,
  startOption,
  optionKey,
  scanOptions,
  initUnsupport,
  optMatchShift,
  optRscroll,
  optQuitAtEof,
  getSwindow,
  chopLine,
  optRscrollAttr,
  prChar,
  setTabs,
  nextTabStop,
  setHeader,
  applyPendingHeader,
  setNoSearchHeaders,
  noSearchHeadersMessage,
  flushPendopt,
  optionArgPending,
  setCliOptions,
  takeCliOptions
} from '../../src/options';

import { prProto, setProto } from '../../src/features/prompt';

import { resetLesskey, userBinding } from '../../src/features/lesskey';

// registers the session hooks (--file-size's scan) like the runtime
import '../../src/features/pipe';

import { calculateEOF, screenRows } from '../../src/helpers';

import { prExpand } from '../../src/features/prompt';

import { startSearch, searchInputKey, execSearch, statusColChar,
  clearHighlight } from '../../src/features/searching';

import { initFiles, loadFile, revealPipeEnd }
  from '../../src/features/files';

import { getFirstCmd } from '../../src/features/misc';

import fs from 'fs';
import os from 'os';
import path from 'path';

const stdoutWrite = vi.spyOn(process.stdout, 'write')
  .mockImplementation(() => true);

const content = Array.from({ length: 30 }, (_, i) => `m${i + 1}`);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.setWindow = -1;
  config.screenWidth = 80;
  config.halfScreenWidth = 40;
  config.window = 24;
  config.chopLongLines = false;

  mode.INIT = false;
  mode.EOF = false;

  search.message = '';
  search.messageQueue.length = 0;
  option.pending = '';
  option.name = null;
  option.spec = null;

  opt.quitAtEof = 0;
  opt.lessIsMore = 0;
  opt.headerLines = 0;
  opt.headerCols = 0;
  opt.headerStart = 0;
  opt.autoBuffers = 1;
  opt.backScroll = -1;
  opt.wheelLines = 1;
  opt.rscrollChar = '>';
  opt.rscrollAttr = 's';
  opt.squeeze = 0;
  opt.quiet = 0;
  opt.intrChar = '\x18';
  opt.emouse = 0;
  opt.tabStops = [];
  opt.tabDefault = 8;
  opt.linenumWidth = 7;
  opt.statusColWidth = 2;
  opt.matchShift = 0;
  opt.matchShiftFraction = 500000;
  opt.wantFileSize = 0;
  setNoSearchHeaders(0, 0);

  stdoutWrite.mockClear();

  initUnsupport('');
  initContent(content);
  calculateEOF(content);
  toggle('--search-options=-\x0D');
  search.message = '';
  search.messageQueue.length = 0;
});

/** Feeds an option command: `-a`, `_x`, `-+a`, long names with `\r`. */
function toggle(keys: string): void {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey(content, key);
}

describe('less option defaults', () => {
  it('defaults --match-shift to half the screen width', () => {
    expect(optMatchShift()).toBe(40);
  });

  it('reports the --match-shift default as a fraction', () => {
    toggle('__match-shift\x0D');
    expect(search.message).toBe('Search match shift is .5 of screen width');
  });

  it('queries the -j default as screen line 0 like jump_sline_arg', () => {
    toggle('_j');
    expect(search.message).toBe('Position target at screen line 0');
  });

  it('quotes the tags file name in the -T query', () => {
    toggle('_T');
    expect(search.message).toBe('Tags file "tags"');
  });
});

describe('get_swindow (-z)', () => {
  it('uses a positive -z directly', () => {
    config.setWindow = 5;
    expect(getSwindow()).toBe(5);
  });

  it('treats zero and negative -z relative to the screen height', () => {
    config.setWindow = 0;
    expect(getSwindow()).toBe(24);

    config.setWindow = -5;
    expect(getSwindow()).toBe(19);
  });

  it('subtracts the --header lines like less', () => {
    opt.headerLines = 3;
    expect(getSwindow()).toBe(20);
  });
});

describe('chop_line', () => {
  it('forces chopping while a --header is active', () => {
    expect(chopLine()).toBe(false);

    setHeader('2', content);
    expect(chopLine()).toBe(true);

    setHeader('-', content);
    expect(chopLine()).toBe(false);

    setHeader(',3', content);
    expect(chopLine()).toBe(true);
  });
});

describe('--rscroll handler', () => {
  it('disables the marker with "-"', () => {
    toggle('--rscroll=-\x0D');
    expect(optRscroll()).toBe('');
    expect(search.message).toBe('rscroll character is -');
  });

  it('parses a "*x" attribute prefix like setfmt', () => {
    toggle('--rscroll=*u#\x0D');
    expect(optRscroll()).toBe('#');
    expect(opt.rscrollAttr).toBe('u');
    expect(search.message).toBe('rscroll character is #');
  });

  it('rejects a wide character and reports the old state after', () => {
    toggle('--rscroll=好\x0D');
    expect(optRscroll()).toBe('>');
    expect(search.message).toBe('cannot set rscroll to a wide character');
    expect(search.messageQueue).toContain('rscroll character is >');
  });
});

describe('-+ and -! flags', () => {
  it('rejects -+ and -! for string options', () => {
    toggle('-!P');
    expect(search.message)
      .toBe('Cannot use "-+" or "-!" for a string option');

    toggle('-+P');
    expect(search.message)
      .toBe('Cannot use "-+" or "-!" for a string option');
  });

  it('rejects -! for numeric options', () => {
    toggle('-!h');
    expect(search.message).toBe('Can\'t use "-!" for a numeric option');
  });

  it('sets a bool to the inverse of its default with -!', () => {
    toggle('-!B');
    expect(opt.autoBuffers).toBe(0);
    expect(search.message).toBe("Don't automatically allocate buffers");
  });
});

describe('option parameter edge cases', () => {
  it('turns an empty parameter into a query', () => {
    toggle('-h\x0D');
    expect(opt.backScroll).toBe(-1);
    expect(search.message).toBe('Backwards scroll limit is -1 lines');
  });

  it('rejects an overflowing number like getnumc', () => {
    toggle('-h99999999999\x0D');
    expect(opt.backScroll).toBe(-1);
    expect(search.message)
      .toBe('Number too large in -h (--max-back-scroll)');
  });

  it('resets --wheel-lines to one line when not positive', () => {
    toggle('--wheel-lines=0\x0D');
    expect(opt.wheelLines).toBe(1);
    expect(search.message).toBe('Scroll 1 line(s) on mouse wheel');
  });

  it('reports "No such option" for a bare RETURN', () => {
    toggle('-\x0D');
    expect(search.message).toBe('No such option');
  });

  it('accepts INT_MAX but rejects the very next integer', () => {
    toggle('-h2147483647\x0D');
    expect(opt.backScroll).toBe(2147483647);

    toggle('-h2147483648\x0D');
    expect(opt.backScroll).toBe(2147483647);
    expect(search.message)
      .toBe('Number too large in -h (--max-back-scroll)');
  });

  it('distinguishes missing and forbidden-negative numbers', () => {
    toggle('-hwat\x0D');
    expect(search.message)
      .toBe('Number is required after -h (--max-back-scroll)');

    toggle('-h-1\x0D');
    expect(search.message)
      .toBe('Negative number not allowed in -h (--max-back-scroll)');
  });

  it('keeps a handler limit error but suppresses its follow-up with ^P', () => {
    toggle('-\x10-line-num-width=99\x0D');

    expect(opt.linenumWidth).toBe(7);
    expect(search.message)
      .toBe('Line number width must not be larger than 16');
    expect(search.messageQueue).toEqual([]);
  });
});

describe('option command cancellation boundaries', () => {
  it('cancels a partly typed parameter on ^C without applying it', () => {
    toggle('-h123');
    optionKey(content, '\x03');

    expect(option.pending).toBe('');
    expect(option.spec).toBe(null);
    expect(opt.backScroll).toBe(-1);
    expect(search.message).toBe('');
  });

  it.each(['\x08', '\x7F'])(
    'erasing past an empty parameter with %j cancels it', key => {
      toggle('-h');
      optionKey(content, key);

      expect(option.pending).toBe('');
      expect(option.spec).toBe(null);
      expect(opt.backScroll).toBe(-1);
    }
  );

  it.each(['\x03', '\x08', '\x7F'])(
    'cancels an empty long-name prompt with %j', key => {
      toggle('--');
      optionKey(content, key);

      expect(option.pending).toBe('');
      expect(option.name).toBe(null);
      expect(search.message).toBe('');
    }
  );

  it.each(['\x03', '\x1B', '\x1B[A', '\x08', '\x7F'])(
    'cancels the bare option prompt with %j', key => {
      startOption('-');
      optionKey(content, key);

      expect(option.pending).toBe('');
      expect(search.message).toBe('');
    }
  );

  it('rings but leaves a no-match TAB completion editable', () => {
    toggle('--zz');
    stdoutWrite.mockClear();

    optionKey(content, '\x09');

    expect(stdoutWrite).toHaveBeenCalledWith('\x07');
    expect(option.pending).toBe('-');
    expect(option.name).toBe('zz');
  });

  it('cycles TAB completion through candidates and back to the stem', () => {
    toggle('--qui');
    const names: (string | null)[] = [];

    for (let i = 0; i < 6; i++) {
      optionKey(content, '\x09');
      names.push(option.name);
    }

    expect(names).toEqual([
      'quit-at-eof',
      'quit-if-one-screen',
      'quit-on-intr',
      'quiet',
      'qui',
      'quit-at-eof',
    ]);
  });

  it('lets repeated modifiers cancel each other before the option', () => {
    toggle('-++s');
    expect(opt.squeeze).toBe(1);

    toggle('-!!s');
    expect(opt.squeeze).toBe(0);

    toggle('-\x10\x10s');
    expect(opt.squeeze).toBe(1);
    expect(search.message).toBe('Squeeze multiple blank lines');
  });

  it('rejects both querying and changing a no-toggle/no-query option', () => {
    toggle('_p');
    expect(search.message).toBe('Cannot query the -p (--pattern) option');

    toggle('-p');
    expect(search.message).toBe('Cannot change the -p (--pattern) option');
  });
});

describe('option prompt line editing, like less cmd_char', () => {
  it('edits a number parameter with the cursor keys', () => {
    toggle('-h12');
    optionKey(content, '\x1b[D');
    optionKey(content, '3');
    optionKey(content, '\x0D');

    expect(opt.backScroll).toBe(132);
    opt.backScroll = -1;
  });

  it('keeps the long-name prompt open across arrow keys', () => {
    startOption('-');
    for (const key of '-wor') optionKey(content, key);

    optionKey(content, '\x1b[D');
    expect(option.pending).toBe('-');

    optionKey(content, '\x1b[C');
    optionKey(content, '\x0D');
    expect(search.message).toBe('Wrap lines at spaces');
    toggle('--wordwrap\x0D');
  });

  it('kills a parameter back with ^U, like EC_LINEKILL', () => {
    toggle('-h99');
    optionKey(content, '\x15');
    optionKey(content, '7');
    optionKey(content, '\x0D');

    expect(opt.backScroll).toBe(7);
    opt.backScroll = -1;
  });
});

describe('long option names', () => {
  it('accepts a mixed-case name for the upper state like sprefix', () => {
    toggle('--Quit-a\x0D');
    expect(optQuitAtEof()).toBe(2);
    expect(search.message).toBe('Quit immediately at end-of-file');
  });

  it('completes names with TAB like findopts_name', () => {
    startOption('-');
    for (const key of '-qui') optionKey(content, key);

    optionKey(content, '\x09');
    expect(option.name).toBe('quit-at-eof');

    optionKey(content, '\x09');
    expect(option.name).toBe('quit-if-one-screen');
  });

  it('suppresses the message with ^P like OPT_NO_PROMPT', () => {
    toggle('-\x10s');
    expect(opt.squeeze).toBe(1);
    expect(search.message).toBe('');
    opt.squeeze = 0;
  });
});

describe('$LESS_UNSUPPORT and $LESS_IS_MORE', () => {
  it('ignores unsupported options in the scan', () => {
    initUnsupport('-e');
    scanOptions('e', []);
    expect(opt.quitAtEof).toBe(0);

    initUnsupport('');
    scanOptions('e', []);
    expect(opt.quitAtEof).toBe(1);
    opt.quitAtEof = 0;
  });

  it('maps -e onto more semantics via get_quit_at_eof', () => {
    opt.lessIsMore = 1;
    expect(optQuitAtEof()).toBe(1);

    opt.quitAtEof = 1;
    expect(optQuitAtEof()).toBe(2);
  });

  it('treats -n as the -z window size in more mode', () => {
    opt.lessIsMore = 1;
    scanOptions('n30', []);
    expect(config.setWindow).toBe(30);
  });

  it('marks the -i/-I pair together from either spelling', () => {
    initUnsupport('--ignore-case');
    scanOptions('-iI', []);
    expect(search.caseless).toBe(0);

    initUnsupport('-I');
    scanOptions('-Ii', []);
    expect(search.caseless).toBe(0);
  });

  it('consumes an unsupported string value but keeps scanning after $', () => {
    initUnsupport('--prompt');
    scanOptions('-Pignored$-S', []);

    expect(config.chopLongLines).toBe(true);
  });

  it('rescans digits after an unsupported number as a -z window', () => {
    initUnsupport('--max-back-scroll');
    scanOptions('-h12S', []);

    expect(opt.backScroll).toBe(-1);
    expect(config.setWindow).toBe(12);
    expect(config.chopLongLines).toBe(true);
  });

  it('lets a dangling unsupported option consume the whole next arg', () => {
    initUnsupport('P');
    scanOptions('-P', [], false);
    scanOptions('-S', [], false);
    flushPendopt();

    expect(config.chopLongLines).toBe(false);
    expect(search.message).toBe('');
  });

  it('uses -p as the every-file command under more semantics', () => {
    opt.lessIsMore = 1;
    const startup = scanOptions('-pG$', []);

    expect(startup.firstCmds).toEqual([]);
    expect(getFirstCmd()).toBe('G');
  });

  it('skips an unknown long name and still marks a later entry', () => {
    initUnsupport('--bogus --chop-long-lines');
    scanOptions('-S', []);

    expect(config.chopLongLines).toBe(false);
    expect(search.message).toBe('');
  });
});

describe('command line argument scans (less scan_option per arg)', () => {
  it('accepts a bare long option argument', () => {
    const startup = scanOptions('--help', [], false);
    expect(startup.dohelp).toBe(true);
    expect(search.message).toBe('');
  });

  it('keeps -r literal outside the environment', () => {
    const before = opt.ctldisp;

    scanOptions('r', [], false);
    expect(opt.ctldisp).toBe(1);

    scanOptions('r', []);
    expect(opt.ctldisp).toBe(2);

    opt.ctldisp = before;
  });

  it('takes the next argument for a dangling option, like pendopt', () => {
    const original = prProto(0);

    scanOptions('-P', [], false);
    expect(search.message).toBe('');

    // "X" is no style selector, so the short prompt takes it whole;
    // less hands the raw argument over, without $ processing
    scanOptions('X prompt$', [], false);
    flushPendopt();
    expect(search.message).toBe('');

    expect(prProto(0)).toBe('X prompt$');
    setProto('s' + original);
  });

  it('takes the next argument for a dangling number option', () => {
    scanOptions('-h', [], false);
    scanOptions('12', [], false);
    flushPendopt();
    expect(opt.backScroll).toBe(12);
    expect(search.message).toBe('');
    opt.backScroll = -1;
  });

  it('reports a dangling option left at the end, like nopendopt', () => {
    scanOptions('-P', [], false);
    flushPendopt();
    expect(search.message).toBe('Value is required after -P (--prompt)');
  });

  it('skips the option handler for a pendopt number, like less', () => {
    // an attached value runs opt_wheel_lines and clamps to 1
    scanOptions('--wheel-lines=0', [], false);
    expect(opt.wheelLines).toBe(1);

    // a two-argument value writes the variable raw (less calls getnumc
    // into the ovar without the handler)
    scanOptions('--wheel-lines', [], false);
    scanOptions('0', [], false);
    expect(opt.wheelLines).toBe(0);

    opt.wheelLines = 1;
  });

  it('classifies argument consumption, like isoptpending', () => {
    expect(optionArgPending('-P', null)?.letter).toBe('P');
    expect(optionArgPending('-b', null)?.letter).toBe('b');
    expect(optionArgPending('--tabs', null)?.letter).toBe('x');

    // an attached value satisfies the option
    expect(optionArgPending('-Pfoo', null)).toBe(null);
    expect(optionArgPending('--tabs=4', null)).toBe(null);
    expect(optionArgPending('-e', null)).toBe(null);

    // the pending option consumes the whole next argument
    const pending = optionArgPending('-P', null);
    expect(optionArgPending('anything at all', pending)).toBe(null);

    // classification stays silent
    expect(search.message).toBe('');
  });

  it('reports every recognized option to the classifier callback', () => {
    const seen: string[] = [];
    const pending = optionArgPending(
      ' \t-S$--tabs=4+ignored',
      null,
      spec => seen.push(spec.names[0])
    );

    expect(pending).toBe(null);
    expect(seen).toEqual(['chop-long-lines', 'tabs']);
    expect(search.message).toBe('');
  });

  it('classifies digit and more-mode -n arguments as -z', () => {
    const digits: string[] = [];
    optionArgPending('25', null, spec => digits.push(spec.names[0]));
    expect(digits).toEqual(['window']);

    opt.lessIsMore = 1;
    const more: string[] = [];
    optionArgPending('n10', null, spec => more.push(spec.names[0]));
    expect(more).toEqual(['window']);
  });

  it('stores CLI option arrays by identity and consumes them once', () => {
    const args = ['-S', '--tabs=4'];
    setCliOptions(args);

    expect(takeCliOptions()).toBe(args);
    expect(takeCliOptions()).toEqual([]);
  });

  it('rejects punctuation trailing a complete long name silently', () => {
    const seen: string[] = [];

    expect(optionArgPending('--help!', null,
      spec => seen.push(spec.names[0]))).toBe(null);
    expect(seen).toEqual([]);
    expect(search.message).toBe('');
  });

  it('reports an unreadable --lesskey-src file at startup', () => {
    scanOptions('--lesskey-src=/definitely/not/there', []);

    expect(search.message)
      .toBe('Cannot use lesskey source file "/definitely/not/there"');
  });

  it('accepts what less accepts, and only complains the way it does', () => {
    // measured against less over four inputs. Only a MISSING file is an
    // error there; the other three load silently, and the compiled
    // binary is the one this used to refuse - less's line stops at its
    // first NUL (lesskey_parse.c:722), so less reads an empty first line
    // where this read the whole blob and called it a missing action
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-ks-'));
    const write = (name: string, data: string | Buffer): string => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, data);
      return file;
    };

    // "\0M+G" + a 'c' section binding x to A_QUIT(24) + "x" "End"
    const compiled = Buffer.from([
      0x00, 0x4D, 0x2B, 0x47,
      0x63, 3, 0, 0x78, 0x00, 24,
      0x78, 0x45, 0x6E, 0x64,
    ]);

    for (const [name, data] of [
      ['empty.src', ''],
      ['compiled.src', compiled],
      ['crlf.src', 'x quit\r\n'],
    ] as [string, string | Buffer][]) {
      resetLesskey();
      search.message = '';
      scanOptions(`--lesskey-src=${write(name, data)}`, []);

      expect([name, search.message]).toEqual([name, '']);
    }

    // the CRLF file was the last one read, and its binding took
    expect(userBinding('x')?.action).toBe('EXIT');

    resetLesskey();
  });

  it('sets each startup header-search exclusion independently', () => {
    scanOptions('--no-search-header-lines', []);
    expect({
      lines: opt.nosearchHeaderLines,
      cols: opt.nosearchHeaderCols,
    }).toEqual({ lines: 1, cols: 0 });

    scanOptions('--no-search-header-columns', []);
    expect({
      lines: opt.nosearchHeaderLines,
      cols: opt.nosearchHeaderCols,
    }).toEqual({ lines: 0, cols: 1 });
  });
});

describe('shared parser boundaries copied from less helpers', () => {
  it('prints NUL, ESC and DEL with prchar notation', () => {
    expect(prChar('\x00')).toBe('^@');
    expect(prChar('\x1B')).toBe('ESC');
    expect(prChar('\x7F')).toBe('^?');
  });

  it('uses prchar notation when --intr contains ESC', () => {
    toggle('--intr=^[\x0D');
    toggle('__intr\x0D');

    expect(search.message).toBe('interrupt character is ESC');
  });

  it.each([
    ['d', BOLD_ON, BOLD_OFF],
    ['u', UNDERLINE_ON, UNDERLINE_OFF],
    ['k', '\x1B[5m', '\x1B[25m'],
    ['n', '', ''],
    ['s', INVERSE_ON, INVERSE_OFF],
  ])('maps the *%s rscroll attribute to its terminal pair',
    (attr, on, off) => {
      opt.rscrollAttr = attr as typeof opt.rscrollAttr;
      expect(optRscrollAttr()).toEqual({ on, off });
    });

  it('keeps valid --emouse bits around an invalid list member', () => {
    toggle('--emouse=all\x0D');
    search.message = '';
    search.messageQueue.length = 0;

    toggle('--emouse=scroll,bogus,lclick\x0D');

    expect(search.message).toBe('--emouse: invalid name "bogus"');
    expect(search.messageQueue)
      .toEqual(['Mouse features enabled: scroll,lclick']);
  });

  it('skips empty comma-separated --emouse members', () => {
    toggle('--emouse=,scroll,,lclick,\x0D');
    toggle('__emouse\x0D');

    expect(search.message).toBe('Mouse features enabled: scroll,lclick');
  });

  it('treats an ambiguous --emouse member as zero and scans on', () => {
    toggle('--emouse=h,lclick\x0D');

    expect(search.message).toBe('--emouse: ambiguous name "h"');
    expect(search.messageQueue).toEqual(['Mouse features enabled: lclick']);
  });

  it('normalizes every --search-options form in one mixed value', () => {
    toggle('--search-options=efknrEw5313\x0D');
    toggle('__search-options\x0D');

    // W wins over E, lowercase is accepted, and sub-searches sort/dedupe.
    expect(search.message).toBe('search options: FKNRW135');
  });

  it('skips duplicate, decreasing, and overflowing tab stops', () => {
    setTabs(' 4, 4, 3, 10, 2147483648, 18 ');

    expect(opt.tabStops).toEqual([0, 4, 10, 18]);
    expect(nextTabStop(18)).toBe(26);
  });

  it('preserves old tab stops when no positive stop survives', () => {
    setTabs('4,12');
    setTabs('0,0,2147483648');

    expect(opt.tabStops).toEqual([0, 4, 12]);
    expect(nextTabStop(12)).toBe(20);
  });

  it('caps the explicit tab-stop table at 127 entries after zero', () => {
    setTabs(Array.from({ length: 140 }, (_, i) => String(i + 1)).join(','));

    expect(opt.tabStops).toHaveLength(128);
    expect(opt.tabStops.at(-1)).toBe(127);
    expect(nextTabStop(127)).toBe(128);
  });

  it('reports all four --no-search-header combinations', () => {
    const messages: string[] = [];

    for (const [lines, cols] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      setNoSearchHeaders(lines, cols);
      noSearchHeadersMessage();
      messages.push(search.message);
    }

    expect(messages).toEqual([
      'Search includes header lines and columns',
      'Search includes header columns but not header lines',
      'Search includes header lines but not header columns',
      'Search does not include header lines or columns',
    ]);
  });

  it('defers a startup header and clamps an oversized start line', () => {
    scanOptions('--header=2,3,999', []);
    expect(opt.headerLines).toBe(0);

    applyPendingHeader(content);

    expect(opt.headerLines).toBe(2);
    expect(opt.headerCols).toBe(3);
    expect(opt.headerStart).toBe(content.length - 1);
    expect(config.row).toBe(content.length - 1);
  });
});

describe('-J status column search chars (less init_status_col)', () => {
  it('shows * for visible and </>/= for chopped-away matches', () => {
    startSearch('/', 1);
    for (const char of 'm3') searchInputKey(char);
    execSearch(content);

    // wrapped display: the match is always visible
    expect(statusColChar('m3', 2)).toBe('*');
    expect(statusColChar('m4', 3)).toBe('');

    // chopped with a horizontal shift: the match sits off-screen
    config.chopLongLines = true;
    config.col = 10;
    config.screenWidth = 20;
    expect(statusColChar('m3' + ' '.repeat(40), 2)).toBe('<');

    config.col = 0;
    expect(statusColChar(' '.repeat(30) + 'm3', 2)).toBe('>');
    expect(statusColChar('m3' + ' '.repeat(30) + 'm3', 2)).toBe('>');

    config.col = 10;
    expect(statusColChar('m3' + ' '.repeat(30) + 'm3', 2)).toBe('=');

    clearHighlight();
    config.chopLongLines = false;
    config.col = 0;
    config.screenWidth = 80;
  });
});

describe('-f force_open guards (less bad_file/edit)', () => {
  it('refuses a directory without -f and tries with it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-f-'));
    initFiles([dir]);

    expect(loadFile(0)).toBe(null);
    expect(search.message).toBe(`${dir} is a directory`);

    // -f forces past bad_file: the failing read leaves less's empty
    // file with prompt_message's "read error"
    search.message = '';
    opt.forceOpen = 1;
    expect(loadFile(0)).toEqual(['']);
    expect(search.message).toBe('read error');

    opt.forceOpen = 0;
    fs.rmdirSync(dir);
  });
});

describe('pipe size, like ch_length() and --file-size', () => {
  it('reports ? for size until a read past the end returns EOI', () => {
    expect(prExpand(content, '%s')).toBe('?');
    expect(prExpand(content, '%B')).toBe('?');
    expect(prExpand(content, '?s%s:no size.')).toBe('no size');

    // displaying the end alone is not enough, like less's ch_length
    // staying NULL_POSITION until a read returns EOI
    mode.EOF = true;
    expect(prExpand(content, '%s')).toBe('?');
    revealPipeEnd();
    expect(prExpand(content, '%s')).toMatch(/^\d+$/);

    // and it stays known afterwards
    mode.EOF = false;
    expect(prExpand(content, '?s%s:no size.')).toMatch(/^\d+$/);
  });

  it('learns the size when --file-size turns on, like scan_eof', () => {
    expect(prExpand(content, '%s')).toBe('?');

    toggle('--file-size\x0D');
    expect(search.message).toBe('Get size of each file');
    expect(prExpand(content, '%s')).toMatch(/^\d+$/);
  });
});

describe('-~ padding past end of file, like gline on null lines', () => {
  const stripped = (row: string): string =>
    row.replace(/\x1b\[[0-9;]*m/g, '');

  beforeEach(() => {
    opt.tildes = 1;
    config.blankTop = 0;
  });

  it('draws forced-back rows above BOF as tildes too', () => {
    config.blankTop = 2;
    const rows = screenRows(content.slice(0, 5), []);

    expect(stripped(rows[0])).toBe('~');
    expect(stripped(rows[1])).toBe('~');
    expect(stripped(rows[2])).not.toBe('~');
    expect(rows.length).toBe(config.window);
  });

  it('draws rows above BOF blank with tildes off', () => {
    config.blankTop = 2;
    toggle('-~');
    const rows = screenRows(content.slice(0, 5), []);

    expect(stripped(rows[0])).toBe('');
  });

  it('shows tilde rows below EOF by default', () => {
    const rows = screenRows(content.slice(0, 5), []);

    expect(rows.length).toBe(config.window);
    expect(stripped(rows[10])).toBe('~');
  });

  it('keeps blank rows and the bottom prompt with tildes off', () => {
    toggle('-~');
    const rows = screenRows(content.slice(0, 5), []);

    expect(rows.length).toBe(config.window);
    expect(stripped(rows[10])).toBe('');
    expect(stripped(rows[config.window - 1])).not.toBe('');
  });
});
