import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { files } from '../../src/features/files';

import { windowTitle, refreshWindowTitle } from '../../src/tty/title';

/**
 * The terminal's title, which og sets only on Windows and gets on unix
 * for free: the terminal reads the foreground process, and og's is
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
});

afterAll(() => {
  files.list = realList;
  files.index = realIndex;
  process.title = realTitle;
});

describe('window title', () => {
  it('names the file being paged, like og\'s ?f', () => {
    files.list = [entry('notes.txt')];

    expect(windowTitle()).toBe('less-pager-mini notes.txt');
  });

  it('names whichever file is current after a switch', () => {
    files.list = [entry('first.txt'), entry('second.txt')];
    files.index = 1;

    expect(windowTitle()).toBe('less-pager-mini second.txt');
  });

  it('says nothing about standard input', () => {
    // og's ?f is false for "-", so a piped session has no name to
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
