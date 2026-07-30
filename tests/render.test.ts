import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../src/state/config';

import { render, resetRender } from '../src/helpers';

import { search } from '../src/features/searching';

import { files, initFiles } from '../src/features/files';

import { detectedDimensions } from '../src/tty/screen';

import { subRowStart } from '../src/features/jumping';

import { calculateEOF } from '../src/helpers';

import { screenRows } from '../src/helpers';

import { lineForward, lineBackward, setHalfScreenRight,
  setHalfScreenLeft } from '../src/features/moving';

const content = Array.from({ length: 60 }, (_, i) => `line ${i}`);

let writes: string[] = [];
const originalWrite = process.stdout.write;

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.bufferOffset = 0;
  config.keyPrefix = '';
  config.subShift = 0;
  config.screen = [];
  config.screenWidth = 80;
  config.window = 24;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.BUFFERING = false;
  mode.HELP = false;

  search.input = null;
  search.message = '';

  writes = [];
  process.stdout.write = ((chunk: string) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  resetRender();
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

describe('render', () => {
  it('draws a full frame first, then scrolls incrementally', () => {
    config.row = 10;
    render(content, []);

    // og's FIRST paint on the alternate screen homes nowhere:
    // term_init has parked the cursor on the bottom line and forw()
    // writes each line followed by a newline, scrolling the first
    // screenful up into place (screen.c:2061 + forwback.c)
    expect(writes[0]).not.toContain('\x1b[H');
    expect(writes[0]).not.toContain('\x1b[2J');
    expect(writes[0]).toContain('\rline 10\nline 11\n');

    config.row = 11;
    render(content, []);

    // one line forward: og asks the terminal for no scroll at all -
    // forw() clears the prompt row, writes the new line THERE, and
    // the newline ending it scrolls the screen (forwback.c). So the
    // frame is clear_bot + the exposed line + its newline
    expect(writes[1]).toContain('\r\x1b[Kline 33\n');
    expect(writes[1]).not.toContain('\x1b[1S');
    expect(writes[1]).not.toContain('\x1b[H\x1b[K');
    expect(writes[1]).not.toContain('line 12\n');
  });

  it('scrolls down when moving backward', () => {
    config.row = 10;
    render(content, []);

    config.row = 8;
    render(content, []);

    // back() is the mirror: home, REVERSE INDEX (which scrolls the
    // screen down), the line, its newline - newest row first
    expect(writes[1]).toContain('\x1b[H\x1bMline 9\n');
    expect(writes[1]).toContain('\x1b[H\x1bMline 8\n');
    expect(writes[1]).not.toContain('\x1b[2T');
    expect(writes[1]).not.toContain('line 20');
  });

  it("paints forward jumps with og's skipping marker", () => {
    config.row = 10;
    render(content, []);

    config.row = 36;
    render(content, []);

    // og's forw() without top_scroll: clear the prompt row, print
    // "...skipping..." and let the new lines scroll in — no homing
    expect(writes[1]).toContain('...skipping...');
    expect(writes[1]).not.toContain('\x1b[H');
    expect(writes[1]).toContain('line 36');
  });

  it('scrolls an exact-screenful advance without the marker', () => {
    config.row = 10;
    render(content, []);

    // new top = old BOTTOM_PLUS_ONE: og-contiguous by position
    config.row = 10 + config.window - 1;
    render(content, []);

    expect(writes[1]).not.toContain('...skipping...');
    expect(writes[1]).not.toContain('\x1b[H');
    expect(writes[1]).toContain(`line ${10 + config.window - 1}`);
  });

  it('falls back to a full frame on backward jumps', () => {
    config.row = 36;
    render(content, []);

    config.row = 5;
    render(content, []);

    expect(writes[1]).toContain('\x1b[H');
    expect(writes[1]).not.toContain('...skipping...');
    expect(writes[1]).toContain('line 5');
  });

  it('redraws fully after a reset', () => {
    config.row = 10;
    render(content, []);

    resetRender();
    config.row = 11;
    render(content, []);

    expect(writes[1]).toContain('\x1b[H');
    expect(writes[1]).not.toContain('\x1b[1S');
  });

  it('writes nothing when the frame is unchanged (scroll at limit)', () => {
    config.row = 10;
    render(content, []);
    render(content, []);

    expect(writes.length).toBe(1);
  });

  it('echoes a pending key prefix and hides the number buffer', () => {
    mode.BUFFERING = true;
    config.keyPrefix = '\x18';
    render(content, ['1']);

    // like less's A_PREFIX prompt: " ^X", replacing the digit echo
    expect(writes[0]).toContain(' ^X');
    expect(writes[0]).not.toContain('^X1');

    // og spells the escape character "ESC" (prchar, charset.c:533),
    // so a half-read arrow echoes " ESC" and then " ESCO". Whether it
    // is echoed AT ALL is the input layer's call - getcc_repl
    // swallows a bare ESC on any terminal whose kent starts with one.
    writes = [];
    resetRender();
    config.keyPrefix = '\x1B';
    render(content, []);
    expect(writes.join('')).toContain(' ESC');

    writes = [];
    resetRender();
    config.keyPrefix = '\x1BO';
    render(content, []);
    expect(writes.join('')).toContain(' ESCO');

    // the prefix owns the command line: cmd_reset clears the digits
    writes = [];
    resetRender();
    config.keyPrefix = '\x1B';
    render(content, ['1']);
    expect(writes.join('')).toContain(' ESC');
    expect(writes.join('')).not.toContain('ESC1');
  });

  it('replaces the END marker with an echoed key prefix', () => {
    mode.EOF = true;
    config.keyPrefix = ':';

    render(['a', 'b'], []);
    const frame = writes.join('');

    // the " :" prompt takes the marker's line instead of adding one
    expect(frame).toContain(' :');
    expect(frame).not.toContain('(END)');
  });

  it('combines the new-file title with the END marker like og', () => {
    initFiles(['x1', 'x2']);
    files.index = 0;
    files.newFile = true;
    mode.EOF = true;

    render(['a', 'b'], []);
    expect(writes.join('')).toContain('x1 (file 1 of 2) (END) - Next: x2');

    // any following frame drops the new-file part, keeping the marker
    writes = [];
    render(['a', 'b'], []);
    expect(writes.join('')).toContain('(END) - Next: x2');
    expect(writes.join('')).not.toContain('file 1 of 2');

    initFiles([]);
  });

  it('parks the cursor after the prompt on every frame', () => {
    config.row = 10;
    render(content, []);

    // prompt row 24 shows ':' so the cursor parks at column 2
    expect(writes[0]).toContain('\x1b[24;2H');

    config.row = 11;
    render(content, []);

    // a scroll frame parks nothing: og's own newline has left the
    // cursor on the prompt row, right after the prompt it just wrote
    expect(writes[1].endsWith(':\x1b[K\x1b[?2026l')).toBe(true);
  });
});

describe('$LESS_LINES gives up og full_screen', () => {
  // the rows below the window belong to whoever launched us, so
  // scrolling into them is not allowed: og repaints where it would
  // have scrolled and drops the marker (screen.c:966 and its readers)
  afterEach(() => {
    delete process.env.LESS_LINES;
    detectedDimensions();
  });

  const shrink = (): void => {
    process.env.LESS_LINES = String(config.window);
    detectedDimensions();
  };

  it('repaints instead of scrolling one line forward', () => {
    config.row = 10;
    render(content, []);
    shrink();

    config.row = 11;
    render(content, []);

    expect(writes[1]).not.toContain('\x1b[1S');
    expect(writes[1]).toContain('\x1b[H');
    // the whole window reprints, top row included, not just the
    // newly exposed bottom one a scroll would have added
    expect(writes[1]).toContain('line 11');
    expect(writes[1]).toContain('line 33');
  });

  it('drops the skipping marker on a far forward jump', () => {
    config.row = 10;
    render(content, []);
    shrink();

    config.row = 36;
    render(content, []);

    expect(writes[1]).not.toContain('...skipping...');
    expect(writes[1]).toContain('\x1b[H');
    expect(writes[1]).toContain('line 36');
  });

  it('scrolls again once the variable is gone', () => {
    shrink();
    config.row = 10;
    render(content, []);

    delete process.env.LESS_LINES;
    detectedDimensions();

    config.row = 11;
    render(content, []);

    expect(writes[1]).toContain('\r\x1b[Kline 33\n');
  });
});

describe('a width change keeps the top on the same text', () => {
  // og's table[TOP] is a byte position: a width change re-wraps from
  // the same byte, a forward move keeps that shifted grid, and a
  // backward move re-anchors to the absolute one (back_line lands on
  // the greatest row start below the position, input.c:358). All
  // three measured against a live og at 79 columns with -N taking 8.
  const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join('-');

  beforeEach(() => {
    config.row = 0;
    config.chopLongLines = false;
  });

  it('starts the top row AT the shift, not at the boundary', () => {
    config.subRow = 2;
    config.subShift = 5;

    const at = subRowStart(long, 2);
    const rows = screenRows([long], []);

    expect(rows[0]).toBe(long.slice(at + 5, at + 5 + config.screenWidth));
    expect(rows[0]).not.toBe(long.slice(at, at + config.screenWidth));
  });

  it('wraps the rest of that line from the shifted start', () => {
    config.subRow = 0;
    config.subShift = 7;

    const w = config.screenWidth;
    const rows = screenRows([long], []);

    // the next row continues the shifted grid, not the absolute one
    expect(rows[1]).toBe(long.slice(7 + w, 7 + 2 * w));
  });
  it('does not spill past the window when the span fills it', () => {
    // enough backward moves and the uncovered span alone is taller
    // than the screen; the grid below must simply not be reached, as
    // og stops filling the position table. Emitting it anyway overran
    // the row list and the screen jumped to the file's end.
    const w = config.screenWidth;
    const huge = 'x'.repeat(w * 60);

    config.subRow = 2;
    config.subShift = 0;

    const rows = screenRows([huge], []);
    const last = config.window - 2;

    // every visible row comes from the span, the last one included
    expect(rows[0]).toBe(huge.slice(2 * w, 3 * w));
    expect(rows.slice(0, last + 1).every(r => r === 'x'.repeat(w)))
      .toBe(true);
    expect(rows.length).toBe(config.window);
  });

  it('sends a horizontal shift back to the line start, for good', () => {
    // og's pos_rehead: every shift command moves table[TOP] back to
    // the beginning of its line first (command.c:2459 and friends)
    // and trashes the screen. Shifting right and back left therefore
    // leaves the screen at the line's start, not where it began -
    // confirmed against og.
    config.subRow = 3;
    config.subShift = 0;

    setHalfScreenRight([]);
    expect(config.subRow).toBe(0);

    setHalfScreenLeft([]);
    expect(config.col).toBe(0);
    expect(config.subRow).toBe(0);
    expect(screenRows([long], [])[0]).toBe(long.slice(0, config.screenWidth));
  });

  it('pushes the partial row down, then scrolls it off', () => {
    // og's add_back_pos prepends an entry per backward move and
    // add_forw_pos drops table[0] per forward one (position.c:63-90),
    // so the short row walks down the screen and then away
    const w = config.screenWidth;

    config.subRow = 4;
    config.subShift = 30;

    lineBackward([long], 1);
    // og's add_back_pos prepends an ENTRY, whose end is the row that
    // used to be on top - that is what makes the exposed row short
    expect(config.screen[0]).toEqual({ row: 0, offset: 4 * w, end: 4 * w + 30 });
    expect(screenRows([long], [])[0]).toBe(long.slice(4 * w, 4 * w + 30));

    // a second backward move prepends another, and the first keeps the
    // bound it was given
    lineBackward([long], 1);
    expect(config.screen[1].end).toBe(4 * w + 30);
    const rows = screenRows([long], []);
    expect(rows[0]).toBe(long.slice(3 * w, 4 * w));
    expect(rows[1]).toBe(long.slice(4 * w, 4 * w + 30));

    // forward walks those entries back off
    lineForward([long], 1);
    expect(screenRows([long], [])[0]).toBe(long.slice(4 * w, 4 * w + 30));

    lineForward([long], 1);
    // og's add_forw_pos drops table[0] and appends the newly drawn row
    // in one operation, so the table does not shrink - "the entries
    // were walked off" means the top is no longer the SHORT row
    // back_line left, not that the table emptied
    expect(config.screen[0].end - config.screen[0].offset).toBe(w);
    expect(screenRows([long], [])[0])
      .toBe(long.slice(4 * w + 30, 5 * w + 30));
  });

  it('bounds the row a backward move exposes at the old top', () => {
    // og's back_line stops appending once it reaches the old top -
    // "if (new_pos >= curr_pos) break" (input.c) - so the exposed row
    // is partial and the rows below keep the grid they had. Measured
    // against og after a 80 -> 70 resize: a 30-column row, then the
    // shifted grid resuming.
    const w = config.screenWidth;

    config.subRow = 1;
    config.subShift = 0;
    // the entry back_line would have prepended: it ends where the
    // screen used to start, and the next row resumes the grid below
    config.screen = [{ row: 0, offset: w, end: w + 30 }];

    const rows = screenRows([long], []);

    expect(rows[0]).toBe(long.slice(w, w + 30));
    expect(rows[1]).toBe(long.slice(w + 30, w + 30 + w));
  });

  it('anchors the last screenful from the file end, not from the top', () => {
    // og's jump_forw puts the file's LAST LINE on the bottom screen
    // line and lets jump_loc fill upward (jump.c:62), so the anchor is
    // a back_line walk from the end - it never consults where the
    // screen currently starts. We used to COUNT each line's rows and
    // then correct the count whenever the walk reached a top sitting
    // part-way into a row; walking steps instead, so there is nothing
    // to correct and the answer cannot depend on the top at all.
    const w = config.screenWidth;
    const line = 'x'.repeat(w * 40 + 20);   // last row is 20 wide

    config.row = 0;
    config.subRow = 0;

    config.subShift = 0;
    calculateEOF([line]);
    const plain = config.endSubRow;

    config.subShift = 30;
    calculateEOF([line]);

    expect(config.endSubRow).toBe(plain);
    // window-2 rows back from the line's last row
    expect(plain).toBe(40 - (config.window - 2));
  });

  it('drops the partial row once it passes the last line', () => {
    // og's position table holds exactly sc_height entries, so the
    // junction rides down as add_back_pos prepends more rows and is
    // gone the moment it falls off the bottom. Ours is an offset:
    // left standing it rose back INTO view the next time the screen
    // moved forward, putting a short row far below a top og had long
    // since regenerated whole (measured, 80 -> 70 at 25 rows).
    const w = config.screenWidth;
    const huge = 'x'.repeat(w * 200);
    const start = 50 * w;

    config.subRow = 50;
    config.subShift = 30;

    lineBackward([huge], 1);
    expect(config.screen[0].end).toBe(start + 30);

    // the span may fill the screen exactly - the short row ending at
    // the seam is itself the last line - and still show
    lineBackward([huge], config.window - 2);
    expect(screenRows([huge], [])[config.window - 2])
      .toBe(huge.slice(start, start + 30));

    // one row more and it has scrolled off the bottom, for good: the
    // table holds sc_height entries and no more (position.c)
    lineBackward([huge], 1);
    expect(config.screen.every(cell => cell.end !== start + 30)).toBe(true);

    lineForward([huge], 4);
    expect(screenRows([huge], []).slice(0, config.window - 1)
      .every(r => r.length === w)).toBe(true);
  });
});
