import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/config';

import { search, chgCaseless } from '../../src/features/searching';

import { opt, initUnsupport, setCliOptions } from '../../src/options';

import { bigPager } from '../../src/bigfile/session';

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
] as const;

const originalEnv = Object.fromEntries(
  ENV_NAMES.map(name => [name, process.env[name]])
);

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

async function drive(keys: string[], less: string = ''): Promise<string> {
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
    const running = bigPager(file);
    await new Promise(resolve => setImmediate(resolve));

    if (!dataHandler) throw new Error('bigPager did not install a key handler');

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
});
