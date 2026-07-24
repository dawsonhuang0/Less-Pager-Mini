import { afterEach, beforeEach, describe, expect, it, vi }
  from 'vitest';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { lineForward, lineBackward, forceLineBackward, newlineForward,
  newlineBackward } from '../../src/features/moving';

import { goPos } from '../../src/features/jumping';

import { opt } from '../../src/options';

import { calculateEOF, resetBellTimer } from '../../src/helpers';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const content = Array.from({ length: 30 }, (_, i) => `g${i + 1}`);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 10;
  config.halfScreenWidth = 5;
  config.window = 6;
  config.chopLongLines = true;
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  initContent(content);
  calculateEOF(content);
});

describe('J / K forced scrolling', () => {
  it('J scrolls past (END) up to the last line', () => {
    config.row = 25;
    mode.EOF = true;

    lineForward(content, 3, true);
    expect(config.row).toBe(28);
  });

  it('K pads blank lines above the beginning', () => {
    forceLineBackward(content, 2);

    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(2);
  });

  it('K consumes file distance before padding blanks', () => {
    config.row = 1;
    forceLineBackward(content, 3);

    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(2);
  });

  it('caps the blank padding one short of an empty screen', () => {
    forceLineBackward(content, 99);
    expect(config.blankTop).toBe(config.window - 2);
  });

  it('K at the cap rings the eof bell, like og back with no lines', () => {
    forceLineBackward(content, 99);

    resetBellTimer();
    const write = vi.mocked(process.stdout.write);
    write.mockClear();

    forceLineBackward(content, 1);
    expect(config.blankTop).toBe(config.window - 2);
    expect(write).toHaveBeenCalledWith('\x07');
  });
});

describe('K blank top with the end of file on screen', () => {
  const short = content.slice(0, 3);

  beforeEach(() => {
    calculateEOF(short);
    mode.EOF = true;
  });

  it('keeps (END) while the tail stays on screen, like eof_displayed', () => {
    forceLineBackward(short, 1);

    expect(config.blankTop).toBe(1);
    expect(mode.EOF).toBe(true);
  });

  it('does not consume blanks scrolling forward at end-of-file', () => {
    forceLineBackward(short, 1);
    lineForward(short, 1);

    expect(config.blankTop).toBe(1);
    expect(config.row).toBe(0);
  });

  it('clears (END) once the tail slides below the bottom line', () => {
    forceLineBackward(short, 3);

    expect(config.blankTop).toBe(3);
    expect(mode.EOF).toBe(false);
  });

  it('re-latches (END) when scrolling forward reveals the tail', () => {
    forceLineBackward(short, 3);
    lineForward(short, 1);

    expect(config.blankTop).toBe(2);
    expect(mode.EOF).toBe(true);
  });

  it('K from the initial screen counts only og null rows over BOF', () => {
    // og's row table is top-anchored from the start: the lower-left
    // first paint is a transient visual, not state, so K adds one
    // null row and the tail stays on screen
    mode.INIT = true;
    forceLineBackward(short, 1);

    expect(mode.INIT).toBe(false);
    expect(config.blankTop).toBe(1);
    expect(mode.EOF).toBe(true);
  });
});

describe('ESC-j / ESC-k newline scrolling', () => {
  const wrapped = ['aaaaaaaaaaaaaaaaaaaaaaaaa',
    'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj'];

  beforeEach(() => {
    initContent(wrapped);
    config.chopLongLines = false;
    calculateEOF(wrapped);
  });

  it('scrolls until a revealed bottom row ends its file line', () => {
    // bottom_plus_one is the unwrapped 'dd': one screen row scrolls
    // and the wrapped top line stays on screen mid-wrap, like forw()
    newlineForward(wrapped, 1);
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(1);
  });

  it('rides a wrapped incoming line for free', () => {
    const tail = ['bb', 'cc', 'dd', 'ee', 'ff',
      'aaaaaaaaaaaaaaaaaaaaaaaaa', 'gg'];
    initContent(tail);
    calculateEOF(tail);

    // all three rows of the wrapped line reveal before its end counts
    newlineForward(tail, 1);
    expect(config.row).toBe(3);
    expect(config.subRow).toBe(0);
  });

  it('counts N file lines at the bottom edge', () => {
    newlineForward(wrapped, 2);
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(2);
  });

  it('ESC-k from a mid-line top snaps to the line start first', () => {
    config.row = 0;
    config.subRow = 2;
    newlineBackward(wrapped, 1);
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
  });
});

describe('P byte offset jumps', () => {
  it('jumps to the row containing the offset', () => {
    // rows "g1".."g9" take 3 bytes each with their newlines
    goPos(content, 0);
    expect(config.row).toBe(0);

    goPos(content, 3);
    expect(config.row).toBe(1);

    goPos(content, 8);
    expect(config.row).toBe(2);
  });

  it('clamps past the end to the last line', () => {
    goPos(content, 999999);
    expect(config.row).toBe(29);
  });
});

describe('--past-eof forces backward scrolls too, like og back()', () => {
  beforeEach(() => { opt.pastEof = 1; });
  afterEach(() => { opt.pastEof = 0; });

  it('pads null rows above BOF on a plain k at the top', () => {
    lineBackward(content, 2);

    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(2);
  });

  it('consumes file distance before padding, like the forced back', () => {
    config.row = 1;
    const leftover = lineBackward(content, 3);

    expect(leftover).toBe(0);
    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(2);
  });
});

describe('a -z window of zero or less, like og forw/back nlines == 0', () => {
  it('rings the eof bell and does not move', () => {
    config.row = 10;

    resetBellTimer();
    const write = vi.mocked(process.stdout.write);
    write.mockClear();

    lineForward(content, 0);
    expect(config.row).toBe(10);
    expect(write).toHaveBeenCalledWith('\x07');

    resetBellTimer();
    write.mockClear();

    lineBackward(content, -2);
    expect(config.row).toBe(10);
    expect(write).toHaveBeenCalledWith('\x07');
  });
});

describe('-c full-window forward, like og forw with top_scroll', () => {
  beforeEach(() => { opt.clearRepaint = 1; });
  afterEach(() => { opt.clearRepaint = 0; });

  it('starts a new screen past EOF when fewer lines remain', () => {
    config.row = 22;
    lineForward(content, config.window - 1);

    expect(config.row).toBe(27);
    expect(mode.EOF).toBe(true);
  });

  it('stops once the last file line reaches the top', () => {
    config.row = 22;
    lineForward(content, 100);
    expect(config.row).toBe(29);
  });

  it('clamps a smaller move at the last screenful as usual', () => {
    config.row = 22;
    lineForward(content, config.window - 2);
    expect(config.row).toBe(25);
  });
});
