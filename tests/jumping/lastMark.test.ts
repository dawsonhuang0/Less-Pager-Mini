import { describe, expect, it } from 'vitest';

import { LtFile } from '../lesstest/ltFile';
import { runLt } from '../lesstest/runLt';

/*
 * The last mark (') through the real pager.
 *
 * These go through the in-process command loop rather than calling a
 * function, because the bugs they cover live in the seekable pager's
 * jump paths -- which command dispatch, not a unit call, reaches.
 */
const LINES = 80;
const text = Array.from({ length: LINES }, (_, i) => `line ${i + 1}`)
  .join('\n') + '\n';

const HEIGHT = 12; // 11 text rows + the prompt

const session = (keys: string[]): LtFile => ({
  env: {},
  args: ['input.txt'],
  files: { 'input.txt': text },
  width: 40,
  height: HEIGHT,
  firstScreen: null,
  firstCursor: null,
  steps: keys.map(key => ({ key, screen: null, cursor: null })),
});

/** The top line of the screen after each keystroke. */
const tops = async (keys: string[]): Promise<string[]> => {
  const result = await runLt(session([...keys, 'q']));
  // screens[0] is startup, so a step's screen is one further along
  return result.screens.map(rows => rows[0]);
};

// with 11 text rows, G puts the last line at the bottom: line 70 on top
const LAST_SCREEN_TOP = `line ${LINES - (HEIGHT - 2)}`;

describe("G records the last mark, like jump_forw's own lastmark", () => {
  it("comes back to where G left when '' is pressed", async () => {
    // less's jump_forw calls lastmark() itself, before pos_clear, since
    // "lastmark will be called later by jump_loc, but it fails because
    // the position table has been cleared" (jump.c:51). Without it the
    // mark stayed unset and '' did not move at all
    const seen = await tops(['G', "'", "'"]);

    expect(seen[1]).toBe(LAST_SCREEN_TOP); // G
    expect(seen[3]).toBe('line 1'); // ''
  }, 20000);

  it('goes back to the end when the mark is asked for twice', async () => {
    // the jump back to line 1 was far enough to repaint, so jump_loc
    // records the last mark again -- at the position G left
    const seen = await tops(['G', "'", "'", "'", "'"]);

    expect(seen[3]).toBe('line 1');
    expect(seen[5]).toBe(LAST_SCREEN_TOP);
  }, 20000);

  it('records the position G started from, not the file start',
    async () => {
      const seen = await tops(['3', '0', 'g', 'G', "'", "'"]);

      expect(seen[3]).toBe('line 30');
      expect(seen[4]).toBe(LAST_SCREEN_TOP); // G
      expect(seen[6]).toBe('line 30');
    }, 20000);
});

describe('an unset last mark is the beginning of the file', () => {
  it("sends '' to line 1 after a plain scroll", async () => {
    // scrolling never sets a mark, so gomark takes its ch_zero()
    // fallback (mark.c:340). Resolving that as row 0 of the spooled
    // window instead meant '' jumped to where it already was
    const seen = await tops(['j', 'j', "'", "'"]);

    expect(seen[2]).toBe('line 3');
    expect(seen[4]).toBe('line 1');
  }, 20000);

  it('stays at line 1 when asked again', async () => {
    // less's gomark cmarks LASTMARK to position zero on the way past, so
    // the second '' has a mark now -- and it is still zero. The jump
    // that got here was short enough to scroll, which does not record
    const seen = await tops(['j', 'j', "'", "'", "'", "'"]);

    expect(seen[4]).toBe('line 1');
    expect(seen[6]).toBe('line 1');
  }, 20000);
});

describe('letter marks survive a jump away and back', () => {
  it('returns to a mark set before going to the end', async () => {
    const seen = await tops(['4', '0', 'g', 'm', 'a', 'G', "'", 'a']);

    expect(seen[3]).toBe('line 40');
    expect(seen[8]).toBe('line 40');
  }, 20000);
});
