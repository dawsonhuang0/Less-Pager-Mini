import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { files } from '../../src/features/files';

import { windowTitle, windowTitles, refreshWindowTitle, resetWindowTitle }
  from '../../src/tty/title';

/**
 * The terminal's title, which less sets only on Windows and gets on unix
 * for free: the terminal reads the foreground process, and less's is
 * `less foo`. Ours is `node .../cli.js foo`, so process.title is the
 * one thing that can put our name there.
 *
 * An OSC title sequence was tried and removed. It showed up as a
 * SECOND name beside the process one and outlived the session, because
 * restoring it needs the xterm title stack and Terminal.app ignores
 * that. Nothing here should ever reach the terminal as bytes.
 */
const realTitle = process.title;
const realList = files.list;
const realIndex = files.index;

const entry = (path: string): (typeof files.list)[number] =>
  ({ path, lines: null, size: 0, sizeKnown: true, saved: null });

beforeEach(() => {
  files.list = [];
  files.index = 0;
  resetWindowTitle();
});

afterAll(() => {
  files.list = realList;
  files.index = realIndex;
  process.title = realTitle;
});

describe('window title', () => {
  it('names the file being paged, like less\'s ?f', () => {
    files.list = [entry('notes.txt')];

    expect(windowTitle()).toBe('less-pager-mini notes.txt');
  });

  it('names whichever file is current after a switch', () => {
    files.list = [entry('first.txt'), entry('second.txt')];
    files.index = 1;

    expect(windowTitle()).toBe('less-pager-mini second.txt');
  });

  it('says nothing about standard input', () => {
    // less's ?f is false for "-", so a piped session has no name to
    // show and the prompt does not carry one either
    files.list = [entry('-')];

    expect(windowTitle()).toBe('less-pager-mini');
  });

  it('says nothing about a library call over its own data', () => {
    // paramPager pages what the caller passed: there is no file, so
    // the entry carries no path and the rule needs no idea of who
    // called - the same test covers both
    files.list = [entry('')];

    expect(windowTitle()).toBe('less-pager-mini');

    files.list = [];
    expect(windowTitle()).toBe('less-pager-mini');
  });

  it('renames the process, and writes nothing to the terminal', () => {
    files.list = [entry('log.txt')];
    process.title = 'something else';

    refreshWindowTitle();

    expect(process.title).toBe('less-pager-mini log.txt');
    // a title made of escape bytes is what the OSC attempt did, and
    // what left one behind on the screen after quitting
    expect(process.title).not.toContain('\x1b');
  });
});

describe('a title too long for the argv block', () => {
  it('is cut by node, which is the whole reason for the ladder', () => {
    // process.title overwrites argv IN PLACE, so the command line's
    // own length is the ceiling. Run a program whose argv is tiny to
    // show it: this is the premise the ladder rests on, so it is
    // measured rather than assumed.
    const dir = mkdtempSync(path.join(tmpdir(), 'lpm-title-'));

    writeFileSync(path.join(dir, 'p.js'),
      'process.title = "X".repeat(500);\nconsole.log(process.title.length);');

    const budget = Number(execFileSync(process.execPath, ['p.js'], {
      cwd: dir, encoding: 'utf8'
    }).trim());

    // argv joined with spaces, to the byte - here execFileSync passes
    // the interpreter's full path as argv[0], and every byte of it is
    // room the title gets to use
    expect(budget).toBe([process.execPath, 'p.js'].join(' ').length);
  });

  it('sheds the branding before the name, towards less\'s own shape', () => {
    // less's title IS its argv, `less tests/editing`. When something
    // has to go, going that way is closer to less than "less-pager-mini
    // te" is - the file is the part ?f is about.
    files.list = [entry('tests/editing')];

    expect(windowTitles()).toEqual([
      'less-pager-mini tests/editing',
      'lmn tests/editing',
      'tests/editing',
      'lmn editing',
      'editing'
    ]);
  });

  it('keeps a bare name whole, having no directories to shed', () => {
    files.list = [entry('notes.txt')];

    expect(windowTitles()).toEqual([
      'less-pager-mini notes.txt',
      'lmn notes.txt',
      'notes.txt'
    ]);
  });

  it('falls back to the command name when even the product will not fit',
    () => {
      files.list = [entry('-')];

      expect(windowTitles()).toEqual(['less-pager-mini', 'lmn']);
    });
});
