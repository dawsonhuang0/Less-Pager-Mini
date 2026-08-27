import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { search } from '../../src/features/searching';

import { files, initFiles, loadFile, closeAlt }
  from '../../src/features/files';

import { closeAltFile, openAltFile } from '../../src/features/lessopen';

import { initSecure } from '../../src/features/secure';

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
  it('pages the preprocessor output', async () => {
    process.env.LESSOPEN = '|tr a-z A-Z < %s';

    expect(open()).toEqual(['ONE', 'TWO']);
    expect(files.list[0].alt).toBe('-');
    expect(files.list[0].size).toBe(8);
  });

  it('falls back to the file when the pipe stays empty', async () => {
    process.env.LESSOPEN = '|true %s';

    expect(open()).toEqual(['one', 'two']);
    expect(files.list[0].alt).toBeUndefined();
  });

  it('distinguishes an empty file with || and exit 0', async () => {
    process.env.LESSOPEN = '||true %s';

    expect(open()).toEqual(['']);
    expect(files.list[0].alt).toBe('-');
  });

  it('falls back with || when the preprocessor fails', async () => {
    process.env.LESSOPEN = '||false %s';

    expect(open()).toEqual(['one', 'two']);
    expect(files.list[0].alt).toBeUndefined();
  });

  it('reports failures with --show-preproc-errors', async () => {
    process.env.LESSOPEN = '||exit 3; echo %s';
    scanOptions('--show-preproc-errors', []);

    open();
    expect(search.message).toBe('Input preprocessor failed (status 3)');
  });

  it('reports a shell that never ran, like popen\'s child', () => {
    // no /bin/sh, or a $SHELL that has been uninstalled. less cannot
    // see that as anything special: its popen forks fine and the CHILD
    // _exit(127)s when it cannot exec, so close_pipe is handed a plain
    // 127 (edit.c:299). spawnSync reports it as an error with a NULL
    // status instead, which read as success and said nothing at all.
    const realShell = process.env.SHELL;

    try {
      process.env.SHELL = '/nonexistent-shell';
      process.env.LESSOPEN = '||echo %s';
      scanOptions('--show-preproc-errors', []);

      open();
      expect(search.message).toBe('Input preprocessor failed (status 127)');
    } finally {
      if (realShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = realShell;
    }
  });

  it('stays silent about failures by default', async () => {
    process.env.LESSOPEN = '||false %s';

    open();
    expect(search.message).toBe('');
  });
});

describe('$LESSOPEN temp file form', () => {
  it('pages the named replacement file', async () => {
    const alt = path.join(dir, 'orig.txt.alt');
    fs.writeFileSync(alt, 'ALT LINE\n');
    process.env.LESSOPEN = 'echo %s.alt';

    expect(open()).toEqual(['ALT LINE']);
    expect(files.list[0].alt).toBe(alt);
  });

  it('falls back when the preprocessor names nothing', async () => {
    process.env.LESSOPEN = 'true %s';

    expect(open()).toEqual(['one', 'two']);
    expect(files.list[0].alt).toBeUndefined();
  });
});

describe('$LESSOPEN "-" forms feed the pseudo-file, like less', () => {
  it('pipes the in-memory content through the preprocessor', async () => {
    process.env.LESSOPEN = '|-cat %s | tr a-z A-Z';

    expect(openAltFile('-', 'one\ntwo\n')).toEqual({
      lines: ['ONE', 'TWO'],
      size: 8,
      alt: '-',
      raw: 'ONE\nTWO\n',
      preprocError: undefined,
    });
  });

  it('skips the pseudo-file without the "-" prefix', async () => {
    process.env.LESSOPEN = '|cat %s';
    expect(openAltFile('-', 'one\n')).toBeNull();
  });
});

describe('$LESSOPEN validation and -L', () => {
  it('requires exactly one %s, like less', async () => {
    process.env.LESSOPEN = '|cat';

    expect(open()).toEqual(['one', 'two']);
    expect(search.message).toBe(
      'LESSOPEN ignored: must contain exactly one %s'
    );
  });

  it('is disabled by -L', async () => {
    process.env.LESSOPEN = '|tr a-z A-Z < %s';
    scanOptions('-L', []);

    expect(open()).toEqual(['one', 'two']);
  });
});

describe('$LESSCLOSE', () => {
  it('runs with the original and replacement names', async () => {
    const log = path.join(dir, 'close.log');
    process.env.LESSOPEN = '|tr a-z A-Z < %s';
    process.env.LESSCLOSE = `echo %s %s > ${log}`;

    open();
    await closeAlt(files.list[0]);

    expect(fs.readFileSync(log, 'utf8')).toBe(`${orig} -\n`);
    expect(files.list[0].alt).toBeUndefined();
  });

  it('rejects more than two %s markers, like less', async () => {
    process.env.LESSOPEN = '|tr a-z A-Z < %s';
    process.env.LESSCLOSE = 'echo %s %s %s';

    open();
    await closeAlt(files.list[0]);

    expect(search.message).toBe(
      'LESSCLOSE ignored; must contain no more than 2 %s'
    );
  });

  it('is disallowed by LESSSECURE, ahead of the %s check', async () => {
    const log = path.join(dir, 'close3.log');
    process.env.LESSCLOSE = `echo %s %s %s > ${log}`;
    process.env.LESSSECURE = '1';

    try {
      initSecure();
      // less's close_altfile returns on SF_LESSOPEN before it even
      // reads $LESSCLOSE, so the malformed value goes unreported
      await closeAltFile('-', orig);
    } finally {
      delete process.env.LESSSECURE;
      initSecure();
    }

    expect(fs.existsSync(log)).toBe(false);
    expect(search.message).toBe('');
  });

  it('does nothing without a $LESSOPEN product', async () => {
    const log = path.join(dir, 'close2.log');
    process.env.LESSCLOSE = `echo closed > ${log}`;

    open();
    await closeAlt(files.list[0]);

    expect(fs.existsSync(log)).toBe(false);
  });
});
