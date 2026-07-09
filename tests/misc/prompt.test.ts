import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/config';

import { files, initContent } from '../../src/features/files';

import { prExpand, shellQuote } from '../../src/features/prompt';

const content = Array.from({ length: 30 }, (_, i) => `p${i + 1}`);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 80;
  config.window = 6;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  initContent(content);
  files.list[0].path = 'notes.txt';
});

describe('prompt expansion', () => {
  it('expands file name escapes', () => {
    files.list[0].path = 'dir/my notes.txt';

    expect(prExpand(content, '%f')).toBe('dir/my notes.txt');
    expect(prExpand(content, '%F')).toBe('my notes.txt');
    expect(prExpand(content, '%g')).toBe('dir/my\\ notes.txt');
    expect(prExpand(content, '%G')).toBe('my\\ notes.txt');
  });

  it('expands line numbers with where chars', () => {
    config.row = 9;

    // top, middle, bottom, bottom-plus-one of a 6-row window
    expect(prExpand(content, '%lt-%lm-%lb-%lB')).toBe('10-12-14-15');

    // the where char defaults to top
    expect(prExpand(content, '%l/%L')).toBe('10/30');
  });

  it('expands position escapes', () => {
    config.row = 9;

    // lines "p1\n".."p9\n" are 3 bytes each: 27 bytes before line 10
    expect(prExpand(content, '%b')).toBe('27');
    expect(prExpand(content, '%s')).toBe(String(files.list[0].size));

    expect(prExpand(content, '%P')).toBe('33');
    expect(prExpand(content, '%d of %D')).toBe('2 of 6');
  });

  it('expands file list and misc escapes', () => {
    files.list.push({ path: 'next.txt', lines: null, size: 0, saved: null });

    expect(prExpand(content, '%i of %m, next %x')).toBe(
      '1 of 2, next next.txt'
    );
    expect(prExpand(content, '%T')).toBe('file');
    expect(prExpand(content, '100%%')).toBe('100%');
    expect(prExpand(content, '%c')).toBe('1');
  });

  it('evaluates conditionals with else and endif', () => {
    // 6 screen rows show 5 content lines above the prompt line
    expect(prExpand(content, '?e(END):%lb.')).toBe('5');

    mode.EOF = true;
    expect(prExpand(content, '?e(END):%lb.')).toBe('(END)');

    // ?m with one file: false branch after the else
    expect(prExpand(content, '?m(file %i of %m):single.')).toBe('single');

    files.list.push({ path: 'b.txt', lines: null, size: 0, saved: null });
    expect(prExpand(content, '?m(file %i of %m):single.')).toBe(
      '(file 1 of 2)'
    );
  });

  it('handles nesting, backslash escapes and %t truncation', () => {
    expect(prExpand(content, '?e?xnext\\ %x:done.:more.')).toBe('more');

    mode.EOF = true;
    expect(prExpand(content, '?e?xnext\\ %x:done.:more.')).toBe('done');

    files.list.push({ path: 'n.txt', lines: null, size: 0, saved: null });
    expect(prExpand(content, '?e?xnext\\ %x:done.:more.')).toBe(
      'next n.txt'
    );

    expect(prExpand(content, 'pad   %t!')).toBe('pad!');
    expect(prExpand(content, '\\%f')).toBe('%f');
  });

  it('quotes shell metacharacters like less', () => {
    expect(shellQuote('a b$c')).toBe('a\\ b\\$c');
    expect(shellQuote('plain.txt')).toBe('plain.txt');
    expect(shellQuote('a\nb')).toBe('a"\n"b');
  });
});
