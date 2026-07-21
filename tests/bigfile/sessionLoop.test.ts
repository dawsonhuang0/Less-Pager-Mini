import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/config';

import { search, chgCaseless } from '../../src/features/searching';

import { opt, initUnsupport, setCliOptions } from '../../src/options';

import { bigPager } from '../../src/bigfile/session';

import { pagerPipe } from '../../src';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-big-loop-'));
const file = path.join(dir, 'large-path-small-fixture.txt');

fs.writeFileSync(file, Array.from({ length: 240 }, (_, i) => {
  if (i === 30) return 'alpha NEEDLE omega';
  if (i === 80) return '{ value in brackets }';
  if (i === 120) return 'x'.repeat(120) + ' wide tail';
  return `line ${i + 1}`;
}).join('\n') + '\n');

const ENV_NAMES = [
  'LESS',
  'LESSHISTFILE',
  'LESSNOCONFIG',
  'LESS_SHELL_COPTION',
  'LESS_SIGUSR1',
] as const;

const originalEnv = Object.fromEntries(
  ENV_NAMES.map(name => [name, process.env[name]])
);

class FakePipe extends EventEmitter {
  paused = true;
  destroyed = false;
  onResume: (() => void) | null = null;
  pause = () => { this.paused = true; return this; };
  resume = () => {
    this.paused = false;
    this.onResume?.();
    return this;
  };
  destroy = () => { this.destroyed = true; return this; };
}

beforeEach(() => {
  process.env.LESSHISTFILE = '-';
  process.env.LESSNOCONFIG =
    'LESS,LESSHISTFILE,LESS_SHELL_COPTION,LESS_SIGUSR1';
  delete process.env.LESS;
  delete process.env.LESS_SHELL_COPTION;
  delete process.env.LESS_SIGUSR1;

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
  setCliOptions([]);

  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

async function drive(
  keys: string[],
  less: string = '',
  ready?: () => void,
  start?: () => Promise<void>,
  boot?: () => void
): Promise<string> {
  process.env.LESS = less;

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
  let dataHandler: ((data: Buffer) => void) | null = null;

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
    const running = start ? start() : bigPager(file);
    boot?.();
    await new Promise(resolve => setImmediate(resolve));

    if (!dataHandler) throw new Error('bigPager did not install a key handler');

    ready?.();
    await new Promise(resolve => setImmediate(resolve));

    for (const key of keys) {
      dataHandler(Buffer.from(key));
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

describe('windowed big-file command loop', () => {
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
      expect(output).toContain('Command not available');
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

  it('runs LESS_SIGUSR1 command keys and removes its signal listener',
    async () => {
      process.env.LESS_SIGUSR1 = 'G';
      const listeners = process.listenerCount('SIGUSR1');

      const output = await drive([], '', () => {
        process.emit('SIGUSR1');
      });

      expect(output).toContain('(END)');
      expect(process.listenerCount('SIGUSR1')).toBe(listeners);
    }, 20000);

  it('honors LESS_SHELL_COPTION in big-file shell commands', async () => {
    const sentinel = path.join(dir, 'shell-coption-ran');
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
    process.env.LESS_SHELL_COPTION = '-ec';

    const command = `false; touch ${sentinel}`;
    await drive(['!', ...command, '\r', '\r']);

    expect(fs.existsSync(sentinel)).toBe(false);
  }, 20000);

  it('pages a bounded growing spool for non-seekable input', async () => {
    const stream = new FakePipe();
    const first = Buffer.from(
      Array.from({ length: 20 }, (_, i) => `pipe line ${i}`).join('\n') + '\n');

    const output = await drive(['j'], '', () => {
      // Satisfy the view's fixed read-ahead target with a newline-free
      // chunk: it lands directly on disk and pauses upstream again.
      stream.emit('data', Buffer.alloc(8 * 1024 * 1024, 0x78));
      expect(stream.paused).toBe(true);
      stream.emit('end');
    }, () => pagerPipe(stream as unknown as Readable), () => {
      stream.emit('data', first);
    });

    expect(output).toContain('pipe line 0');
    expect(stream.destroyed).toBe(true);
  }, 20000);

  it('continues a forward search across bounded spool windows', async () => {
    const stream = new FakePipe();
    const first = Buffer.from(
      Array.from({ length: 20 }, (_, i) => `before ${i}`).join('\n') + '\n');
    let fed = false;

    const output = await drive([
      '/', 'N', 'E', 'E', 'D', 'L', 'E', '\r', 'r',
    ], '', () => {
      stream.onResume = () => {
        if (fed) return;
        fed = true;
        setImmediate(() => {
          stream.emit('data', Buffer.from('after NEEDLE here\n'));
          stream.emit('end');
        });
      };
    }, () => pagerPipe(stream as unknown as Readable), () => {
      stream.emit('data', first);
    });

    expect(output).toContain('NEEDLE');
  }, 20000);

  it('aborts a pending G drain and restores pipe backpressure', async () => {
    const stream = new FakePipe();
    const first = Buffer.from(
      Array.from({ length: 20 }, (_, i) => `held ${i}`).join('\n') + '\n');

    const output = await drive([
      'G', '\x03', 'k',
    ], '', undefined, () => pagerPipe(stream as unknown as Readable), () => {
      stream.emit('data', first);
    });

    expect(output).toContain('Waiting for data');
    expect(output).not.toContain('- 100%');
    expect(stream.paused).toBe(true);
    expect(stream.destroyed).toBe(true);
  }, 20000);
});
