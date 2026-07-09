import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import {
  files,
  initContent,
  initFiles,
  setPreviousPath
} from '../../src/features/files';

import {
  miscInput,
  pipeMark,
  overwrite,
  startMiscInput,
  miscInputKey,
  startLogFile,
  resetMisc,
  startPipe,
  pipeMarkKey,
  shellCommand,
  setFirstCmd,
  getFirstCmd,
  logFileTarget,
  overwriteKey,
  writeLogFile,
  versionMessage
} from '../../src/features/misc';

import {
  option,
  startOption,
  optionKey
} from '../../src/features/options';

import {
  markRow,
  marksKey,
  startSetMark,
  resetMarks
} from '../../src/features/jumping';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-misc-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const content = Array.from({ length: 30 }, (_, i) => `m${i + 1}`);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 80;
  config.window = 6;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  option.pending = '';
  option.name = null;
  resetMisc();
  resetMarks();

  initContent(content);
});

describe('shell command', () => {
  it('expands % and # and remembers the command for !!', () => {
    setPreviousPath('prev.txt');

    expect(shellCommand('echo % #')).toEqual({
      cmd: 'echo - prev.txt',
      doneMsg: '!done',
    });

    // !! reuses the stored command
    expect(shellCommand('!!').cmd).toBe('echo - prev.txt');
  });

  it('suppresses the done message after a leading ^P', () => {
    expect(shellCommand('\x10echo hi')).toEqual({
      cmd: 'echo hi',
      doneMsg: null,
    });
  });
});

describe('+cmd', () => {
  it('strips leading + signs and spaces, empty clears', () => {
    setFirstCmd('+ +G');
    expect(getFirstCmd()).toBe('G');

    setFirstCmd('');
    expect(getFirstCmd()).toBe('');
  });
});

describe('log file (s / -o)', () => {
  it('rejects file-backed input up front like less', () => {
    initFiles(['whatever.txt']);
    files.index = 0;

    // the prompt never opens for a file, like og's immediate error
    startLogFile(false);
    expect(miscInput.pending).toBe('');
    expect(search.message).toBe('Input is not a pipe');

    search.message = '';
    expect(logFileTarget('out.log')).toBeNull();
    expect(search.message).toBe('Input is not a pipe');
  });

  it('writes new files and asks before clobbering', () => {
    const fresh = path.join(dir, 'fresh.log');
    expect(logFileTarget(fresh)).toBe('write');

    writeLogFile(content, false);
    expect(fs.readFileSync(fresh, 'utf8')).toBe(content.join('\n') + '\n');
    expect(search.message).toBe(`Log file "${fresh}"`);

    // in a fresh session the existing file opens the overwrite query
    resetMisc();
    expect(logFileTarget(fresh)).toBe('ask');
    expect(overwrite.pending).toBe(true);

    // unknown answers re-ask with the reminder prompt
    expect(overwriteKey('x')).toBe('pending');
    expect(overwrite.reminder).toBe(true);

    expect(overwriteKey('A')).toBe('append');
    writeLogFile(['tail'], true);
    expect(fs.readFileSync(fresh, 'utf8'))
      .toBe(content.join('\n') + '\ntail\n');

    overwrite.pending = true;
    expect(overwriteKey('q')).toBe('quit');
  });
});

describe('option long names', () => {
  it('toggles --ignore-case and queries __IGNORE-CASE', () => {
    startOption('-');
    optionKey([], '-');
    for (const char of 'ignore-case') optionKey([], char);
    optionKey([], '\x0D');
    expect(search.message).toBe('Ignore case in searches');

    startOption('-');
    optionKey([], 'i');
    expect(search.message).toBe('Case is significant in searches');

    startOption('_');
    optionKey([], '_');
    for (const char of 'IGNORE-CASE') optionKey([], char);
    optionKey([], '\x0D');
    expect(search.message).toBe('Case is significant in searches');
  });

  it('reports unknown long and short options like less', () => {
    startOption('-');
    optionKey([], '-');
    for (const char of 'nope') optionKey([], char);
    optionKey([], '\x0D');
    expect(search.message).toBe('There is no --nope option');

    startOption('-');
    optionKey([], 'l');
    expect(search.message).toBe('There is no -l option');
  });

  it('routes -o to the log file prompt and _o to the query', () => {
    startOption('-');
    optionKey([], 'o');
    expect(miscInput.pending).toBe('s');

    miscInput.pending = '';
    startOption('_');
    optionKey([], 'o');
    expect(search.message).toBe('No log file');

    // once a log is written, _o reports it and s/-o refuse to reopen
    const logged = path.join(dir, 'active.log');
    logFileTarget(logged);
    writeLogFile(content, false);

    startOption('_');
    optionKey([], 'o');
    expect(search.message).toBe(`Log file "${logged}"`);

    // the prompt reopens, but entering a name refuses like opt_o,
    // queueing the active log name as a follow-up message
    startLogFile(false);
    expect(miscInput.pending).toBe('s');
    expect(logFileTarget('another.log')).toBeNull();
    expect(search.message).toBe('Log file is already in use');
    expect(search.messageQueue).toEqual([`Log file "${logged}"`]);
  });
});

describe('pipe marks', () => {
  it('resolves predefined and user marks', () => {
    expect(markRow(content, '^')).toBe(0);
    expect(markRow(content, '$')).toBe(29);
    expect(markRow(content, '.')).toBe(0);

    config.row = 10;
    startSetMark(false, 0);
    marksKey(content, 'a');

    config.row = 3;
    expect(markRow(content, 'a')).toBe(10);

    expect(markRow(content, 'z')).toBeNull();
    expect(search.message).toBe('Mark not set');
  });

  it('collects the mark then opens the | command prompt', () => {
    startPipe();
    expect(pipeMark.pending).toBe(true);

    expect(pipeMarkKey(content, '$')).toBe(true);
    expect(pipeMark.char).toBe('$');
    expect(miscInput.pending).toBe('|');

    startPipe();
    expect(pipeMarkKey(content, '\x03')).toBe(false);
    expect(pipeMark.pending).toBe(false);
  });

  it('reports an unset mark at the |mark: prompt like less', () => {
    startPipe();

    expect(pipeMarkKey(content, 'z')).toBe(false);
    expect(miscInput.pending).toBe('');
    expect(search.message).toBe('Mark not set');

    search.message = '';
    startPipe();
    expect(pipeMarkKey(content, '?')).toBe(false);
    expect(search.message).toBe('Invalid mark letter ?');
  });
});

describe('misc input editing', () => {
  it('edits, runs and cancels like the other prompts', () => {
    startMiscInput('!');
    for (const char of 'lss') miscInputKey(char);
    miscInputKey('\x7F');
    expect(miscInput.text).toBe('ls');

    expect(miscInputKey('\x0D')).toBe('run');
    expect(miscInput.pending).toBe('');

    startMiscInput('+');

    // ESC is an edit prefix now, like og; ^G aborts the prompt
    expect(miscInputKey('\x1B')).toBe('pending');
    expect(miscInputKey('\x07')).toBe('cancel');
    expect(miscInput.pending).toBe('');
  });

  it('accepts a literal ^P but drops other control chars', () => {
    startMiscInput('!');
    miscInputKey('\x10');
    miscInputKey('\x01');
    for (const char of 'ls') miscInputKey(char);

    expect(miscInput.text).toBe('\x10ls');
    expect(miscInputKey('\x0D')).toBe('run');
  });
});

describe('version', () => {
  it('reports the package version', () => {
    versionMessage();
    expect(search.message).toMatch(/^less-pager-mini \d+\.\d+\.\d+$/);
  });
});
