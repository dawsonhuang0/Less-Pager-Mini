import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import {
  search,
  startSearch,
  searchInputKey,
  searchPrompt
} from '../../src/features/searching';

import { cmd, cmdCol } from '../../src/features/cmdbuf';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

beforeEach(() => {
  config.screenWidth = 80;
  config.window = 24;

  mode.INIT = true;
  mode.EOF = false;

  search.input = null;
  search.regex = null;
  search.history = [];
  search.message = '';

  startSearch('/', 1);
});

function type(text: string): void {
  for (const char of text) searchInputKey(char);
}

const pattern = (): string => search.input?.chars.join('') ?? '';

describe('editing at the search prompt', () => {
  it('inserts mid-pattern after arrow movement', () => {
    type('abc');
    searchInputKey('\x1B[D');
    type('X');

    expect(pattern()).toBe('abXc');
    expect(searchPrompt()).toBe('/abXc');
  });

  it('moves by words with ctrl-arrows', () => {
    type('foo bar baz');

    searchInputKey('\x1B[1;5D'); // ctrl-left
    searchInputKey('\x1B[1;5D');
    type('Z');
    expect(pattern()).toBe('foo Zbar baz');
  });

  it('deletes a word with ESC-BACKSPACE', () => {
    type('one two');
    searchInputKey('\x1B');
    searchInputKey('\x7F');
    expect(pattern()).toBe('one ');
  });

  it('kills the line with ^U but keeps the prompt open', () => {
    type('abc');
    expect(searchInputKey('\x15')).toBe('pending');
    expect(pattern()).toBe('');
    expect(search.input).not.toBeNull();
  });

  it('aborts with ^G', () => {
    type('abc');
    expect(searchInputKey('\x07')).toBe('cancel');
    expect(search.input).toBeNull();
  });

  it('recalls history with a cursor-anchored prefix', () => {
    search.history.push('alpha', 'beta', 'alps');
    startSearch('/', 1); // reopen so the recall spot sees the list

    type('al');
    searchInputKey('\x1B[A');
    expect(pattern()).toBe('alps');

    searchInputKey('\x1B[A');
    expect(pattern()).toBe('alpha');
  });

  it('still toggles modifiers on an empty pattern', () => {
    searchInputKey('\x0E'); // ^N
    expect(searchPrompt()).toBe('Non-match /');

    // the prompt column follows the longer prompt
    expect(cmdCol()).toBe('Non-match /'.length);
  });

  it('treats a modifier char as text once the pattern started', () => {
    type('a!');
    expect(pattern()).toBe('a!');
  });

  it('inserts a dead ESC combo as pattern text, like og', () => {
    searchInputKey('\x1B');
    searchInputKey('q');

    expect(pattern()).toBe('\x1Bq');
    expect(searchPrompt()).toBe('/ESCq');
  });

  it('shifts the display when the pattern outgrows the screen', () => {
    config.screenWidth = 20;
    startSearch('/', 1);

    type('abcdefghijklmnopqrstuvwx');

    expect(cmd.offset).toBeGreaterThan(0);
    expect(cmdCol()).toBeLessThan(20);
    expect(searchPrompt()).toBe('/' + cmd.steps.slice(cmd.offset).join(''));
  });
});
