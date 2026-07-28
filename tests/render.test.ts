import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../src/state/config';

import { render, resetRender } from '../src/helpers';

import { search } from '../src/features/searching';

import { files, initFiles } from '../src/features/files';

import { detectedDimensions } from '../src/tty/screen';

import { subRowStart } from '../src/features/jumping';

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
  config.subAnchor = 0;
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

    // first frame: full redraw from home, no screen clear
    expect(writes[0]).toContain('\x1b[H');
    expect(writes[0]).not.toContain('\x1b[2J');
    expect(writes[0]).toContain('line 10');

    config.row = 11;
    render(content, []);

    // one line forward: scroll up 1, redraw only the exposed rows
    expect(writes[1]).toContain('\x1b[1S');
    expect(writes[1]).not.toContain('\x1b[H\x1b[K');
    expect(writes[1]).toContain('line 33');
    expect(writes[1]).not.toContain('line 12\n');
  });

  it('scrolls down when moving backward', () => {
    config.row = 10;
    render(content, []);

    config.row = 8;
    render(content, []);

    expect(writes[1]).toContain('\x1b[2T');
    expect(writes[1]).toContain('line 8');
    expect(writes[1]).toContain('line 9');
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

    expect(writes[1]).toContain('\x1b[24;2H');
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

    expect(writes[1]).toContain('\x1b[1S');
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
    config.subAnchor = 40 * w;

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
    expect(config.subAnchor).toBe(4 * w + 30);
    expect(screenRows([long], [])[0]).toBe(long.slice(4 * w, 4 * w + 30));

    // a second backward move keeps the SAME anchor: the whole
    // uncovered span still wraps up to where the screen first started
    lineBackward([long], 1);
    expect(config.subAnchor).toBe(4 * w + 30);
    const rows = screenRows([long], []);
    expect(rows[0]).toBe(long.slice(3 * w, 4 * w));
    expect(rows[1]).toBe(long.slice(4 * w, 4 * w + 30));

    // forward walks those entries back off
    lineForward([long], 1);
    expect(screenRows([long], [])[0]).toBe(long.slice(4 * w, 4 * w + 30));

    lineForward([long], 1);
    expect(config.subAnchor).toBe(0);
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
    config.subAnchor = w + 30;

    const rows = screenRows([long], []);

    expect(rows[0]).toBe(long.slice(w, w + 30));
    expect(rows[1]).toBe(long.slice(w + 30, w + 30 + w));
  });
});
