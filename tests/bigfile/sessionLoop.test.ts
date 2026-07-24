import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/config';

import { search, chgCaseless } from '../../src/features/searching';

import { opt, initUnsupport, setCliOptions } from '../../src/options';

import { Readable, PassThrough } from 'stream';

import streamPager, { pagerPipe } from '../../src/pager/streamPager';

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

fs.writeFileSync(bracketFile, Array.from({ length: 12000 }, (_, i) => {
  if (i === 0) return '{ DISTANT BRACKET START';
  if (i === 11999) return 'DISTANT BRACKET END }';
  return `bracket filler ${i + 1}`;
}).join('\n') + '\n');

fs.writeFileSync(tagsFile, `deep\t${streamedFile}\t11000\n`);

{
  const fd = fs.openSync(sparseFile, 'w');
  fs.writeSync(fd, 'FIRST SPARSE LINE\n');
  fs.ftruncateSync(fd, 2 ** 40);
  const tail = Buffer.from('\nFINAL SPARSE LINE\n');
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

// The fused key loop replays og's ISIG semantics for a typed ^C by
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

describe('unified file command loop', () => {
  it('uses byte-position G/g on a sparse 1TB file', async () => {
    // -n: og's only line-number-scan suppressor — without it, G's
    // og-faithful currline(BOTTOM) walks the whole sparse terabyte
    const output = await drive(['G', 'g'], '-f -S -n', sparseFile);

    expect(output).toContain('FINAL SPARSE LINE');
    expect(output).toContain('FIRST SPARSE LINE');
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

  it('completes the wrapped bottom line on ESC-j, like og forw()',
    async () => {
      // top at line 111 leaves the 130-char line 121 half shown: og's
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
      expect(output).toContain('less-pager-mini 1.11.0');
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
