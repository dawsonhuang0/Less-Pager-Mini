import { describe, expect, it } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { LtFile } from '../lesstest/ltFile';
import { runLt } from '../lesstest/runLt';

/*
 * A key sequence that starts a binding and then does not finish it.
 *
 * less's cmd_decode matches against the TAIL of what has accumulated
 * (decode.c:943, cmd_match:845), so bytes that lead nowhere age out
 * and the last one runs as its own command. The digit that opened
 * the sequence was never a count - binding "5e" makes 5 a prefix.
 */
const text = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
  + '\n';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-prefix-'));
const keys = path.join(dir, 'keys');

fs.writeFileSync(keys, '5e forw-line\n');

const tops = async (typed: string[]): Promise<string[]> => {
  const file: LtFile = {
    env: { LESSKEYIN: keys },
    args: ['input.txt'],
    files: { 'input.txt': text },
    width: 40,
    height: 8,
    firstScreen: null,
    firstCursor: null,
    steps: [...typed, 'q'].map(key => ({ key, screen: null, cursor: null })),
  };

  return (await runLt(file)).screens.map(rows => rows[0]);
};

describe('a lesskey prefix that leads nowhere', () => {
  it('runs the key that ended it, rather than dropping it', async () => {
    // 5 is the first byte of "5e", so it opens a prefix instead of a
    // count; j completes nothing, and is still a j
    expect((await tops(['5', 'j']))[2]).toBe('line 2');
  });

  it('still completes the binding it was a prefix of', async () => {
    expect((await tops(['5', 'e']))[2]).toBe('line 2');
  });
});
