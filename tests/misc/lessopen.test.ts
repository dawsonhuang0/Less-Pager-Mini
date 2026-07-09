import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { search } from '../../src/features/searching';

import { files, initFiles, loadFile, closeAlt }
  from '../../src/features/files';

import { openAltFile } from '../../src/features/lessopen';

import { scanOptions } from '../../src/options';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-lessopen-'));

const orig = path.join(dir, 'orig.txt');
fs.writeFileSync(orig, 'one\ntwo\n');

const savedOpen = process.env.LESSOPEN;
const savedClose = process.env.LESSCLOSE;

/** Opens orig.txt through the current $LESSOPEN. */
function open(): string[] | null {
  initFiles([orig]);
  const lines = loadFile(0);
  files.index = 0;
  return lines;
}

beforeEach(() => {
  delete process.env.LESSOPEN;
  delete process.env.LESSCLOSE;

  search.message = '';
  search.messageQueue.length = 0;

  scanOptions('-+L --+show-preproc-errors', []);
});

afterEach(() => {
  if (savedOpen === undefined) delete process.env.LESSOPEN;
  else process.env.LESSOPEN = savedOpen;

  if (savedClose === undefined) delete process.env.LESSCLOSE;
  else process.env.LESSCLOSE = savedClose;
});

describe('$LESSOPEN pipe forms', () => {
  it('pages the preprocessor output', () => {
    process.env.LESSOPEN = '|tr a-z A-Z < %s';

    expect(open()).toEqual(['ONE', 'TWO']);
    expect(files.list[0].alt).toBe('-');
    expect(files.list[0].size).toBe(8);
  });

  it('falls back to the file when the pipe stays empty', () => {
    process.env.LESSOPEN = '|true %s';

    expect(open()).toEqual(['one', 'two']);
    expect(files.list[0].alt).toBeUndefined();
  });

  it('distinguishes an empty file with || and exit 0', () => {
    process.env.LESSOPEN = '||true %s';

    expect(open()).toEqual(['']);
    expect(files.list[0].alt).toBe('-');
  });

  it('falls back with || when the preprocessor fails', () => {
    process.env.LESSOPEN = '||false %s';

    expect(open()).toEqual(['one', 'two']);
    expect(files.list[0].alt).toBeUndefined();
  });

  it('reports failures with --show-preproc-errors', () => {
    process.env.LESSOPEN = '||exit 3; echo %s';
    scanOptions('--show-preproc-errors', []);

    open();
    expect(search.message).toBe('Input preprocessor failed (status 3)');
  });

  it('stays silent about failures by default', () => {
    process.env.LESSOPEN = '||false %s';

    open();
    expect(search.message).toBe('');
  });
});

describe('$LESSOPEN temp file form', () => {
  it('pages the named replacement file', () => {
    const alt = path.join(dir, 'orig.txt.alt');
    fs.writeFileSync(alt, 'ALT LINE\n');
    process.env.LESSOPEN = 'echo %s.alt';

    expect(open()).toEqual(['ALT LINE']);
    expect(files.list[0].alt).toBe(alt);
  });

  it('falls back when the preprocessor names nothing', () => {
    process.env.LESSOPEN = 'true %s';

    expect(open()).toEqual(['one', 'two']);
    expect(files.list[0].alt).toBeUndefined();
  });
});

describe('$LESSOPEN "-" forms feed the pseudo-file, like og', () => {
  it('pipes the in-memory content through the preprocessor', () => {
    process.env.LESSOPEN = '|-cat %s | tr a-z A-Z';

    expect(openAltFile('-', 'one\ntwo\n')).toEqual({
      lines: ['ONE', 'TWO'],
      size: 8,
      alt: '-',
    });
  });

  it('skips the pseudo-file without the "-" prefix', () => {
    process.env.LESSOPEN = '|cat %s';
    expect(openAltFile('-', 'one\n')).toBeNull();
  });
});

describe('$LESSOPEN validation and -L', () => {
  it('requires exactly one %s, like og', () => {
    process.env.LESSOPEN = '|cat';

    expect(open()).toEqual(['one', 'two']);
    expect(search.message).toBe(
      'LESSOPEN ignored: must contain exactly one %s'
    );
  });

  it('is disabled by -L', () => {
    process.env.LESSOPEN = '|tr a-z A-Z < %s';
    scanOptions('-L', []);

    expect(open()).toEqual(['one', 'two']);
  });
});

describe('$LESSCLOSE', () => {
  it('runs with the original and replacement names', () => {
    const log = path.join(dir, 'close.log');
    process.env.LESSOPEN = '|tr a-z A-Z < %s';
    process.env.LESSCLOSE = `echo %s %s > ${log}`;

    open();
    closeAlt(files.list[0]);

    expect(fs.readFileSync(log, 'utf8')).toBe(`${orig} -\n`);
    expect(files.list[0].alt).toBeUndefined();
  });

  it('rejects more than two %s markers, like og', () => {
    process.env.LESSOPEN = '|tr a-z A-Z < %s';
    process.env.LESSCLOSE = 'echo %s %s %s';

    open();
    closeAlt(files.list[0]);

    expect(search.message).toBe(
      'LESSCLOSE ignored; must contain no more than 2 %s'
    );
  });

  it('does nothing without a $LESSOPEN product', () => {
    const log = path.join(dir, 'close2.log');
    process.env.LESSCLOSE = `echo closed > ${log}`;

    open();
    closeAlt(files.list[0]);

    expect(fs.existsSync(log)).toBe(false);
  });
});
