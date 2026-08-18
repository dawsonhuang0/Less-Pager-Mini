import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { files, initFiles, getPreviousPath, setPreviousPath }
  from '../../src/features/files';

import { markSnapshot, restoreMarkSnapshot, resetMarks, marks }
  from '../../src/features/jumping';

import { resetLesskey, loadLesskey } from '../../src/features/lesskey';

import { openLesskeyView, exitLesskeyView, inLesskeyView }
  from '../../src/features/lesskeyView';

import { switchToFile } from '../../src/commands';

import { config } from '../../src/state/config';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-view-'));
const saved = { LESSKEYIN: process.env.LESSKEYIN, LESSKEY: process.env.LESSKEY };

const source = path.join(dir, 'keys.lesskey');
const target = path.join(dir, 'target.txt');

beforeEach(() => {
  fs.writeFileSync(source, 'j forw-line\nZZ quit\n');
  fs.writeFileSync(target, Array.from({ length: 40 },
    (_, i) => `line ${i + 1}`).join('\n') + '\n');

  process.env.LESSKEYIN = source;
  process.env.LESSKEY = path.join(dir, 'no-such-binary');

  resetMarks();
  resetLesskey();
  loadLesskey(true);
  initFiles([target]);
  switchToFile(0);
});

afterEach(() => {
  if (inLesskeyView()) exitLesskeyView(707);

  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/*
 * The lesskey view swaps the session's FILE LIST, the way the help
 * screen swaps its content. What it must not do is leave anything of
 * its own behind: the list it installed is gone the moment it exits,
 * so a mark or a "#" naming one of those files names something else
 * afterwards.
 */
describe('viewing lesskey files over a live session', () => {
  it('swaps the loaded forms in, and puts the file back', () => {
    expect(files.list.map(entry => entry.path)).toEqual([target]);

    expect(openLesskeyView()).toBe(true);
    expect(inLesskeyView()).toBe(true);
    expect(files.list.map(entry => entry.path)).toEqual([source]);

    expect(exitLesskeyView(707)).toBe(true);
    expect(inLesskeyView()).toBe(false);
    expect(files.list.map(entry => entry.path)).toEqual([target]);
    expect(files.index).toBe(0);
  });

  it('comes back to the position it left', () => {
    config.row = 12;

    openLesskeyView();
    expect(config.row).toBe(0);   // the top of the lesskey file

    exitLesskeyView(707);
    expect(config.row).toBe(12);
  });

  it('leaves the marks exactly as it found them', () => {
    // a mark names its file by INDEX, and the index it would record
    // in there belongs to a list that stops existing on the way out
    config.row = 5;
    marks.pending = '';
    const before = markSnapshot();

    openLesskeyView();
    exitLesskeyView(707);

    expect(markSnapshot()).toEqual(before);
  });

  it('leaves the # file alone', () => {
    setPreviousPath('/somewhere/else');

    openLesskeyView();
    exitLesskeyView(707);

    expect(getPreviousPath()).toBe('/somewhere/else');
  });

  it('refuses to open twice over itself', () => {
    expect(openLesskeyView()).toBe(true);
    expect(openLesskeyView()).toBe(false);
    expect(files.list.map(entry => entry.path)).toEqual([source]);
  });

  it('exits as a no-op when no view is open', () => {
    expect(exitLesskeyView(707)).toBe(false);
    expect(files.list.map(entry => entry.path)).toEqual([target]);
  });

  it('restores a snapshot taken over a swapped list', () => {
    const before = markSnapshot();

    restoreMarkSnapshot({ user: [['a', { file: 3, row: 1, subRow: 0,
      sline: 0 }]], quote: null });
    expect(markSnapshot().user).toHaveLength(1);

    restoreMarkSnapshot(before);
    expect(markSnapshot()).toEqual(before);
  });
});
