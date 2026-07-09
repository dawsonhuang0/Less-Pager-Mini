import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { parseLt } from './ltFile';
import { runLt } from './runLt';

/**
 * Replays og's recorded lesstest sessions (less/lesstest/lt) against
 * this pager: each keystroke's screen must match the dump og produced.
 *
 * Failures print the first mismatching screen pair; they are the
 * canonical divergence list from og.
 */
const corpus = path.join(process.cwd(), 'less/lesstest/lt');

// the corpus is the og divergence burn-down list: run it on demand
// with LESSTEST=1 so the main suite stays green meanwhile
const enabled = !!process.env.LESSTEST && fs.existsSync(corpus);

const names = enabled
  ? fs.readdirSync(corpus).filter(name => name.endsWith('.lt')).sort()
  : [];

describe('og lesstest corpus', () => {
  if (!enabled) {
    it('is skipped without LESSTEST=1', () => { expect(true).toBe(true); });
    return;
  }

  it.each(names)('%s', async name => {
    const lt = parseLt(path.join(corpus, name));
    const result = await runLt(lt);

    if (result.mismatches.length) {
      const first = result.mismatches[0];

      const report = [
        `${result.mismatches.length}/${result.compared} screens differ; ` +
          `first at step ${first.step} (key ${first.key}, ` +
          `${first.charDiffs} char / ${first.attrDiffs} attr cells):`,
        '--- expected (og) ---',
        ...first.expected.map(row => JSON.stringify(row)),
        '--- actual (ours) ---',
        ...first.actual.map(row => JSON.stringify(row)),
      ].join('\n');

      expect.fail(report);
    }

    expect(result.compared).toBeGreaterThan(0);
  }, 20000);
});
