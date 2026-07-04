import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../src/config';

import {
  bufferToNum,
  inputToFilePaths,
  inputToString,
  addBufferChar,
  delBufferChar,
  getLastRow,
  calculateEOF,
  visualWidth,
  maxSubRow,
  splitChars,
  withReset
} from '../src/helpers';

import { RED, RESET } from './utils/constants';

const FAMILY = '👨‍👩‍👧‍👦';

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.indentation = 2;
  config.bufferOffset = 0;
  config.chopLongLines = false;

  mode.INIT = true;
  mode.EOF = false;
  mode.BUFFERING = false;
});

describe('bufferToNum', () => {
  it('parses digit buffers as base-10 integers', () => {
    expect(bufferToNum(['4', '2'])).toBe(42);
    expect(bufferToNum(['0', '7'])).toBe(7);
  });

  it('returns 0 for empty or invalid buffers', () => {
    expect(bufferToNum([])).toBe(0);
    expect(bufferToNum(['0'])).toBe(0);
    expect(bufferToNum(['a'])).toBe(0);
  });
});

describe('inputToFilePaths', () => {
  it('returns existing paths only', () => {
    expect(inputToFilePaths('package.json')).toEqual(['package.json']);
    expect(inputToFilePaths('definitely-not-a-file.xyz')).toEqual([]);
  });

  it('flattens nested arrays and drops invalid entries', () => {
    expect(
      inputToFilePaths([['package.json', 'nope.xyz'], 42, [['tsconfig.json']]])
    ).toEqual(['package.json', 'tsconfig.json']);
  });

  it('returns empty array for non-string input', () => {
    expect(inputToFilePaths(42)).toEqual([]);
    expect(inputToFilePaths(undefined)).toEqual([]);
  });
});

describe('inputToString', () => {
  it('splits strings by newline', () => {
    expect(inputToString('a\nb', false)).toEqual(['a', 'b']);
  });

  it('stringifies primitives', () => {
    expect(inputToString(undefined, false)).toEqual(['undefined']);
    expect(inputToString(42, false)).toEqual(['42']);
    expect(inputToString(10n, false)).toEqual(['10']);
    expect(inputToString(true, false)).toEqual(['true']);
    expect(inputToString(null, false)).toEqual(['null']);
  });

  it('stringifies functions from their source', () => {
    expect(inputToString(() => 42, false)).toEqual(['() => 42']);
  });

  it('pretty-prints objects using configured indentation', () => {
    expect(inputToString({ a: 1 }, false)).toEqual(['{', '  "a": 1', '}']);
  });

  it('keeps objects on one line when preserving format', () => {
    expect(inputToString({ a: 1 }, true)).toEqual(['{"a":1}']);
  });
});

describe('addBufferChar / delBufferChar', () => {
  it('appends characters and enables buffering mode', () => {
    const buffer: string[] = [];

    addBufferChar(buffer, '1');

    expect(buffer).toEqual(['1']);
    expect(mode.BUFFERING).toBe(true);
  });

  it('advances buffer offset when the visible width limit is reached', () => {
    const buffer: string[] = [];

    for (let i = 0; i < 78; i++) addBufferChar(buffer, '1');
    expect(config.bufferOffset).toBe(0);

    addBufferChar(buffer, '1');
    expect(config.bufferOffset).toBe(1);
  });

  it('deletes back to an empty buffer and disables buffering mode', () => {
    const buffer: string[] = [];

    for (let i = 0; i < 79; i++) addBufferChar(buffer, '1');
    while (buffer.length) delBufferChar(buffer);

    expect(config.bufferOffset).toBe(0);
    expect(mode.BUFFERING).toBe(false);
  });

  it('ignores deletion on an empty buffer', () => {
    const buffer: string[] = [];

    delBufferChar(buffer);

    expect(buffer).toEqual([]);
    expect(mode.BUFFERING).toBe(false);
  });
});

describe('getLastRow', () => {
  it('finds the top row of the last full window in chopped mode', () => {
    config.chopLongLines = true;

    const content = new Array(30).fill('line');

    expect(getLastRow(content)).toEqual({ lastRow: 7, lastSubRow: 0 });
  });

  it('returns origin when content fits the window', () => {
    config.chopLongLines = true;

    expect(getLastRow(new Array(5).fill('line')))
      .toEqual({ lastRow: 0, lastSubRow: 0 });
  });

  it('accounts for wrapped sub-rows', () => {
    config.screenWidth = 10;
    config.window = 4;

    const content = ['x', 'a'.repeat(25)];

    expect(getLastRow(content)).toEqual({ lastRow: 1, lastSubRow: 0 });

    config.window = 3;

    expect(getLastRow(content)).toEqual({ lastRow: 1, lastSubRow: 1 });
  });
});

describe('calculateEOF', () => {
  it('sets EOF when content fits the window', () => {
    config.chopLongLines = true;

    calculateEOF(new Array(5).fill('line'));

    expect(config.endRow).toBe(0);
    expect(config.endSubRow).toBe(0);
    expect(mode.EOF).toBe(true);
  });

  it('clears EOF when content overflows the window', () => {
    config.chopLongLines = true;
    mode.EOF = true;

    calculateEOF(new Array(30).fill('line'));

    expect(config.endRow).toBe(7);
    expect(mode.EOF).toBe(false);
  });
});

describe('visualWidth', () => {
  it('measures ASCII, CJK, styled and ZWJ content', () => {
    expect(visualWidth('abc')).toBe(3);
    expect(visualWidth('你好')).toBe(4);
    expect(visualWidth(RED + '你好' + RESET)).toBe(4);
    expect(visualWidth(FAMILY)).toBe(2);
  });
});

describe('maxSubRow', () => {
  it('returns extra sub-rows needed for wrapped lines', () => {
    expect(maxSubRow('a'.repeat(200))).toBe(2);
    expect(maxSubRow('short')).toBe(0);
    expect(maxSubRow('')).toBe(0);
  });

  it('returns 0 when chopping is enabled', () => {
    config.chopLongLines = true;

    expect(maxSubRow('a'.repeat(200))).toBe(0);
  });
});

describe('splitChars', () => {
  it('keeps grapheme clusters together', () => {
    expect(splitChars('a' + FAMILY + 'b')).toEqual(['a', FAMILY, 'b']);
    expect(splitChars('é')).toEqual(['é']);
  });
});

describe('withReset', () => {
  it('closes open styles', () => {
    expect(withReset(RED + 'a')).toBe(RED + 'a' + RESET);
  });

  it('leaves closed or unstyled lines untouched', () => {
    expect(withReset('plain')).toBe('plain');
    expect(withReset(RED + 'a' + RESET)).toBe(RED + 'a' + RESET);
    expect(withReset(RED + 'a' + RESET + 'b')).toBe(RED + 'a' + RESET + 'b');
  });
});
