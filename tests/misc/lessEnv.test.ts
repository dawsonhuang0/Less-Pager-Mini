import { afterEach, beforeEach, describe, expect, it, vi }
  from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { config, mode } from '../../src/state/config';

import { STYLE_REGEX, initAnsiChars } from '../../src/state/constants';

import { search, chgCaseless } from '../../src/features/searching';

import { initContent, files } from '../../src/features/files';

import {
  scanOptions,
  flushPendopt,
  optQuitAtEof,
  optCtldisp,
  optSqueeze,
  optBackScroll,
  optQuotes,
  optHeader,
  optLinenumWidth,
  optNoInit,
  optNoKeypad,
  optNoSearchHeaders,
  setNoSearchHeaders,
  optTagsFile,
  nextTabStop
} from '../../src/options';

import { prProto, setProto } from '../../src/features/prompt';

import {
  getFirstCmd,
  takeStartupLog,
  writeLogFile,
  appendLogLines,
  logFileName,
  overwrite,
  resetMisc
} from '../../src/features/misc';

import { calculateEOF } from '../../src/helpers';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const content = Array.from({ length: 30 }, (_, i) => `e${i + 1}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-env-'));

/** Scans a $LESS value over the shared content, reporting a dangling
 *  option like the pager's startup (og's nopendopt). */
const scan = (env: string): ReturnType<typeof scanOptions> => {
  const result = scanOptions(env, content);
  flushPendopt();
  return result;
};

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.setCol = 0;
  config.setWindow = -1;
  config.screenWidth = 80;
  config.halfScreenWidth = 40;
  config.window = 6;
  config.chopLongLines = false;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  search.messageQueue.length = 0;
  search.input = null;

  resetMisc();
  initContent(content);
  calculateEOF(content);

  // restore defaults for the options exercised here
  scan('-+e -+s -+q -+~ --+no-keypad --+no-init --+use-backslash');
  scan('--header=0,0 --line-num-width=7');
  chgCaseless(0);
  setNoSearchHeaders(0, 0);
  search.message = '';
  search.messageQueue.length = 0;
});

describe('letters and triples', () => {
  it('sets a bool letter', () => {
    scan('-S');
    expect(config.chopLongLines).toBe(true);
    expect(search.message).toBe('');
  });

  it('bunches letters without dashes', () => {
    scan('sS');
    expect(optSqueeze()).toBe(true);
    expect(config.chopLongLines).toBe(true);
  });

  it('flips triples through the letter case', () => {
    scan('-e');
    expect(optQuitAtEof()).toBe(1);

    scan('-E');
    expect(optQuitAtEof()).toBe(2);

    scan('-+e');
    expect(optQuitAtEof()).toBe(0);
  });

  it('treats -r in the environment as -R', () => {
    scan('-r');
    expect(optCtldisp()).toBe(2);

    scan('--raw-control-chars');
    expect(optCtldisp()).toBe(2);
  });

  it('reports an unknown letter and stops, like og', () => {
    scan('-Y -S');
    expect(search.message).toBe(
      'There is no -Y option ("less --help" for help)'
    );
    expect(config.chopLongLines).toBe(false);
  });
});

describe('long names', () => {
  it('matches names and uppercase names', () => {
    scan('--quit-at-eof');
    expect(optQuitAtEof()).toBe(1);

    scan('--QUIT-AT-EOF');
    expect(optQuitAtEof()).toBe(2);
  });

  it('selects the second state through the typed case, like og', () => {
    scan('--Quit-at-eof');
    expect(optQuitAtEof()).toBe(2);
  });

  it('accepts unambiguous abbreviations', () => {
    scan('--quit-at');
    expect(optQuitAtEof()).toBe(1);
  });

  it('reports ambiguous abbreviations with the remainder', () => {
    scan('--quit');
    expect(search.message).toBe(
      '--quit is an ambiguous abbreviation ("less --help" for help)'
    );
  });

  it('reports unknown names with the remainder, like og', () => {
    scan('--xyzzy -S');
    expect(search.message).toBe(
      'There is no --xyzzy -S option ("less --help" for help)'
    );
    expect(config.chopLongLines).toBe(false);
  });

  it('rejects = after a toggle option, like og', () => {
    scan('--squeeze-blank-lines=1');
    expect(search.message).toBe(
      'The --squeeze-blank-lines=1 option should not be followed by ='
    );
    expect(optSqueeze()).toBe(false);
  });

  it('resets to the default with --+name', () => {
    scan('-S');
    scan('--+chop-long-lines');
    expect(config.chopLongLines).toBe(false);
  });

  it('separates letters but not long names with $, like og', () => {
    scan('-S$-s');
    expect(config.chopLongLines).toBe(true);
    expect(optSqueeze()).toBe(true);

    scan('--chop-long-lines$-s');
    expect(search.message).toBe(
      'There is no --chop-long-lines$-s option ("less --help" for help)'
    );
  });
});

describe('-i and -I fold into one caseless option, like og', () => {
  it.each([
    ['-i', 1],
    ['-I', 2],
    ['--ignore-case', 1],
    ['--IGNORE-CASE', 2],
    ['--Ignore-case', 2],
  ])('%s sets caseless %d', (env, caseless) => {
    scan(env);
    expect(search.caseless).toBe(caseless);
  });

  it('resets with -+I', () => {
    scan('-I');
    scan('-+I');
    expect(search.caseless).toBe(0);
  });
});

describe('numbers', () => {
  it('parses a number parameter', () => {
    scan('-h7');
    expect(optBackScroll()).toBe(7);

    scan('-h 12');
    expect(optBackScroll()).toBe(12);
  });

  it('allows negative numbers with negok (-z)', () => {
    scan('-z-5');
    expect(config.setWindow).toBe(-5);
  });

  it('takes a bare number as the -z window, like more', () => {
    scan('-25');
    expect(config.setWindow).toBe(25);

    scan('30');
    expect(config.setWindow).toBe(30);
  });

  it('reports a missing number and rescans the char, like og', () => {
    scan('-hx');
    expect(search.message).toBe('Number is required after -h');

    // og then reads "x" as the -x option, which waits for a value
    expect(search.messageQueue).toContain(
      'Value is required after -x (--tabs)'
    );
  });

  it('reports a rejected negative and rescans it, like og', () => {
    scan('-h-3');
    expect(search.message).toBe('Negative number not allowed in -h');

    // og resumes at the "-", so "3" becomes a more-style window size
    expect(config.setWindow).toBe(3);
  });

  it('reports overflow', () => {
    scan('-b99999999999');
    expect(search.message).toBe('Number too large in -b');
  });

  it('reports a bad long name number with the remainder, like og', () => {
    scan('--max-back-scroll x');
    expect(search.message).toBe(
      'Number is required after max-back-scroll x'
    );
  });

  it('clamps --line-num-width like the runtime toggle', () => {
    scan('--line-num-width=99');
    expect(search.message).toBe(
      'Line number width must not be larger than 16'
    );
    expect(optLinenumWidth()).toBe(7);
  });
});

describe('strings', () => {
  it('reads a -P prompt up to $', () => {
    const original = prProto(0);

    scan('-Pfoo$-S');
    expect(prProto(0)).toBe('foo');
    expect(config.chopLongLines).toBe(true);

    setProto(original);
  });

  it('requires a value at the end of the string', () => {
    scan('-P');
    expect(search.message).toBe('Value is required after -P (--prompt)');

    search.message = '';
    scan('-P ');
    expect(search.message).toBe('Value is required after -P');
  });

  it('ends a space-limited parameter at a space', () => {
    scan('-"<> -S');
    expect(optQuotes()).toEqual({ open: '<', close: '>' });
    expect(config.chopLongLines).toBe(true);

    scan('-""');
  });

  it('limits --tabs to digits and commas', () => {
    scan('--tabs=4,9 -S');
    expect(nextTabStop(0)).toBe(4);
    expect(nextTabStop(4)).toBe(9);
    expect(nextTabStop(9)).toBe(14);
    expect(config.chopLongLines).toBe(true);

    scan('-x');
  });

  it('stores -T unexpanded at startup, like opt__T INIT', () => {
    // only a runtime toggle runs the lglob expansion
    scan('-T~/mytags');
    expect(optTagsFile()).toBe('~/mytags');

    scan('-Ttags');
  });

  it('parses --header lines and columns', () => {
    scan('--header=5,3');
    expect(optHeader()).toEqual({ lines: 5, cols: 3, start: 0 });
  });

  it('escapes $ with --use-backslash', () => {
    const original = prProto(0);

    scan('--use-backslash -Pa\\$b$-S');
    expect(prProto(0)).toBe('a$b');
    expect(config.chopLongLines).toBe(true);

    setProto(original);
  });
});

describe('+ commands', () => {
  it('queues a +cmd for the first file', () => {
    expect(scan('+G').firstCmds).toEqual(['G']);
  });

  it('consumes the rest of the string without $, like og', () => {
    expect(scan('+5 -S').firstCmds).toEqual(['5 -S']);
    expect(config.chopLongLines).toBe(false);
  });

  it('ends the command at $', () => {
    expect(scan('+G$-S').firstCmds).toEqual(['G']);
    expect(config.chopLongLines).toBe(true);
  });

  it('stores ++cmd as the every-file command', () => {
    expect(scan('++G').firstCmds).toEqual([]);
    expect(getFirstCmd()).toBe('G');
  });

  it('turns -p into a search command, like og', () => {
    expect(scan('-pfoo$-S').firstCmds).toEqual(['/foo']);
    expect(config.chopLongLines).toBe(true);
  });
});

describe('special options', () => {
  it('stops at -V and reports the version flag', () => {
    const result = scan('-V -S');
    expect(result.version).toBe(true);
    expect(config.chopLongLines).toBe(false);
  });

  it('collects -? and --help as dohelp and scans on', () => {
    expect(scan('-? -S').dohelp).toBe(true);
    expect(config.chopLongLines).toBe(true);

    expect(scan('--help').dohelp).toBe(true);
  });

  it('sets no-toggle options at startup', () => {
    scan('-X --no-keypad');
    expect(optNoInit()).toBe(true);
    expect(optNoKeypad()).toBe(true);
  });

  it('sets the header search exclusions silently, like og INIT', () => {
    scan('--no-search-headers');
    expect(optNoSearchHeaders()).toEqual({ lines: true, cols: true });
    expect(search.message).toBe('');
  });

  it('-k loads a binary lesskey file, erroring like opt_k', () => {
    // og's lesskey(s, 0) failure message (optfunc.c:293)
    scan('-k/definitely/not/there');
    expect(search.message).toBe(
      'Cannot use lesskey file "/definitely/not/there"');
    search.message = '';
  });
});

describe('-o and -O startup log files', () => {
  it('writes piped-in content silently', () => {
    const log = path.join(dir, 'log1.txt');

    scan(`-o${log}`);
    const pending = takeStartupLog();
    expect(pending).toEqual({ name: log, force: false });

    overwrite.file = log;
    writeLogFile(content, false, true);

    expect(fs.readFileSync(log, 'utf8')).toBe(content.join('\n') + '\n');
    expect(logFileName()).toBe(log);
    expect(search.message).toBe('');
  });

  it('streams later pipe lines into the active log, like ch.c', () => {
    const log = path.join(dir, 'log2.txt');

    scan(`-o${log}`);
    takeStartupLog();
    overwrite.file = log;
    writeLogFile(content, false, true);

    appendLogLines(['late1', 'late2']);

    expect(fs.readFileSync(log, 'utf8'))
      .toBe(content.join('\n') + '\nlate1\nlate2\n');
  });

  it('keeps -O for the silent overwrite', () => {
    const log = path.join(dir, 'log3.txt');
    fs.writeFileSync(log, 'old\n');

    scan(`-O${log}`);
    expect(takeStartupLog()).toEqual({ name: log, force: true });
  });

  it('does not log regular files, like og', () => {
    const log = path.join(dir, 'log4.txt');
    files.list[0].path = path.join(dir, 'input.txt');

    scan(`-o${log}`);

    // og's CH_CANSEEK guard (edit.c:961)
    expect(takeStartupLog()).toBe(null);
    expect(fs.existsSync(log)).toBe(false);
  });
});

describe('LESSANSIMIDCHARS / LESSANSIENDCHARS', () => {
  afterEach(() => {
    delete process.env.LESSANSIMIDCHARS;
    delete process.env.LESSANSIENDCHARS;
    initAnsiChars();
  });

  it('recognizes og default sequences without requiring [', () => {
    initAnsiChars();

    // colon-separated SGR params and a bare ESC-m, like ansi_step
    expect(STYLE_REGEX.test('\x1b[38:5:196m')).toBe(true);
    expect(STYLE_REGEX.test('\x1bm')).toBe(true);
    expect(STYLE_REGEX.test('\x1b(B')).toBe(false);
  });

  it('honors custom end characters', () => {
    process.env.LESSANSIENDCHARS = 'mK';
    initAnsiChars();

    expect(STYLE_REGEX.test('\x1b[K')).toBe(true);
  });

  it('honors custom middle characters', () => {
    process.env.LESSANSIMIDCHARS = 'X';
    initAnsiChars();

    expect(STYLE_REGEX.test('\x1bXXm')).toBe(true);
    expect(STYLE_REGEX.test('\x1b[1m')).toBe(false);
  });
});
