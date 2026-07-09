import fs from 'fs';

import { Cell, NULL_COLOR } from './ltScreen';

/** One recorded step: a keystroke and the expected screen after it. */
export interface LtStep {
  /** The raw input character(s) sent to less. */
  key: string;
  /** The expected screen cells, or null for steps without a dump. */
  screen: Cell[][] | null;
  /** Expected cursor position. */
  cursor: { x: number, y: number } | null;
}

/** A parsed .lt session, like lesstest's TestSetup + command list. */
export interface LtFile {
  env: Record<string, string>;
  /** The less command line (options and file names). */
  args: string[];
  /** Embedded test files by name. */
  files: Record<string, string>;
  width: number;
  height: number;
  /** The screen expected right after startup. */
  firstScreen: Cell[][] | null;
  firstCursor: { x: number, y: number } | null;
  steps: LtStep[];
}

/** Splits a quoted parameter list, like lesstest's parse tokens. */
function quoted(line: string): string[] {
  const out: string[] = [];
  const regex = /"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    out.push(match[1].replace(/\\(.)/g, '$1'));
  }

  return out;
}

/**
 * Decodes a `=` screen dump into cells, like lt_screen's screen_read
 * encoding: `@HH` attribute changes, `$HH`/`!HH` color changes, `#`
 * before the cursor cell, `\` escaping literal metachars, `_` blanks.
 */
export function parseScreen(
  dump: string,
  width: number,
  height: number
): { cells: Cell[][], cursor: { x: number, y: number } | null } {
  const cells: Cell[][] = [];
  let cursor: { x: number, y: number } | null = null;

  let attr = 0;
  let fg = NULL_COLOR;
  let bg = NULL_COLOR;
  let i = 0;

  const chars = [...dump];

  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];

    for (let x = 0; x < width; x++) {
      for (;;) {
        const ch = chars[i];

        if (ch === '@') {
          attr = parseInt(chars.slice(i + 1, i + 3).join(''), 16);
          i += 3;
        } else if (ch === '$') {
          fg = parseInt(chars.slice(i + 1, i + 3).join(''), 16);
          i += 3;
        } else if (ch === '!') {
          bg = parseInt(chars.slice(i + 1, i + 3).join(''), 16);
          i += 3;
        } else if (ch === '#') {
          cursor = { x, y };
          i++;
        } else {
          break;
        }
      }

      let ch = chars[i] ?? '_';
      if (ch === '\\') ch = chars[++i] ?? '_';
      i++;

      row.push({ ch, attr, fg, bg });
    }

    cells.push(row);
  }

  return { cells, cursor };
}

/**
 * Parses a .lt session file, like lesstest's parse_testfile.
 */
export function parseLt(path: string): LtFile {
  const data = fs.readFileSync(path);

  const lt: LtFile = {
    env: {},
    args: [],
    files: {},
    width: 80,
    height: 24,
    firstScreen: null,
    firstCursor: null,
    steps: [],
  };

  let i = 0;
  let pendingKey: string | null = null;

  const nextLine = (): string | null => {
    if (i >= data.length) return null;
    const end = data.indexOf(0x0A, i);
    const line = end < 0 ? data.subarray(i) : data.subarray(i, end);
    i = end < 0 ? data.length : end + 1;
    return line.toString('utf8');
  };

  const pushStep = (
    screen: Cell[][] | null,
    cursor: { x: number, y: number } | null
  ): void => {
    if (pendingKey === null) {
      lt.firstScreen = screen;
      lt.firstCursor = cursor;
      return;
    }

    lt.steps.push({ key: pendingKey, screen, cursor });
    pendingKey = null;
  };

  for (;;) {
    const line = nextLine();
    if (line === null) break;

    switch (line[0]) {
      case 'E': {
        const [name, value] = quoted(line);
        lt.env[name] = value.replace(/\^\[/g, '\x1B');
        break;
      }

      case 'A':
        lt.args = quoted(line);
        break;

      case 'F': {
        const [name] = quoted(line);
        const len = parseInt(line.slice(line.lastIndexOf('"') + 2), 10);

        lt.files[name] = data.subarray(i, i + len).toString('latin1');
        i += len;

        // the file block ends with a newline before the next line
        if (data[i] === 0x0A) i++;
        break;
      }

      case '+': {
        // a key without a dump still replays (mid escape sequences)
        if (pendingKey !== null) pushStep(null, null);

        const code = parseInt(line.slice(1), 16);
        pendingKey = String.fromCodePoint(code);
        break;
      }

      case '=': {
        const parsed = parseScreen(line.slice(1), lt.width, lt.height);
        pushStep(parsed.cells, parsed.cursor);
        break;
      }

      case 'Q':
        if (pendingKey !== null) pushStep(null, null);
        break;

      default:
        break;
    }

    if (lt.env.COLUMNS) lt.width = parseInt(lt.env.COLUMNS, 10);
    if (lt.env.LINES) lt.height = parseInt(lt.env.LINES, 10);
  }

  return lt;
}
