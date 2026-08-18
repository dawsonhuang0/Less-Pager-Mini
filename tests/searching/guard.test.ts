import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import {
  search,
  startSearch,
  searchInputKey,
  execSearch,
  filterLines
} from '../../src/features/searching';

import { initContent } from '../../src/features/files';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

// a subject that hangs V8's backtracking engine on (a+)+b
const content = ['alpha one', 'a'.repeat(300), 'alpha two'];

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.screenWidth = 80;
  config.window = 6;

  mode.INIT = false;
  mode.EOF = false;

  search.input = null;
  search.regex = null;
  search.invert = false;
  search.highlight = true;
  search.subs = new Set();
  search.filters = [];
  search.history = [];
  search.message = '';

  initContent(content);
});

function runSearch(pattern: string): void {
  startSearch('/', 1);
  for (const char of pattern) searchInputKey(char);
  searchInputKey('\x0D');
  execSearch(content);
}

describe('catastrophic pattern guard', () => {
  // less runs this pattern against the same 300 a's and simply reports
  // "Pattern not found" — a C regcomp is an NFA and has nothing to
  // blow up. Our search is one too now, so the backtracking blowup
  // this used to guard against cannot happen through a search pattern
  // and the guard never fires for one.
  it('answers a backtracking pattern the way less does', () => {
    runSearch('(a+)+b');

    expect(search.message).toBe('Pattern not found: (a+)+b');
    expect(search.regex).not.toBeNull();
    expect(config.row).toBe(0);
  }, 15000);

  it('leaves ordinary searches alone', () => {
    runSearch('alpha two');

    expect(search.message).toBe('');
    expect(config.row).toBe(2);
  });

  it('drops a catastrophic & filter instead of hanging', () => {
    const regex = /(a+)+b/;
    const result = filterLines(content, line => regex.test(line));

    expect(result).toBeNull();
    expect(search.message).toBe('Pattern too complex');
  }, 15000);

  it('applies ordinary filters through the guarded slices', () => {
    const result = filterLines(content, line => line.includes('alpha'));
    expect(result).toEqual(['alpha one', 'alpha two']);
  });
});
