import { describe, expect, it } from 'vitest';

import { LtFile } from './lesstest/ltFile';
import { runLt } from './lesstest/runLt';

const text = Array.from({ length: 80 }, (_, i) => {
  if (i === 9) return 'alpha NEEDLE omega';
  if (i === 20) return '{ bracketed value }';
  return `line ${i + 1}`;
}).join('\n') + '\n';

const session = (keys: string[], options: string[] = []): LtFile => ({
  env: {},
  args: [...options, 'input.txt'],
  files: { 'input.txt': text },
  width: 50,
  height: 12,
  firstScreen: null,
  firstCursor: null,
  steps: keys.map(key => ({ key, screen: null, cursor: null })),
});

const replay = async (
  keys: string[], options: string[] = []
): Promise<void> => {
  const result = await runLt(session(keys, options));
  expect(result.steps).toBe(keys.length);
  expect(result.mismatches).toEqual([]);
};

describe('in-process interactive command loop', () => {
  it('drives movement, counts, percentage jumps, and repaint', async () => {
    await replay([
      'j', 'k', 'd', 'u', 'f', 'b',
      'G', 'g',
      '5', 'g',
      '2', '0', '%',
      'r',
      'q',
    ]);
  }, 20000);

  it('drives search, filtering, runtime options, and help restore',
    async () => {
    await replay([
      '/', 'N', 'E', 'E', 'D', 'L', 'E', '\r',
      'n', 'N',
      '&', 'l', 'i', 'n', 'e', ' ', '1', '\r',
      '-', 'S', ' ',
      '-', 'S', ' ',
      'h', 'q',
      'q',
    ]);
  }, 20000);

  it('drives marks, bracket matching, prefixes, and status messages',
    async () => {
      await replay([
        'm', 'a',
        'G',
        "'", 'a',
        '{', '}', '(', ')', '[', ']',
        ':', 'f', ' ',
        ':', 'n', ' ',
        '\x18', '\x18',
        'q',
      ]);
    }, 20000);

  it('drives mouse packets and bracketed-paste suppression', async () => {
    await replay([
      '\x1b[<65;1;1M',
      '\x1b[<64;1;1M',
      '\x1b[<66;1;1M',
      '\x1b[<67;1;1M',
      '\x1b[<0;4;4M',
      '\x1b[<0;4;4m',
      '\x1b[<2;4;4m',
      '\x1b[200~ignored\nq\x1b[201~',
      'q',
    ], ['--emouse=all', '--no-paste']);
  }, 20000);

  it('keeps multiple examined files on the file-backed engine', async () => {
    const fixture = session([':', 'n', '=', ' ', ':', 'p', 'q']);
    fixture.args = ['input.txt', 'second.txt'];
    fixture.files['second.txt'] = 'second file\nline two\n';

    const result = await runLt(fixture);
    expect(result.steps).toBe(fixture.steps.length);
    expect(result.mismatches).toEqual([]);
  }, 20000);
});
