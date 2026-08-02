import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import { calculateEOF, resetBellTimer } from '../../src/helpers';

import { search } from '../../src/features/searching';

import { initContent, files } from '../../src/features/files';

import {
  Mark,
  marksKey,
  onSourceMarks,
  resetMarks,
  startGoMark
} from '../../src/features/jumping';

import { hook } from '../../src/options';

import { resetSession, session } from '../../src/state/session';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

/*
 * A seekable file with a WINDOW onto it, as the pager presents it:
 * session.content is a bounded slice, so its row 0 is the top of the
 * WINDOW and not the beginning of the file.
 */
const FILE_LINES = Array.from({ length: 200 }, (_, i) => String(i + 1));
const FILE_BYTES = Buffer.from(FILE_LINES.join('\n') + '\n', 'latin1');

const lineStarts: number[] = [];
for (let at = 0, i = 0; i < FILE_LINES.length; i++) {
  lineStarts.push(at);
  at += FILE_LINES[i].length + 1;
}

let windowBase = 0;
const WINDOW_ROWS = 50;

const slideTo = (firstLine: number): void => {
  windowBase = firstLine - 1;
  const rows = FILE_LINES.slice(windowBase, windowBase + WINDOW_ROWS);
  initContent(rows);
  resetSession(rows);
  session.content = rows;
  calculateEOF(session.content);
};

let jumped: Mark | null = null;

beforeEach(() => {
  resetBellTimer();

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

  search.message = '';
  files.index = 0;
  jumped = null;

  resetMarks();
  slideTo(1);

  hook.sourceBytePosition = row =>
    lineStarts[windowBase + row] ?? FILE_BYTES.length;

  onSourceMarks({
    position: row => lineStarts[windowBase + row] ?? FILE_BYTES.length,
    linePosition: line => lineStarts[line - 1] ?? null,
    jump: mark => {
      jumped = mark;
      return true;
    },
  });
});

describe('gomark on an unset last mark', () => {
  it("jumps to position zero, not to the window's row 0", () => {
    // og's gomark sets an unset LASTMARK to ch_zero() -- the beginning
    // of the FILE (mark.c:340). Building a synthetic row 0 instead and
    // letting its position be filled in from the window meant `''`
    // after any scrolling jumped to where it already was
    slideTo(101);
    startGoMark(0);
    marksKey(session.content, "'");

    expect(jumped).not.toBeNull();
    expect(jumped!.pos).toBe(0);
  });

  it('lands at the beginning even when the window starts the file', () => {
    startGoMark(0);
    marksKey(session.content, "'");

    expect(jumped!.pos).toBe(0);
  });
});
