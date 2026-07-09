import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import { files, initContent, initFiles, loadFile }
  from '../../src/features/files';

import {
  follow,
  startFollow,
  stopFollow,
  pollFollow
} from '../../src/features/follow';

import { scanOptions } from '../../src/options';

import { calculateEOF } from '../../src/helpers';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-follow-'));

let fileNo = 0;
let file = '';

/** Creates a fresh log-like file and opens it as the current entry. */
function openFile(data: string): string[] {
  file = path.join(dir, `log${++fileNo}.txt`);
  fs.writeFileSync(file, data);

  initFiles([file]);
  const lines = loadFile(0)!;
  files.index = 0;

  return lines;
}

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.window = 6;
  config.screenWidth = 80;

  mode.HELP = false;
  search.message = '';

  scanOptions('--+follow-name --+exit-follow-on-close', []);
});

afterEach(() => {
  stopFollow();
});

describe('startFollow', () => {
  it('waits on the pseudo-file like og at the end of a closed pipe',
    () => {
      initContent(['a', 'b']);

      expect(startFollow('forever')).toBe(true);
      expect(follow.active).toBe('forever');
      expect(pollFollow()).toEqual({ kind: 'idle' });
    });

  it('leaves the pseudo-file wait with --exit-follow-on-close', () => {
    initContent(['a', 'b']);
    scanOptions('--exit-follow-on-close', []);

    startFollow('forever');
    expect(pollFollow()).toEqual({ kind: 'close' });
  });

  it('reports a vanished file like a file open error', () => {
    openFile('a\n');
    fs.unlinkSync(file);

    expect(startFollow('forever')).toBe(false);
    expect(search.message).toBe(`${file}: No such file or directory`);
  });

  it('opens the current file and remembers the read offset', () => {
    openFile('a\nb\n');

    expect(startFollow('forever')).toBe(true);
    expect(follow.active).toBe('forever');
    expect(follow.readPos).toBe(4);
    expect(follow.tailPartial).toBe(false);
  });

  it('detects a partial last line', () => {
    openFile('a\npartial');

    expect(startFollow('forever')).toBe(true);
    expect(follow.tailPartial).toBe(true);
  });
});

describe('pollFollow', () => {
  it('idles while nothing is appended', () => {
    openFile('a\n');
    startFollow('forever');

    expect(pollFollow()).toEqual({ kind: 'idle' });
  });

  it('returns appended complete lines and grows the entry size', () => {
    const lines = openFile('a\n');
    calculateEOF(lines);
    startFollow('forever');

    fs.appendFileSync(file, 'b\nc\n');

    expect(pollFollow()).toEqual({
      kind: 'data',
      lines: ['b', 'c'],
      extendTail: false,
    });
    expect(files.list[0].size).toBe(6);
  });

  it('extends a partial last line with the first new line', () => {
    openFile('a\npart');
    startFollow('forever');

    fs.appendFileSync(file, 'ial\nnext\n');

    expect(pollFollow()).toEqual({
      kind: 'data',
      lines: ['ial', 'next'],
      extendTail: true,
    });
  });

  it('holds an incomplete line in the carry until its newline', () => {
    openFile('a\n');
    startFollow('forever');

    fs.appendFileSync(file, 'no newline yet');
    expect(pollFollow()).toEqual({ kind: 'idle' });

    fs.appendFileSync(file, ' done\n');
    expect(pollFollow()).toEqual({
      kind: 'data',
      lines: ['no newline yet done'],
      extendTail: false,
    });
  });

  it('keeps following the descriptor when the file rotates', () => {
    openFile('a\n');
    startFollow('forever');

    // rename + recreate: the descriptor still sees the old file
    fs.renameSync(file, file + '.1');
    fs.writeFileSync(file, 'new\n');

    expect(pollFollow()).toEqual({ kind: 'idle' });

    fs.appendFileSync(file + '.1', 'still here\n');
    expect(pollFollow()).toEqual({
      kind: 'data',
      lines: ['still here'],
      extendTail: false,
    });
  });

  it('reopens a rotated file with --follow-name', () => {
    openFile('a\n');
    scanOptions('--follow-name', []);
    startFollow('forever');

    fs.renameSync(file, file + '.1');
    fs.writeFileSync(file, 'new\n');

    expect(pollFollow()).toEqual({ kind: 'rotate' });
  });

  it('reopens a truncated file with --follow-name', () => {
    openFile('aaaa\nbbbb\n');
    scanOptions('--follow-name', []);
    startFollow('forever');

    fs.writeFileSync(file, 'x\n');
    expect(pollFollow()).toEqual({ kind: 'rotate' });
  });

  it('leaves the wait when the file closes with --exit-follow-on-close',
    () => {
      openFile('a\n');
      scanOptions('--exit-follow-on-close', []);
      startFollow('forever');

      expect(pollFollow()).toEqual({ kind: 'idle' });

      fs.unlinkSync(file);
      expect(pollFollow()).toEqual({ kind: 'close' });
    });

  it('keeps waiting on a vanished file without the option', () => {
    openFile('a\n');
    startFollow('forever');

    fs.unlinkSync(file);
    expect(pollFollow()).toEqual({ kind: 'idle' });
  });
});

describe('stopFollow', () => {
  it('returns the queued keys and resets the state', () => {
    openFile('a\n');
    startFollow('forever');
    follow.queued.push('j', 'q');

    expect(stopFollow()).toEqual(['j', 'q']);
    expect(follow.active).toBeNull();
    expect(follow.fd).toBe(-1);
    expect(follow.queued).toEqual([]);
  });
});
