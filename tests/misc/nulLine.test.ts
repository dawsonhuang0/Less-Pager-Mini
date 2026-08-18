import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { opt, option } from '../../src/options';

import { render, resetRender, calculateEOF } from '../../src/helpers';

import { LtScreen } from '../lesstest/ltScreen';

/**
 * less's put_line writes the line buffer up to its first NUL
 * (output.c:72). Under -r a raw NUL reaches that buffer, so the rest
 * of the line AND the newline ending it never reach the terminal: the
 * row collapses into the next one, the rows below drift up, and the
 * prompt — printed at the drifted cursor — ends up one row short of
 * the bottom.
 *
 * The expected screens here were captured from less itself
 * (less/less -r, 10x20 pty) rather than reasoned about.
 */
const WIDTH = 20;
const HEIGHT = 10;

const written: string[] = [];

vi.spyOn(process.stdout, 'write').mockImplementation(data => {
  written.push(String(data));
  return true;
});

/** The screen the written frames actually produce. */
function screenRows(): string[] {
  const screen = new LtScreen(WIDTH, HEIGHT);
  screen.feed(written.join(''));

  return screen.snapshot().cells.map(row =>
    row.map(cell => cell.ch === '_' ? ' ' : cell.ch).join('').trimEnd());
}

const content = ['ab\0cd', 'xy', 'zz'];

// ESC [ K — the bottom-line clear less omits before its marker
const CLEAR_LINE_SEQ = '\x1B[K';

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = WIDTH;
  config.halfScreenWidth = WIDTH / 2;
  config.window = HEIGHT;
  config.chopLongLines = true;
  config.keyPrefix = '';
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = true;
  mode.HELP = false;
  mode.BUFFERING = false;
  mode.DUMB = false;

  search.message = '';
  search.input = null;
  option.pending = '';

  // -r: control characters go to the terminal raw, so the NUL
  // survives into the line instead of becoming ^@
  opt.ctldisp = 1;

  initContent(content);
  calculateEOF(content);
  resetRender();
  written.length = 0;
});

describe('a raw NUL cutting a line short', () => {
  it('merges the row below it and drifts the prompt up', () => {
    render(content, []);

    // less: abxy / zz / ~ x6 / the prompt on row 9 / row 10 left blank
    // (less shows "(END)" there; the prompt TEXT is a session-state
    // matter this unit harness does not set up, so only its ROW is
    // asserted)
    const rows = screenRows();

    expect(rows[0]).toBe('abxy');
    expect(rows[1]).toBe('zz');
    expect(rows.slice(2, 8)).toEqual(Array(6).fill('~'));
    expect(rows[8]).not.toBe('~');
    expect(rows[8]).not.toBe('');
    expect(rows[9]).toBe('');
  });

  it('parks the cursor on the drifted prompt row', () => {
    render(content, []);

    // row 9, just past the prompt — less leaves its cursor there
    // because it never emitted the collapsed row's newline
    expect(written.join('')).toMatch(/\x1B\[9;\d+H/);
    expect(written.join('')).not.toMatch(/\x1B\[10;\d+H/);
  });

  it('parks at the PROMPT\'s width, not the row the drift lands on',
    () => {
      // the last content row is far wider than the prompt, so a park
      // that measures the drifted row instead of the prompt shows up
      // as a wrong COLUMN even though the row is right
      const filled = ['ab\0cd', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8',
        'LONGLINE'];

      initContent(filled);
      calculateEOF(filled);
      resetRender();
      written.length = 0;

      render(filled, []);

      const screen = new LtScreen(WIDTH, HEIGHT);
      screen.feed(written.join(''));
      const snap = screen.snapshot();

      // row 9 holds the prompt, row 10 is the row the collapse freed
      expect(snap.cy).toBe(8);
      expect(snap.cx).toBe(1);
    });

  it('drops the drift when a forced back scrolls the screen', () => {
    // less's K pads a null line above BOF and repaints by scrolling
    // (ESC M) with the prompt addressed absolutely, so the collapse's
    // drift disappears: the prompt returns to the bottom row. Ours
    // must take the scroll path too, which needs every tilde row to
    // carry the same string — see padToEOF.
    render(content, []);
    written.length = 0;

    config.blankTop = 1;
    render(content, []);

    const frame = written.join('');

    expect(frame).toMatch(/\x1B\[10;\d+H/);
    expect(frame).not.toMatch(/\x1B\[9;\d+H/);
  });

  it('appends the repaint marker to an open option prompt\'s echo',
    () => {
      // less's marker is a bare putstr at the cursor (forwback.c:274):
      // typing -r over a squished screen repaints, and since the mca
      // line still shows "-" the row reads "-...skipping...".
      // Captured from less at 12x80.
      mode.INIT = true;
      option.pending = '-';
      render(content, []);
      written.length = 0;

      // the toggle's message arrives while the option echo is up
      option.pending = '';
      search.message = 'Display control characters directly';
      render(content, []);

      const frame = written.join('');

      expect(frame).toContain('...skipping...');
      // no clear before it: the echoed "-" survives on the row
      expect(frame.indexOf('...skipping...'))
        .toBeLessThan(frame.indexOf('\n'));
      expect(frame.slice(0, frame.indexOf('...skipping...')))
        .not.toContain(CLEAR_LINE_SEQ);
    });

  it('leaves an ordinary screen untouched', () => {
    const plain = ['ab', 'xy', 'zz'];

    initContent(plain);
    calculateEOF(plain);
    resetRender();
    written.length = 0;

    render(plain, []);
    const rows = screenRows();

    // no NUL, no collapse: the prompt keeps the bottom row
    expect(rows[0]).toBe('ab');
    expect(rows[1]).toBe('xy');
    expect(rows[8]).toBe('~');
    expect(rows[9]).not.toBe('');
    expect(written.join('')).toMatch(/\x1B\[10;\d+H/);
  });
});
