import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import { search, startSearch, searchInputKey, execSearch }
  from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import {
  option,
  startOption,
  optionKey,
  optHeader,
  resetHeaderStart,
  setNoSearchHeaders,
  jumpSindex,
  vlinenum,
  opt
} from '../../src/options';

import { firstLine } from '../../src/features/jumping';

import { formatContent, calculateEOF } from '../../src/helpers';

import { transformContent } from '../../src/lines/helpers';

import { help } from '../../src/startup/lessHelp';

import { UNDERLINE_ON, UNDERLINE_OFF } from '../../src/state/constants';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const content = Array.from({ length: 30 }, (_, i) => `m${i + 1}`);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 80;
  config.halfScreenWidth = 40;
  config.window = 6;
  config.chopLongLines = true;
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  search.input = null;
  search.regex = null;
  search.filters = [];
  option.pending = '';

  initContent(content);
  calculateEOF(content);

  toggle('--header=-\x0D');
  resetHeaderStart();

  // restore the header companion defaults
  toggle('-+-no-number-headers\x0D');
  setNoSearchHeaders(0, 0);
  search.message = '';
});

/** Feeds an option command key by key, like newOptions.test.ts. */
function toggle(keys: string): void {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey(content, key);
}

describe('--header option', () => {
  it('parses L,C,N and reports on query like opt_header', () => {
    toggle('--header=3,4,2\x0D');
    expect(optHeader()).toEqual({ lines: 3, cols: 4, start: 1 });

    toggle('__header\x0D');
    expect(search.message)
      .toBe('Header (lines,columns,line-number) is 3,4,2');
  });

  it('anchors at the current top line when N is omitted', () => {
    config.row = 5;
    toggle('--header=2\x0D');

    expect(optHeader()).toEqual({ lines: 2, cols: 0, start: 5 });
  });

  it('keeps values for empty fields and disables with -', () => {
    toggle('--header=3\x0D');
    toggle('--header=,7\x0D');
    expect(optHeader().lines).toBe(3);
    expect(optHeader().cols).toBe(7);

    toggle('--header=-\x0D');
    expect(optHeader().lines).toBe(0);
    expect(optHeader().cols).toBe(0);

    // og reports find_linenum(header_start_pos) even with no header
    toggle('__header\x0D');
    expect(search.message)
      .toBe('Header (lines,columns,line-number) is 0,0,1');
  });

  it('rejects a non-numeric field like next_cnum', () => {
    toggle('--header=x\x0D');
    expect(search.message).toBe('Number is required after --header');
    expect(optHeader().lines).toBe(0);
  });
});

describe('header line overlay', () => {
  it('pins the header lines over the scrolled screen', () => {
    toggle('--header=2\x0D');
    config.row = 10;

    const lines = formatContent(content);

    expect(lines[0]).toBe('m1');
    expect(lines[1]).toBe(UNDERLINE_ON + 'm2' + UNDERLINE_OFF);
    expect(lines[2]).toBe('m13');
    expect(lines[3]).toBe('m14');
  });

  it('skips the underline when the top sits at the header start', () => {
    toggle('--header=2\x0D');

    const lines = formatContent(content);

    expect(lines[0]).toBe('m1');
    expect(lines[1]).toBe('m2');
    expect(lines[2]).toBe('m3');
  });

  it('does not underline the line-number gutter', () => {
    const saved = opt.linenums;
    opt.linenums = 2;

    try {
      toggle('--header=2\x0D');
      config.row = 10;

      const boundary = formatContent(content)[1];
      const underline = boundary.indexOf(UNDERLINE_ON);
      // eslint-disable-next-line no-control-regex
      const plain = (line: string): string => line.replace(/\x1B\[[\d;]*m/g, '');

      expect(underline).toBeGreaterThan(0);
      expect(boundary.slice(0, underline)).not.toContain(UNDERLINE_ON);
      expect(plain(boundary.slice(0, underline))).toBe('      2 ');
      expect(plain(boundary.slice(underline))).toBe('m2');
    } finally {
      opt.linenums = saved;
    }
  });

  it('shifts headers with hshift like og overlay_header', () => {
    // og's overlay draws header lines through forw_line, which
    // honors the live hshift (pty-verified: L01 fghij... under
    // --header=2,4 with ESC-))
    const wide = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ1234', 'x', 'y', 'z'];
    initContent(wide);
    toggle('--header=1\x0D');

    config.row = 2;
    config.col = 4;

    const lines = formatContent(wide);
    expect(lines[0]).toBe(UNDERLINE_ON + 'EFGHIJ' + UNDERLINE_OFF);
  });

  it('stays active on the help pseudo-file', () => {
    const helpContent = transformContent(help);
    initContent(helpContent);
    toggle('--header=2,3,1\x0D');

    // Once help has moved below its beginning, og overlays lines 1-2,
    // underlines the second one, and continues with help line 4.
    mode.HELP = true;
    config.row = 1;

    const lines = formatContent(helpContent);
    // eslint-disable-next-line no-control-regex
    const plain = (line: string): string => line.replace(/\x1B\[[\d;]*m/g, '');

    expect(plain(lines[0])).toBe('');
    expect(lines[1].startsWith(UNDERLINE_ON)).toBe(true);
    expect(lines[1].endsWith(UNDERLINE_OFF)).toBe(true);
    expect(plain(lines[1])).toContain('SUMMARY OF LESS COMMANDS');
    expect(plain(lines[2]))
      .toBe('      Commands marked with * may be preceded by a number, N.');
  });
});

describe('header column overlay', () => {
  it('keeps the first columns while horizontally shifted', () => {
    const wide = ['ABCDEFGHIJKL', 'MNOPQRSTUVWX'];
    initContent(wide);
    toggle('--header=0,2\x0D');

    config.col = 4;
    config.screenWidth = 8;

    const lines = formatContent(wide);

    expect(lines[0]).toBe('ABGHIJKL');
    expect(lines[1]).toBe('MNSTUVWX');
  });

  it('pads short prefixes to the header column width', () => {
    const wide = ['A', 'MNOPQRSTUVWX'];
    initContent(wide);
    toggle('--header=0,3\x0D');

    config.col = 4;
    config.screenWidth = 8;

    const lines = formatContent(wide);
    expect(lines[0]).toBe('A  ');
  });
});

describe('header jumps', () => {
  it('clamps jumps above the header to its start', () => {
    config.row = 10;
    toggle('--header=2,0,5\x0D');

    // g 1 clamps to the header start (after_header_pos) and og's
    // back() guard stops the -j back-walk there with NO blank rows
    // (forwback.c: pos != after_header_pos breaks), so the screen
    // stays aligned under the overlay - no duplicated lines
    firstLine(content, 1);

    const lines = formatContent(content);
    expect(config.row).toBe(4);
    expect(lines[0]).toBe('m5');
    expect(lines[1]).toBe('m6');
    expect(lines[2]).toBe('m7');
  });

  it('moves the -j target below the header lines', () => {
    expect(jumpSindex()).toBe(0);

    toggle('--header=3\x0D');
    expect(jumpSindex()).toBe(3);
  });
});

describe('--no-number-headers', () => {
  it('blanks header numbers and renumbers below, like vlinenum', () => {
    toggle('--header=2,0,1\x0D');
    toggle('--no-number-headers\x0D');
    expect(search.message).toBe("Don't number header lines");

    expect(vlinenum(1)).toBe(0);
    expect(vlinenum(2)).toBe(0);
    expect(vlinenum(3)).toBe(1);
    expect(vlinenum(10)).toBe(8);

    toggle('--no-number-headers\x0D');
    expect(search.message).toBe('Number header lines');
    expect(vlinenum(1)).toBe(1);
  });
});

describe('--no-search-headers family', () => {
  function doSearch(pattern: string): void {
    startSearch('/', 1);
    for (const char of pattern) searchInputKey(char);
    execSearch(content);
  }

  it('assigns both flags and reports the combined state', () => {
    toggle('--no-search-headers\x0D');
    expect(search.message)
      .toBe('Search does not include header lines or columns');

    toggle('--no-search-header-columns\x0D');
    expect(search.message)
      .toBe('Search includes header lines but not header columns');

    toggle('__no-search-headers\x0D');
    expect(search.message)
      .toBe('Search includes header lines but not header columns');
  });

  it('moves the search start past the first header-count lines', () => {
    toggle('--header=2,0,3\x0D');
    setNoSearchHeaders(1, 0);

    // og's only exclusion is the START adjust over ABSOLUTE line
    // numbers (search.c:1541): the first two FILE lines (m1, m2)
    // fall out of range...
    doSearch('m2$');
    expect(search.message).toMatch(/^Pattern not found/);

    // ...while the actual header rows (m3, m4) still match - og is
    // blind to where the header really starts
    search.message = '';
    doSearch('m3$');
    expect(config.row).toBe(2);
  });

  it('lets backward searches run into the header, like og', () => {
    toggle('--header=1,0,1\x0D');
    setNoSearchHeaders(1, 0);
    config.row = 5;
    search.message = '';

    // og never skips header lines mid-scan: a backward search from
    // below matches the pinned line itself (probed: 6g ?TARGET with
    // --no-search-headers jumps to line 1)
    startSearch('?', 1);
    for (const char of 'm1$') searchInputKey(char);
    execSearch(content);

    expect(config.row).toBe(0);
    expect(search.message).toBe('');
  });

  it('excludes header columns from searches', () => {
    const wide = ['ABCDEF', 'XYABCD'];
    initContent(wide);
    toggle('--header=0,2\x0D');
    setNoSearchHeaders(0, 1);

    // AB in line 1 sits inside the header columns; line 2 matches
    startSearch('/', 1);
    for (const char of 'AB') searchInputKey(char);
    execSearch(wide);

    expect(config.row).toBe(1);
    expect(search.message).not.toBe('Pattern not found');
  });
});
