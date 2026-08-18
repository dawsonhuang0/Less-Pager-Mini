import { describe, expect, it } from 'vitest';

import { runLt } from '../lesstest/runLt';

import { markLesskeyViewSession, isLesskeyViewSession,
  resetLesskeyViewSession } from '../../src/features/lesskeyView';

/*
 * --view-lesskey on the command line.
 *
 * WITH a file it opens over it, the way the runtime form opens over a
 * live session: quitting the view leaves the session on the file that
 * was asked for. That is deliberately unlike -?, whose help IS the
 * input file and whose q quits (og's dohelp registering
 * FAKE_HELPFILE).
 */
const text = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

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
});
