import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/state/config';

import {
  search,
  startSearch,
  searchInputKey,
  execSearch,
  execFilter,
  highlightLine
} from '../../src/features/searching';

import {
  option,
  startOption,
  optionKey,
  scanOptions
} from '../../src/options';

import { opt } from '../../src/options/state';

import {
  optUseGnuRegexp,
  optUseJsRegexp
} from '../../src/options/shared';

import { useGnuRegexp } from '../../src/options/use-gnu-regexp';

import { useJsRegexp } from '../../src/options/use-js-regexp';

import { hasGnuLibc } from '../../src/tty/platform';

import { INVERSE_ON } from '../../src/state/constants';

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
  opt.useGnuRegexp = -1;
  opt.useJsRegexp = 0;
});

function doSearch(dir: '/' | '?', pattern: string): void {
  startSearch(dir, 1);
  for (const char of pattern) searchInputKey(char);
  execSearch(content);
}

describe('-i / -I option command', () => {
  it('-i toggles smart case sensitivity with less messages', () => {
    startOption('-');
    optionKey([], 'i');

    expect(search.caseless).toBe(1);
    expect(search.message).toBe('Ignore case in searches');

    startOption('-');
    optionKey([], 'i');

    expect(search.caseless).toBe(0);
    expect(search.message).toBe('Case is significant in searches');
  });

  it('-I toggles always-ignore case', () => {
    startOption('-');
    optionKey([], 'I');

    expect(search.caseless).toBe(2);
    expect(search.message).toBe('Ignore case in searches and in patterns');

    startOption('-');
    optionKey([], 'I');

    expect(search.caseless).toBe(0);
  });

  it('_ queries without changing the option', () => {
    search.caseless = 1;

    startOption('_');
    optionKey([], 'i');

    expect(search.caseless).toBe(1);
    expect(search.message).toBe('Ignore case in searches');
  });

  it('reports unknown options', () => {
    startOption('-');
    optionKey([], 'l');

    expect(search.message).toBe('There is no -l option');
  });
});

describe('case sensitivity in searches', () => {
  it('is case-sensitive by default', () => {
    doSearch('/', 'alpha');

    expect(search.message).toMatch(/^Pattern not found: /);
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
    expect(search.message).toMatch(/^Pattern not found: /);
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
    optionKey([], 'i');

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

/*
 * glibc's regcomp passes RE_SYNTAX_POSIX_EXTENDED, which leaves
 * RE_NO_GNU_OPS clear, so a Linux user's less reads `\w` and a BSD
 * user's reads the letter w. --use-gnu-regexp hands the second user
 * the first one's dialect.
 *
 * There is no w anywhere in the corpus, which is what makes `\w` tell
 * the two apart.
 */
describe('--use-gnu-regexp', () => {
  const POSIX = 0;
  const GNU = 1;

  it('follows the host libc until something says otherwise', () => {
    // -1 is untouched: an unasked session searches the way the less
    // on the same machine does, which is the only default that can be
    // right on both a glibc box and a BSD one
    opt.useGnuRegexp = -1;
    expect(optUseGnuRegexp()).toBe(hasGnuLibc());
  });

  it('hands over the OTHER dialect when named', () => {
    // naming a bool sets it to the opposite of its default and the
    // default is the host's - so this is GNU where glibc is absent
    // and POSIX where it is, which is what the help line says
    scanOptions('--use-gnu-regexp', content, false);
    expect(optUseGnuRegexp()).toBe(!hasGnuLibc());
  });

  it('puts the host back on -+', () => {
    scanOptions('--use-gnu-regexp', content, false);
    scanOptions('--+use-gnu-regexp', content, false);
    expect(optUseGnuRegexp()).toBe(hasGnuLibc());
  });

  it('reads \\w as a word character under GNU, and as w under POSIX', () => {
    // there is no w anywhere in the corpus, which is what makes this
    // tell the two dialects apart
    opt.useGnuRegexp = GNU;
    doSearch('/', '\\w');
    expect(search.message).not.toMatch(/^Pattern not found: /);

    search.message = '';
    opt.useGnuRegexp = POSIX;
    doSearch('/', '\\w');
    expect(search.message).toMatch(/^Pattern not found: /);
  });

  it('brings the whole dialect, not the operators alone', () => {
    // BSD has no backreferences either, so `(o)\1` is (o) then a 1;
    // one knob without the other six would be a dialect no libc has
    opt.useGnuRegexp = GNU;

    doSearch('/', '(o)\\1');
    expect(search.message).not.toMatch(/^Pattern not found: /);
    expect(config.row).toBe(0);
  });

  it('stands aside from --use-js-regexp, either direction', () => {
    // naming a dialect names the engine that HAS dialects, so JS
    // steps aside - and because less scans left to right, that is
    // also what makes the later flag win
    for (const state of [GNU, POSIX]) {
      useJsRegexp.set(1, '');
      useGnuRegexp.set(state, '');
      expect(opt.useJsRegexp).toBe(0);
    }
  });

  // the `-` command as a user drives it: dash, the long name typed
  // out, RETURN. Nothing below reimplements the toggle arithmetic -
  // getting that wrong is what let the bug through
  const dash = (name: string): void => {
    search.message = '';
    startOption('-');
    for (const char of `-${name}`) optionKey(content, char);
    optionKey(content, '\n');
  };
  const engine = (): string =>
    optUseJsRegexp() ? 'JS' : (optUseGnuRegexp() ? 'GNU' : 'POSIX');

  it('uncovers the dialect under JS instead of flipping it', () => {
    // never a dialect by NAME: which one the flag lands on depends on
    // the libc, so the claim is about the relationship - the press
    // that comes out from under JS must not move the dialect
    dash('use-gnu-regexp');
    const chosen = engine();

    dash('use-js-regexp');
    expect(engine()).toBe('JS');

    // the press that used to flip: the dialect underneath was already
    // set and invisible, so it flipped what the user could not see
    dash('use-gnu-regexp');
    expect(engine()).toBe(chosen);
    expect(search.message).toBe(`Search with ${chosen} regular expressions`);

    // ...and the press after that does change it
    dash('use-gnu-regexp');
    expect(engine()).not.toBe(chosen);
  });

  it('names the dialect it returns to when JS is switched off', () => {
    // the message used to come from the HOST rather than the dialect
    // in force, so on a Mac it said POSIX while searching with GNU
    dash('use-gnu-regexp');
    const chosen = engine();

    dash('use-js-regexp');
    dash('use-js-regexp');

    expect(engine()).toBe(chosen);
    expect(search.message).toBe(`Search with ${chosen} regular expressions`);
  });

  it('is never written by --use-js-regexp', () => {
    // JS sits on top: it picks the engine and leaves the dialect
    // saying whatever it said, so turning JS off uncovers the reading
    // the user chose rather than guessing at one
    useGnuRegexp.set(GNU, '');
    useJsRegexp.set(1, '');
    expect(opt.useGnuRegexp).toBe(GNU);

    useJsRegexp.set(0, '');
    expect(opt.useGnuRegexp).toBe(GNU);
  });
});
