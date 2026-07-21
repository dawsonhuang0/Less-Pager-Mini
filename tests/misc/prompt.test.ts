import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/config';

import { files, initContent, revealSize, revealPipeEnd }
  from '../../src/features/files';

import { editCommand, prExpand, shellQuote, windowedEditCommand }
  from '../../src/features/prompt';

import { initEnvironment } from '../../src/environment';

const content = Array.from({ length: 30 }, (_, i) => `p${i + 1}`);
const editorEnv = {
  LESSEDIT: process.env.LESSEDIT,
  VISUAL: process.env.VISUAL,
  EDITOR: process.env.EDITOR,
};

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

  delete process.env.LESSEDIT;
  delete process.env.VISUAL;
  delete process.env.EDITOR;
  initEnvironment();
});

afterEach(() => {
  for (const [name, value] of Object.entries(editorEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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

    // og's %L is '?' while ch_length is unknown (prompt.c:379);
    // the where char defaults to top
    expect(prExpand(content, '%l/%L')).toBe('10/?');

    revealSize();
    expect(prExpand(content, '%l/%L')).toBe('10/30');
  });

  it('expands position escapes', () => {
    config.row = 9;

    // lines "p1\n".."p9\n" are 3 bytes each: 27 bytes before line 10
    expect(prExpand(content, '%b')).toBe('27');

    // the pipe's total size is unknown (og's ch_length) even with
    // the end displayed, until a read past it returns EOI
    expect(prExpand(content, '%s')).toBe('?');
    mode.EOF = true;
    expect(prExpand(content, '%s')).toBe('?');
    revealPipeEnd();
    expect(prExpand(content, '%s')).toBe(String(files.list[0].size));
    mode.EOF = false;

    expect(prExpand(content, '%P')).toBe('33');
    expect(prExpand(content, '%d of %D')).toBe('2 of 6');
  });

  it('expands file list and misc escapes', () => {
    files.list.push({
      path: 'next.txt', lines: null, size: 0, sizeKnown: true, saved: null,
    });

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

    // ?e is og's eof_displayed: the pipe must have returned EOI
    mode.EOF = true;
    expect(prExpand(content, '?e(END):%lb.')).toBe('5');
    revealPipeEnd();
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
    revealSize();
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

  it('expands LESSEDIT with VISUAL, line positions and quoted files', () => {
    process.env.VISUAL = 'nvim';
    process.env.LESSEDIT = '%E --line %lm %g';
    files.list[0].path = 'my notes.txt';
    config.row = 9;

    expect(editCommand(content)).toBe('nvim --line 12 my\\ notes.txt');
    expect(windowedEditCommand('huge file.txt', 123))
      .toBe('nvim --line 123 huge\\ file.txt');
  });

  it('drops the default +line conditional when a line is unavailable', () => {
    process.env.EDITOR = 'ed';
    expect(windowedEditCommand('huge file.txt', null))
      .toBe('ed  huge\\ file.txt');
  });
});
