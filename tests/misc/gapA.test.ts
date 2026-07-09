import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { lineForward, forceLineBackward, newlineForward, newlineBackward }
  from '../../src/features/moving';

import { goPos } from '../../src/features/jumping';

import { calculateEOF } from '../../src/helpers';

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
});

describe('ESC-j / ESC-k newline scrolling', () => {
  it('moves by whole lines in wrap mode', () => {
    const wrapped = ['aaaaaaaaaaaaaaaaaaaaaaaaa',
      'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj'];
    initContent(wrapped);
    config.chopLongLines = false;
    calculateEOF(wrapped);

    // ESC-j from a wrapped first line skips all its sub-rows
    newlineForward(wrapped, 1);
    expect(config.row).toBe(1);
    expect(config.subRow).toBe(0);

    // ESC-k from a mid-line top snaps to the line start first
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
