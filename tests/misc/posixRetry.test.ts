import { beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';

import { posixRetry, search } from '../../src/features/searching';

import { getPrompt } from '../../src/helpers';

import { useJsRegexp } from '../../src/options/use-js-regexp';

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

describe('toggling the engine', () => {
  it('says so before it does the work the toggle causes', () => {
    // the option machinery assigns search.message AFTER set()
    // returns, so an option whose set() re-highlights a screenful
    // reports itself only once that is done - which reads as a toggle
    // that did nothing for a while
    // straight to the terminal, like the line-number walk's message:
    // no frame is being built, and the point is that it arrives first
    const written: string[] = [];
    const writeSync = vi.spyOn(fs, 'writeSync').mockImplementation(
      ((_fd: number, data: string) => {
        written.push(String(data));
        return String(data).length;
      }) as unknown as typeof fs.writeSync);

    try {
      useJsRegexp.set(1, []);
    } finally {
      writeSync.mockRestore();
      useJsRegexp.set(0, []);
    }

    expect(written.join('')).toContain("Search with JavaScript's RegExp");
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
