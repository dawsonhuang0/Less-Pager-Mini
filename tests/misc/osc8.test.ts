import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../src/config';

import { initAnsiChars, STYLE_REGEX } from '../../src/constants';

import { initEnvironment } from '../../src/environment';

import {
  osc8CommandForUri,
  osc8Links,
  resetOsc8,
  searchOsc8,
  selectedOsc8,
} from '../../src/features/osc8';

import { search } from '../../src/features/searching';

const NAMES = [
  'LESSANSIOSCALLOW', 'LESSANSIOSCCHARS',
  'LESS_OSC8_OPEN_http', 'LESS_OSC8_OPEN_NONE', 'LESS_OSC8_OPEN_ANY',
] as const;
const saved = Object.fromEntries(NAMES.map(name => [name, process.env[name]]));

beforeEach(() => {
  for (const name of NAMES) delete process.env[name];
  initEnvironment();
  initAnsiChars();
  resetOsc8();
  config.row = 0;
  search.message = '';
});

afterEach(() => {
  for (const name of NAMES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  initEnvironment();
  initAnsiChars();
});

describe('LESSANSIOSCALLOW and LESSANSIOSCCHARS', () => {
  it('always passes typed OSC 8 but rejects other types by default', () => {
    expect(STYLE_REGEX.test('\x1b]8;;https://example.test\x07')).toBe(true);
    expect(STYLE_REGEX.test('\x1b]0;title\x07')).toBe(false);
  });

  it('admits listed numeric types with BEL or ST terminators', () => {
    process.env.LESSANSIOSCALLOW = '0, 52';
    initAnsiChars();
    expect(STYLE_REGEX.test('\x1b]0;title\x07')).toBe(true);
    expect(STYLE_REGEX.test('\x1b]52;c;payload\x1b\\')).toBe(true);
    expect(STYLE_REGEX.test('\x1b]9;unsafe\x07')).toBe(false);
  });

  it('passes only starred custom untyped intro characters in content', () => {
    process.env.LESSANSIOSCCHARS = 'X*Y';
    initAnsiChars();
    expect(STYLE_REGEX.test('\x1bXpayload\x07')).toBe(true);
    expect(STYLE_REGEX.test('\x1bYpayload\x07')).toBe(false);
  });
});

describe('OSC 8 selection and handler variables', () => {
  const open = (uri: string, text: string) =>
    `\x1b]8;id=x;${uri}\x07${text}\x1b]8;;\x07`;

  it('pairs open and close sequences and selects in both directions', () => {
    const lines = [open('https://a', 'A'), 'plain', open('file:x', 'B')];
    expect(osc8Links(lines).map(link => link.uri))
      .toEqual(['https://a', 'file:x']);

    expect(searchOsc8(lines, 1)).toBe(true);
    expect(selectedOsc8()?.uri).toBe('https://a');

    expect(searchOsc8(lines, 1)).toBe(true);
    expect(selectedOsc8()?.uri).toBe('file:x');

    expect(searchOsc8(lines, -1)).toBe(true);
    expect(selectedOsc8()?.uri).toBe('https://a');

    // og never wraps: a miss errors and keeps the old selection
    // (osc8_search returns after "OSC 8 link not found")
    expect(searchOsc8(lines, -1)).toBe(false);
    expect(selectedOsc8()?.uri).toBe('https://a');
    expect(search.message).toBe('OSC 8 link not found');
  });

  it('lowercases schemes, distinguishes NONE, and quotes the URI', () => {
    process.env.LESS_OSC8_OPEN_http = 'open-http';
    process.env.LESS_OSC8_OPEN_NONE = 'open-relative';
    expect(osc8CommandForUri('HTTP://example/a b')?.command)
      .toBe('open-http HTTP://example/a\\ b');
    expect(osc8CommandForUri('local file')?.command)
      .toBe('open-relative local\\ file');
  });

  it('falls back from a dash handler to ANY and honors ^P no-pause', () => {
    process.env.LESS_OSC8_OPEN_http = '-';
    process.env.LESS_OSC8_OPEN_ANY = '\x10fallback';
    const command = osc8CommandForUri('http://example');
    expect(command).toEqual({
      command: 'fallback http://example',
      done: null,
    });
  });
});
