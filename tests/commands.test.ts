import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  suspendTerminal: vi.fn(),
  enterScreen: vi.fn(),
  keyboard: {
    setRawMode: vi.fn(),
    resume: vi.fn(),
  },
}));

vi.mock('child_process', async importOriginal => ({
  ...await importOriginal<typeof import('child_process')>(),
  spawnSync: fake.spawnSync,
}));

vi.mock('../src/keyboard', async importOriginal => ({
  ...await importOriginal<typeof import('../src/keyboard')>(),
  keyboard: () => fake.keyboard,
}));

vi.mock('../src/screen', async importOriginal => ({
  ...await importOriginal<typeof import('../src/screen')>(),
  suspendTerminal: fake.suspendTerminal,
  enterScreen: fake.enterScreen,
}));

import { config, mode } from '../src/config';

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

import { session, resetSession } from '../src/session';

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
  fake.keyboard.setRawMode.mockReset();
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
  opt.noShell = 0;
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
  it('saves the old position and restores the target position', () => {
    config.row = 3;
    config.subRow = 1;
    files.list[1].saved = { row: 1, subRow: 0 };
    setFirstCmd('+G');

    expect(switchToFile(1)).toBe(true);

    expect(files.list[0].saved).toEqual({ row: 3, subRow: 1 });
    expect(files.index).toBe(1);
    expect(session.fullContent).toEqual(['b1', 'b2', 'b3']);
    expect(session.content).toEqual(['b1', 'b2', 'b3']);
    expect(config.row).toBe(1);
    expect(config.subRow).toBe(0);
    expect(session.pendingFirstCmds).toEqual(['G']);
    expect(files.newFile).toBe(true);
  });

  it('leaves the current file alone when the target cannot load', () => {
    files.list.push({
      path: missing,
      lines: null,
      size: 0,
      sizeKnown: true,
      saved: null,
    });

    expect(switchToFile(2)).toBe(false);
    expect(files.index).toBe(0);
    expect(session.fullContent[0]).toBe('a1');
    expect(search.message).toContain('No such file or directory');
  });

  it('inserts and opens a new name immediately after the current file', () => {
    expect(openByName(fileC)).toBe(true);

    expect(files.list.map(entry => entry.path))
      .toEqual([fileA, fileC, fileB]);
    expect(files.index).toBe(1);
    expect(session.fullContent).toEqual(['c1', 'c2']);
  });

  it('removes a newly inserted entry again when opening fails', () => {
    expect(openByName(missing)).toBe(false);

    expect(files.list.map(entry => entry.path)).toEqual([fileA, fileB]);
    expect(files.index).toBe(0);
  });

  it('uses a numeric :n count and quits past the end under -e', () => {
    session.buffer = ['1'];
    stepFile(1);
    expect(files.index).toBe(1);

    mode.EOF = true;
    opt.quitAtEof = 1;
    const exit = vi.fn();
    session.exit = exit;
    stepFile(1);

    expect(exit).toHaveBeenCalledOnce();
  });

  it('rings instead of changing files from the help screen', () => {
    mode.HELP = true;

    stepFile(1);

    expect(files.index).toBe(0);
    expect(stdoutWrite).toHaveBeenCalledWith('\x07');
  });

  it('switches away before deleting the current file', () => {
    files.list.push({
      path: fileC,
      lines: null,
      size: 0,
      sizeKnown: true,
      saved: null,
    });

    removeFile();

    expect(files.list.map(entry => entry.path)).toEqual([fileB, fileC]);
    expect(files.index).toBe(0);
    expect(session.fullContent).toEqual(['b1', 'b2', 'b3']);
  });

  it('refuses deletion when only one file or help is active', () => {
    files.list.splice(1);
    removeFile();
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
    removeFile();
    expect(stdoutWrite).toHaveBeenCalledWith('\x07');
  });
});

describe(':e examine execution', () => {
  it('opens the first good name while preserving earlier errors', () => {
    examine.text = `${missing} ${fileC}`;

    runExamine();

    expect(files.index).toBe(1);
    expect(files.list[1].path).toBe(fileC);
    expect(session.fullContent).toEqual(['c1', 'c2']);
    expect(search.message).toContain('No such file or directory');
  });

  it('an empty answer re-examines the current file', () => {
    files.list[0].lines = null;
    examine.text = '   ';

    runExamine();

    expect(files.index).toBe(0);
    expect(session.fullContent[0]).toBe('a1');
    expect(examine.text).toBe('');
  });
});

describe('shell, pipe, and editor commands', () => {
  it('blocks shell, pipe, and editor execution under --no-shell', () => {
    opt.noShell = 1;
    pipeMark.rows = [0, 1];

    runShell('echo direct', null);
    runMiscInput('!', 'echo bang');
    runMiscInput('#', 'echo prompt');
    runPipe('wc -l');
    runEditor();

    expect(search.message)
      .toBe('Shell commands are disabled by --no-shell');
    expect(fake.spawnSync).not.toHaveBeenCalled();
    expect(fake.suspendTerminal).not.toHaveBeenCalled();
  });

  it('runs a hidden shell command and re-enters immediately', () => {
    runShell('-echo hidden', null);

    expect(fake.spawnSync).toHaveBeenCalledOnce();
    expect(fake.suspendTerminal).toHaveBeenCalledOnce();
    expect(fake.enterScreen).toHaveBeenCalledOnce();
    expect(fake.keyboard.setRawMode).toHaveBeenCalledWith(true);
    expect(fake.keyboard.resume).toHaveBeenCalledOnce();
    expect(session.shellPause).toBe(false);
    expect(files.newFile).toBe(true);
  });

  it('parks on the shell screen when a done message is requested', () => {
    runShell('echo visible', '!done');

    expect(session.shellPause).toBe('shell');
    expect(fake.enterScreen).not.toHaveBeenCalled();
    expect(stdoutWrite.mock.calls.some(call =>
      String(call[0]).includes('!done  (press RETURN)'))).toBe(true);
  });

  it('pipes an inclusive marked range and parks on the pager screen', () => {
    pipeMark.rows = [1, 3];

    runPipe('wc -l');

    const options = fake.spawnSync.mock.calls[0][2];
    expect(options.input).toBe('a2\na3\na4\n');
    expect(session.shellPause).toBe('pager');
    expect(fake.enterScreen).toHaveBeenCalledOnce();
  });

  it('does nothing when a pipe command has no mark', () => {
    runPipe('wc');

    expect(fake.spawnSync).not.toHaveBeenCalled();
  });

  it('rejects editing standard input', () => {
    initContent(['stdin']);
    resetSession(['stdin']);

    runEditor();

    expect(search.message).toBe('Cannot edit standard input');
    expect(fake.spawnSync).not.toHaveBeenCalled();
  });

  it('warns once before editing a LESSOPEN replacement', () => {
    files.list[0].alt = { path: fileC, lines: ['replacement'] };

    runEditor();
    expect(search.message).toBe('WARNING: This file was viewed via LESSOPEN');
    expect(session.pendingEditWarn).toBe(true);
    expect(fake.spawnSync).not.toHaveBeenCalled();

    search.message = '';
    runEditor();
    expect(fake.spawnSync).toHaveBeenCalledOnce();
    expect(session.pendingEditWarn).toBe(false);
  });

  it('stores +cmd through the shared miscellaneous dispatcher', () => {
    runMiscInput('+', '  ++42G');
    expect(getFirstCmd()).toBe('42G');
  });
});

describe('display filter orchestration', () => {
  it('filters the visible content and returns to the top', () => {
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

  it('stores a help-screen filter behind the help content', () => {
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

  it('leaves content alone after an invalid filter pattern', () => {
    startSearch('&', 1);
    searchInputKey('[');

    applyFilter();

    expect(search.message).toBe('Invalid pattern');
    expect(session.content[0]).toBe('a1');
  });
});
