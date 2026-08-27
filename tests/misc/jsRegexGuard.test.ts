import { describe, expect, it } from 'vitest';

import { execFileSync } from 'child_process';

/*
 * The two-worker guard, exercised in a real node process.
 *
 * Not driven from here directly: the guard blocks its thread in
 * Atomics.wait while workers do the work, and vitest's own worker
 * pool will not schedule a nested worker while the thread that owns
 * it is blocked - the wait simply never ends. So the fixture runs it
 * where nothing is in the way, and this reads the answers back.
 */
const probe = (): Record<string, unknown> => JSON.parse(
  execFileSync('node', ['tests/fixtures/guardProbe.mjs'],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }));

describe('a host regex that can be killed', () => {
  const out = probe();

  it('answers an ordinary match with the whole shape', () => {
    expect(out.match).toEqual(
      { match: { index: 2, groups: ['aaabb', 'aaa', 'bb'] } });
  });

  it('answers a test', () => {
    expect([out.test, out.miss]).toEqual([true, false]);
  });

  it('comes back from a pattern that would never return', () => {
    // 40 a's against (a+)+b is 2^40 steps in a backtracking engine:
    // the call cannot finish, and the only reason anything comes back
    // is that the thread running it is killed
    // the null answer IS the abort: guardedMatch returns it from the
    // one branch that records one, so reading the flag back out of the
    // module said nothing the return value had not already said - and
    // it was the only reason src exported it
    expect(out.killed).toBeNull();
    expect(out.killedMs as number).toBeLessThan(5000);
  });

  it('still works after one was killed', () => {
    expect(out.after).toEqual({ match: { index: 1, groups: ['bbb'] } });
  });

  it('grows its buffer for a subject that does not fit', () => {
    // a SharedArrayBuffer cannot grow, so both workers are replaced by
    // a pair with room. Refusing instead would send the longest lines
    // - the ones most worth killing - back to the thread that cannot
    expect(out.big).toBe(true);
  });
});
