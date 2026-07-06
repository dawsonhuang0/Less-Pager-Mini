import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { calculateEOF, formatContent } from '../../src/helpers';

import { lineForward } from '../../src/features/moving';

import { search } from '../../src/features/searching';

import {
  matchBracket,
  brackets,
  startBrackets,
  bracketsKey
} from '../../src/features/jumping';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

// window 6 = 4 content rows + bottom row + prompt row
const json = [
  '{',                                 // 0
  '  "a": {',                          // 1
  '    "b": [',                        // 2
  '      1,',                          // 3
  '      2',                           // 4
  '    ],',                            // 5
  '    "f": "f(x) = (a + (b)) - (y)"', // 6
  '  },',                              // 7
  '}',                                 // 8
];

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 80;
  config.window = 6;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;

  search.message = '';
  brackets.pending = '';

  calculateEOF(json);
});

describe('forward matching', () => {
  it('places the matching close bracket on the bottom line', () => {
    matchBracket(json, '{', '}', true, 1);

    // match at row 8, bottom line = top + window - 2
    expect(config.row).toBe(8 - (config.window - 2));
    expect(config.subRow).toBe(0);
    expect(config.blankTop).toBe(0);
  });

  it('counts nested pairs of the same kind', () => {
    config.row = 1;
    matchBracket(json, '{', '}', true, 1);

    // { at row 1 matches } at row 7, not the outer } at row 8
    expect(config.row).toBe(7 - (config.window - 2));
  });

  it('walks back window-2 rows from the match', () => {
    config.row = 2;
    matchBracket(json, '[', ']', true, 1);

    // ] is on row 5, placed on the bottom line
    expect(config.row).toBe(5 - (config.window - 2));
  });

  it('pads blank rows above BOF to keep the match on the bottom line', () => {
    const small = ['(a', ')b', 'c', 'd', 'e', 'f', 'g'];
    calculateEOF(small);

    matchBracket(small, '(', ')', true, 1);

    // ) on row 1 stays on the bottom line: 3 blank rows precede BOF,
    // like less's jump_loc drawing blank lines at the top
    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(3);
    expect(search.message).toBe('');

    const lines = formatContent(small);
    expect(lines.slice(0, 4)).toEqual(['', '', '', '(a']);
    expect(lines[config.window - 2]).toBe(')b');

    // scrolling forward consumes the blank padding first
    lineForward(small, 2);
    expect(config.blankTop).toBe(1);
    expect(config.row).toBe(0);

    lineForward(small, 3);
    expect(config.blankTop).toBe(0);
    expect(config.row).toBe(2);
  });

  it('matches the N-th open bracket in the top line', () => {
    config.row = 6;
    matchBracket(json, '(', ')', true, 2);

    // 2nd ( opens "(a + (b))"; its ) is on the same line
    expect(config.row).toBe(Math.max(6 - (config.window - 2), 0));
    expect(search.message).toBe('');
  });

  it('reports when the top line has no bracket', () => {
    config.row = 3;
    matchBracket(json, '{', '}', true, 1);

    expect(search.message).toBe('No bracket in top line');
    expect(config.row).toBe(3);
  });

  it('reports when no matching bracket exists', () => {
    config.row = 1;
    matchBracket(json, '[', ']', true, 2);

    // row 1 has no 2nd [ -> not that error; use an unbalanced pair instead
    expect(search.message).toBe('No bracket in top line');

    search.message = '';
    const lone = ['open ( only', 'no close here'];
    calculateEOF(lone);
    config.row = 0;

    matchBracket(lone, '(', ')', true, 1);
    expect(search.message).toBe('No matching bracket');
  });
});

describe('blank padding interplay', () => {
  it('reports nothing in top line when blank-padded', () => {
    config.blankTop = 3;
    matchBracket(json, '{', '}', true, 1);

    // with blank rows above BOF, position(TOP) is null in less
    expect(search.message).toBe('Nothing in top line');
  });

  it('resolves the bottom line above blank padding', () => {
    const braces = ['{a', '{b', '}b', 'x', '}a', 'x', 'x'];
    calculateEOF(braces);

    // unpadded: bottom line is row 4 (}a), matching { at row 0
    matchBracket(braces, '{', '}', false, 1);
    expect(config.row).toBe(0);

    // padded by 2: bottom line is row 2 (}b), matching { at row 1
    config.row = 0;
    config.blankTop = 2;
    matchBracket(braces, '{', '}', false, 1);
    expect(config.row).toBe(1);
    expect(config.blankTop).toBe(0);
  });
});

describe('backward matching', () => {
  it('places the matching open bracket on the top line', () => {
    config.row = 8 - (config.window - 2);
    matchBracket(json, '{', '}', false, 1);

    // } on bottom line (row 8) matches { at row 0
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
  });

  it('counts nested pairs of the same kind', () => {
    config.row = 7 - (config.window - 2);
    matchBracket(json, '{', '}', false, 1);

    // } at row 7 matches { at row 1, not the outer { at row 0
    expect(config.row).toBe(1);
  });

  it('reports when the bottom line is past the end', () => {
    config.row = 8;
    matchBracket(json, '{', '}', false, 1);

    expect(search.message).toBe('Nothing in bottom line');
  });

  it('reports when the bottom line has no bracket', () => {
    config.row = 4 - (config.window - 2);
    matchBracket(json, '{', '}', false, 1);

    expect(search.message).toBe('No bracket in bottom line');
  });
});

describe('wrapped lines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
    config.screenWidth = 10;
  });

  it('starts the top-line scan at the displayed sub-row', () => {
    const wrapped = [
      'ab{cdefghi{klm',  // sub-row 0: 'ab{cdefghi', sub-row 1: '{klm'
      'x}',
      'y}',
    ];
    calculateEOF(wrapped);

    config.row = 0;
    config.subRow = 1;
    matchBracket(wrapped, '{', '}', true, 1);

    // the { at sub-row 1 is the first visible one; nest is 0, so its
    // match is the first } (row 1), not the second; walking back hits
    // BOF after 2 sub-rows, leaving 2 blank rows above
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
    expect(config.blankTop).toBe(2);
    expect(search.message).toBe('');
  });

  it('resolves the bottom line to a wrapped sub-row', () => {
    const wrapped = [
      '(open',
      'aaaaaaaaaa)bbbbbbbbb)',  // ) on sub-rows 1 and 2
    ];
    config.window = 4;  // bottom line = 2 sub-row steps below top
    calculateEOF(wrapped);

    config.row = 0;
    config.subRow = 0;
    matchBracket(wrapped, '(', ')', false, 1);

    // bottom line shows sub-row 1 of row 1; its first ) matches the (
    expect(config.row).toBe(0);
    expect(search.message).toBe('');
  });
});

describe('custom bracket prompt', () => {
  const html = [
    '<div>',
    '  <span>text</span>',
    '</div>',
    'tail',
    'tail',
    'tail',
  ];

  beforeEach(() => {
    calculateEOF(html);
  });

  it('collects two characters then matches forward', () => {
    startBrackets(true, 1);
    expect(brackets.pending).toBe('f');

    bracketsKey(html, '<');
    expect(brackets.pending).toBe('f');
    expect(brackets.chars).toBe('<');

    bracketsKey(html, '>');
    expect(brackets.pending).toBe('');

    // matching is textual: the < of <div> pairs with its own > on row 0,
    // padded down to the bottom line with blank rows above BOF
    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(config.window - 2);
    expect(search.message).toBe('');
  });

  it('matches backward with a custom pair', () => {
    config.row = 0;
    config.window = 4;  // bottom line = row 2

    startBrackets(false, 1);
    bracketsKey(html, '<');
    bracketsKey(html, '>');

    // matching is textual: the > ending </div> pairs with the < that
    // starts </div> itself, so row 2 goes to the top
    expect(config.row).toBe(2);
    expect(search.message).toBe('');
  });

  it('cancels on ^C and ESC', () => {
    startBrackets(true, 1);
    bracketsKey(html, '\x03');
    expect(brackets.pending).toBe('');

    startBrackets(false, 1);
    bracketsKey(html, '\x1B');
    expect(brackets.pending).toBe('');
  });
});
