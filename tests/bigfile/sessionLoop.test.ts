import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/state/config';

import { search, chgCaseless } from '../../src/features/searching';

import { opt, initUnsupport, setCliOptions } from '../../src/options';

import { Readable, PassThrough } from 'stream';

import streamPager, { pagerPipe } from '../../src/pager/streamPager';

import { LtScreen } from '../lesstest/ltScreen';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-big-loop-'));
const file = path.join(dir, 'large-path-small-fixture.txt');
const streamedFile = path.join(dir, 'multi-block-fixture.txt');
const sparseFile = path.join(dir, 'sparse-terabyte-fixture.txt');
const oscFile = path.join(dir, 'multi-block-osc8-fixture.txt');
const followFile = path.join(dir, 'follow-fixture.txt');
const bracketFile = path.join(dir, 'multi-block-bracket-fixture.txt');
const tagsFile = path.join(dir, 'tags');

fs.writeFileSync(file, Array.from({ length: 240 }, (_, i) => {
  if (i === 30) return 'alpha NEEDLE omega';
  if (i === 80) return '{ value in brackets }';
  if (i === 120) return 'x'.repeat(120) + ' wide tail';
  return `line ${i + 1}`;
}).join('\n') + '\n');

fs.writeFileSync(streamedFile, Array.from({ length: 12000 }, (_, i) =>
  i === 11999 ? 'FINAL MULTI BLOCK LINE' : `stream line ${i + 1}`
).join('\n') + '\n');

fs.writeFileSync(oscFile, Array.from({ length: 12000 }, (_, i) =>
  i === 10999
    ? '\x1b]8;;https://example.test\x07DEEP OSC LINK\x1b]8;;\x07'
    : `plain line ${i + 1}`
).join('\n') + '\n');

fs.writeFileSync(followFile, 'follow start\n');

// shorter than the window: its first paint is less's squished screen
const shortFile = path.join(dir, 'short-fixture.txt');
fs.writeFileSync(shortFile, 'one\ntwo\nthree\n');

fs.writeFileSync(bracketFile, Array.from({ length: 12000 }, (_, i) => {
  if (i === 0) return '{ DISTANT BRACKET START';
  if (i === 11999) return 'DISTANT BRACKET END }';
  return `bracket filler ${i + 1}`;
}).join('\n') + '\n');

fs.writeFileSync(tagsFile, `deep\t${streamedFile}\t11000\n`);

// A terabyte with LINES in it, clustered at both ends.
//
// It used to be a single 1 TB line: one newline at byte 18, the next
// at 2^40. That passed instantly only because forwLine cut a
// newline-less run at the 64 KiB grid and never went looking for the
// real end - which is the bug that drew a 360 KB line as six rows
// (546290e). less reads to the newline however far it is (input.c:241,
// `do { c = ch_forw_get(); } while (c != '\n' && c != EOI)`), and so
// do we, so that shape now costs a terabyte of scanning in either
// pager. less is in fact SLOWER at it than we are: on a 4 GB version,
// less 10.1s to our 5.2s.
//
// The point of the fixture is byte-position G/g on a huge sparse
// file, not a pathological single line, so the lines live in clusters
// at the head and tail. G and g each land on a cluster and never scan
// the hole; only scrolling into the middle would, and nothing does.
// The file is still 2^40 bytes and still sparse.
{
  const fd = fs.openSync(sparseFile, 'w');

  // head: enough lines to fill a screen after g, including a long
  // line. At 1 KB it is a control: it cannot cost anything, so if the
  // test is still slow the long line was never the reason.
  const long = 'LONGSTART' + 'x'.repeat(1024);
  const head = ['FIRST SPARSE LINE', long, 'AFTER LONG LINE']
    .concat(Array.from({ length: 12 }, (_, i) => `head line ${i + 1}`));
  fs.writeSync(fd, head.join('\n') + '\n');

  fs.ftruncateSync(fd, 2 ** 40);

  // tail: a screenful, so G's screen is all real lines
  const tail = Buffer.from('\n' +
    Array.from({ length: 12 }, (_, i) => `tail line ${i + 1}`).join('\n') +
    '\nFINAL SPARSE LINE\n');
  fs.writeSync(fd, tail, 0, tail.length, 2 ** 40 - tail.length);
  fs.closeSync(fd);
}

const ENV_NAMES = [
  'LESS',
  'LESSHISTFILE',
  'LESSNOCONFIG',
] as const;

const originalEnv = Object.fromEntries(
  ENV_NAMES.map(name => [name, process.env[name]])
);

// The fused key loop replays less's ISIG semantics for a typed ^C by
// signalling its own process group (raiseSigint). stdin is faked to
// a TTY here, so an injected \x03 would SIGINT vitest and the shell
// that launched it — swallow group signals for this suite's lifetime.
const savedKill = process.kill;
process.kill = ((pid: number, signal?: string | number): true =>
  pid <= 0 ? true : savedKill.call(process, pid, signal)
) as typeof process.kill;

beforeEach(() => {
  process.env.LESSHISTFILE = '-';
  process.env.LESSNOCONFIG = '1';
  delete process.env.LESS;

  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.window = 12;
  config.screenWidth = 50;
  config.setCol = 0;
  config.setWindow = -1;
  config.chopLongLines = false;

  opt.linenums = 1;
  opt.squeeze = 0;
  opt.headerLines = 0;
  opt.headerCols = 0;
  opt.mouseMode = 0;
  opt.emouse = 0;
  opt.noPaste = 0;
  opt.noShell = 0;
  opt.quitOnIntr = 0;
  opt.modelines = 0;
  opt.wantFileSize = 0;
  opt.permaMarks = 0;
  search.message = '';
  search.messageQueue.length = 0;
  search.highlight = true;
  chgCaseless(0);
  initUnsupport('');
  setCliOptions([]);
});

afterAll(() => {
  process.kill = savedKill;

  setCliOptions([]);

  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

async function drive(
  keys: Array<string | (() => void | Promise<void>)>,
  less: string = '',
  target: unknown = file
): Promise<string> {
  setCliOptions(less ? less.split(' ') : []);

  const stdout = process.stdout as unknown as Record<string, unknown>;
  const stdin = process.stdin as unknown as Record<string, unknown>;

  const savedWrite = process.stdout.write;
  const savedRows = Object.getOwnPropertyDescriptor(stdout, 'rows');
  const savedColumns = Object.getOwnPropertyDescriptor(stdout, 'columns');
  const savedIsTTY = Object.getOwnPropertyDescriptor(stdout, 'isTTY');
  const savedStdin = {
    isTTY: Object.getOwnPropertyDescriptor(stdin, 'isTTY'),
    setRawMode: stdin.setRawMode,
    resume: stdin.resume,
    pause: stdin.pause,
    on: stdin.on,
    off: stdin.off,
    once: stdin.once,
    unshift: stdin.unshift,
  };

  let output = '';
  // the closure assignments below are invisible to TS flow analysis,
  // so seed the full union to keep call sites from narrowing to never
  let dataHandler = null as ((data: Buffer) => void) | null;

  process.stdout.write = ((data: string | Uint8Array): boolean => {
    output += typeof data === 'string' ? data : data.toString();
    return true;
  }) as typeof process.stdout.write;

  Object.defineProperty(stdout, 'rows', { value: 12, configurable: true });
  Object.defineProperty(stdout, 'columns', { value: 50, configurable: true });
  Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true });

  stdin.setRawMode = () => process.stdin;
  stdin.resume = () => process.stdin;
  stdin.pause = () => process.stdin;
  stdin.unshift = () => true;
  stdin.once = (event: string, fn: (data: Buffer) => void) => {
    if (event === 'data') dataHandler = fn;
    return process.stdin;
  };
  stdin.on = (event: string, fn: (data: Buffer) => void) => {
    if (event === 'data') dataHandler = fn;
    return process.stdin;
  };
  stdin.off = (event: string, fn: (data: Buffer) => void) => {
    if (event === 'data' && dataHandler === fn) dataHandler = null;
    return process.stdin;
  };

  try {
    const running = target instanceof Readable
      ? pagerPipe(target)
      : streamPager(target);
    await new Promise(resolve => setImmediate(resolve));

    if (!dataHandler) {
      throw new Error('streamPager did not install a key handler');
    }

    for (const key of keys) {
      if (typeof key === 'function') {
        await key();
      } else {
        dataHandler(Buffer.from(key));
      }
      await new Promise(resolve => setImmediate(resolve));
    }

    if (dataHandler) dataHandler(Buffer.from('q'));
    await running;
    return output;
  } finally {
    process.stdout.write = savedWrite;

    if (savedRows) Object.defineProperty(stdout, 'rows', savedRows);
    else delete stdout.rows;
    if (savedColumns) Object.defineProperty(stdout, 'columns', savedColumns);
    else delete stdout.columns;
    if (savedIsTTY) Object.defineProperty(stdout, 'isTTY', savedIsTTY);
    else delete stdout.isTTY;

    if (savedStdin.isTTY) {
      Object.defineProperty(stdin, 'isTTY', savedStdin.isTTY);
    } else {
      delete stdin.isTTY;
    }
    stdin.setRawMode = savedStdin.setRawMode;
    stdin.resume = savedStdin.resume;
    stdin.pause = savedStdin.pause;
    stdin.on = savedStdin.on;
    stdin.off = savedStdin.off;
    stdin.once = savedStdin.once;
    stdin.unshift = savedStdin.unshift;
  }
}

/** The screen the driven session's output actually produces. */
function screenOf(output: string): string[] {
  const screen = new LtScreen(50, 12);
  screen.feed(output);

  return screen.snapshot().cells.map(row =>
    row.map(cell => cell.ch === '_' ? ' ' : cell.ch).join('').trimEnd());
}

describe('unified file command loop', () => {
  it('repaints the squished first screen on a backward command',
    async () => {
      // less's back() runs squish_check before it can know whether the
      // scroll is possible (forwback.c:394), so k at BOF fills the
      // blank rows above the text with tildes and only then bells.
      // Captured from less: one/two/three at the top, ~ below.
      const out = await drive(['k'], '', shortFile);
      const rows = screenOf(out);

      expect(rows[0]).toBe('one');
      expect(rows[1]).toBe('two');
      expect(rows[2]).toBe('three');
      expect(rows[3]).toBe('~');
      expect(rows[10]).toBe('~');
    });

  it('leaves the squished first screen alone on a forward command',
    async () => {
      // less's forward() bells and returns BEFORE reaching forw(), so
      // no squish_check runs and the short screen stays bottom-anchored
      const out = await drive(['j'], '', shortFile);
      const rows = screenOf(out);

      expect(rows[0]).toBe('');
      expect(rows[8]).toBe('one');
      expect(rows[9]).toBe('two');
      expect(rows[10]).toBe('three');
    });

  it('uses byte-position G/g on a sparse 1TB file', async () => {
    // -n: less's only line-number-scan suppressor — without it, G's
    // less-faithful currline(BOTTOM) walks the whole sparse terabyte
    const output = await drive(['G', 'g'], '-f -S -n', sparseFile);

    expect(output).toContain('FINAL SPARSE LINE');
    expect(output).toContain('FIRST SPARSE LINE');

    // the long line is ONE row under -S, so the line after it is on
    // screen too: less's skipeol ends a chopped line at its first
    // screenful and skips to the newline (input.c:239), however many
    // megabytes away that is. Cutting it into 64 KiB pieces instead
    // put 64 rows of the same line on screen and pushed this off
    expect(output).toContain('AFTER LONG LINE');
  }, 20000);

  it('keeps shared commands and headers beyond the bootstrap block',
    async () => {
      const output = await drive([
        'G', 'g',
        'h', 'j', 'q',
      ], '--header=2,3,1 -N -S', streamedFile);

      expect(output).toContain('FINAL MULTI BLOCK LINE');
      expect(output).toContain('stream line 1');
      expect(output).toContain('SUMMARY');
    }, 20000);

  it('spools a pipe to disk: G drains it and g returns to the start',
    async () => {
      const pipe = new PassThrough();

      // ~0.9MB pre-buffered so an in-memory pipe would shed its head
      for (let i = 1; i <= 40000; i++) {
        pipe.write(`pipe line ${i} end\n`);
      }

      const output = await drive([
        'G',
        () => { pipe.end(); },
        () => new Promise(resolve => setTimeout(resolve, 300)),
        'g',
        () => new Promise(resolve => setTimeout(resolve, 100)),
      ], '', pipe);

      const tail = output.indexOf('pipe line 40000 end');
      const headAgain = output.lastIndexOf('pipe line 1 end');

      // the true end rendered after the drain...
      expect(tail).toBeGreaterThan(-1);
      // ...and the start is still reachable afterward: the spool kept
      // every byte on disk, nothing was shed
      expect(headAgain).toBeGreaterThan(tail);
    }, 20000);

  it('completes the wrapped bottom line on ESC-j, like less forw()',
    async () => {
      // top at line 111 leaves the 130-char line 121 half shown: less's
      // to_newline reveals its remaining rows, so ' wide tail' (its
      // last wrap row) must reach the screen; a file-line top jump
      // would stop one row short of it
      const output = await drive([
        '1', '1', '1', 'g', '\x1bj',
      ], '', file);

      expect(output).toContain(' wide tail');
    }, 20000);

  it('searches forward and backward outside the materialized window',
    async () => {
      const output = await drive([
        '/', ...'FINAL MULTI BLOCK LINE', '\r',
        'g', 'G',
        '?', ...'stream line 11000', '\r',
      ], '', streamedFile);

      expect(output).toContain('FINAL MULTI BLOCK LINE');
      expect(output).toContain('stream line 11000');
    }, 20000);

  it('restores a seekable source when distant incsearch is cancelled',
    async () => {
      const pattern = 'stream line 11000';
      const output = await drive([
        '/', ...pattern, '\x03',
        '/', ...pattern, '\r',
      ], '--incsearch -S', streamedFile);

      const firstMatch = output.indexOf('stream line 11000');
      const restored = output.indexOf('stream line 1\n', firstMatch + 1);
      const accepted = output.indexOf('stream line 11000', restored + 1);

      expect(firstMatch).toBeGreaterThan(-1);
      expect(restored).toBeGreaterThan(firstMatch);
      expect(accepted).toBeGreaterThan(restored);
    }, 20000);

  it('keeps byte-position marks across distant file windows', async () => {
    const output = await drive([
      'm', 'a',
      'G', 'm', 'b',
      "'", 'a',
      "'", 'b',
    ], '-S -J', streamedFile);

    expect(output).toContain('stream line 1');
    expect(output).toContain('FINAL MULTI BLOCK LINE');
  }, 20000);

  it('sets a numbered mark outside the materialized window', async () => {
    const output = await drive([
      ...'10000', 'm', 'z',
      "'", 'z',
    ], '-S', streamedFile);

    expect(output).toContain('stream line 10000');
  }, 20000);

  it('keeps absolute line numbers after a byte-position jump', async () => {
    const output = await drive(['G'], '-N -S', streamedFile);

    expect(output).toContain('12000');
    expect(output).toContain('FINAL MULTI BLOCK LINE');
  }, 20000);

  it('expands long prompts from absolute file positions', async () => {
    const lines = await drive(['G'], '-M -S', streamedFile);
    const bytes = await drive(['G'], '-n -M -S', streamedFile);

    expect(lines).toContain('/12000');
    expect(bytes).toContain(String(fs.statSync(streamedFile).size));
  }, 20000);

  it('finds OSC 8 links outside the materialized window', async () => {
    const output = await drive(['\x0F', 'n'], '-S', oscFile);

    expect(output).toContain('DEEP OSC LINK');
  }, 20000);

  it('moves through filtered byte-position lines outside the window',
    async () => {
      const output = await drive([
        '&', ...'FINAL MULTI BLOCK LINE', '\r',
        'G', 'g',
        '&', '\r', 'g',
      ], '-S', streamedFile);

      expect(output).toContain('FINAL MULTI BLOCK LINE');
      expect(output).toContain('stream line 1');
    }, 20000);

  it('keeps later command-line files on the seekable source', async () => {
    const output = await drive([
      ':', 'n', '\r', 'G',
      ':', 'p', '\r', 'G',
    ], '-S', [streamedFile, oscFile]);

    expect(output).toContain('plain line 12000');
    expect(output).toContain('FINAL MULTI BLOCK LINE');
  }, 20000);

  it('spans a search into a distant window of the next source file',
    async () => {
      const output = await drive([
        '/', ...'DEEP OSC LINK', '\r',
        '\x1b', 'n',
      ], '-S', [streamedFile, oscFile]);

      expect(output).toContain('DEEP OSC LINK');
    }, 20000);

  it('reverse-spans from EOF into a distant previous source window',
    async () => {
      const output = await drive([
        ':', 'n', '\r',
        '/', ...'stream line 11000', '\r',
        '\x1b', 'N',
      ], '-S', [streamedFile, oscFile]);

      expect(output).toContain('stream line 11000');
    }, 20000);

  it('refreshes a followed regular file through BlockFile', async () => {
    const output = await drive([
      'F',
      () => { fs.appendFileSync(followFile, 'FOLLOW APPENDED LINE\n'); },
      () => new Promise<void>(resolve => setTimeout(resolve, 120)),
      '\x18',
    ], '-S', followFile);

    expect(output).toContain('FOLLOW APPENDED LINE');
  }, 20000);

  it('matches brackets across distant source windows', async () => {
    const output = await drive(['{', '}'], '-S', bracketFile);

    expect(output).toContain('DISTANT BRACKET END }');
    expect(output).toContain('{ DISTANT BRACKET START');
  }, 20000);

  it('pins a header whose absolute start is beyond the bootstrap',
    async () => {
      const output = await drive(
        ['k', 'G'],
        '--header=2,0,11000 -S',
        streamedFile
      );

      expect(output).toContain('stream line 11000');
      expect(output).toContain('stream line 11001');
      expect(output).toContain('FINAL MULTI BLOCK LINE');
      expect(output).not.toContain('stream line 10999');
    }, 20000);

  it('jumps to a distant numeric tag through the source', async () => {
    const output = await drive(
      [],
      `-T${tagsFile} -tdeep -S`,
      streamedFile
    );

    expect(output).toContain('stream line 11000');
  }, 20000);

  it('drives movement, byte/percent jumps, horizontal shifts, and info',
    async () => {
      const output = await drive([
        'j', 'k', 'd', 'u', 'f', 'b',
        'G', 'g',
        '4', '0', '%',
        '1', '0', '0', 'P',
        '\x1b)', '\x1b(', '\x1b$', '\x1b0',
        '=', '\r',
      ]);

      expect(output).toContain(file);
      expect(output).toContain('byte ');
    }, 20000);

  it('drives search, case recompilation, marks, help, and colon errors',
    async () => {
      const output = await drive([
        '/', 'N', 'E', 'E', 'D', 'L', 'E', '\r',
        'n', 'N',
        '-', 'i', '\r',
        'm', 'a', 'G', "'", 'a',
        '\x1bm', 'a',
        'h', 'j', 'd', 'G', 'g', 'q',
        ':', 'n', '\r',
        ':', 'p', '\r',
        ':', 'e', '\r',
        'V', '\r',
      ]);

      expect(output).toContain('No next file');
      expect(output).toContain('No previous file');
      // the running package's own version, so a release bump does
      // not fail a test about the V command
      const { version } = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
      ) as { version: string };

      expect(output).toContain(`less-pager-mini ${version}`);
    }, 20000);

  it('ages a ^O prefix out over an unbound sequence, like cmd_decode',
    async () => {
      // ^O + up-arrow has no binding: less's tail cascade drops the
      // prefix silently and runs the arrow — a stale prefix once
      // re-entered the cascade forever (stack overflow)
      const output = await drive([
        '10g', '\x0f', '\x1b[A',
      ], '', file);

      expect(output).toContain('line 9');
    }, 20000);

  it('drives mouse scrolling, runtime display options, and follow exit',
    async () => {
      const output = await drive([
        '\x1b[<65;1;1M',
        '\x1b[<64;1;1M',
        '-', 'S', '\r',
        '-', 'S', '\r',
        's', '\r',
        'F', '\x18',
      ], '--emouse=all --no-paste');

      expect(output).toContain('Input is not a pipe');
      expect(output).toContain('\x1b[?1006h');
      expect(output).toContain('\x1b[?2004h');
    }, 20000);

  // A key string reaching `drive` is fed as ONE chunk, so a
  // multi-character one leaves keys queued behind the first - less's
  // tty still holding the rest of the burst.

  it('keeps -N numbers correct after the anchor pool evicts',
    async () => {
      // less's table holds LINENUM_POOL entries and drops the smallest
      // gap when full (linenum.c:185). Resolving one per rendered row,
      // this scroll pushes well past 1024, so the numbers on screen
      // come from a table that has evicted.
      const output = await drive(['j'.repeat(150)], '-N -S', streamedFile);
      const rows = screenOf(output).filter(row => /^\s*\d+\s/.test(row));
      const nums = rows.map(row => parseInt(row.trim().split(/\s+/)[0], 10));

      expect(nums.length).toBeGreaterThan(3);
      // contiguous, and naming the line they actually sit on
      nums.forEach((n, i) => {
        if (i > 0) expect(n).toBe(nums[i - 1] + 1);
      });
      expect(rows[0]).toContain(`stream line ${nums[0]}`);
    }, 20000);

  it('warns instead of opening big-file shell and editor commands',
    async () => {
      const output = await drive([
        '!', '\r',
        '#', '\r',
        'v', '\r',
      ], '--no-shell');

      expect(output).toContain('Command not available');
    }, 20000);
});
