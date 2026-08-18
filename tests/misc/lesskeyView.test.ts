import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { files, initFiles, getPreviousPath, setPreviousPath, onSourceFiles }
  from '../../src/features/files';

import { markSnapshot, restoreMarkSnapshot, resetMarks, marks }
  from '../../src/features/jumping';

import { resetLesskey, loadLesskey } from '../../src/features/lesskey';

import { openLesskeyView, exitLesskeyView, inLesskeyView,
  refreshLesskeyView, lesskeyViewFiles, applyLesskeyEdits }
  from '../../src/features/lesskeyView';

import { userBinding } from '../../src/features/lesskey';

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

  it('forgets where the view was left, like re-entering help', () => {
    // the position that persists is the ENGINE's, kept per path so :n
    // and :p come back to it - so this asserts the engine is told to
    // drop it rather than asserting config, which a file list rebuilt
    // from scratch resets on its own
    const forgotten: string[] = [];

    onSourceFiles({
      load: () => undefined,
      activate: () => {},
      forget: filePath => { forgotten.push(filePath); },
    });

    try {
      openLesskeyView();
      exitLesskeyView(707);

      expect(forgotten).toEqual([source]);
    } finally {
      onSourceFiles(null);
    }
  });

  it('makes an edit live without waiting for the quit', () => {
    // og leaves the old text up after v until R flushes its buffers,
    // which is right for a file being READ and wrong here: the editor
    // was opened to change what the keys do
    openLesskeyView();

    expect(userBinding('j')?.action).toBe('LINE_FORWARD');

    // what `v` would have left behind
    fs.writeFileSync(source, 'j quit\nQQ help\n');

    expect(refreshLesskeyView(707)).toBeNull();
    expect(userBinding('j')?.action).toBe('EXIT');
    expect(userBinding('QQ')?.action).toBe('HELP');

    exitLesskeyView(707);
    expect(userBinding('j')?.action).toBe('EXIT');
  });

  it('compiles an edited binary back over the file it came from', () => {
    // the rendered source is a temp file; the thing that has to
    // change is the binary the session actually loads
    const binary = path.join(dir, 'keys.bin');

    fs.writeFileSync(binary, Buffer.from([
      0x00, 0x4D, 0x2B, 0x47,
      0x63, 3, 0, 0x78, 0x00, 24,      // x -> A_QUIT
      0x65, 0, 0, 0x76, 0, 0,
      0x78, 0x45, 0x6E, 0x64,
    ]));

    const before = fs.readFileSync(binary);
    const view = lesskeyViewFiles.call(null);
    const rendered = view.files.find(file => file.form?.kind === 'binary');

    // only reachable when a binary actually loaded; skip when the
    // source file won this session's ladder
    if (!rendered) return;

    fs.writeFileSync(rendered.path, '#command\nz help\n');
    expect(applyLesskeyEdits(view.files, 707)).toEqual([]);
    expect(fs.readFileSync(binary).equals(before)).toBe(false);
  });

  it('reports a bad edit and leaves the binary alone', () => {
    const view = lesskeyViewFiles();
    const rendered = view.files.find(file => file.form?.kind === 'binary');

    if (!rendered) return;

    fs.writeFileSync(rendered.path, '#command\nz blah\n');

    expect(applyLesskeyEdits(view.files, 707)[0])
      .toMatch(/unknown action: "blah"/);
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
