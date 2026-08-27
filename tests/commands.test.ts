import fs from 'fs';

import { initSecure } from '../src/features/secure';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  suspendTerminal: vi.fn(),
  enterScreen: vi.fn(),
  setKeyboardRaw: vi.fn(),
  keyboard: {
    resume: vi.fn(),
  },
}));

vi.mock('child_process', async importOriginal => ({
  ...await importOriginal<typeof import('child_process')>(),
  spawnSync: fake.spawnSync,
}));

vi.mock('../src/tty/keyboard', async importOriginal => ({
  ...await importOriginal<typeof import('../src/tty/keyboard')>(),
  keyboard: () => fake.keyboard,
  setKeyboardRaw: fake.setKeyboardRaw,
}));

vi.mock('../src/tty/screen', async importOriginal => ({
  ...await importOriginal<typeof import('../src/tty/screen')>(),
  suspendTerminal: fake.suspendTerminal,
  enterScreen: fake.enterScreen,
}));

import { config, mode } from '../src/state/config';

import {
  files,
  examine,
  binaryConfirm,
  initContent,
  initFiles,
  loadFile
} from '../src/features/files';

import {
  search,
  startSearch,
  searchInputKey
} from '../src/features/searching';

import {
  pipeMark,
  resetMisc,
  setFirstCmd,
  getFirstCmd
} from '../src/features/misc';

import { resetMarks } from '../src/features/jumping';

import { opt, setNoSearchHeaders } from '../src/options';

import { calculateEOF } from '../src/helpers';

import { session, resetSession } from '../src/state/session';

import {
  switchToFile,
  openByName,
  stepFile,
  removeFile,
  runExamine,
  runShell,
  runPipe,
  runEditor,
  runMiscInput,
  applyFilter
} from '../src/commands';

const stdoutWrite = vi.spyOn(process.stdout, 'write')
  .mockImplementation(() => true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-commands-'));
const fileA = path.join(dir, 'a.txt');
const fileB = path.join(dir, 'b.txt');
const fileC = path.join(dir, 'c.txt');
const missing = path.join(dir, 'missing.txt');

fs.writeFileSync(fileA, 'a1\na2\na3\na4\na5\n');
fs.writeFileSync(fileB, 'b1\nb2\nb3\n');
fs.writeFileSync(fileC, 'c1\nc2\n');

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fake.spawnSync.mockReset();
  fake.suspendTerminal.mockReset();
  fake.enterScreen.mockReset();
  fake.setKeyboardRaw.mockReset();
  fake.keyboard.resume.mockReset();
  stdoutWrite.mockClear();

  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.window = 4;
  config.screenWidth = 80;
  config.chopLongLines = false;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  opt.quitAtEof = 0;
  opt.noEditWarn = 0;
  opt.oldBot = 0;
  opt.squeeze = 0;
  setNoSearchHeaders(0, 0);

  search.message = '';
  search.messageQueue.length = 0;
  search.filters = [];
  search.input = null;
  binaryConfirm.request = false;
  binaryConfirm.pending = false;
  pipeMark.rows = [];

  resetMisc();
  resetMarks();
  initFiles([fileA, fileB]);
  files.index = 0;
  const lines = loadFile(0)!;
  resetSession(lines);
  calculateEOF(lines);
});

describe('file command orchestration', () => {
  it('saves the old position and restores the target position', async () => {
    config.row = 3;
    config.subRow = 1;
    files.list[1].saved = { row: 1, subRow: 0 };
    setFirstCmd('+G');

    const switched1true = switchToFile(1);

    expect(switched1true.ok).toBe(true);

    await switched1true.done;

    expect(files.list[0].saved).toEqual({ row: 3, subRow: 1 });
    expect(files.index).toBe(1);
    expect(session.fullContent).toEqual(['b1', 'b2', 'b3']);
    expect(session.content).toEqual(['b1', 'b2', 'b3']);
    expect(config.row).toBe(1);
    expect(config.subRow).toBe(0);
    expect(session.pendingFirstCmds).toEqual(['G']);
    expect(files.newFile).toBe(true);
  });

  it('starts the new file at column 0, like less edit_ifile hshift = 0', async () => {
    // less's edit_ifile zeroes hshift (edit.c:680) in the same block as
    // pos_clear and clr_hilite: a switch starts at the left edge
    // however far the file being left was shifted. It has to - less
    // saves a scrpos per ifile (ifile.c:35) and the shift is not in
    // it, so there is nothing to restore to.
    //
    // We had somewhere to keep it and kept it, so :n from a
    // right-shifted file opened the next one mid-line.
    config.col = 40;

    const switched1true = switchToFile(1);

    expect(switched1true.ok).toBe(true);

    await switched1true.done;

    expect(config.col).toBe(0);
  });

  it('leaves the current file alone when the target cannot load', async () => {
    files.list.push({
      path: missing,
      lines: null,
      size: 0,
      sizeKnown: true,
      saved: null,
    });

    const switched2false = switchToFile(2);

    expect(switched2false.ok).toBe(false);

    await switched2false.done;
    expect(files.index).toBe(0);
    expect(session.fullContent[0]).toBe('a1');
    expect(search.message).toContain('No such file or directory');
  });

  it('inserts and opens a new name immediately after the current file', async () => {
    expect(openByName(fileC)).toBe(true);

    expect(files.list.map(entry => entry.path))
      .toEqual([fileA, fileC, fileB]);
    expect(files.index).toBe(1);
    expect(session.fullContent).toEqual(['c1', 'c2']);
  });

  it('removes a newly inserted entry again when opening fails', () => {
    // NOT awaited, and that is the assertion. The callers that test
    // this - gotoCurrentTag, the mark restore - render on their very
    // next line and cannot suspend. While this returned a promise the
    // test `if (!openByName(name))` was always false, because a
    // promise is an object, and the recovery behind it never ran.
    expect(openByName(missing)).toBe(false);

    expect(files.list.map(entry => entry.path)).toEqual([fileA, fileB]);
    expect(files.index).toBe(0);
  });

  it('uses a numeric :n count and quits past the end under -e', async () => {
    session.buffer = ['1'];
    await stepFile(1);
    expect(files.index).toBe(1);

    mode.EOF = true;
    opt.quitAtEof = 1;
    const exit = vi.fn();
    session.exit = exit;
    await stepFile(1);

    expect(exit).toHaveBeenCalledOnce();
  });

  it('rings instead of changing files from the help screen', async () => {
    mode.HELP = true;

    await stepFile(1);

    expect(files.index).toBe(0);
    expect(stdoutWrite).toHaveBeenCalledWith('\x07');
  });

  it('switches away before deleting the current file', async () => {
    files.list.push({
      path: fileC,
      lines: null,
      size: 0,
      sizeKnown: true,
      saved: null,
    });

    await removeFile();

    expect(files.list.map(entry => entry.path)).toEqual([fileB, fileC]);
    expect(files.index).toBe(0);
    expect(session.fullContent).toEqual(['b1', 'b2', 'b3']);
  });

  it('refuses deletion when only one file or help is active', async () => {
    files.list.splice(1);
    await removeFile();
    expect(stdoutWrite).toHaveBeenCalledWith('\x07');

    stdoutWrite.mockClear();
    files.list.push({
      path: fileB,
      lines: null,
      size: 0,
      sizeKnown: true,
      saved: null,
    });
    mode.HELP = true;
    await removeFile();
    expect(stdoutWrite).toHaveBeenCalledWith('\x07');
  });
});

describe(':e examine execution', () => {
  it('opens the first good name while preserving earlier errors', async () => {
    examine.text = `${missing} ${fileC}`;

    await runExamine();

    expect(files.index).toBe(1);
    expect(files.list[1].path).toBe(fileC);
    expect(session.fullContent).toEqual(['c1', 'c2']);
    expect(search.message).toContain('No such file or directory');
  });

  it('an empty answer re-examines the current file', async () => {
    files.list[0].lines = null;
    examine.text = '   ';

    await runExamine();

    expect(files.index).toBe(0);
    expect(session.fullContent[0]).toBe('a1');
    expect(examine.text).toBe('');
  });
});

describe('shell, pipe, and editor commands', () => {
  it('blocks the editor under LESSSECURE, like less\'s A_VISUAL', async () => {
    // less gates at the DISPATCH, not inside lsystem: A_VISUAL checks
    // SF_EDIT (command.c:2142) while lsystem itself has no check at
    // all. So runEditor is the right level to assert here, and the
    // ! # | dispatch is covered end to end in bigfile/sessionLoop.
    process.env.LESSSECURE = '1';
    initSecure();

    try {
      await runEditor();

      expect(search.message).toBe('Command not available');
      expect(fake.spawnSync).not.toHaveBeenCalled();
      expect(fake.suspendTerminal).not.toHaveBeenCalled();
    } finally {
      delete process.env.LESSSECURE;
      initSecure();
    }
  });

  it('runs a hidden shell command and re-enters immediately', async () => {
    runShell('-echo hidden', null);

    expect(fake.spawnSync).toHaveBeenCalledOnce();
    expect(fake.suspendTerminal).toHaveBeenCalledOnce();
    expect(fake.enterScreen).toHaveBeenCalledOnce();
    expect(fake.setKeyboardRaw).toHaveBeenCalledWith(true);
    expect(fake.keyboard.resume).toHaveBeenCalledOnce();
    expect(session.shellPause).toBe(false);
    expect(files.newFile).toBe(true);
  });

  it('parks on the shell screen when a done message is requested', async () => {
    runShell('echo visible', '!done');

    expect(session.shellPause).toBe('shell');
    expect(fake.enterScreen).not.toHaveBeenCalled();
    expect(stdoutWrite.mock.calls.some(call =>
      String(call[0]).includes('!done  (press RETURN)'))).toBe(true);
  });

  it('pipes an inclusive marked range and parks on the pager screen', async () => {
    pipeMark.rows = [1, 3];

    runPipe('wc -l');

    const options = fake.spawnSync.mock.calls[0][2];
    expect(options.input).toBe('a2\na3\na4\n');
    expect(session.shellPause).toBe('pager');
    expect(fake.enterScreen).toHaveBeenCalledOnce();
  });

  it('does nothing when a pipe command has no mark', async () => {
    runPipe('wc');

    expect(fake.spawnSync).not.toHaveBeenCalled();
  });

  it('rejects editing standard input', async () => {
    initContent(['stdin']);
    resetSession(['stdin']);

    await runEditor();

    expect(search.message).toBe('Cannot edit standard input');
    expect(fake.spawnSync).not.toHaveBeenCalled();
  });

  it('warns once before editing a LESSOPEN replacement', async () => {
    files.list[0].alt = { path: fileC, lines: ['replacement'] };

    await runEditor();
    expect(search.message).toBe('WARNING: This file was viewed via LESSOPEN');
    expect(session.pendingEditWarn).toBe(true);
    expect(fake.spawnSync).not.toHaveBeenCalled();

    search.message = '';
    await runEditor();
    expect(fake.spawnSync).toHaveBeenCalledOnce();
    expect(session.pendingEditWarn).toBe(false);
  });

  it('stores +cmd through the shared miscellaneous dispatcher', async () => {
    runMiscInput('+', '  ++42G');
    expect(getFirstCmd()).toBe('42G');
  });
});

describe('display filter orchestration', () => {
  it('filters the visible content and returns to the top', async () => {
    startSearch('&', 1);
    for (const char of 'a[24]') searchInputKey(char);
    config.row = 3;
    config.subRow = 2;
    config.blankTop = 1;

    applyFilter();

    expect(session.content).toEqual(['a2', 'a4']);
    expect(config.row).toBe(0);
    expect(config.subRow).toBe(0);
    expect(config.blankTop).toBe(0);
  });

  it('stores a help-screen filter behind the help content', async () => {
    mode.HELP = true;
    session.prevConfig = { ...config, row: 9, subRow: 2 };
    startSearch('&', 1);
    for (const char of 'a[13]') searchInputKey(char);

    applyFilter();

    expect(session.content[0]).toBe('a1');
    expect(session.prevContent).toEqual(['a1', 'a3']);
    expect(session.prevConfig.row).toBe(0);
    expect(session.prevConfig.subRow).toBe(0);
  });

  it('leaves content alone after an invalid filter pattern', async () => {
    startSearch('&', 1);
    searchInputKey('[');

    applyFilter();

    expect(search.message).toBe('Invalid pattern');
    expect(session.content[0]).toBe('a1');
  });
});
