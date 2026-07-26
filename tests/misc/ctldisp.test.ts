import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/state/config';

import { opt } from '../../src/options';

import { initCharset } from '../../src/features/charset';

import { initAnsiChars } from '../../src/state/constants';

import { transformContent } from '../../src/lines/helpers';

/**
 * -R passes ANSI sequences through, but only the ones og's ansi_step
 * accepts: an ESC, middle characters from $LESSANSIMIDCHARS, then an
 * end character from $LESSANSIENDCHARS ("m" by default).
 *
 * The first character that is neither returns ANSI_ERR, and og's
 * remove_ansi() then DELETES everything the sequence stored, that
 * character included (line.c:1252) — so ESC[K, ESC[?25l and ESC(B
 * vanish under -R rather than showing as carets.
 *
 * Every expectation here was captured from og (less/less -R) at 6x40.
 */
const ESC = '\x1B';

beforeEach(() => {
  config.screenWidth = 40;
  mode.DUMB = false;
  opt.ctldisp = 2;
  opt.bsMode = 0;
  opt.procBackspace = 0;
  opt.squeeze = 0;
  delete process.env.LESSANSIENDCHARS;
  delete process.env.LESSANSIMIDCHARS;
  initCharset();
  initAnsiChars();
});

const shown = (line: string): string => transformContent([line])[0];

describe('-R sequence acceptance', () => {
  it('passes a complete SGR sequence through untouched', () => {
    expect(shown(`${ESC}[31mRED${ESC}[m tail`))
      .toBe(`${ESC}[31mRED${ESC}[m tail`);
  });

  it('deletes a sequence that ends on a non-end character', () => {
    // og: "RED tail" — the ESC[K is gone, not caret-rendered
    expect(shown(`${ESC}[KRED tail`)).toBe('RED tail');
    expect(shown(`${ESC}[?25lRED tail`)).toBe('RED tail');
    expect(shown(`${ESC}(BRED tail`)).toBe('RED tail');
  });

  it('keeps a later valid sequence after deleting an invalid one', () => {
    expect(shown(`${ESC}[K${ESC}[31mRED${ESC}[m tail`))
      .toBe(`${ESC}[31mRED${ESC}[m tail`);
  });

  it('deletes an OSC whose type is not allowed', () => {
    // og swallows the whole OSC 0 title, terminator included
    expect(shown(`${ESC}]0;title\x07RED tail`)).toBe('RED tail');
  });

  it('emits an unfinished sequence but never a lone trailing ESC', () => {
    // og: "RED \x1b[31" reaches the screen, a dangling ESC does not -
    // passing it raw would swallow the newline and merge two rows
    expect(shown(`RED ${ESC}[31`)).toBe(`RED ${ESC}[31`);
    expect(shown(`RED tail${ESC}`)).toBe('RED tail');
  });

  it('follows $LESSANSIENDCHARS', () => {
    process.env.LESSANSIENDCHARS = 'mK';
    initAnsiChars();

    // K now ENDS a sequence, so ESC[K passes through instead
    expect(shown(`${ESC}[KRED tail`)).toBe(`${ESC}[KRED tail`);
  });
});

describe('-r passes every control character raw', () => {
  beforeEach(() => {
    opt.ctldisp = 1;
  });

  it('leaves sequences og would reject under -R alone', () => {
    expect(shown(`${ESC}[KRED tail`)).toBe(`${ESC}[KRED tail`);
    expect(shown(`${ESC}(BRED tail`)).toBe(`${ESC}(BRED tail`);
  });
});
