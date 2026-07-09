import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';

import {
  cmd,
  cmdOpen,
  cmdClose,
  cmdChar,
  cmdText,
  cmdCol,
  cmdDisplay,
  cmdUngot
} from '../../src/features/cmdbuf';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

/** Feeds keys, draining ungot replays like the prompt loop. */
function type(...keys: string[]): string {
  let last = 'ok';

  for (const key of keys) {
    last = cmdChar(key);

    for (let u = cmdUngot(); u !== null; u = cmdUngot()) {
      last = cmdChar(u);
    }
  }

  return last;
}

beforeEach(() => {
  config.screenWidth = 80;
  cmdClose();
  cmdOpen('/');
});

describe('insertion and movement', () => {
  it('inserts at the cursor and tracks the column', () => {
    type('a', 'b', 'c');
    expect(cmdText()).toBe('abc');
    expect(cmdCol()).toBe(4); // prompt "/" is 1 wide

    type('\x1B[D'); // LeftArrow
    type('X');
    expect(cmdText()).toBe('abXc');
  });

  it('moves with arrows, ESC-h/l, HOME and END', () => {
    type('h', 'e', 'l', 'l', 'o');

    type('\x1B0'); // ESC-0 home
    expect(cmdCol()).toBe(1);

    type('\x1B$'); // ESC-$ end
    expect(cmdCol()).toBe(6);

    type('\x1Bh');
    type('\x1Bh');
    expect(cmdCol()).toBe(4);

    type('\x1Bl');
    expect(cmdCol()).toBe(5);

    type('\x1BOH'); // HOME (SS3)
    expect(cmdCol()).toBe(1);

    type('\x1B[F'); // END (CSI)
    expect(cmdCol()).toBe(6);
  });

  it('steps over wide characters by their width', () => {
    type('你', '好');
    expect(cmdCol()).toBe(5);

    type('\x1B[D');
    expect(cmdCol()).toBe(3);
  });
});

describe('deletion', () => {
  it('backspaces left of the cursor', () => {
    type('a', 'b', 'c');
    type('\x7F');
    expect(cmdText()).toBe('ab');
  });

  it('aborts when backspacing past the beginning', () => {
    expect(type('\x7F')).toBe('quit');
  });

  it('deletes under the cursor with DELETE and ESC-x', () => {
    type('a', 'b', 'c');
    type('\x1B0');
    type('\x1B[3~');
    expect(cmdText()).toBe('bc');

    type('\x1Bx');
    expect(cmdText()).toBe('c');

    // at end of line, DELETE does nothing
    type('\x1B$');
    type('\x1Bx');
    expect(cmdText()).toBe('c');
  });

  it('deletes words with space semantics, like cmd_werase', () => {
    for (const ch of 'foo bar  baz') type(ch);

    type('\x1B\x7F'); // ESC-BACKSPACE: word left
    expect(cmdText()).toBe('foo bar  ');

    type('\x1B\x7F'); // spaces first, then the word
    expect(cmdText()).toBe('foo bar');
    type('\x1B\x7F');
    expect(cmdText()).toBe('foo ');
  });

  it('deletes the word under the cursor with ESC-X', () => {
    for (const ch of 'one two three') type(ch);
    type('\x1B0');

    type('\x1BX');
    expect(cmdText()).toBe(' two three');

    type('\x1BX'); // spaces under cursor
    expect(cmdText()).toBe('two three');
  });

  it('kills the whole line with ^U and aborts when empty', () => {
    for (const ch of 'abc') type(ch);
    expect(type('\x15')).toBe('ok');
    expect(cmdText()).toBe('');

    expect(type('\x15')).toBe('quit');
  });

  it('aborts with ^G, clearing the line', () => {
    for (const ch of 'abc') type(ch);
    expect(type('\x07')).toBe('quit');
    expect(cmdText()).toBe('');
  });
});

describe('literal input', () => {
  it('inserts edit keys literally after ^V', () => {
    type('\x16', '\x7F');
    expect(cmdText()).toBe('\x7F');
    expect(cmdDisplay()).toBe('^?');
  });
});

describe('ESC sequence handling', () => {
  it('assembles ESC combos typed key by key', () => {
    type('a', 'b');
    expect(cmdChar('\x1B')).toBe('ok'); // pending prefix
    expect(cmdText()).toBe('ab');

    type('h'); // completes ESC-h: left
    expect(cmdCol()).toBe(2);
    expect(cmdText()).toBe('ab');
  });

  it('inserts a dead ESC combo and replays the tail', () => {
    cmdChar('\x1B');
    type('q'); // ESC-q is not an edit command

    expect(cmdText()).toBe('\x1Bq');
    expect(cmdDisplay()).toBe('ESCq');
  });
});

describe('history recall', () => {
  const history = ['abc', 'xyz', 'abd'];

  beforeEach(() => {
    cmdClose();
    cmdOpen('/', { history });
  });

  it('walks entries with UP/DOWN and og sentinel stops', () => {
    type('\x1B[A');
    expect(cmdText()).toBe('abd');

    type('\x1B[A');
    expect(cmdText()).toBe('xyz');

    type('\x1B[A');
    expect(cmdText()).toBe('abc');

    type('\x1B[A'); // past the oldest: bell, stay
    expect(cmdText()).toBe('abc');

    type('\x1B[B');
    expect(cmdText()).toBe('xyz');

    type('\x1B[B');
    expect(cmdText()).toBe('abd');

    type('\x1B[B'); // past the newest: bell, stay
    expect(cmdText()).toBe('abd');
  });

  it('latches the prefix at the cursor, like updown_match', () => {
    type('a', 'b');
    type('\x1B[A'); // prefix "ab"
    expect(cmdText()).toBe('abd');

    type('\x1B[A');
    expect(cmdText()).toBe('abc');

    type('\x1B[A'); // no earlier "ab" entry
    expect(cmdText()).toBe('abc');
  });

  it('resets the latch when the buffer is edited', () => {
    type('a', 'b');
    type('\x1B[A');
    expect(cmdText()).toBe('abd');

    type('\x7F'); // edit resets the latch
    type('\x1B[A'); // new prefix is "ab" up to cursor... latch at cur
    expect(cmd.updownMatch).toBe(2);
  });

  it('bells at history-less prompts', () => {
    cmdClose();
    cmdOpen(':');
    type('a');
    type('\x1B[A');
    expect(cmdText()).toBe('a');
  });
});

describe('horizontal shifting', () => {
  it('shifts left half a screen when the cursor hits the edge', () => {
    config.screenWidth = 12;
    cmdClose();
    cmdOpen('/');

    for (const ch of 'abcdefghijklmnop') type(ch);

    // the cursor column always stays inside the screen
    expect(cmdCol()).toBeLessThan(12);
    expect(cmd.offset).toBeGreaterThan(0);

    // the visible slice starts at the offset
    expect(cmdDisplay()).toBe(
      cmd.steps.slice(cmd.offset).join('').slice(0, cmdDisplay().length)
    );
  });

  it('shifts back right when moving left past the prompt', () => {
    config.screenWidth = 12;
    cmdClose();
    cmdOpen('/');

    for (const ch of 'abcdefghijklmnop') type(ch);

    while (cmd.cur > 0) type('\x1B[D');

    expect(cmd.offset).toBe(0);
    expect(cmdCol()).toBe(1);
  });
});

describe('completion gating', () => {
  it('bells on TAB without a completer', () => {
    type('a');
    expect(type('\t')).toBe('ok');
    expect(cmdText()).toBe('a');
  });

  it('runs the completer for TAB, SHIFT-TAB and ^L', () => {
    const calls: string[] = [];

    cmdClose();
    cmdOpen('Examine: ', { complete: action => { calls.push(action); } });

    type('\t', '\x1B[Z', '\x0C');
    expect(calls).toEqual(['complete', 'reverseComplete', 'expand']);
  });
});

describe('ESC-arrow word movement', () => {
  beforeEach(() => {
    cmdClose();
    cmdOpen('/');
  });

  it('moves by words with ESC then an arrow, both encodings', () => {
    for (const ch of 'foo bar') type(ch);

    type('\x1B', '\x1BOD'); // ESC LeftArrow (keypad mode)
    expect(cmd.cur).toBe(4);

    type('\x1B', '\x1B[D'); // ESC LeftArrow (CSI)
    expect(cmd.cur).toBe(0);

    type('\x1B', '\x1BOC'); // ESC RightArrow
    expect(cmd.cur).toBe(4);
  });
});
