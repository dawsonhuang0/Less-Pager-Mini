import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/config';

import {
  search,
  startSearch,
  searchInputKey,
  searchPrompt,
  execSearch,
  execFilter,
  repeatSearch,
  toggleHighlight,
  clearHighlight,
  highlightLine
} from '../../src/features/searching';

import { formatContent } from '../../src/helpers';

import { INVERSE_ON, INVERSE_OFF, END_MARKER } from '../../src/constants';

import { RED, RESET } from '../utils/constants';

const content = [
  'alpha one',      // 0
  'bravo two',      // 1
  'charlie three',  // 2
  'alpha four',     // 3
  'delta five',     // 4
  'alpha six',      // 5
  'echo seven',     // 6
];

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.endRow = 0;
  config.endSubRow = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.chopLongLines = false;

  mode.INIT = true;
  mode.EOF = false;

  search.input = null;
  search.regex = null;
  search.invert = false;
  search.lastDir = 1;
  search.highlight = true;
  search.subs = new Set();
  search.filters = [];
  search.history = [];
  search.message = '';
});

function type(pattern: string): void {
  for (const char of pattern) searchInputKey(char);
}

function doSearch(dir: '/' | '?', pattern: string, count = 1): void {
  startSearch(dir, count);
  type(pattern);
  execSearch(content);
}

describe('search input editing', () => {
  it('collects typed characters and submits on CR', () => {
    startSearch('/', 1);
    type('abc');

    expect(search.input?.chars.join('')).toBe('abc');
    expect(searchInputKey('\x0D')).toBe('run');
  });

  it('edits with backspace and cancels on empty backspace', () => {
    startSearch('/', 1);
    type('ab');

    expect(searchInputKey('\x7F')).toBe('pending');
    expect(search.input?.chars.join('')).toBe('a');

    searchInputKey('\x7F');
    expect(searchInputKey('\x7F')).toBe('cancel');
    expect(search.input).toBeNull();
  });

  it('cancels on ^C', () => {
    startSearch('/', 1);
    type('ab');

    expect(searchInputKey('\x03')).toBe('cancel');
    expect(search.input).toBeNull();
  });

  it('ignores escape sequences', () => {
    startSearch('/', 1);
    type('ab');
    searchInputKey('\x1B[A');

    expect(search.input?.chars.join('')).toBe('ab');
  });
});

describe('search prompt', () => {
  it('shows &/ for filters and modifier prefixes as they toggle', () => {
    startSearch('&', 1);
    expect(searchPrompt()).toBe('&/');

    searchInputKey('!');
    expect(searchPrompt()).toBe('Non-match &/');

    searchInputKey('\x12');
    expect(searchPrompt()).toBe('Non-match Regex-off &/');

    searchInputKey('!');
    expect(searchPrompt()).toBe('Regex-off &/');
  });

  it('toggles modifiers only while the pattern is empty', () => {
    startSearch('/', 1);
    type('a!b');

    expect(search.input?.chars.join('')).toBe('a!b');
    expect(searchPrompt()).toBe('/a!b');
  });

  it('shows search-only modifiers and combinations for searches', () => {
    startSearch('?', 1);
    searchInputKey('\x0B');
    searchInputKey('\x17');
    searchInputKey('@');

    expect(searchPrompt()).toBe('First-file Keep-pos Wrap ?');
  });

  it('treats search-only modifier keys as literals in a filter', () => {
    startSearch('&', 1);
    searchInputKey('\x0B');
    searchInputKey('*');

    expect(search.input?.chars.join('')).toBe('\x0B*');
    expect(searchPrompt()).toBe('&/^K*');
  });

  it('^S prompts for a sub-pattern digit', () => {
    startSearch('/', 1);
    searchInputKey('\x13');

    expect(searchPrompt()).toBe('Sub-pattern (1-5):');

    searchInputKey('2');
    expect(searchPrompt()).toBe('Sub-2 /');
  });

  it('^L quotes the next character literally', () => {
    startSearch('/', 1);
    searchInputKey('\x0C');

    expect(searchPrompt()).toBe('Lit /');

    searchInputKey('!');

    expect(search.input?.chars.join('')).toBe('!');
    expect(search.input?.invert).toBe(false);
    expect(searchPrompt()).toBe('/!');
  });
});

describe('search history', () => {
  it('recalls previous patterns with Up and Down arrows', () => {
    doSearch('/', 'alpha');
    doSearch('/', 'bravo');

    startSearch('/', 1);
    searchInputKey('\x1B[A');
    expect(search.input?.chars.join('')).toBe('bravo');

    searchInputKey('\x1B[A');
    expect(search.input?.chars.join('')).toBe('alpha');

    // oldest entry: Up stays put
    searchInputKey('\x1B[A');
    expect(search.input?.chars.join('')).toBe('alpha');

    searchInputKey('\x1B[B');
    expect(search.input?.chars.join('')).toBe('bravo');
  });

  it('restores the typed text when navigating back down', () => {
    doSearch('/', 'alpha');

    startSearch('/', 1);
    type('bra');
    searchInputKey('\x1B[A');
    expect(search.input?.chars.join('')).toBe('alpha');

    searchInputKey('\x1B[B');
    expect(search.input?.chars.join('')).toBe('bra');
  });

  it('is shared between searches and filters', () => {
    startSearch('&', 1);
    type('delta');
    execFilter();

    startSearch('?', 1);
    searchInputKey('\x1BOA');
    expect(search.input?.chars.join('')).toBe('delta');
  });

  it('skips consecutive duplicates and empty patterns', () => {
    doSearch('/', 'alpha');
    doSearch('/', 'alpha');
    doSearch('/', '');

    expect(search.history).toEqual(['alpha']);
  });
});

describe('execSearch', () => {
  it('finds a match on the current top line (search includes screen)', () => {
    doSearch('/', 'alpha');

    expect(config.row).toBe(0);
    expect(mode.INIT).toBe(false);
  });

  it('jumps forward to the next matching line', () => {
    config.row = 1;
    doSearch('/', 'alpha');

    expect(config.row).toBe(3);
  });

  it('finds the N-th match forward', () => {
    doSearch('/', 'alpha', 2);

    expect(config.row).toBe(3);
  });

  it('searches backward with ?', () => {
    config.row = 6;
    doSearch('?', 'alpha');

    expect(config.row).toBe(5);
  });

  it('? finds visible matches below the top line', () => {
    // whole 7-line file fits in the window; ? scans from the bottom line
    config.row = 0;
    doSearch('?', 'alpha');

    expect(config.row).toBe(5);
  });

  it('reports when the pattern is not found', () => {
    doSearch('/', 'zulu');

    expect(config.row).toBe(0);
    expect(search.message).toBe('Pattern not found');
  });

  it('reports when repeating with no previous pattern', () => {
    doSearch('/', '');

    expect(search.message).toBe('No previous regular expression');
  });

  it('repeats the previous search on an empty pattern', () => {
    doSearch('/', 'alpha');
    expect(config.row).toBe(0);

    doSearch('/', '');
    expect(config.row).toBe(3);
  });

  it('reports invalid regular expressions', () => {
    doSearch('/', '[');

    expect(search.message).toBe('Invalid pattern');
    expect(config.row).toBe(0);
  });

  it('finds NON-matching lines with !', () => {
    doSearch('/', '!alpha');

    expect(config.row).toBe(1);
  });

  it('searches literally with ^R', () => {
    doSearch('/', '\x12a.pha');
    expect(search.message).toBe('Pattern not found');

    config.row = 1;
    doSearch('/', 'a.pha');
    expect(config.row).toBe(3);
  });

  it('starts from the first line with @', () => {
    config.row = 4;
    doSearch('/', '@alpha');

    expect(config.row).toBe(0);
  });

  it('keeps position with ^K but compiles the pattern', () => {
    doSearch('/', '\x0Balpha');

    expect(config.row).toBe(0);
    expect(search.regex).not.toBeNull();
  });

  it('wraps past EOF with ^W', () => {
    config.row = 5;
    doSearch('/', '\x17bravo');

    expect(config.row).toBe(1);
  });

  it('restricts matches to a sub-pattern with ^S', () => {
    startSearch('/', 1);
    searchInputKey('\x13');
    searchInputKey('2');
    type('(alpha)|(bravo)');
    execSearch(content);

    // only the line where group 2 participates counts as a match
    expect(config.row).toBe(1);

    expect(highlightLine('x bravo y')).toBe(
      'x ' + INVERSE_ON + 'bravo' + INVERSE_OFF + ' y'
    );
    expect(highlightLine('x alpha y')).toBe('x alpha y');
  });
});

describe('repeatSearch', () => {
  it('repeats forward with n and reverses with N', () => {
    doSearch('/', 'alpha');
    expect(config.row).toBe(0);

    repeatSearch(content, 1, false);
    expect(config.row).toBe(3);

    repeatSearch(content, 1, false);
    expect(config.row).toBe(5);

    repeatSearch(content, 1, true);
    expect(config.row).toBe(3);
  });

  it('reverses relative to a backward search', () => {
    config.row = 6;
    doSearch('?', 'alpha');
    expect(config.row).toBe(5);

    repeatSearch(content, 1, false);
    expect(config.row).toBe(3);

    repeatSearch(content, 1, true);
    expect(config.row).toBe(5);
  });

  it('reports when no previous search exists', () => {
    repeatSearch(content, 1, false);

    expect(search.message).toBe('No previous regular expression');
  });
});

describe('highlightLine', () => {
  it('wraps matches in inverse video', () => {
    doSearch('/', 'alpha');

    expect(highlightLine('xx alpha yy')).toBe(
      'xx ' + INVERSE_ON + 'alpha' + INVERSE_OFF + ' yy'
    );
  });

  it('highlights every match in a line', () => {
    doSearch('/', 'alpha');

    expect(highlightLine('alpha alpha')).toBe(
      INVERSE_ON + 'alpha' + INVERSE_OFF +
      ' ' +
      INVERSE_ON + 'alpha' + INVERSE_OFF
    );
  });

  it('matches across ANSI style codes', () => {
    doSearch('/', 'alpha');

    expect(highlightLine('al' + RED + 'pha' + RESET + ' z')).toBe(
      INVERSE_ON + 'al' + INVERSE_OFF +
      RED +
      INVERSE_ON + 'pha' + INVERSE_OFF +
      RESET + ' z'
    );
  });

  it('leaves lines without matches untouched', () => {
    doSearch('/', 'alpha');

    expect(highlightLine('nothing here')).toBe('nothing here');
  });

  it('is disabled by toggle and re-enabled by a new search', () => {
    doSearch('/', 'alpha');

    toggleHighlight();
    expect(highlightLine('alpha')).toBe('alpha');

    toggleHighlight();
    expect(highlightLine('alpha')).toContain(INVERSE_ON);

    clearHighlight();
    expect(highlightLine('alpha')).toBe('alpha');

    doSearch('/', 'bravo');
    expect(highlightLine('bravo')).toContain(INVERSE_ON);
  });

  it('ESC-u without a previous pattern reports an error', () => {
    toggleHighlight();

    expect(search.message).toBe('No previous regular expression');
  });

  it('ESC-U forgets the pattern so n has nothing to repeat', () => {
    doSearch('/', 'alpha');
    clearHighlight();

    expect(search.regex).toBeNull();

    repeatSearch(content, 1, false);
    expect(search.message).toBe('No previous regular expression');
    expect(config.row).toBe(0);
  });

  it('repeating a search unhides highlighting', () => {
    doSearch('/', 'alpha');
    toggleHighlight();
    expect(highlightLine('alpha')).toBe('alpha');

    repeatSearch(content, 1, false);
    expect(highlightLine('alpha')).toContain(INVERSE_ON);
  });
});

describe('prompt replacement at (END)', () => {
  it('suppresses the END marker while typing a search', () => {
    mode.EOF = true;

    const before = formatContent(content);
    expect(before[before.length - 1]).toBe(END_MARKER);

    startSearch('/', 1);

    const during = formatContent(content);
    expect(during[during.length - 1]).not.toBe(END_MARKER);
  });

  it('suppresses the END marker while a message is shown', () => {
    mode.EOF = true;
    search.message = 'Pattern not found';

    const during = formatContent(content);
    expect(during[during.length - 1]).not.toBe(END_MARKER);
  });
});

describe('execFilter', () => {
  it('builds a matcher for &pattern', () => {
    startSearch('&', 1);
    type('alpha');

    const filter = execFilter();

    expect(filter).toBeTypeOf('function');
    expect(content.filter(filter!)).toEqual([
      'alpha one', 'alpha four', 'alpha six'
    ]);
  });

  it('inverts with !', () => {
    startSearch('&', 1);
    type('!alpha');

    const filter = execFilter();

    expect(content.filter(filter!)).toHaveLength(4);
  });

  it('stacks filters so lines must match all patterns', () => {
    startSearch('&', 1);
    type('alpha');
    execFilter();

    startSearch('&', 1);
    type('six');
    const filter = execFilter();

    expect(content.filter(filter!)).toEqual(['alpha six']);
  });

  it('does not touch the search pattern or highlighting', () => {
    startSearch('&', 1);
    type('alpha');
    execFilter();

    expect(search.regex).toBeNull();
    expect(highlightLine('alpha')).toBe('alpha');
  });

  it('returns null on an empty pattern and removes all filters', () => {
    startSearch('&', 1);
    type('alpha');
    execFilter();

    startSearch('&', 1);

    expect(execFilter()).toBeNull();
    expect(search.filters).toEqual([]);
  });

  it('returns undefined on an invalid pattern', () => {
    startSearch('&', 1);
    type('[');

    expect(execFilter()).toBeUndefined();
    expect(search.message).toBe('Invalid pattern');
  });
});
