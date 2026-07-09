import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { option, startOption, optionKey } from '../../src/options';

import { findTag, stepTag, tagRow, currTagFile, ntags, currTag, resetTags }
  from '../../src/features/tags';

import { calculateEOF } from '../../src/helpers';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-tags-'));
const srcFile = path.join(dir, 'main.c');
const tagsFile = path.join(dir, 'tags');

fs.writeFileSync(srcFile, [
  'int helper(void)',
  '{',
  '}',
  'int main(void)',
  '{',
  '}',
  '',
].join('\n'));

// one pattern entry, one line-number entry, one duplicate-name entry
fs.writeFileSync(tagsFile, [
  '!_TAG_FILE_FORMAT\t2\t/extended/',
  `helper\t${srcFile}\t/^int helper(void)$/;"\tf`,
  `main\t${srcFile}\t4;"\tf`,
  `dup\t${srcFile}\t/^int helper(void)$/`,
  `dup\t${srcFile}\t4`,
  '',
].join('\n'));

const content = fs.readFileSync(srcFile, 'utf8').split('\n');

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 60;
  config.halfScreenWidth = 30;
  config.window = 6;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  option.pending = '';

  initContent(content);
  calculateEOF(content);
  resetTags();

  toggle(`-T${tagsFile}\x0D`);
  search.message = '';
});

/** Feeds an option command key by key. */
function toggle(keys: string): void {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey(content, key);
}

describe('ctags lookup', () => {
  it('finds a pattern tag and locates its line', () => {
    expect(findTag('helper')).toBeNull();
    expect(ntags()).toBe(1);
    expect(currTagFile()).toBe(srcFile);
    expect(tagRow(content)).toBe(0);
  });

  it('finds a line-number tag', () => {
    expect(findTag('main')).toBeNull();
    expect(tagRow(content)).toBe(3);
  });

  it('reports og messages for misses', () => {
    expect(findTag('nothing')).toBe('No such tag in tags file');

    toggle('-T/definitely/not/there\x0D');
    expect(findTag('helper')).toBe('No tags file');
  });

  it('steps through duplicate matches with t/T semantics', () => {
    expect(findTag('dup')).toBeNull();
    expect(ntags()).toBe(2);
    expect(currTag()).toBe(1);

    expect(stepTag(1, 1)).not.toBeNull();
    expect(currTag()).toBe(2);

    // past the end: stays put and reports null, like nexttag
    expect(stepTag(1, 1)).toBeNull();
    expect(currTag()).toBe(2);

    expect(stepTag(-1, 1)).not.toBeNull();
    expect(currTag()).toBe(1);
    expect(stepTag(-1, 1)).toBeNull();
  });
});

describe('global(1) lookup', () => {
  it('parses ctags -x style output via $LESSGLOBALTAGS', () => {
    toggle('-TGTAGS\x0D');
    process.env.LESSGLOBALTAGS = `printf 'sym macro 6 ${srcFile} x\\n'`;

    try {
      expect(findTag('sym')).toBeNull();
      expect(ntags()).toBe(1);
      expect(tagRow(content)).toBe(5);
    } finally {
      delete process.env.LESSGLOBALTAGS;
    }
  });

  it('reports No tags file without $LESSGLOBALTAGS', () => {
    toggle('-TGTAGS\x0D');
    expect(findTag('sym')).toBe('No tags file');
  });
});

describe('-t option', () => {
  it('loads the tag list from the runtime prompt', () => {
    toggle('-thelper\x0D');
    expect(search.message).toBe('');
    expect(ntags()).toBe(1);

    toggle('-tmissing\x0D');
    expect(search.message).toBe('No such tag in tags file');
  });
});
