import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search, startSearch, searchInputKey, execSearch }
  from '../../src/features/searching';

import { opt } from '../../src/options';

import { calculateEOF } from '../../src/helpers';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

// a 10-col window wraps these into predictable sub-rows
const width = 10;

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = width;
  config.halfScreenWidth = 5;
  config.window = 6;
  config.chopLongLines = false;

  mode.INIT = false;
  mode.EOF = false;

  search.input = null;
  search.regex = null;
  search.invert = false;
  search.lastDir = 1;
  search.subs = new Set();
  search.filters = [];
  search.message = '';
});

function doSearch(type: '/' | '?', pattern: string): void {
  startSearch(type, 1);
  for (const char of pattern) searchInputKey(char);
}

describe('search_pos over wrapped lines', () => {
  // 8 sub-rows; only subs 0-4 fit the 5 text rows, HIT on sub 6
  const long = 'a'.repeat(60) + 'HITaaaaaaaaaaaaaaaaa';
  const content = [long, 'xxHITxx'];

  it('a fresh search reaches the wrapped tail below the screen', () => {
    calculateEOF(content);
    doSearch('/', 'HIT');
    execSearch(content);

    // the match end (sub 6) lands on the bottom line, like og's
    // get_lastlinepos + jump_loc(lastlinepos, BOTTOM)
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(2);
  });

  it('-a starts at the first invisible sub-row, not the next line', () => {
    calculateEOF(content);
    search.message = '';

    // og search_pos OPT_ON: position(sc_height-1) falls mid-line;
    // the remainder is the first candidate and the jump lands on it
    // (the match end is under the quarter-screen heuristic here)
    withHowSearch(1, () => {
      doSearch('/', 'HIT');
      execSearch(content);
    });

    expect(config.row).toBe(0);
    expect(config.subRow).toBe(5);
  });

  it('-a backward searches the invisible head of the top line', () => {
    const headline = 'aaaaaHITaa' + 'b'.repeat(70);
    const wide = [headline, 'ccc'];
    calculateEOF(wide);

    config.subRow = 2;

    withHowSearch(1, () => {
      doSearch('?', 'HIT');
      execSearch(wide);
    });

    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
    expect(search.message).toBe('');
  });

  it('reports Nothing to search when -a has no place to start', () => {
    const short = ['one', 'two'];
    calculateEOF(short);

    withHowSearch(1, () => {
      doSearch('/', 'two');
      execSearch(short);
    });

    expect(search.message).toBe('Nothing to search');
    expect(config.row).toBe(0);
  });

  it('a match ending exactly at the line end never bottom-jumps', () => {
    // og 707's zeroed chpos sentinel (cvt_text's FIXME): tpos reads
    // as linepos, and pos == opos skips the jump entirely
    const tail = 'a'.repeat(77) + 'HIT';
    const quirky = [tail, 'zzz'];
    calculateEOF(quirky);

    doSearch('/', 'HIT');
    execSearch(quirky);

    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
  });
});

describe('shift_visible rscroll width', () => {
  it('counts the marker column only while --rscroll is enabled', () => {
    // search.c:641: swidth = sc_width - (rscroll_char ? 1 : 0)
    const wide = ['aaaaaHITTzzz'];
    calculateEOF(wide);
    config.chopLongLines = true;

    // marker on: the match end (col 9) misses the 9-col text area
    doSearch('/', 'HITT');
    execSearch(wide);
    expect(config.col).toBe(3);

    config.col = 0;
    const saved = opt.rscrollChar;
    opt.rscrollChar = '';

    try {
      // --rscroll=-: the full width is usable and no shift happens
      doSearch('/', 'HITT');
      execSearch(wide);
      expect(config.col).toBe(0);
    } finally {
      opt.rscrollChar = saved;
      config.chopLongLines = false;
    }
  });
});

/** Runs a block under a -a/--search-skip-screen state. */
function withHowSearch(state: number, fn: () => void): void {
  const saved = opt.howSearch;
  opt.howSearch = state;

  try {
    fn();
  } finally {
    opt.howSearch = saved;
  }
}
