import { beforeEach, describe, expect, it, vi } from 'vitest';

import { posixRetry, search } from '../../src/features/searching';

import { getPrompt } from '../../src/helpers';

import { endJsRegexGuard, guardedMatch, jsRegexAborted, clearJsRegexAbort }
  from '../../src/features/jsRegexGuard';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

beforeEach(() => {
  posixRetry.pending = false;
  search.message = '';
});

/*
 * A --use-js-regexp search that had to be killed leaves nothing
 * behind - not because the pattern is wrong, but because the engine
 * asked for cannot finish it. The engine that can is already here, so
 * the pager offers it, in the shape og asks about a binary file.
 */
describe('the offer to finish a search with POSIX', () => {
  it('asks in og\'s own question shape', () => {
    posixRetry.pending = true;

    // the question replaces the prompt entirely, as og's binary one
    // does - there is nothing else the bottom row could usefully say
    expect(getPrompt([])).toContain(
      'Pattern too complex. Try again with POSIX RegExp?');
  });

  it('is raised by a match that had to be killed', () => {
    // the same 2^40 pattern, aborted through the poll: what the user
    // sees afterwards is the question, not a silent failure
    clearJsRegexAbort();

    let polls = 0;

    const answer = guardedMatch({
      source: '(a+)+b', flags: '', text: 'a'.repeat(40), test: false,
    }, () => ++polls > 2);

    expect(answer).toBeNull();
    expect(jsRegexAborted()).toBe(true);

    // searching.ts raises the question on exactly this answer
    posixRetry.pending = answer === null;
    expect(getPrompt([])).toContain('Try again with POSIX RegExp?');

    endJsRegexGuard();
  }, 10000);
});
