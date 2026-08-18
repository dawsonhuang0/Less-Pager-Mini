import { describe, expect, it } from 'vitest';

import { LtFile } from '../lesstest/ltFile';
import { runLt } from '../lesstest/runLt';

/*
 * The mouse wheel through the real pager.
 *
 * A unit call cannot reach this: the bug it covers was the wheel
 * moving the IN-MEMORY view while every keyboard command moved the
 * file-backed one, so the two only disagreed after a tick had already
 * landed. One tick looked right; the second bell'd at an (END) the
 * file was nowhere near.
 */
const LINES = 80;
const text = Array.from({ length: LINES }, (_, i) => `line ${i + 1}`)
  .join('\n') + '\n';

const HEIGHT = 12; // 11 text rows + the prompt

// through $LESS, not the args line: runLt turns an option argument
// into a $LESS it then OVERWRITES with the recording's own env when
// it calls pager(), so an option written as an arg never arrives
const session = (keys: string[], less: string): LtFile => ({
  env: { LESS: less },
  args: ['input.txt'],
  files: { 'input.txt': text },
  width: 40,
  height: HEIGHT,
  firstScreen: null,
  firstCursor: null,
  steps: keys.map(key => ({ key, screen: null, cursor: null })),
});

/** The top line of the screen after each report. */
const tops = async (keys: string[], less = '--mouse'):
  Promise<string[]> => {
  const result = await runLt(session([...keys, 'q'], less));
  // screens[0] is startup, so a step's screen is one further along
  return result.screens.map(rows => rows[0]);
};

const DOWN = '\x1b[<65;1;1M';
const UP = '\x1b[<64;1;1M';

describe('mouse wheel scrolling on a file', () => {
  it('keeps moving on every tick, not just the first', async () => {
    // og's A_F_MOUSE is forward(wheel_lines) -- the same forward()
    // every other command uses (command.c:1720), so the fourth tick
    // is as ordinary as the first
    const screens = await tops([DOWN, DOWN, DOWN, DOWN]);

    expect(screens.slice(0, 5)).toEqual([
      'line 1', 'line 2', 'line 3', 'line 4', 'line 5',
    ]);
  }, 20000);

  it('comes back up the same way', async () => {
    const screens = await tops([DOWN, DOWN, DOWN, UP, UP]);

    expect(screens[3]).toBe('line 4');
    expect(screens[5]).toBe('line 2');
  }, 20000);

  it('scrolls --wheel-lines lines a tick', async () => {
    const screens = await tops([DOWN, DOWN], '--mouse --wheel-lines=3');

    expect(screens[1]).toBe('line 4');
    expect(screens[2]).toBe('line 7');
  }, 20000);
});
