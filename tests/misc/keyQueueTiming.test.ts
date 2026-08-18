import { describe, expect, it } from 'vitest';

import {
  fallingBehind,
  edgeWait,
  BEHIND_MS,
  EDGE_DWELL_MS,
} from '../../src/pager/core';

/**
 * The two clocks in the key queue, stated as rules.
 *
 * Both take `now` instead of reading it, because both were wrong in a
 * way no screen test could catch: one hid the ":" on the first key of
 * every burst, the other never fired at all. Neither is less's - less
 * needs no clock here, its no-op costs microseconds - so there is no
 * upstream behaviour to compare against, only the rule we chose.
 */
describe('falling behind the keyboard', () => {
  it('is false with nothing queued', () => {
    expect(fallingBehind(0, 1_000, 1_000 + BEHIND_MS * 10)).toBe(false);
  });

  it('is false while the backlog is young', () => {
    // a terminal delivers a burst in chunks, so a few keys sit in the
    // queue for a moment even when we are comfortably ahead
    expect(fallingBehind(5, 1_000, 1_000 + BEHIND_MS - 1)).toBe(false);
  });

  it('is true once the backlog has stood for BEHIND_MS', () => {
    expect(fallingBehind(1, 1_000, 1_000 + BEHIND_MS)).toBe(true);
  });

  it('measures the CURRENT backlog, not the time since one existed', () => {
    // The bug: keyed on "when the queue was last empty", an idle spell
    // read as an enormous backlog the moment one key landed, so the
    // very first key of every burst looked like falling behind. A
    // queue that is empty carries no start time at all.
    expect(fallingBehind(1, 0, 1_000_000)).toBe(false);
  });
});

describe('the edge rest', () => {
  it('is nothing when no rest is armed', () => {
    expect(edgeWait(0, 5_000)).toBe(0);
  });

  it('holds for the remainder of the dwell', () => {
    const armed = 5_000 + EDGE_DWELL_MS;

    expect(edgeWait(armed, 5_000)).toBe(EDGE_DWELL_MS);
    expect(edgeWait(armed, 5_000 + 20)).toBe(EDGE_DWELL_MS - 20);
  });

  it('releases exactly at the deadline', () => {
    const armed = 5_000 + EDGE_DWELL_MS;

    expect(edgeWait(armed, armed)).toBe(0);
  });

  it('never asks the queue to wait backwards', () => {
    // a rest whose deadline has long passed must not report a negative
    // wait, which setTimeout would treat as "immediately" but which
    // would also read as "still resting" to a caller testing > 0
    expect(edgeWait(5_000, 60_000)).toBe(0);
  });
});
