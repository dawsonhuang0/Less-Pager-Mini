import { describe, expect, it } from 'vitest';

import { collapseRun } from '../../src/pager/core';

/**
 * What the key queue throws away when a burst piles up against an
 * edge.
 *
 * og needs none of this: forw()/back() with nlines == 0 bell and
 * return (forwback.c:335), microseconds each, so a hundred queued keys
 * that all do nothing cost nothing. Ours renders a frame per key,
 * which is what made an overshoot into eof lock the pager up for as
 * long as the backlog took to drain.
 *
 * Dropping them is safe because they are indistinguishable: same wall,
 * same bell (rate limited to one a second, og's gate), same "(END)".
 * What is NOT safe is dropping past them, and that is what these pin
 * down - the collapse only ever eats a run of the SAME key.
 */
describe('the edge collapse', () => {
  it('drops the repeats of the key just run', () => {
    const queue = ['j', 'j', 'j'];

    collapseRun(queue, 'j');

    expect(queue).toEqual([]);
  });

  it('stops at the first different key', () => {
    // the case that matters: reverse direction at the bottom and the
    // k runs at once instead of after a dozen no-ops
    const queue = ['j', 'j', 'k', 'j'];

    collapseRun(queue, 'j');

    expect(queue).toEqual(['k', 'j']);
  });

  it('leaves a queue that does not start with the key alone', () => {
    const queue = ['k', 'j', 'j'];

    collapseRun(queue, 'j');

    expect(queue).toEqual(['k', 'j', 'j']);
  });

  it('keeps a command typed behind the burst', () => {
    // h at the bottom of a long scroll has to survive: og's help is
    // one keystroke away however far behind the screen is
    const queue = ['j', 'j', 'j', 'h'];

    collapseRun(queue, 'j');

    expect(queue).toEqual(['h']);
  });

  it('compares whole key sequences, not bytes', () => {
    // an arrow arrives as one entry (ESC [ B), so a run of them
    // collapses like a run of j - and a DIFFERENT escape sequence
    // still stops it
    const queue = ['\x1b[B', '\x1b[B', '\x1b[A'];

    collapseRun(queue, '\x1b[B');

    expect(queue).toEqual(['\x1b[A']);
  });

  it('does nothing to an empty queue', () => {
    const queue: string[] = [];

    collapseRun(queue, 'j');

    expect(queue).toEqual([]);
  });
});
