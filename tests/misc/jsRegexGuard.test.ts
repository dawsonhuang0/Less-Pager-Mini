import { afterAll, describe, expect, it } from 'vitest';

import { guardedMatch, endJsRegexGuard, jsRegexAborted, clearJsRegexAbort }
  from '../../src/features/jsRegexGuard';

afterAll(() => {
  endJsRegexGuard();
});

/*
 * A JavaScript regex is one uninterruptible call: nothing else on the
 * thread runs until it returns, which is why the interrupt poll that
 * stops every other long search never gets a turn. Killing the thread
 * is the only thing that stops one, so a pattern that can blow up
 * runs in a worker.
 */
describe('a host regex that can be killed', () => {
  const never = (): boolean => false;

  it('answers an ordinary match with the whole shape', () => {
    clearJsRegexAbort();

    const answer = guardedMatch(
      { source: '(a+)(b+)', flags: '', text: 'xxaaabbz', test: false }, never);

    expect(answer?.match).toEqual({ index: 2, groups: ['aaabb', 'aaa', 'bb'] });
    expect(jsRegexAborted()).toBe(false);
  });

  it('answers a test', () => {
    expect(guardedMatch(
      { source: 'a+b', flags: '', text: 'aaab', test: true }, never)?.test)
      .toBe(true);

    expect(guardedMatch(
      { source: 'a+b', flags: '', text: 'aaa', test: true }, never)?.test)
      .toBe(false);
  });

  it('comes back from a pattern that would never return', () => {
    // 40 a's against (a+)+b is 2^40 steps in a backtracking engine:
    // this call cannot finish, and the only reason the test does is
    // that the thread running it gets killed
    clearJsRegexAbort();

    let polls = 0;
    const start = Date.now();

    const answer = guardedMatch({
      source: '(a+)+b',
      flags: '',
      text: 'a'.repeat(40),
      test: false,
    }, () => ++polls > 2);

    expect(answer).toBeNull();
    expect(jsRegexAborted()).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
  }, 10000);

  it('still works after one was killed', () => {
    clearJsRegexAbort();

    expect(guardedMatch(
      { source: 'b+', flags: '', text: 'abbbc', test: false }, never)?.match)
      .toEqual({ index: 1, groups: ['bbb'] });
  });

  it('grows its buffer for a subject that does not fit', () => {
    // a SharedArrayBuffer cannot grow, so the worker is replaced by
    // one with room. Refusing instead would send the longest lines -
    // the ones most worth killing - back to the thread that cannot
    clearJsRegexAbort();

    const long = 'x'.repeat(3 << 20);

    expect(guardedMatch(
      { source: 'x+$', flags: '', text: long, test: true }, never)?.test)
      .toBe(true);
    expect(jsRegexAborted()).toBe(false);
  }, 20000);

  it('says so when it is taking a while, and only then', async () => {
    // og says nothing during a search, because og's searches return.
    // This one may not, and a pager that looks hung without saying
    // why is the thing to avoid
    clearJsRegexAbort();

    const written: string[] = [];
    const write = process.stdout.write;

    (process.stdout as unknown as { write: unknown }).write =
      (data: string): boolean => { written.push(String(data)); return true; };

    const start = Date.now();

    try {
      guardedMatch({
        source: '(a+)+b', flags: '', text: 'a'.repeat(40), test: false,
      }, () => Date.now() - start > 2500);
    } finally {
      (process.stdout as unknown as { write: unknown }).write = write;
    }

    const shown = written.join('');

    expect(shown).toContain('Searching... (interrupt to abort)');

    // and in standout, like every other message that holds you
    expect(shown).toMatch(/\x1b\[7m.*Searching\.\.\./);
  }, 15000);
});
