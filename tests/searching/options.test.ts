import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/config';

import {
  search,
  startSearch,
  searchInputKey,
  execSearch,
  execFilter,
  highlightLine
} from '../../src/features/searching';

import { option, startOption, optionKey } from '../../src/features/options';

import { INVERSE_ON } from '../../src/constants';

const content = [
  'foo line',
  'ALPHA LINE',
  'bar line',
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
  search.caseless = 0;
  search.message = '';

  option.pending = '';
});

function doSearch(dir: '/' | '?', pattern: string): void {
  startSearch(dir, 1);
  for (const char of pattern) searchInputKey(char);
  execSearch(content);
}

describe('-i / -I option command', () => {
  it('-i toggles smart case sensitivity with less messages', () => {
    startOption('-');
    optionKey('i');

    expect(search.caseless).toBe(1);
    expect(search.message).toBe('Ignore case in searches');

    startOption('-');
    optionKey('i');

    expect(search.caseless).toBe(0);
    expect(search.message).toBe('Case is significant in searches');
  });

  it('-I toggles always-ignore case', () => {
    startOption('-');
    optionKey('I');

    expect(search.caseless).toBe(2);
    expect(search.message).toBe('Ignore case in searches and in patterns');

    startOption('-');
    optionKey('I');

    expect(search.caseless).toBe(0);
  });

  it('_ queries without changing the option', () => {
    search.caseless = 1;

    startOption('_');
    optionKey('i');

    expect(search.caseless).toBe(1);
    expect(search.message).toBe('Ignore case in searches');
  });

  it('reports unknown options', () => {
    startOption('-');
    optionKey('z');

    expect(search.message).toBe('There is no z option');
  });
});

describe('case sensitivity in searches', () => {
  it('is case-sensitive by default', () => {
    doSearch('/', 'alpha');

    expect(search.message).toBe('Pattern not found');
    expect(config.row).toBe(0);
  });

  it('-i ignores case for lowercase patterns (smart case)', () => {
    search.caseless = 1;

    doSearch('/', 'alpha');
    expect(config.row).toBe(1);
  });

  it('-i stays sensitive when the pattern has uppercase', () => {
    search.caseless = 1;

    doSearch('/', 'Alpha');
    expect(search.message).toBe('Pattern not found');
  });

  it('-I ignores case even for uppercase patterns', () => {
    search.caseless = 2;

    doSearch('/', 'aLpHa');
    expect(config.row).toBe(1);
  });

  it('toggling -i recompiles the pattern for highlighting', () => {
    search.caseless = 1;
    doSearch('/', 'alpha');
    expect(highlightLine('xx ALPHA yy')).toContain(INVERSE_ON);

    startOption('-');
    optionKey('i');

    expect(search.caseless).toBe(0);
    expect(highlightLine('xx ALPHA yy')).toBe('xx ALPHA yy');
  });

  it('applies to & filters at creation time', () => {
    search.caseless = 2;

    startSearch('&', 1);
    for (const char of 'alpha') searchInputKey(char);
    const filter = execFilter();

    expect(content.filter(filter!)).toEqual(['ALPHA LINE']);
  });
});
