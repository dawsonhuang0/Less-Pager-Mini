import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import { content } from '../utils/mockContent';

import { calculateEOF } from '../../src/helpers';

import { search } from '../../src/features/searching';

import { firstLine, lastLine, percentLine } from '../../src/features/jumping';

const len = content.length;

const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(
  () => true
);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.halfScreenWidth = 40;
  config.halfWindow = 12;

  mode.INIT = true;
  mode.EOF = false;

  search.message = '';
  writeSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('chopLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = true;
    calculateEOF(content);
  });

  it('jumps back to the first line', () => {
    firstLine(content, 10);
    expect(config.row).toBe(9);
    expect(mode.INIT).toBe(false);

    firstLine(content, 1);
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
    expect(mode.EOF).toBe(false);
  });

  it('puts the last line at the top when N is the line count', () => {
    firstLine(content, len);
    expect(config.row).toBe(len - 1);
    expect(mode.EOF).toBe(true);
  });

  it('reports an error when the line does not exist', () => {
    firstLine(content, len + 1);
    expect(search.message).toBe(`Cannot seek to line number ${len + 1}`);
    expect(config.row).toBe(0);
    expect(mode.INIT).toBe(true);
  });

  it('jumps to the end of the content', () => {
    lastLine(content, 0);
    expect(config.row).toBe(config.endRow);
    expect(config.subRow).toBe(config.endSubRow);
    expect(mode.EOF).toBe(true);
    expect(mode.INIT).toBe(false);
  });

  it('acts like firstLine when N is given', () => {
    lastLine(content, 10);
    expect(config.row).toBe(9);

    lastLine(content, len + 1);
    expect(search.message).toBe(`Cannot seek to line number ${len + 1}`);
    expect(config.row).toBe(9);
  });

  it('rings the bell when already at the end', () => {
    lastLine(content, 0);
    writeSpy.mockClear();

    lastLine(content, 0);
    expect(writeSpy).toHaveBeenCalledWith('\x07');
    expect(config.row).toBe(config.endRow);
    expect(mode.EOF).toBe(true);
  });

  it('jumps back to the end after passing it', () => {
    config.row = len - 1;
    mode.EOF = true;

    lastLine(content, 0);
    expect(config.row).toBe(config.endRow);
    expect(mode.EOF).toBe(true);
  });

  it('jumps to a percentage into the content', () => {
    percentLine(content, 50);
    expect(config.row).toBe(Math.floor(len * 50 / 100));
    expect(config.subRow).toBe(0);
    expect(mode.INIT).toBe(false);

    percentLine(content, 0);
    expect(config.row).toBe(0);
  });

  it('rounds half to even like less', () => {
    const tenLines = content.slice(0, 10);
    calculateEOF(tenLines);

    // 10 * 25% = 2.5 -> 2 (even), 10 * 75% = 7.5 -> 8 (7 is odd)
    percentLine(tenLines, 25);
    expect(config.row).toBe(2);

    percentLine(tenLines, 75);
    expect(config.row).toBe(8);
  });

  it('lands on the last line at 100 percent and above', () => {
    percentLine(content, 100);
    expect(config.row).toBe(len - 1);
    expect(mode.EOF).toBe(true);

    percentLine(content, 150);
    expect(config.row).toBe(len - 1);
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
    calculateEOF(content);
  });

  it('jumps to the end of the content', () => {
    lastLine(content, 0);
    expect(config.row).toBe(config.endRow);
    expect(config.subRow).toBe(config.endSubRow);
    expect(mode.EOF).toBe(true);
  });

  it('resets subRow when jumping to a line', () => {
    config.subRow = 3;

    firstLine(content, 5);
    expect(config.row).toBe(4);
    expect(config.subRow).toBe(0);
    expect(mode.EOF).toBe(false);
  });

  it('is not at EOF when landing at the start of a wrapped end row', () => {
    firstLine(content, config.endRow + 1);
    expect(config.row).toBe(config.endRow);
    expect(mode.EOF).toBe(config.endSubRow === 0);
  });

  it('jumps to a percentage into the content', () => {
    percentLine(content, 100);
    expect(config.row).toBe(len - 1);
    expect(config.subRow).toBe(0);
    expect(mode.EOF).toBe(true);
  });
});

describe('short-content end jump (jump_loc null-row pad)', () => {
  const short = ['1', '2', '3', '4'];

  beforeEach(() => {
    config.chopLongLines = true;
    config.blankTop = 0;
    calculateEOF(short);
  });

  it('G bottom-anchors under tildes, second G bells', () => {
    expect(lastLine(short, 0)).toBe(true);
    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(config.window - 1 - short.length);
    expect(mode.EOF).toBe(true);

    // less's bot_pos == end_pos on the anchored screen: eof_bell
    expect(lastLine(short, 0)).toBe(false);
    expect(config.blankTop).toBe(config.window - 1 - short.length);
  });

  it('re-derives the pad when grown content still fits', () => {
    lastLine(short, 0);

    const grown = [...short, '5', '6'];
    calculateEOF(grown);

    expect(lastLine(grown, 0)).toBe(true);
    expect(config.blankTop).toBe(config.window - 1 - grown.length);
  });

  it('keeps no pad for content taller than the screen', () => {
    calculateEOF(content);
    lastLine(content, 0);
    expect(config.blankTop).toBe(0);
  });
});
