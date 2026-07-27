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
  /** The same rows as attribute masks, for attribute-only diffs. */
  expectedAttrs: string[];
  actualAttrs: string[];
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

/** Renders a cell row's attributes for reports, "." for none. */
const attrText = (row: Cell[]): string =>
  row.map(cell => (cell.attr ? String(cell.attr) : '.')).join('')
    .replace(/\.+$/, '');

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

  // anything a developer's own environment might contribute goes
  // first; the recording then puts back exactly what og had
  for (const name of ['LESS', 'LESSOPEN', 'LESSCLOSE', 'LESSKEYIN',
    'LESSKEY', 'LESSKEY_CONTENT', 'LESSCHARSET', 'LESSBINFMT',
    'LESSUTFBINFMT', 'LESSUTFCHARDEF', 'LESSANSIENDCHARS',
    'LESSANSIMIDCHARS', 'MORE', 'LANG', 'LC_CTYPE', 'LC_ALL']) {
    setEnv(name, undefined);
  }

  // og's lesstest hands less exactly LESS*, COLUMNS, LINES, LANG,
  // LC_CTYPE and MORE (env.c is_less_env) and logs that set as the E
  // lines, so the recording IS the environment less saw. Replay it,
  // minus the synthetic LESS_TERMCAP_* VALUES: those only decide
  // which escape bytes og wrote, and .lt compares screens, not bytes.
  const recorded = Object.entries(lt.env)
    .filter(([name]) => !name.startsWith('LESS_TERMCAP_'));

  for (const [name, value] of recorded) setEnv(name, value || undefined);

  // Which capabilities the recording NAMES is a different matter: og
  // ran with no $TERM at all (env.c never passes it), so every
  // capability it had came from that list and everything else was
  // absent. "ti"/"te" are not on it, and og's term_init homes to the
  // lower left only when both exist (screen.c:2061) - which is why a
  // short first screen sits at the TOP of a recorded screen and at
  // the bottom of a real terminal's. Cancel them the way a termcap
  // entry does, so the replay starts where og started.
  // @8 is kent: without it og's getcc_repl returns a bare ESC to
  // the command loop instead of swallowing it as a partial match
  const canceled = ['ti', 'te', '@8']
    .filter(name => !(`LESS_TERMCAP_${name}` in lt.env));

  if (canceled.length) {
    setEnv('TERMCAP', `lesstest:${canceled.map(n => `${n}@`).join(':')}:`);
  }

  // the args line adds to whatever $LESS the recording carried
  if (options.length) {
    setEnv('LESS', [lt.env.LESS ?? '', ...options].filter(Boolean).join(' '));
  }

  // The developer's own lesskey files must stay out of the replay,
  // but LESSNOCONFIG is the wrong tool: it skips lesskey ENTIRELY
  // (decode.c:1357), including the $LESSKEY_CONTENT a recording may
  // carry - og had that content, so the replay must too. Point every
  // lesskey lookup at a path that cannot exist instead, and leave the
  // recorded content alone.
  const nowhere = path.join(dir, 'no-such-lesskey');

  for (const name of ['LESSKEYIN', 'LESSKEY', 'LESSKEYIN_SYSTEM',
    'LESSKEY_SYSTEM']) {
    if (!(name in lt.env)) setEnv(name, nowhere);
  }

  setEnv('LESSHISTFILE', '-');

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
        expectedAttrs: expected.map(attrText),
        actualAttrs: screen.cells.map(attrText),
        charDiffs,
        attrDiffs,
      });
    }
  };

  try {
    const session = pager(fileArgs, { 'examine-file': true });

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

    // Leave the session; ^G cancels any open command buffer without
    // triggering the pager's ISIG emulation (raw ^C would signal the
    // entire Vitest process group and terminate the harness itself).
    if (dataHandler) {
      const quit = dataHandler as (data: string) => void;
      quit('\x07');
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
