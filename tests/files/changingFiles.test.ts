import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/state/config';

import { search } from '../../src/features/searching';

import {
  files,
  examine,
  initContent,
  initFiles,
  loadFile,
  saveFilePosition,
  stepFileTarget,
  indexFileTarget,
  startExamine,
  examineKey,
  expandExamineList,
  addExamineHistory,
  setPreviousPath,
  fileTitle,
  nextFileName,
  fileInfo,
  revealPipeEnd
} from '../../src/features/files';

import { opt, scanOptions } from '../../src/options';

import { runExamine } from '../../src/commands';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-files-'));
const fileA = path.join(dir, 'a.txt');
const fileB = path.join(dir, 'b.txt');

// 100 lines of "l1".."l100" with a trailing newline, like a normal file
fs.writeFileSync(
  fileA,
  Array.from({ length: 100 }, (_, i) => `l${i + 1}`).join('\n') + '\n'
);
fs.writeFileSync(fileB, 'b1\nb2\nb3\n');

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  initFiles([fileA, fileB]);
  files.index = 0;
});

describe('file list navigation', () => {
  it('steps forward and backward with less-style errors', () => {
    expect(stepFileTarget(1, 1)).toBe(1);

    files.index = 1;
    expect(stepFileTarget(1, 1)).toBeNull();
    expect(search.message).toBe('No next file');

    search.message = '';
    expect(stepFileTarget(1, 2)).toBeNull();
    expect(search.message).toBe('No (N-th) next file');

    files.index = 0;
    expect(stepFileTarget(-1, 1)).toBeNull();
    expect(search.message).toBe('No previous file');
  });

  it('resolves :x targets', () => {
    expect(indexFileTarget(1)).toBe(0);
    expect(indexFileTarget(2)).toBe(1);

    expect(indexFileTarget(3)).toBeNull();
    expect(search.message).toBe('No such file');
  });
});

describe('loading', () => {
  it('reads a file and strips the trailing newline', () => {
    const lines = loadFile(0);

    expect(lines).toHaveLength(100);
    expect(lines?.[0]).toBe('l1');
    expect(lines?.[99]).toBe('l100');
    expect(files.list[0].size).toBe(fs.statSync(fileA).size);
  });

  it('reports missing files and directories like less', () => {
    files.list.push({
      path: path.join(dir, 'nope.txt'), lines: null, size: 0, saved: null,
    });
    expect(loadFile(2)).toBeNull();
    expect(search.message).toContain('No such file or directory');

    search.message = '';
    files.list.push({ path: dir, lines: null, size: 0, saved: null });
    expect(loadFile(3)).toBeNull();
    expect(search.message).toBe(`${dir} is a directory`);
  });

  it('saves and keeps per-file positions', () => {
    config.row = 42;
    config.subRow = 1;
    saveFilePosition();

    expect(files.list[0].saved).toEqual({ row: 42, subRow: 1 });
  });
});

describe('examine prompt', () => {
  it('collects text, edits, and runs on RETURN', () => {
    startExamine();
    expect(examine.pending).toBe(true);

    for (const char of 'a.tx') examineKey(char);
    expect(examine.text).toBe('a.tx');

    examineKey('\x7F');
    expect(examine.text).toBe('a.t');

    examineKey('x');
    examineKey('t');
    expect(examineKey('\x0D')).toBe('run');
    expect(examine.pending).toBe(false);
    expect(examine.text).toBe('a.txt');
  });

  it('cancels on ^C and on backspacing past the start', () => {
    startExamine();
    examineKey('x');
    expect(examineKey('\x03')).toBe('cancel');
    expect(examine.text).toBe('');

    startExamine();
    expect(examineKey('\x7F')).toBe('cancel');
    expect(examine.pending).toBe(false);
  });

  it('recalls opened file names with Up/Down', () => {
    addExamineHistory(fileA);
    addExamineHistory(fileB);

    startExamine();
    examineKey('\x1B[A');
    expect(examine.text).toBe(fileB);

    examineKey('\x1B[A');
    expect(examine.text).toBe(fileA);

    // past the oldest entry, Up rings and stays put
    examineKey('\x1B[A');
    expect(examine.text).toBe(fileA);

    examineKey('\x1B[B');
    expect(examine.text).toBe(fileB);

    // past the newest entry, Down rings and stays put
    examineKey('\x1B[B');
    expect(examine.text).toBe(fileB);
  });

  it('only recalls entries starting with the typed text', () => {
    addExamineHistory('hello.txt');
    addExamineHistory('main.txt');

    startExamine();
    for (const char of 'he') examineKey(char);
    examineKey('\x1B[A');
    expect(examine.text).toBe('hello.txt');

    // the latched prefix keeps filtering after the recall
    examineKey('\x1B[B');
    expect(examine.text).toBe('hello.txt');

    // an unmatched prefix rings and keeps the typed text
    startExamine();
    examineKey('x');
    examineKey('\x1B[A');
    expect(examine.text).toBe('x');
    expect(examine.pending).toBe(true);
  });

  it('re-latches the prefix after editing the text', () => {
    addExamineHistory('hello.txt');
    addExamineHistory('help.txt');

    startExamine();
    examineKey('\x1B[A');
    expect(examine.text).toBe('help.txt');

    // erasing a char latches "help.tx", which hello.txt cannot match
    examineKey('\x7F');
    examineKey('\x1B[A');
    expect(examine.text).toBe('help.tx');
  });

  it('wraps Down at a fresh prompt to the oldest entry', () => {
    addExamineHistory('hello.txt');
    addExamineHistory('main.txt');

    startExamine();
    examineKey('\x1B[B');
    expect(examine.text).toBe('hello.txt');
  });

  it('skips consecutive duplicates and rings with no history', () => {
    startExamine();
    examineKey('\x1B[A');
    expect(examine.text).toBe('');
    expect(examine.pending).toBe(true);

    addExamineHistory(fileA);
    addExamineHistory(fileA);
    addExamineHistory(fileB);

    startExamine();
    examineKey('\x1B[A');
    examineKey('\x1B[A');
    expect(examine.text).toBe(fileA);

    examineKey('\x1B[A');
    expect(examine.text).toBe(fileA);
  });

  it('seeds the history with - for in-memory content', () => {
    initContent(['x']);

    startExamine();
    examineKey('\x1B[A');
    expect(examine.text).toBe('-');
  });

  it('escapes recalled names containing spaces', () => {
    // less shell_quotes the history entry (edit.c:683): the meta
    // escape, never the -" pair, on a shell that has one
    addExamineHistory('with space.txt');

    startExamine();
    examineKey('\x1B[A');
    expect(examine.text).toBe('with\\ space.txt');
  });
});

describe('examine expansion', () => {
  it('substitutes % and # like fexpand', () => {
    setPreviousPath(fileB);

    expect(expandExamineList('%')).toEqual([fileA]);
    expect(expandExamineList('#')).toEqual([fileB]);
    expect(expandExamineList('%%')).toEqual(['%']);
    expect(expandExamineList('##')).toEqual(['#']);

    // with no previous file, # stays literal
    setPreviousPath(null);
    expect(expandExamineList('#')).toEqual(['#']);
  });

  it('splits space-separated names, honoring quotes', () => {
    expect(expandExamineList('one two')).toEqual(['one', 'two']);
    expect(expandExamineList('"with space" three'))
      .toEqual(['with space', 'three']);
  });

  it('groups with the -" quote pair, like init_textlist', () => {
    opt.quoteOpen = '<';
    opt.quoteClose = '>';

    try {
      expect(expandExamineList('<with space> three'))
        .toEqual(['with space', 'three']);

      // the old default pair no longer groups
      expect(expandExamineList('"a b"')).toEqual(['"a', 'b"']);

      // a doubled close quote is a literal one (shell_unquote)
      expect(expandExamineList('<a>>b>')).toEqual(['a>b']);
    } finally {
      opt.quoteOpen = opt.quoteClose = '"';
    }
  });

  it('protects a space with the meta escape, like shell_unquote', () => {
    expect(expandExamineList('with\\ space three'))
      .toEqual(['with space', 'three']);

    // a quote opened mid-word groups the space AND is consumed.
    // shell_unquote alone would keep it - it only strips a LEADING
    // quote - but it never sees the word first: init_textlist hands
    // the still-quoted word to lglob, and the SHELL strips it there.
    // Measured on less/less: `:e pre"a b"` reports `prea b`.
    expect(expandExamineList('pre"a b"')).toEqual(['prea b']);
  });

  it('globs patterns and sorts, falling back to the raw name', () => {
    const globbed = expandExamineList(path.join(dir, '*.txt'));
    expect(globbed).toEqual([fileA, fileB]);

    const question = expandExamineList(path.join(dir, '?.txt'));
    expect(question).toEqual([fileA, fileB]);

    expect(expandExamineList(path.join(dir, 'z*'))).toEqual([
      path.join(dir, 'z*'),
    ]);
  });

  it('reports a name it could not open, and does not defer the message',
    async () => {
      // less's edit_list error()s per failing name (edit.c), so a failed
      // :e leaves "<name>: No such file or directory" holding the bottom
      // line. The message must be armed by the time runExamine RETURNS:
      // the caller renders on the next line and nothing repaints after.
      files.list = [{ path: fileA, lines: null, size: 0, sizeKnown: true,
        saved: null }];
      files.index = 0;
      search.message = '';

      startExamine();
      for (const ch of 'nosuchfile') examineKey(ch);
      examineKey('\r');

      // deliberately NOT awaited, which is the whole point: the caller
      // renders on the very next line (core.ts, the examine dispatch),
      // so an await inside runExamine that hands the tail to a
      // microtask sets the message AFTER the paint that should carry
      // it. Awaiting here would pass either way.
      const done = runExamine();

      expect(search.message).toBe('nosuchfile: No such file or directory');

      await done;
    });

  it('globs in process on request, under --use-zsh-glob', () => {
    // NOT a less option: less's lglob always shells out
    // (filename.c:750), and glob(3) appears once in all of less, under
    // `#if MSDOS_COMPILER==DJGPPC`. This makes the in-process globber -
    // the one Windows and a machine with no shell already use -
    // reachable on purpose, so the two can be compared from one binary.
    const brace = path.join(dir, '{a,b}.txt');

    // the shell splits a brace list BEFORE it globs, so it expands here
    expect(expandExamineList(brace)).toEqual([fileA, fileB]);

    try {
      scanOptions('--use-zsh-glob', []);

      expect(expandExamineList(path.join(dir, '*.txt')))
        .toEqual([fileA, fileB]);

      // ...and cannot there. Word splitting is the shell's, not the
      // matcher's, so an in-process globber never sees the braces -
      // the one grammar difference the switch makes.
      expect(expandExamineList(brace)).toEqual([brace]);
    } finally {
      opt.useZshGlob = 0;
    }
  });

  it('globs in process when no shell can be executed at all', () => {
    // less degrades here rather than deciding to: popen forks fine, the
    // child cannot exec, and lglob reads the empty pipe as "did not
    // expand" (filename.c:790, which never looks at the status). It has
    // no in-process globber on unix to do better with; we carry one for
    // Windows already, so :e keeps working on a machine whose shell is
    // gone. A DELIBERATE divergence, like the Windows branch.
    const realShell = process.env.SHELL;

    try {
      process.env.SHELL = '/nonexistent-shell';

      expect(expandExamineList(path.join(dir, '*.txt')))
        .toEqual([fileA, fileB]);

      // and a pattern that matches nothing is still the pattern, which
      // is what less answers with and what the shell branch answers
      // with - the fallback changes who looks, not what is said
      expect(expandExamineList(path.join(dir, 'z*'))).toEqual([
        path.join(dir, 'z*'),
      ]);
    } finally {
      if (realShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = realShell;
    }
  });

  it('expands ~ and environment variables', () => {
    process.env.LPM_TEST_DIR = dir;
    expect(expandExamineList('$LPM_TEST_DIR/a.txt')).toEqual([fileA]);
    expect(expandExamineList('${LPM_TEST_DIR}/b.txt')).toEqual([fileB]);
    delete process.env.LPM_TEST_DIR;

    expect(expandExamineList('~/x')[0]).toBe(path.join(os.homedir(), 'x'));
  });

  it('cycles TAB completions through matches then the original', () => {
    startExamine();
    for (const char of path.join(dir, 'a')) examineKey(char);

    examineKey('\x09');
    expect(examine.text).toBe(fileA);

    // one match: next TAB returns to the typed original
    examineKey('\x09');
    expect(examine.text).toBe(path.join(dir, 'a'));

    examineKey('\x09');
    expect(examine.text).toBe(fileA);

    // backward completion steps the other way
    examineKey('\x0F');
    expect(examine.text).toBe(path.join(dir, 'a'));
  });

  it('expands the whole match list with ^L', () => {
    startExamine();
    for (const char of dir + '/') examineKey(char);

    examineKey('\x0C');
    expect(examine.text).toBe(`${fileA} ${fileB}`);
  });
});

describe('prompts and info', () => {
  it('builds the new-file title like %f (file i of m)', () => {
    expect(fileTitle()).toBe(`${fileA} (file 1 of 2)`);

    files.index = 1;
    expect(fileTitle()).toBe(`${fileB} (file 2 of 2)`);

    initContent(['x']);
    expect(fileTitle()).toBe('');
  });

  it('names the next file for the (END) marker', () => {
    expect(nextFileName()).toBe(fileB);

    files.index = 1;
    expect(nextFileName()).toBe('');
  });

  it('formats = output like e_proto', () => {
    loadFile(0);
    const content = files.list[0].lines ?? loadFile(0)!;

    fileInfo(content);

    // 23 rows shown; byte = start of line 24 (60 chars + 23 newlines)
    const size = fs.statSync(fileA).size;
    expect(search.message).toBe(
      `${fileA} (file 1 of 2) lines 1-23/100 byte 83/${size} 21%`
    );
  });

  it('shows (END) at EOF and the column when shifted', () => {
    initContent(['a', 'b', 'c']);
    mode.EOF = true;
    revealPipeEnd();
    config.col = 4;

    fileInfo(['a', 'b', 'c']);

    // e_proto's ?e branch ends with a space and ?c starts with one, so
    // less prints two spaces between (END) and (column ...)
    expect(search.message).toBe('lines 1-3/3 byte 5/5 (END)  (column 5)');
  });
});
