import { expect, it } from 'vitest';

import { getAction, splitKeys } from '../src/normalKeys';

it('valid keys should have their corresponding event as result', () => {
  // ':' alone is a command prefix, not a key: its combos map instead
  const validKeys = ['\x08', '\x7F', 'q', 'g', 'G'];
  validKeys.forEach(key => expect(getAction(key)).not.toBeUndefined());
});

it('maps : combos to file commands', () => {
  expect(getAction(':e')).toBe('OPEN_FILE');
  expect(getAction(':n')).toBe('NEXT_FILE');
  expect(getAction(':p')).toBe('PREV_FILE');
  expect(getAction(':x')).toBe('INDEX_FILE');
  expect(getAction(':d')).toBe('REMOVE_FILE');
  expect(getAction(':f')).toBe('CURRENT_INFO');
  expect(getAction(':q')).toBe('EXIT');
  expect(getAction(':')).toBeUndefined();
});

it('invalid keys should only have undefined as result', () => {
  const invalidKeys = ['\x1BOP', '\x1B[17~', '\x1B[24~', '\x1B[25~', '\x1B[30~', '\x1B[35~'];
  invalidKeys.forEach(key => expect(getAction(key)).toBeUndefined());
});

it('maps digits to ADD_BUFFER', () => {
  for (let d = 0; d <= 9; d++) {
    expect(getAction(String(d))).toBe('ADD_BUFFER');
  }
});

it('maps SGR mouse scroll sequences to line movement', () => {
  expect(getAction('\x1b[<64;10;20M')).toBe('LINE_BACKWARD');
  expect(getAction('\x1b[<65;10;20M')).toBe('LINE_FORWARD');
});

it('maps arrow keys to movement actions', () => {
  expect(getAction('\x1B[A')).toBe('LINE_BACKWARD');
  expect(getAction('\x1B[B')).toBe('LINE_FORWARD');
  expect(getAction('\x1B[C')).toBe('SET_HALF_SCREEN_RIGHT');
  expect(getAction('\x1B[D')).toBe('SET_HALF_SCREEN_LEFT');
  expect(getAction('\x1B[1;5C')).toBe('LAST_COL');
  expect(getAction('\x1B[1;5D')).toBe('FIRST_COL');
});

it('maps ESC combinations', () => {
  expect(getAction('\x1Bv')).toBe('WINDOW_BACKWARD');
  expect(getAction('\x1B\x20')).toBe('NO_EOF_WINDOW_FORWARD');
  expect(getAction('\x1B)')).toBe('SET_HALF_SCREEN_RIGHT');
  expect(getAction('\x1B(')).toBe('SET_HALF_SCREEN_LEFT');
  expect(getAction('\x1B}')).toBe('LAST_COL');
  expect(getAction('\x1B{')).toBe('FIRST_COL');
});

it('splits batched wheel scrolls into individual arrow keys', () => {
  expect(splitKeys('\x1B[B\x1B[B\x1B[B')).toEqual(['\x1B[B', '\x1B[B', '\x1B[B']);
  expect(splitKeys('\x1B[A\x1B[B')).toEqual(['\x1B[A', '\x1B[B']);
});

it('splits batched SGR mouse sequences', () => {
  expect(splitKeys('\x1b[<65;10;20M\x1b[<65;10;20M'))
    .toEqual(['\x1b[<65;10;20M', '\x1b[<65;10;20M']);
});

it('splits plain character runs into single keys', () => {
  expect(splitKeys('12j')).toEqual(['1', '2', 'j']);
});

it('keeps ESC combinations and lone ESC intact', () => {
  expect(splitKeys('\x1Bv')).toEqual(['\x1Bv']);
  expect(splitKeys('\x1B')).toEqual(['\x1B']);
  expect(splitKeys('\x1B[1;5C')).toEqual(['\x1B[1;5C']);
});

it('splits astral characters as whole code points', () => {
  expect(splitKeys('a😀b')).toEqual(['a', '😀', 'b']);
});

it('maps window movement keys', () => {
  expect(getAction('\x20')).toBe('WINDOW_FORWARD');
  expect(getAction('f')).toBe('WINDOW_FORWARD');
  expect(getAction('b')).toBe('WINDOW_BACKWARD');
  expect(getAction('z')).toBe('SET_WINDOW_FORWARD');
  expect(getAction('w')).toBe('SET_WINDOW_BACKWARD');
  expect(getAction('d')).toBe('SET_HALF_WINDOW_FORWARD');
  expect(getAction('u')).toBe('SET_HALF_WINDOW_BACKWARD');
  expect(getAction('r')).toBe('REPAINT');
  expect(getAction('R')).toBe('DROP_INPUT_REPAINT');
});
