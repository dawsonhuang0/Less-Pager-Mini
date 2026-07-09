import fs from 'fs';
import os from 'os';
import path from 'path';

import pager from '../../src/index';

import { LtFile } from './ltFile';
import { LtScreen, Cell } from './ltScreen';

/** One screen mismatch in a replayed session. */
export interface LtMismatch {
  /** Step index; -1 is the startup screen. */
  step: number;
  /** The key that produced the screen (printable form). */
  key: string;
  expected: string[];
  actual: string[];
  /** Cells whose characters differ (after blank normalization). */
  charDiffs: number;
  /** Cells whose attributes differ. */
  attrDiffs: number;
}

export interface LtResult {
  steps: number;
  compared: number;
  mismatches: LtMismatch[];
}

/** Renders a cell row as text for reports, blanks as spaces. */
const rowText = (row: Cell[]): string =>
  row.map(cell => (cell.ch === '_' || cell.ch === '\0' ? ' ' : cell.ch))
    .join('')
    .replace(/ +$/, '');

const printable = (key: string): string =>
  [...key].map(ch => (ch < ' ' ? '^' + String.fromCharCode(
    ch.charCodeAt(0) + 0x40
  ) : ch)).join('');

/** Compares two grids; blanks (`_`, `\0`, space) are equivalent. */
function compare(
  expected: Cell[][],
  actual: Cell[][]
): { charDiffs: number, attrDiffs: number } {
  let charDiffs = 0;
  let attrDiffs = 0;

  for (let y = 0; y < expected.length; y++) {
    for (let x = 0; x < expected[y].length; x++) {
      const want = expected[y][x];
      const got = actual[y]?.[x] ?? { ch: '_', attr: 0 };

      const wantCh = want.ch === '_' || want.ch === '\0' ? ' ' : want.ch;
      const gotCh = got.ch === '_' || got.ch === '\0' ? ' ' : got.ch;

      if (wantCh !== gotCh) charDiffs++;
      else if (want.attr !== got.attr) attrDiffs++;
    }
  }

  return { charDiffs, attrDiffs };
}

/**
 * Replays a parsed .lt session against this pager in-process: output
 * feeds the LtScreen emulator and every recorded step's screen is
 * compared, like lesstest's runtest against og.
 */
export async function runLt(lt: LtFile): Promise<LtResult> {
  const screen = new LtScreen(lt.width, lt.height);
  const result: LtResult = { steps: lt.steps.length, compared: 0,
    mismatches: [] };

  // embedded test files land in a scratch directory
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-'));
  const fileArgs: string[] = [];
  const options: string[] = [];

  for (const arg of lt.args) {
    if (arg.startsWith('-') || arg.startsWith('+')) {
      options.push(arg);
    } else if (lt.files[arg] !== undefined) {
      fs.writeFileSync(path.join(dir, arg), lt.files[arg], 'latin1');

      // relative names keep the %f prompt identical to og's recording
      fileArgs.push(arg);
    }
  }

  const savedCwd = process.cwd();
  process.chdir(dir);

  // environment: fixed terminal, no user config or history
  const savedEnv: Record<string, string | undefined> = {};
  const setEnv = (name: string, value: string | undefined): void => {
    savedEnv[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  setEnv('TERM', 'xterm');
  setEnv('LESSNOCONFIG', '1');
  setEnv('LESSHISTFILE', '-');
  setEnv('LESS', options.join(' ') || undefined);
  setEnv('LESSOPEN', undefined);
  setEnv('LESSCLOSE', undefined);
  setEnv('LESSKEYIN', undefined);
  setEnv('LESSKEY_CONTENT', undefined);

  // intercept output into the emulator
  const stdout = process.stdout as unknown as Record<string, unknown>;
  const realWrite = process.stdout.write;
  const realRows = Object.getOwnPropertyDescriptor(stdout, 'rows');
  const realColumns = Object.getOwnPropertyDescriptor(stdout, 'columns');
  const realIsTTY = Object.getOwnPropertyDescriptor(stdout, 'isTTY');

  process.stdout.write = ((data: string | Uint8Array): boolean => {
    screen.feed(typeof data === 'string' ? data : data.toString());
    return true;
  }) as typeof process.stdout.write;

  Object.defineProperty(stdout, 'rows', { value: lt.height,
    configurable: true });
  Object.defineProperty(stdout, 'columns', { value: lt.width,
    configurable: true });
  Object.defineProperty(stdout, 'isTTY', { value: true,
    configurable: true });

  // a fake raw-mode stdin capturing the pager's data handler
  const stdin = process.stdin as unknown as Record<string, unknown>;
  const savedStdin = {
    isTTY: Object.getOwnPropertyDescriptor(stdin, 'isTTY'),
    setRawMode: stdin.setRawMode,
    resume: stdin.resume,
    pause: stdin.pause,
    setEncoding: stdin.setEncoding,
    on: stdin.on,
    off: stdin.off,
    once: stdin.once,
    unshift: stdin.unshift,
  };

  let dataHandler: ((data: string) => void) | null = null;

  Object.defineProperty(stdin, 'isTTY', { value: true,
    configurable: true });
  stdin.setRawMode = () => process.stdin;
  stdin.resume = () => process.stdin;
  stdin.pause = () => process.stdin;
  stdin.setEncoding = () => process.stdin;
  stdin.unshift = () => true;
  stdin.once = (event: string, fn: (data: Buffer) => void) => {
    if (event === 'data') setImmediate(() => fn(Buffer.from('\r')));
    return process.stdin;
  };
  stdin.on = (event: string, fn: (data: string) => void) => {
    if (event === 'data') dataHandler = fn;
    return process.stdin;
  };
  stdin.off = () => process.stdin;

  const checkStep = (step: number, key: string): void => {
    const expected = step < 0 ? lt.firstScreen : lt.steps[step].screen;
    if (!expected) return;

    result.compared++;
    const { charDiffs, attrDiffs } = compare(expected, screen.cells);

    if (charDiffs || attrDiffs) {
      result.mismatches.push({
        step,
        key: printable(key),
        expected: expected.map(rowText),
        actual: screen.cells.map(rowText),
        charDiffs,
        attrDiffs,
      });
    }
  };

  try {
    const session = pager(fileArgs, false, true);

    // the pager registers its key handler synchronously after boot
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    checkStep(-1, '(start)');

    for (let n = 0; n < lt.steps.length; n++) {
      if (!dataHandler) break;

      dataHandler(lt.steps[n].key);
      await new Promise(resolve => setImmediate(resolve));
      checkStep(n, lt.steps[n].key);
    }

    // leave the session; a prompt may need an extra escape first
    if (dataHandler) {
      const quit = dataHandler as (data: string) => void;
      quit('\x03');
      quit('q');
      quit('q');
    }

    await Promise.race([
      session,
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  } finally {
    process.chdir(savedCwd);
    process.stdout.write = realWrite;

    if (realRows) Object.defineProperty(stdout, 'rows', realRows);
    else delete stdout.rows;
    if (realColumns) Object.defineProperty(stdout, 'columns', realColumns);
    else delete stdout.columns;
    if (realIsTTY) Object.defineProperty(stdout, 'isTTY', realIsTTY);
    else delete stdout.isTTY;

    if (savedStdin.isTTY) {
      Object.defineProperty(stdin, 'isTTY', savedStdin.isTTY);
    } else {
      delete stdin.isTTY;
    }

    stdin.setRawMode = savedStdin.setRawMode;
    stdin.resume = savedStdin.resume;
    stdin.pause = savedStdin.pause;
    stdin.setEncoding = savedStdin.setEncoding;
    stdin.on = savedStdin.on;
    stdin.off = savedStdin.off;
    stdin.once = savedStdin.once;
    stdin.unshift = savedStdin.unshift;

    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    fs.rmSync(dir, { recursive: true, force: true });
  }

  return result;
}
