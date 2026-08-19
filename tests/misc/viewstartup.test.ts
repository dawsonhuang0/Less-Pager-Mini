import { beforeAll, describe, expect, it } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { runLt } from '../lesstest/runLt';

import { markLesskeyViewSession, isLesskeyViewSession,
  resetLesskeyViewSession } from '../../src/lesskey/view';

/*
 * --view-lesskey on the command line.
 *
 * WITH a file it opens over it, the way the runtime form opens over a
 * live session: quitting the view leaves the session on the file that
 * was asked for. That is deliberately unlike -?, whose help IS the
 * input file and whose q quits (less's dohelp registering
 * FAKE_HELPFILE).
 */
const text = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

// the SECOND lesskey the file count is about - the first is
// $LESSKEY_CONTENT. It used to be a path in /tmp written by hand,
// so the count was 2 on the machine that happened to have that file
// and 1 everywhere else, which is how it passed here and failed in CI
const lesskeyIn = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'lmn-viewstartup-')),
  'fixture.lesskey');

beforeAll(() => {
  fs.writeFileSync(lesskeyIn, 'j forw-line\nZZ quit\n');
});

describe('--view-lesskey given with a file', () => {
  it('opens over it, and q leaves the session on the file', async () => {
    const result = await runLt({
      env: { LESS: '--view-lesskey', LESSKEY_CONTENT: 'x quit;y help' },
      args: ['input.txt'],
      files: { 'input.txt': text },
      width: 40,
      height: 10,
      firstScreen: null,
      firstCursor: null,
      steps: [{ key: 'q', screen: null, cursor: null },
        { key: 'q', screen: null, cursor: null }],
    });

    const tops = result.screens.map(rows => rows[0]);

    // the view is up at startup, and q drops back to the file
    expect(tops[0]).toBe('x quit');
    expect(tops[1]).toBe('line 1');
  }, 20000);

  it('does not stack a view on a session that already is one', async () => {
    // with no file to open over, the CLI makes the forms the file
    // list itself and says so; the scan still sees the flag - from
    // argv, or from $LESS where no filter reaches it - and opening
    // again would cost a second q to leave one screen
    markLesskeyViewSession([]);

    try {
      expect(isLesskeyViewSession()).toBe(true);

      const result = await runLt({
        env: { LESS: '--view-lesskey', LESSKEY_CONTENT: 'x quit;y help' },
        args: ['input.txt'],
        files: { 'input.txt': text },
        width: 40,
        height: 10,
        firstScreen: null,
        firstCursor: null,
        steps: [{ key: 'q', screen: null, cursor: null }],
      });

      // no view opened over it, so the file is what shows
      expect(result.screens[0][0]).toBe('line 1');
    } finally {
      resetLesskeyViewSession();
    }
  }, 20000);

  it('shows the name and the file count on the view\'s first prompt',
    async () => {
      // less's whole "?n?f%f .?m(%T %i of %m) .." group hangs off ?n,
      // "first prompt in a new file", and pr_string clears new_file as
      // it builds a prompt (prompt.c:630). So a second render of the
      // same screen shows neither - which is what an extra render in
      // the open path was doing
      const result = await runLt({
        env: {
          LESSKEYIN: lesskeyIn,
          LESSKEY_CONTENT: 'x quit;y help',
        },
        args: ['input.txt'],
        files: { 'input.txt': text },
        width: 80,
        height: 8,
        firstScreen: null,
        firstCursor: null,
        steps: [...'--view-lesskey'].concat('\r')
          .map(key => ({ key, screen: null, cursor: null })),
      });

      const last = result.screens[result.screens.length - 1];

      expect(last[last.length - 1]).toContain('(file 1 of 2)');
    }, 20000);
});
