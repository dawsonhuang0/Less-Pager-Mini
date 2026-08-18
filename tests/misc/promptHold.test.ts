import { beforeEach, describe, expect, it } from 'vitest';

import {
  markBurst,
  markBehind,
  markCommandTime,
  markStalled,
  armStall,
  isStalled,
  promptHolding,
  endPromptHold,
} from '../../src/helpers';

import { mode } from '../../src/state/config';

/**
 * The rule behind the ":" disappearing during a scroll, tested as a
 * rule rather than through the screen.
 *
 * less suppresses the prompt through check_poll (os.c:136): a read that
 * goes to disk with a key WAITING reads it and pushes it back
 * (ungetcc_back, os.c:164), and the next prompt() returns early on
 * `ungot != NULL` (command.c:924). Two things have to be true - a key
 * waiting AND a read - and every bug in this area was one of them
 * being assumed.
 *
 * Driving this through the pager cannot pin it down: whether a burst
 * actually falls behind depends on block caching and machine speed, so
 * a screen-level test either asserts nothing (a small fixture never
 * falls behind) or asserts a clock.
 */
describe('the ":" hold', () => {
  beforeEach(() => {
    endPromptHold();
    armStall();
    armStall();
    mode.HELP = false;
  });

  it('does not engage without a key waiting', () => {
    // The regression this catches: heavyWork alone used to hold, so a
    // single slow command hid the prompt with nobody behind it - less
    // has nothing to unget from an empty tty and writes as usual.
    markBurst(false);
    markCommandTime(500);

    expect(promptHolding()).toBe(false);
  });

  it('engages when keys are waiting and the work is slow', () => {
    markBurst(true);
    markCommandTime(500);

    expect(promptHolding()).toBe(true);
  });

  it('does not engage on a backlog alone', () => {
    // Terminals deliver a burst in chunks, so keys sit in the queue
    // for a moment even when we are well ahead. Holding on that alone
    // took the ":" off a one-screen file where less's stays put.
    markBurst(true);
    markCommandTime(0);

    expect(promptHolding()).toBe(false);
  });

  it('engages when the queue has not drained for a while', () => {
    markBurst(true);
    markBehind();

    expect(promptHolding()).toBe(true);
  });

  it('never engages on the help file', () => {
    // less's ch answers CH_HELPFILE from memory (ch.c:616): it is never
    // polled, so no help command ever finds its prompt suppressed.
    mode.HELP = true;
    markBurst(true);
    markCommandTime(500);
    markBehind();

    expect(promptHolding()).toBe(false);
  });

  it('releases at an edge, so (END) is written mid-burst', () => {
    // less's forw() with nlines == 0 bells and returns without reading
    // (forwback.c:335), so nothing is ungot however many keys queue up
    markBurst(true);
    markCommandTime(500);
    expect(promptHolding()).toBe(true);

    markStalled();

    expect(promptHolding()).toBe(false);
    expect(isStalled()).toBe(true);
  });

  it('cannot re-arm while the edge still holds', () => {
    // Every key of the burst hits the same wall and reads nothing, so
    // less writes its prompt for all of them. Re-arming between them is
    // what flickered "(END)".
    markStalled();
    markBurst(true);
    markCommandTime(500);
    markBehind();

    expect(promptHolding()).toBe(false);
  });

  it('describes the command just run, not an older one', () => {
    // armStall runs at the top of every command: a latch cleared by
    // comparing painted rows went stale wherever a path did not
    // repaint, and a stale flag ate keys during a real scroll.
    markStalled();
    expect(isStalled()).toBe(true);

    armStall();

    expect(isStalled()).toBe(false);
  });
});
