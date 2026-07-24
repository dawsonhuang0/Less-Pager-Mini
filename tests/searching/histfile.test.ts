import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setShellHistory } from '../../src/features/misc';

import { search } from '../../src/features/searching';

import { loadHistory, saveHistory, recordSearchEntry, touchSearchList,
  touchMarks } from '../../src/startup/histfile';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesshst-test-'));
  file = path.join(dir, 'hst');
  process.env.LESSHISTFILE = file;
  delete process.env.LESSHISTSIZE;

  search.history = [];
  setShellHistory([]);
});

afterEach(() => {
  delete process.env.LESSHISTFILE;
  delete process.env.LESSHISTSIZE;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadHistory', () => {
  it('loads .search patterns from a less-format history file', () => {
    fs.writeFileSync(
      file,
      '.less-history-file:\n.search\n"alpha\n"bravo\n"\n.shell\n"ls -la\n'
    );

    loadHistory();

    expect(search.history).toEqual(['alpha', 'bravo']);
  });

  it('ignores files without the less history header', () => {
    fs.writeFileSync(file, 'not a history\n"x\n');

    loadHistory();

    expect(search.history).toEqual([]);
  });
});

describe('saveHistory', () => {
  it('round-trips and preserves .shell and .mark sections', () => {
    fs.writeFileSync(
      file,
      '.less-history-file:\n.search\n"old\n.shell\n"make\n.mark\nm a 1 2 /tmp/x\n'
    );

    loadHistory();
    search.history.push('new');
    recordSearchEntry('new');
    touchSearchList();
    saveHistory();

    const text = fs.readFileSync(file, 'utf8');

    expect(text.startsWith('.less-history-file:\n.search\n')).toBe(true);
    expect(text).toContain('"old\n"new');
    expect(text).toContain('.shell\n"make');
    expect(text).toContain('m a 1 2 /tmp/x');

    loadHistory();
    expect(search.history).toEqual(['old', 'new']);
  });

  it('creates the file when none exists', () => {
    // forget marks restored by earlier tests, like a fresh run
    loadHistory();

    search.history = ['zeta'];

    recordSearchEntry('zeta');
    touchSearchList();
    saveHistory();

    // og's save_marks always prints the .mark header, even empty
    expect(fs.readFileSync(file, 'utf8'))
      .toBe('.less-history-file:\n.search\n"zeta\n.mark\n');
  });

  it('skips writing when the history is unchanged', () => {
    fs.writeFileSync(file, '.less-history-file:\n.search\n"same\n');

    loadHistory();
    fs.rmSync(file);
    saveHistory();

    expect(fs.existsSync(file)).toBe(false);
  });

  it('writes header and empty .mark after only a mark action', () => {
    // og: setmark raises marks_modified even without --save-marks,
    // so quit writes the file with a bare .mark section
    loadHistory();
    search.history = [];
    setShellHistory([]);

    touchMarks();
    saveHistory();

    expect(fs.readFileSync(file, 'utf8'))
      .toBe('.less-history-file:\n.mark\n');
  });

  it('is disabled by LESSHISTFILE=-', () => {
    process.env.LESSHISTFILE = '-';
    search.history = ['disabled-' + Date.now()];

    expect(() => {
      saveHistory();
      loadHistory();
    }).not.toThrow();

    expect(search.history[0].startsWith('disabled-')).toBe(true);
  });

  it('respects LESSHISTSIZE', () => {
    process.env.LESSHISTSIZE = '2';
    search.history = ['a1', 'b2', 'c3'];

    // og's write_mlist appends new entries UNCAPPED - the histsize
    // skip only trims the DISK copy's head (og-verified)
    for (const e of search.history) recordSearchEntry(e);
    touchSearchList();
    saveHistory();

    expect(fs.readFileSync(file, 'utf8'))
      .toBe('.less-history-file:\n.search\n"a1\n"b2\n"c3\n.mark\n');
  });

  it('merges the current disk file like copy_hist', () => {
    // og-verified: memory overflow skips the disk head (o1, o2), the
    // new entry lands under a SECOND .search header at EOF
    fs.writeFileSync(file,
      '.less-history-file:\n.search\n"o1\n"o2\n"o3\n');

    loadHistory();
    search.history.push('4');
    process.env.LESSHISTSIZE = '2';
    recordSearchEntry('4');
    touchSearchList();
    saveHistory();

    expect(fs.readFileSync(file, 'utf8')).toBe(
      '.less-history-file:\n.search\n"o3\n.search\n"4\n.mark\n');
  });
});
