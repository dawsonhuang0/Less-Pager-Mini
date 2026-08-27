import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { files } from '../../src/features/files';

import { refreshWindowTitle, resetWindowTitle }
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
  it('names the product, and writes nothing to the terminal', () => {
    files.list = [entry('log.txt')];
    process.title = 'something else';

    refreshWindowTitle();

    expect(process.title).toBe('less-pager-mini');
    // a title made of escape bytes is what the OSC attempt did, and
    // what left one behind on the screen after quitting
    expect(process.title).not.toContain('\x1b');
  });

  it('says the same thing whatever is being paged', () => {
    // less writes no title on unix at all, so its bar says whatever the
    // command line said - the file is not what varies. Ours does not
    // vary either: the name is on the screen already, through the
    // prompt's %f.
    for (const list of [[entry('notes.txt')], [entry('-')], [entry('')], []]) {
      files.list = list;
      resetWindowTitle();
      refreshWindowTitle();

      expect(process.title).toBe('less-pager-mini');
    }
  });

  it('is set once and not revised when the file changes', () => {
    // less's title IS its argv, and :n and :e do not rewrite argv, so
    // the bar keeps saying one thing for the whole session. MEASURED in
    // Terminal.app: switching files leaves less's title alone.
    files.list = [entry('first.txt'), entry('second.txt')];

    refreshWindowTitle();
    process.title = 'set by someone else';

    files.index = 1;
    refreshWindowTitle();

    expect(process.title).toBe('set by someone else');
  });
});

describe('a title too long for the argv block', () => {
  it('is cut by node, which is why there is a fallback at all', () => {
    // process.title overwrites argv IN PLACE, so the command line's
    // own length is the ceiling. Run a program whose argv is tiny to
    // show it: this is the premise the fallback rests on, so it is
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

  it('leaves the product name room on every real install path', () => {
    // the budget is `node ` plus the resolved path of the bin script
    // plus the arguments, so the shortest install decides it. The name
    // needs 10 bytes of path; /usr/bin/lmn, the shortest anyone gets,
    // has 12.
    const need = 'less-pager-mini'.length - 'node '.length;

    for (const bin of ['/usr/bin/lmn', '/usr/local/bin/lmn',
      '/opt/homebrew/bin/lmn', 'node_modules/.bin/lmn']) {
      expect(bin.length).toBeGreaterThanOrEqual(need);
    }
  });

  it('falls back to the command name when the product will not fit',
    () => {
      // a short enough command line leaves no room for the product:
      // argv0 makes one without needing a short path on disk, and the
      // module comes in through the environment so it costs no argv
      const dir = mkdtempSync(path.join(tmpdir(), 'lpm-title-'));

      writeFileSync(path.join(dir, 'p.js'),
        'const { refreshWindowTitle } = require(process.env.TITLE);\n' +
        'refreshWindowTitle();\n' +
        'console.log(process.argv.length, process.title);');

      const shown = execFileSync(process.execPath, ['p.js'], {
        argv0: 'n',                        // budget: "n p.js", 6 bytes
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          TITLE: path.join(process.cwd(), 'dist', 'tty', 'title.js')
        }
      }).trim();

      expect(shown).toBe('2 lmn');
    });
});
