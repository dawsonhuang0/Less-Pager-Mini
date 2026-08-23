import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  suspendTerminal: vi.fn(),
  enterScreen: vi.fn(),
  keyboard: {
    setRawMode: vi.fn(),
    resume: vi.fn(),
  },
}));

vi.mock('child_process', async importOriginal => ({
  ...await importOriginal<typeof import('child_process')>(),
  spawnSync: fake.spawnSync,
}));

vi.mock('../../src/tty/keyboard', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/tty/keyboard')>(),
  keyboard: () => fake.keyboard,
}));

vi.mock('../../src/tty/screen', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/tty/screen')>(),
  suspendTerminal: fake.suspendTerminal,
  enterScreen: fake.enterScreen,
}));

import { config, mode } from '../../src/state/config';

import { calculateEOF, resetBellTimer } from '../../src/helpers';

import { search } from '../../src/features/searching';

import { initContent, files } from '../../src/features/files';

import {
  marksKey,
  onSourceMarks,
  resetMarks,
  startSetMark,
  recordLastPosition
} from '../../src/features/jumping';

import { pipeMark, pipeMarkKey, startPipe, resetMisc }
  from '../../src/features/misc';

import { runPipe } from '../../src/commands';

import { opt, hook } from '../../src/options';

import { resetSession, session } from '../../src/state/session';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

/*
 * A seekable file, and a WINDOW onto it.
 *
 * This is the shape that produced every bug below: session.content is
 * not the file, it is a bounded slice, so a mark's local row means one
 * thing before the window slides and something else after. less stores a
 * mark as a POSITION and never has the problem, which is why the pipe
 * has to compare positions too.
 */
const FILE_LINES = Array.from({ length: 200 }, (_, i) => String(i + 1));
const FILE_TEXT = FILE_LINES.join('\n') + '\n';
const FILE_BYTES = Buffer.from(FILE_TEXT, 'latin1');

/** Byte offset of each file line. */
const lineStarts: number[] = [];
for (let at = 0, i = 0; i < FILE_LINES.length; i++) {
  lineStarts.push(at);
  at += FILE_LINES[i].length + 1;
}

/** Which file line the window's row 0 is. */
let windowBase = 0;
const WINDOW_ROWS = 50;

/** File bytes for a range of FILE lines, as the pipe should deliver it. */
const fileLines = (from: number, to: number): string =>
  FILE_LINES.slice(from - 1, to).join('\n') + '\n';

/** Puts a window of the file on screen at a given file line. */
const slideTo = (firstLine: number): void => {
  windowBase = firstLine - 1;
  const rows = FILE_LINES.slice(windowBase, windowBase + WINDOW_ROWS);
  initContent(rows);
  resetSession(rows);
  session.content = rows;
  calculateEOF(session.content);
};

/** Registers the hooks a seekable input publishes. */
const attachSource = (): void => {
  // less's curr_byte: the position table only covers the SCREEN's rows,
  // and a row past it falls back to ch_length -- which is what makes
  // the '$' mark reach the end of the FILE rather than of the window
  const rowByte = (row: number): number =>
    (row >= 0 && row < WINDOW_ROWS
      ? lineStarts[windowBase + row]
      : undefined) ?? FILE_BYTES.length;

  hook.sourceBytePosition = row => rowByte(row);
  hook.sourceReadRange = (from, to) =>
    to > from ? FILE_BYTES.subarray(from, to) : null;
  // less's position(sindex) indexes the SCREEN; with no wrapping screen
  // row k is content row config.row + k
  hook.sourceRowByte = sindex => rowByte(config.row + sindex);

  onSourceMarks({
    position: row => rowByte(row),
    linePosition: line => lineStarts[line - 1] ?? null,
    jump: () => false,
  });
};

const detachSource = (): void => {
  hook.sourceBytePosition = null;
  hook.sourceReadRange = null;
  hook.sourceRowByte = null;
  onSourceMarks(null);
};

/** What the last pipe handed to the shell. */
const piped = (): string | undefined =>
  fake.spawnSync.mock.calls[0]?.[2]?.input;

/** Types the `|` prompt: the mark keys, then runs the command. */
const pipeKeys = (keys: string, cmd = 'wc -l'): void => {
  startPipe();
  for (const key of keys) pipeMarkKey(session.content, key);
  if (!pipeMark.pending) runPipe(cmd);
};

const setMark = (char: string): void => {
  startSetMark(false, 0);
  marksKey(session.content, char);
};

beforeEach(() => {
  resetBellTimer();
  fake.spawnSync.mockReset();
  fake.spawnSync.mockReturnValue({ status: 0 });

  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.window = 6;
  config.screenWidth = 80;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  opt.quiet = 0;
  search.message = '';
  files.index = 0;

  resetMarks();
  resetMisc();
  slideTo(1);
  attachSource();
});

/*
 * config.window is 6, so the screen holds 5 text rows: the bottom line
 * is content row config.row + 4.
 */

describe('a letter mark in the pipe is a position, not a row', () => {
  it('pipes from the mark to the bottom after the window slid', () => {
    // the reported bug: mark line 1, go to the end, pipe. The mark's
    // local row 0 survives the slide as a number and stops naming the
    // line it was set on, so the row comparison said "on screen" and
    // less's before-the-screen branch never fired
    setMark('a');
    slideTo(101);

    pipeKeys('a');

    expect(piped()).toBe(fileLines(1, 105));
  });

  it('pipes from the top through a mark below the screen', () => {
    slideTo(101);
    config.row = 10; // file line 111 at the top
    setMark('a');
    config.row = 0; // scroll back up: the mark is now below the screen

    pipeKeys('a');

    expect(piped()).toBe(fileLines(101, 111));
  });

  it('takes the two marks of a || range in position order', () => {
    setMark('a'); // file line 1
    slideTo(101);
    config.row = 10;
    setMark('b'); // file line 111

    // the second mark is given first, so only ordering by POSITION
    // yields less's range
    pipeKeys('|ba');

    expect(piped()).toBe(fileLines(1, 111));
  });

  it('refuses a mark set in another file, like markpos', () => {
    setMark('a');
    files.index = 1;

    pipeKeys('a');

    expect(search.message).toBe('Mark not in current file');
    expect(fake.spawnSync).not.toHaveBeenCalled();
  });

  it('reports an unset mark before the command prompt opens', () => {
    pipeKeys('z');

    expect(search.message).toBe('Mark not set');
    expect(fake.spawnSync).not.toHaveBeenCalled();
  });
});

describe('the predefined marks are file positions', () => {
  it('pipes one line for ^ at the top of the file', () => {
    // pipe_data copies [spos, epos] INCLUSIVE and then finishes the
    // line, so byte 0 through byte 0 is a whole line, not nothing
    pipeKeys('^');

    expect(piped()).toBe(fileLines(1, 1));
  });

  it('pipes the whole file for ^ once the window slid', () => {
    slideTo(101);

    pipeKeys('^');

    expect(piped()).toBe(fileLines(1, 105));
  });

  it('pipes to the end of the file for $', () => {
    slideTo(101);

    pipeKeys('$');

    expect(piped()).toBe(fileLines(101, 200));
  });

  it('pipes the current screen for . (less takes : and ; together)', () => {
    slideTo(101);

    pipeKeys('.');

    expect(piped()).toBe(fileLines(101, 105));
  });

  it('treats RETURN as .', () => {
    slideTo(101);

    pipeKeys('\r');

    expect(piped()).toBe(fileLines(101, 105));
  });

  it('pipes the top line alone for :', () => {
    slideTo(101);

    pipeKeys(':');

    expect(piped()).toBe(fileLines(101, 101));
  });

  it('pipes the screen for ; , the bottom line', () => {
    slideTo(101);

    pipeKeys(';');

    expect(piped()).toBe(fileLines(101, 105));
  });
});

describe('the last mark in the pipe', () => {
  it('pipes from the recorded last position', () => {
    recordLastPosition(); // at file line 1
    slideTo(101);

    pipeKeys("'");

    expect(piped()).toBe(fileLines(1, 105));
  });

  it('refuses when the last mark was never set', () => {
    // less's markpos has no ch_zero() fallback -- that belongs to gomark
    // -- so an unset LASTMARK fails its "in current file" test
    pipeKeys("'");

    expect(search.message).toBe('Mark not in current file');
    expect(fake.spawnSync).not.toHaveBeenCalled();
  });
});

describe('line-number entry (^N)', () => {
  it('accepts a line below the screen, like find_pos', () => {
    // the window bounds the SCREEN, not the file: bounding the line
    // number by session.content rejected every line past it and piped
    // nothing at all
    pipeKeys('\x0e150\r');

    expect(piped()).toBe(fileLines(1, 150));
  });

  it('accepts a line the window does not hold at all', () => {
    slideTo(101);

    pipeKeys('\x0e5\r');

    expect(piped()).toBe(fileLines(5, 105));
  });

  it('rejects a line past the end of the file', () => {
    pipeKeys('\x0e500\r');

    expect(search.message).toBe('Invalid line number');
    expect(fake.spawnSync).not.toHaveBeenCalled();
  });

  it('rejects line zero', () => {
    pipeKeys('\x0e0\r');

    expect(search.message).toBe('Invalid line number');
    expect(fake.spawnSync).not.toHaveBeenCalled();
  });

  it('takes two line numbers for a || range', () => {
    pipeKeys('|\x0e20\r\x0e10\r');

    expect(piped()).toBe(fileLines(10, 20));
  });
});

describe('a non-seekable input falls back to rows', () => {
  it('pipes out of session.content when there are no positions', () => {
    // a pipe has no positions to compare, and session.content is the
    // whole of what was read, so a row is the only address there is
    detachSource();
    config.row = 1;
    pipeMark.rows = [1, 3];
    pipeMark.positions = [];

    runPipe('wc -l');

    expect(piped()).toBe('2\n3\n4\n');
  });
});
