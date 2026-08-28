import { expect, it, vi } from 'vitest';

import { getAction, splitKeys, tailCascade } from '../src/keys';
import { terminalCapability } from '../src/tty/terminal';
import type { Actions } from '../src/state/types';

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
  const invalidKeys = ['\x1B[17~', '\x1B[24~', '\x1B[25~', '\x1B[30~', '\x1B[35~'];
  invalidKeys.forEach(key => expect(getAction(key)).toBeUndefined());
});

it('maps the terminal F1 capability to help', () => {
  expect(getAction('\x1BOP')).toBe('HELP');
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

it('binds arrow keys to what terminfo says, like less', () => {
  // less fills each special key's slot from terminfo (special_key_str,
  // screen.c:1218) and writes "\377" when the capability is missing
  // (decode.c:390), so a SECOND spelling of an arrow is an ordinary
  // unknown key: echoed to the prompt and belled. Measured against
  // less/less on a pty: ESC O B scrolls, ESC [ B rings the bell.
  const arrows: Array<[string, string, Actions]> = [
    ['kcud1', 'kd', 'LINE_FORWARD'],
    ['kcuu1', 'ku', 'LINE_BACKWARD'],
    ['kcuf1', 'kr', 'SET_HALF_SCREEN_RIGHT'],
    ['kcub1', 'kl', 'SET_HALF_SCREEN_LEFT'],
  ];

  for (const [ti, tc, action] of arrows) {
    const seq = terminalCapability(ti, tc);

    // whatever this terminal reports is the binding...
    if (seq) expect(getAction(seq)).toBe(action);

    // ...and the CSI spelling is bound only if terminfo named it,
    // which no common TERM does — they all report the SS3 form
    const csi = '\x1B[' + { kcud1: 'B', kcuu1: 'A', kcuf1: 'C', kcub1: 'D' }[ti];
    if (seq !== csi) expect(getAction(csi)).toBeUndefined();
  }

  expect(getAction('\x1B[1;5C')).toBe('LAST_COL');
  expect(getAction('\x1B[1;5D')).toBe('FIRST_COL');
});

it('guesses ANSI keys when there is no terminal database', async () => {
  // The test above is less's rule: a capability the entry OMITS leaves
  // the key unbound, and a second spelling rings the bell. This is the
  // case less never meets, because it links curses - no database to
  // read AT ALL, which is Windows. MEASURED there on 11 / node 22:
  // arrows, keypad, PgUp/PgDn, Home/End and F1 all dead, and the wheel
  // with them, since a terminal with mouse reporting off reports a
  // wheel tick AS an arrow. v1.12.1 had every one of them.
  const realTerm = process.env.TERM;

  try {
    process.env.TERM = 'no-such-terminal-xyz';
    vi.resetModules();

    const { resetTerminfo } = await import('../src/tty/terminal');

    resetTerminfo();

    const { getAction: guessed } = await import('../src/keys');

    // both cursor spellings, because smkx asks for DECCKM and a
    // terminal that ignored it answers the other way
    expect(guessed('\x1bOA')).toBe('LINE_BACKWARD');
    expect(guessed('\x1b[A')).toBe('LINE_BACKWARD');
    expect(guessed('\x1bOB')).toBe('LINE_FORWARD');
    expect(guessed('\x1b[B')).toBe('LINE_FORWARD');

    expect(guessed('\x1b[5~')).toBe('WINDOW_BACKWARD');
    expect(guessed('\x1b[6~')).toBe('WINDOW_FORWARD');
    expect(guessed('\x1bOH')).toBe('FIRST_LINE');
    expect(guessed('\x1bOF')).toBe('LAST_LINE');
    expect(guessed('\x1bOP')).toBe('HELP');
  } finally {
    if (realTerm === undefined) delete process.env.TERM;
    else process.env.TERM = realTerm;

    vi.resetModules();
  }
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

it('resolves unbound sequences by their tail, like cmd_decode', () => {
  // less's cmd_match anchors bindings to the buffer's LAST chars
  // (decode.c:845): a stray ESC ages out and the tail runs
  expect(tailCascade('\x1Bq')).toEqual(['q']);
  expect(tailCascade('\x1B\x1BOA')).toEqual(['\x1BOA']);

  // a fully bound combination stays whole
  expect(tailCascade('\x1Bj')).toEqual(['\x1Bj']);

  // no entry shares the tail: ONE invalid command for the buffer
  expect(tailCascade('\x1Bx')).toEqual([null]);

  // digits complete mid-stream, the trailing junk is one invalid;
  // the '1' rides the \x1B[1;… modifier-arrow prefixes and ages out
  // (less, binding none, would yield ['1', '5', null] - same bell)
  expect(tailCascade('\x1B[15~')).toEqual(['5', null]);

  // a dangling partial match drops (less would wait for more input)
  expect(tailCascade('\x1B\x1B')).toEqual([]);
});
