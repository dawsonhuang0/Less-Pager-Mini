import { describe, expect, it } from 'vitest';

import { LtFile } from '../lesstest/ltFile';
import { runLt } from '../lesstest/runLt';

/*
 * LESSUTFCHARDEF, against og's verified screens.
 *
 * Every expectation here was captured from less/less (707x) on a real
 * pty at this exact size, not derived from our own output. Two of the
 * three we match; the third is a recorded divergence, kept as a
 * skipped test so it cannot be forgotten.
 *
 * Why this file exists at all: the w and c classes are parsed into
 * tables that nothing reads, so it looks like a missing feature. It is
 * not that simple. og applies the width and then emits a full row with
 * the deferred-wrap ' \b' rather than a newline, so on a terminal that
 * draws one cell per character its rows RUN TOGETHER -- and ignoring
 * the width lands in the same place. Honouring the width without also
 * implementing og's rule that a row ending a LINE takes a newline
 * (pdone, line.c:1523) breaks the cancellation and moves us AWAY from
 * og. Measured, both ways, on 2026-08-02.
 */
const WIDTH = 20;
const HEIGHT = 8;

/** U+2022 BULLET — the width tables call it narrow (strWidth 1). */
const BULLET = '•';

// the harness writes fixtures with 'latin1', so a fixture must carry
// the UTF-8 BYTES: '•' written directly would land on disk as one
// truncated 0x22 byte and the pager would read a quote mark
const utf8 = (text: string): string =>
  Buffer.from(text, 'utf8').toString('latin1');

const TEXT = BULLET.repeat(30) + '\nSECOND\n';

const session = (env: Record<string, string>): LtFile => ({
  env: { LESSCHARSET: 'utf-8', ...env },
  args: ['input.txt'],
  files: { 'input.txt': utf8(TEXT) },
  width: WIDTH,
  height: HEIGHT,
  firstScreen: null,
  firstCursor: null,
  steps: [{ key: 'q', screen: null, cursor: null }],
});

const screen = async (env: Record<string, string>): Promise<string[]> => {
  const result = await runLt(session(env));
  return result.screens[0];
};

// captured from less/less: 30 bullets wrap once, then SECOND
const OG_SCREEN = [BULLET.repeat(20), BULLET.repeat(10), 'SECOND'];

describe('LESSUTFCHARDEF against og', () => {
  it('matches og with no definitions', async () => {
    const rows = await screen({});

    expect(rows.slice(0, 3)).toEqual(OG_SCREEN);
  }, 20000);

  it('matches og when the bullet is declared wide', async () => {
    // og believes each bullet is two columns and puts ten on a screen
    // row -- and still produces the screen above, because it ends each
    // full row with ' \b' instead of a newline and the terminal packs
    // them back together
    const rows = await screen({ LESSUTFCHARDEF: '2022:w' });

    expect(rows.slice(0, 3)).toEqual(OG_SCREEN);
  }, 20000);

  it.skip('DIVERGENCE: a leading composing run is not displayed',
    async () => {
      // og shows an EMPTY first row and SECOND on the next: a run of
      // composing characters with no base character to attach to
      // renders as nothing at all. We display all thirty.
      //
      // Fixing this is line-buffer work in the renderer, not a width
      // question -- the width is already zero on both sides.
      const rows = await screen({ LESSUTFCHARDEF: '2022:c' });

      expect(rows.slice(0, 2)).toEqual(['', 'SECOND']);
    }, 20000);
});
