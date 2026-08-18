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
  refreshLesskeyView, lesskeyViewFiles, applyLesskeyEdits,
  cleanLesskeyView } from '../../src/features/lesskeyView';

import { search } from '../../src/features/searching';

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

    expect(refreshLesskeyView(707)).toEqual([]);
    expect(userBinding('j')?.action).toBe('EXIT');
    expect(userBinding('QQ')?.action).toBe('HELP');

    exitLesskeyView(707);
    expect(userBinding('j')?.action).toBe('EXIT');
  });

  it('keeps what parsed and reports what did not, like the reader', () => {
    // og's lesskey PROGRAM writes nothing when a source has errors;
    // og's pager READING one reports each bad line and keeps every
    // binding that parsed. This is the reader's job, so one mistyped
    // action must not cost the rest of the file
    const binary = path.join(dir, 'keys.bin');

    fs.writeFileSync(binary, Buffer.from([
      0x00, 0x4D, 0x2B, 0x47,
      0x63, 3, 0, 0x78, 0x00, 24,      // x -> A_QUIT
      0x65, 0, 0, 0x76, 0, 0,
      0x78, 0x45, 0x6E, 0x64,
    ]));

    process.env.LESSKEYIN = path.join(dir, 'no-source-here');
    process.env.LESSKEY = binary;
    resetLesskey();
    loadLesskey(true);
    search.message = '';

    try {
      const view = lesskeyViewFiles();
      const rendered = view.files.find(file => file.form?.kind === 'binary');

      expect(rendered).toBeDefined();

      fs.writeFileSync(rendered!.path, '#command\nz help\nq blah\nw quit\n');

      expect(applyLesskeyEdits(view.files, 707))
        .toEqual([`${binary}: line 3: unknown action: "blah"`]);

      // the good lines took, on both sides of the bad one
      expect(userBinding('z')?.action).toBe('HELP');
      expect(userBinding('w')?.action).toBe('EXIT');

      // reported to the CALLER, not left on the prompt row: the
      // caller prints every message and gates once, like startup

      // the binary itself was written, not left at its old contents
      expect(userBinding('x')).toBeUndefined();

      cleanLesskeyView(view.dir);
    } finally {
      process.env.LESSKEYIN = source;
      delete process.env.LESSKEY;
      resetLesskey();
      loadLesskey(true);
    }
  });

  it('collects every bad line, so one gate covers them all', () => {
    // og's main errmsgs gate prints each scan error and blocks ONCE.
    // Left on the prompt row instead, the first would show and the
    // rest would queue invisibly behind a screen nobody is reading
    const binary = path.join(dir, 'many.bin');

    fs.writeFileSync(binary, Buffer.from([
      0x00, 0x4D, 0x2B, 0x47,
      0x63, 3, 0, 0x78, 0x00, 24,
      0x65, 0, 0, 0x76, 0, 0,
      0x78, 0x45, 0x6E, 0x64,
    ]));

    process.env.LESSKEYIN = path.join(dir, 'no-source-here');
    process.env.LESSKEY = binary;
    resetLesskey();
    loadLesskey(true);
    search.message = '';
    search.messageQueue.length = 0;

    try {
      const view = lesskeyViewFiles();
      const rendered = view.files.find(file => file.form?.kind === 'binary');

      fs.writeFileSync(rendered!.path,
        '#command\na blah\nb quit\nc nope\nd also-wrong\n');

      const messages = applyLesskeyEdits(view.files, 707);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toContain('line 2: unknown action: "blah"');
      expect(messages[2]).toContain('line 5: unknown action: "also-wrong"');

      // the good line between them still took
      expect(userBinding('b')?.action).toBe('EXIT');

      // and nothing was left behind on the prompt row
      expect([search.message, search.messageQueue]).toEqual(['', []]);

      cleanLesskeyView(view.dir);
    } finally {
      process.env.LESSKEYIN = source;
      delete process.env.LESSKEY;
      resetLesskey();
      loadLesskey(true);
    }
  });

  it('names a materialized form after where it came from', () => {
    // the temp path a rendered form lives at is noise - sixty
    // characters of /var/folders before the name starts - on a prompt
    // that also carries the NEXT file's name
    process.env.LESSKEY_CONTENT = 'x quit;y help';
    resetLesskey();
    loadLesskey(true);

    try {
      openLesskeyView();

      const named = files.list.find(entry => entry.display !== undefined);

      expect(named?.display).toBe('LESSKEY_CONTENT');
      expect(named?.path).toMatch(/lesskey-/);   // still a real file
      exitLesskeyView(707);
    } finally {
      delete process.env.LESSKEY_CONTENT;
      resetLesskey();
      loadLesskey(true);
    }
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
