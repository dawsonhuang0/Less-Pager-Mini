import { describe, expect, it } from 'vitest';

import { runLt } from '../lesstest/runLt';

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
});
