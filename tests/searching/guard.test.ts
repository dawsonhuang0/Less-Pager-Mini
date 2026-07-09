import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

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
  it('drops a pattern that hangs the regex engine', () => {
    runSearch('(a+)+b');

    expect(search.message).toBe('Pattern too complex');
    expect(search.regex).toBeNull();
    expect(search.highlight).toBe(false);

    // the display stays where it was, like an interrupted search
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
