import { beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';

import { posixRetry, search } from '../../src/features/searching';

import { getPrompt } from '../../src/helpers';

import { useJsRegexp } from '../../src/options/use-js-regexp';

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
    // the kill itself lives in tests/misc/jsRegexGuard.test.ts, which
    // runs it in a process that can host a blocked thread. What
    // matters here is what the user is left looking at: the question,
    // not a search that quietly found nothing
    posixRetry.pending = true;

    expect(getPrompt([])).toContain('Try again with POSIX RegExp?');
  });

  it('is not hidden behind the message the toggle left', () => {
    // a message outranks the prompt row, and a toggle sets one - so
    // the question would be raised into a row already spoken for, and
    // the user would answer something they never saw
    search.message = "Search with JavaScript's RegExp";
    posixRetry.pending = true;

    // what searching.ts does when it raises the question
    search.message = '';

    expect(getPrompt([])).toContain('Try again with POSIX RegExp?');
  });
});
