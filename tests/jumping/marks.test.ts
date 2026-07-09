import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { calculateEOF, resetBellTimer } from '../../src/helpers';

import { search } from '../../src/features/searching';

import { lineForward } from '../../src/features/moving';

import {
  firstLine,
  marks,
  marksKey,
  startSetMark,
  startGoMark,
  startClearMark,
  resetMarks,
  recordLastPosition
} from '../../src/features/jumping';

const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(
  () => true
);

const content = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);

const setMark = (char: string, n = 0): void => {
  startSetMark(false, n);
  marksKey(content, char);
};

const setBottomMark = (char: string, c = content): void => {
  startSetMark(true, 0);
  marksKey(c, char);
};

const goMark = (char: string, n = 0, c = content): void => {
  startGoMark(n);
  marksKey(c, char);
};

beforeEach(() => {
  // eof/bof bells rate limit to one per second, like og's eof_bell
  resetBellTimer();

  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 80;
  config.window = 6;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  resetMarks();
  writeSpy.mockClear();

  calculateEOF(content);
});

describe('set and goto', () => {
  it('restores a top mark to the top line', () => {
    config.row = 10;
    setMark('a');

    firstLine(content, 1);
    expect(config.row).toBe(0);

    goMark('a');
    expect(config.row).toBe(10);
    expect(search.message).toBe('');
  });

  it('restores a bottom mark to the bottom line', () => {
    config.row = 2;
    setBottomMark('b');

    firstLine(content, 15);
    goMark('b');

    // bottom line (row 6) returns to screen line window-1, so the view
    // is exactly what it was when the mark was set
    expect(config.row).toBe(2);
  });

  it('marks the last non-empty line when the bottom is past EOF', () => {
    const short = ['s1', 's2', 's3'];
    calculateEOF(short);

    setBottomMark('c', short);
    goMark('c', 0, short);

    // mark is (row 2, screen line 3); restoring keeps the top at 0
    expect(config.row).toBe(0);
    expect(search.message).toBe('');
  });

  it('marks line N instead of the screen with an N prefix', () => {
    setMark('x', 8);

    goMark('x');
    expect(config.row).toBe(7);
  });

  it('places the mark on screen line N with an N-prefixed goto', () => {
    setMark('x', 8);

    goMark('x', 3);
    expect(config.row).toBe(5);

    // clipped to the bottom text line like sindex_from_sline
    goMark('x', 99);
    expect(config.row).toBe(7 - (config.window - 2));
  });

  it('reports an unset mark', () => {
    goMark('z');
    expect(search.message).toBe('Mark not set');
    expect(config.row).toBe(0);
  });

  it('rejects invalid mark letters', () => {
    setMark('?');
    expect(search.message).toBe('Invalid mark letter ?');

    search.message = '';
    goMark('5');
    expect(search.message).toBe('Invalid mark letter 5');
  });

  it('reports a line number that does not exist', () => {
    setMark('a', 99);
    expect(search.message).toBe('Cannot find line number 99');
  });

  it('reports a mark beyond the current content', () => {
    config.row = 15;
    setMark('a');

    const filtered = content.slice(0, 5);
    calculateEOF(filtered);
    config.row = 0;

    goMark('a', 0, filtered);
    expect(search.message).toBe('Cannot seek to that file position');
  });

  it('cancels on erase and newline without a message', () => {
    startSetMark(false, 0);
    marksKey(content, '\x0D');
    expect(marks.pending).toBe('');
    expect(search.message).toBe('');

    startGoMark(0);
    marksKey(content, '\x7F');
    expect(marks.pending).toBe('');
    expect(search.message).toBe('');
  });
});

describe('predefined marks', () => {
  it('jumps to the beginning with ^ and the end with $', () => {
    config.row = 10;

    goMark('^');
    expect(config.row).toBe(0);

    goMark('$');
    expect(config.row).toBe(20 - (config.window - 1));
    expect(mode.EOF).toBe(true);
  });
});

describe('previous position', () => {
  it('defaults to the beginning when never set', () => {
    config.row = 10;

    goMark("'");
    expect(config.row).toBe(0);
    expect(search.message).toBe('');
  });

  it('rings the bell when already at the beginning', () => {
    // jump_loc: target already on its screen line -> back(0) -> eof_bell
    goMark("'");
    expect(config.row).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith('\x07');

    writeSpy.mockClear();
    resetBellTimer();
    goMark("'");
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });

  it('gets stuck at the beginning after a short-distance return', () => {
    // within a screen of the top, the backward "Surprise!" branch of
    // jump_loc scrolls without lastmark, so '' cannot come back
    lineForward(content, 3);
    expect(config.row).toBe(3);

    goMark("'");
    expect(config.row).toBe(0);

    goMark("'");
    expect(config.row).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });

  it('is armed by entering the help screen', () => {
    // less's edit_ifile records the last position when it leaves the
    // current file for the help file, so '' returns to the pre-help spot
    lineForward(content, 12);
    recordLastPosition();

    lineForward(content, 2);
    expect(config.row).toBe(14);

    goMark("'");
    expect(config.row).toBe(12);
  });

  it('cycles between beginning and current position with no marks', () => {
    // scrolling never records the previous position
    lineForward(content, 10);
    expect(config.row).toBe(10);

    goMark("'");
    expect(config.row).toBe(0);

    goMark("'");
    expect(config.row).toBe(10);
  });

  it('toggles between the last two positions', () => {
    firstLine(content, 11);
    expect(config.row).toBe(10);

    goMark("'");
    expect(config.row).toBe(0);

    goMark("'");
    expect(config.row).toBe(10);
  });

  it('is not updated by jumps to a visible target', () => {
    lineForward(content, 10);
    expect(config.row).toBe(10);

    // rows 10-14 are displayed; jumping within them skips lastmark
    firstLine(content, 13);
    expect(config.row).toBe(12);

    goMark("'");
    expect(config.row).toBe(0);
  });
});

describe('clear', () => {
  it('clears a mark', () => {
    config.row = 10;
    setMark('a');

    startClearMark();
    marksKey(content, 'a');

    goMark('a');
    expect(search.message).toBe('Mark not set');
  });

  it('rings the bell when clearing an unset mark', () => {
    startClearMark();
    marksKey(content, 'z');

    expect(writeSpy).toHaveBeenCalledWith('\x07');
    expect(search.message).toBe('');
  });

  it('rejects the apostrophe as a clear target', () => {
    startClearMark();
    marksKey(content, "'");

    expect(search.message).toBe("Invalid mark letter '");
  });
});

describe('wrapped lines', () => {
  it('restores a bottom mark across sub-rows', () => {
    config.chopLongLines = false;
    config.screenWidth = 10;

    const wrapped = ['short', 'x'.repeat(25), 'a', 'b', 'c', 'd', 'e', 'f'];
    calculateEOF(wrapped);

    setBottomMark('w', wrapped);

    config.row = 4;
    goMark('w', 0, wrapped);

    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
  });
});

describe('help mode', () => {
  it('ignores setting marks and blocks letter jumps', () => {
    config.row = 10;
    setMark('a');
    config.row = 0;

    mode.HELP = true;

    startSetMark(false, 0);
    expect(marks.pending).toBe('');

    goMark('a');
    expect(config.row).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });
});
