import fs from 'fs';
import path from 'path';

import { secureAllow } from "./secure";

import {
  cmd,
  cmdOpen,
  cmdClose,
  cmdChar,
  cmdUngot,
  cmdText
} from "./cmdbuf";

import { filenameComplete } from "./files";

import { optNoHistDups, optAutosaveAction } from "../options";

import { search } from "./searching";

import { files, fexpand, expandHomeEnv } from "./files";

import { markRow } from "./jumping";

import { ringBell } from "../helpers";

/**
 * Line-input state shared by the `!`, `#`, `|`, `s` (log file) and `+`
 * prompts.
 */
/**
 * Session shell-command history shared by `!`, `#` and `|`, like
 * less's ml_shell; persisted in the history file's .shell section.
 */
export let shellHistory: string[] = [];

/** Replaces the shell history (history file load). */
export function setShellHistory(entries: string[]): void {
  shellHistory = entries;

  if (cmd.active && cmd.history === shellHistory) {
    cmd.histPos = shellHistory.length;
  }
}

/**
 * Records an accepted shell command, like cmd_addhist for ml_shell.
 */
function addShellHistory(text: string): void {
  if (!text) return;

  if (optNoHistDups()) {
    const kept = shellHistory.filter(entry => entry !== text);
    shellHistory.length = 0;
    shellHistory.push(...kept);
  }

  if (shellHistory[shellHistory.length - 1] !== text) {
    shellHistory.push(text);
    if (shellHistory.length > 100) shellHistory.shift();
  }

  if (optAutosaveAction('!')) autosaveHook();
}

// history autosave hook, registered by the pager like searching's
let autosaveHook: () => void = () => {};

/** Registers the --autosave history file writer. */
export function onShellAutosave(fn: () => void): void {
  autosaveHook = fn;
}

export const miscInput = {
  pending: '' as '' | '!' | '#' | '|' | 's' | 'S' | '+',
  text: '',
};

/**
 * Pending `|mark: ` request and the collected mark character.
 */
export const pipeMark = {
  pending: false,
  char: '',
  /** Second mark of the || form; empty for the single-mark form. */
  char2: '',
  /** Which || mark is being read ('' = single-mark prompt). */
  stage: '' as '' | 'first' | 'second',
  /** ^N toggled the prompt into line-number entry (v707). */
  lineMode: false,
  /** Digits typed in line-number mode. */
  num: '',
  /** Resolved rows: [first] or [first, second]. */
  rows: [] as number[],
};

/**
 * Pending log file overwrite query (`Warning: "x" exists; ...`).
 */
export const overwrite = {
  pending: false,
  file: '',
  reminder: false,
};

// the last shell command, reused by "!!" (less's shellcmd)
let lastShellCmd = '';

// command replayed on every newly examined file (less's every_first_cmd)
let firstCmd = '';

// command run once at the first prompt (less's first_cmd_at_prompt)
let cmdAtPrompt = '';

// the active log file name (less's logfile fd staying open)
let logFile = '';

// the log file named by -o/-O in $LESS (less's namelogfile at INIT)
let startupLog: { name: string, force: boolean } | null = null;

/** The active log file name for `_o` queries, empty when unset. */
export const logFileName = (): string => logFile;

/**
 * Forgets session state (log file, shell and first commands, prompts)
 * for a fresh pager run.
 */
export function resetMisc(): void {
  lastShellCmd = '';
  firstCmd = '';
  cmdAtPrompt = '';
  logFile = '';
  startupLog = null;
  miscInput.pending = '';
  miscInput.text = '';
  pipeMark.pending = false;
  overwrite.pending = false;
  search.messageQueue.length = 0;
}

/**
 * Stores the log file named by -o/-O in $LESS, like opt_o at INIT
 * setting namelogfile.
 *
 * @param name - The log file name, kept unexpanded like og.
 * @param force - True for -O: overwrite without asking.
 */
export function setStartupLogFile(name: string, force: boolean): void {
  startupLog = { name, force };
}

/**
 * Opens the $LESS-named log file once the session starts, like og's
 * use_logfile when the input pipe opens: regular files are not logged,
 * an existing file raises the overwrite query, and success is silent.
 *
 * @param content - Full content lines to log.
 */
export function applyStartupLogFile(content: string[]): void {
  const log = startupLog;
  startupLog = null;

  if (!log) return;

  const entry = files.list[files.index];
  if (!entry || entry.path !== '-') return;

  overwrite.file = log.name;

  if (!log.force && fs.existsSync(log.name)) {
    overwrite.pending = true;
    overwrite.reminder = false;
    return;
  }

  writeLogFile(content, false, true);
}

/**
 * Opens one of the line-input prompts (`!`, `|`, `s`, `+`).
 *
 * @param kind - Which prompt to open.
 */
export function startMiscInput(
  kind: '!' | '#' | '|' | 's' | 'S' | '+'
): void {
  miscInput.pending = kind;
  miscInput.text = '';

  // shell prompts carry the ml_shell history and, with the log file
  // prompts, filename completion; `+cmd` has neither, like og
  const shell = kind === '!' || kind === '#' || kind === '|';

  cmdOpen(miscPromptLabel(kind), {
    history: shell ? shellHistory : null,
    complete: kind === '+' ? null : filenameComplete,
  });
}

/** The prompt label for each misc input kind, like start_mca's. */
export function miscPromptLabel(
  kind: '!' | '#' | '|' | 's' | 'S' | '+'
): string {
  const prompts = {
    '!': '!',
    '#': '#',
    '|': '!',
    '+': '+',
    's': 'log file: ',
    'S': 'Log file: ',
  };

  return prompts[kind];
}

/**
 * Handles a key at a misc line-input prompt, examine-style.
 *
 * @param key - Raw key input.
 * @returns `run` to execute, `pending` or `cancel`.
 */
export function miscInputKey(key: string): 'run' | 'pending' | 'cancel' {
  const kind = miscInput.pending;

  if (!cmd.prefix) {
    if (key === '\x0D' || key === '\x0A') {
      miscInput.pending = '';
      miscInput.text = cmdText();
      cmdClose();

      if (kind === '!' || kind === '#' || kind === '|') {
        // ^P prefixed commands still join the history bare, like og
        // eslint-disable-next-line no-control-regex
        addShellHistory(miscInput.text.replace(/^\x10/, ''));
      }

      return 'run';
    }

    if (key === '\x03') {
      miscInput.pending = '';
      miscInput.text = '';
      cmdClose();
      return 'cancel';
    }
  }

  const result = cmdChar(key);
  miscInput.text = cmdText();

  if (result === 'quit') {
    miscInput.pending = '';
    miscInput.text = '';
    cmdClose();
    return 'cancel';
  }

  for (let u = cmdUngot(); u !== null; u = cmdUngot()) {
    const replayed = miscInputKey(u);
    if (replayed !== 'pending') return replayed;
  }

  return 'pending';
}

/**
 * Opens the log file prompt (`s`, `-o`, `-O`), refusing up front when
 * the input is not piped-in content, like less checking CH_CANSEEK.
 *
 * @param force - True for `-O`: overwrite unconditionally.
 */
export function startLogFile(force: boolean): void {
  if (!secureAllow('logfile')) {
    search.message = 'log file support is not available';
    return;
  }

  const entry = files.list[files.index];

  if (!entry || entry.path !== '-') {
    search.message = 'Input is not a pipe';
    return;
  }

  startMiscInput(force ? 'S' : 's');
}

/**
 * Opens the `|mark: ` prompt for the pipe command.
 */
export function startPipe(): void {
  pipeMark.pending = true;
  pipeMark.char = '';
  pipeMark.char2 = '';
  pipeMark.stage = '';
  pipeMark.lineMode = false;
  pipeMark.num = '';
  pipeMark.rows = [];
}

/**
 * Handles the mark character following `|`.
 *
 * - The mark resolves immediately, like less's get_pipe_pos: an unset
 *   or invalid mark reports and aborts before the command prompt.
 *
 * @param content - Full content lines.
 * @param key - Raw key input.
 * @returns True when the mark was taken and the command prompt opens.
 */
export function pipeMarkKey(content: string[], key: string): boolean {
  let c = key[0];

  const abort = (): false => {
    pipeMark.pending = false;
    pipeMark.stage = '';
    return false;
  };

  // ^N toggles between mark and line-number entry, like get_pipe_pos
  if (c === '\x0E') {
    pipeMark.lineMode = !pipeMark.lineMode;
    pipeMark.num = '';
    return false;
  }

  // a resolved row advances || to its next mark, or opens the prompt
  const took = (row: number): boolean => {
    if (pipeMark.stage === 'first') {
      pipeMark.rows = [row];
      pipeMark.stage = 'second';
      pipeMark.lineMode = false;
      pipeMark.num = '';
      return false;
    }

    pipeMark.rows.push(row);
    pipeMark.pending = false;
    pipeMark.stage = '';
    startMiscInput('|');
    return true;
  };

  if (pipeMark.lineMode) {
    if (c >= '0' && c <= '9') {
      pipeMark.num += c;
      return false;
    }

    if (c === '\x08' || c === '\x7F') {
      if (!pipeMark.num) return abort();
      pipeMark.num = pipeMark.num.slice(0, -1);
      return false;
    }

    if (c === '\x0D' || c === '\x0A') {
      const lnum = parseInt(pipeMark.num, 10);
      pipeMark.num = '';

      if (!lnum || lnum > content.length) {
        search.message = 'Invalid line number';
        return abort();
      }

      return took(lnum - 1);
    }

    if (c === '\x03' || key.startsWith('\x1B')) return abort();

    ringBell();
    return false;
  }

  if (
    c === '\x03' || key.startsWith('\x1B') ||
    c === '\x08' || c === '\x7F'
  ) {
    return abort();
  }

  // RETURN picks the current position, like get_pipe_pos's newline
  if (c === '\x0D' || c === '\x0A') c = '.';

  // || reads two marks and pipes exactly the section between them
  if (pipeMark.stage === '' && c === '|') {
    pipeMark.stage = 'first';
    pipeMark.rows = [];
    return false;
  }

  const row = markRow(content, c);
  if (row === null) return abort();

  if (pipeMark.stage !== 'second') pipeMark.char = c;
  return took(row);
}

/**
 * Resolves a `!` prompt answer into the command to run, like less:
 * `!!` repeats the previous command, `%` and `#` expand to filenames,
 * a leading `^P` suppresses the done message.
 *
 * @param text - The raw prompt answer.
 * @returns The command and the done message (null to suppress).
 */
export function shellCommand(
  text: string
): { cmd: string, doneMsg: string | null } {
  let doneMsg: string | null = '!done';

  if (text.startsWith('\x10')) {
    doneMsg = null;
    text = text.slice(1);
  }

  if (!text.startsWith('!')) lastShellCmd = fexpand(text);

  return { cmd: lastShellCmd, doneMsg };
}

/**
 * Stores the command replayed on each newly examined file (`+cmd`).
 *
 * - Leading `+` signs and spaces are skipped; empty input clears it.
 *
 * @param text - The raw prompt answer.
 */
export function setFirstCmd(text: string): void {
  firstCmd = text.replace(/^[+ ]+/, '');
}

/**
 * Returns the `+cmd` command, or an empty string when unset.
 */
export function getFirstCmd(): string {
  return firstCmd;
}

/**
 * Stores the --cmd command, like og's opt_first_cmd_at_prompt.
 */
export function setCmdAtPrompt(text: string): void {
  cmdAtPrompt = text;
}

/**
 * Consumes the --cmd command at the first prompt, like og's prompt()
 * ungetting first_cmd_at_prompt once and clearing it.
 */
export function takeCmdAtPrompt(): string {
  const cmd = cmdAtPrompt;
  cmdAtPrompt = '';
  return cmd;
}

/**
 * Resolves an `s`/`-o` prompt answer into a log file action.
 *
 * - Only piped-in content can be logged, like less.
 *
 * @param text - The raw prompt answer.
 * @param force - True for `-O`: overwrite unconditionally, never ask.
 * @returns `write` to save, `ask` when the overwrite query opened, or
 *          null when nothing should happen (message already set).
 */
export function logFileTarget(
  text: string,
  force: boolean = false
): 'write' | 'ask' | null {
  const name = expandHomeEnv(fexpand(text.trim()));
  if (!name) return null;

  const entry = files.list[files.index];

  if (!entry || entry.path !== '-') {
    search.message = 'Input is not a pipe';
    return null;
  }

  // less refuses once a log is open, after the name is entered (opt_o),
  // then reports the active log as a follow-up message
  if (logFile) {
    search.message = 'Log file is already in use';
    search.messageQueue.push(`Log file "${logFile}"`);
    return null;
  }

  overwrite.file = name;

  if (!force && fs.existsSync(name)) {
    overwrite.pending = true;
    overwrite.reminder = false;
    return 'ask';
  }

  return 'write';
}

/**
 * Handles the answer to the log file overwrite query.
 *
 * @param key - Raw key input.
 * @returns The chosen action; unrecognized keys re-ask with less's
 *          reminder prompt.
 */
export function overwriteKey(
  key: string
): 'overwrite' | 'append' | 'none' | 'quit' | 'pending' {
  const char = key[0];

  switch (char) {
    case 'O': case 'o':
      overwrite.pending = false;
      return 'overwrite';

    case 'A': case 'a':
      overwrite.pending = false;
      return 'append';

    case 'D': case 'd':
      overwrite.pending = false;
      return 'none';

    case 'Q': case 'q':
      overwrite.pending = false;
      return 'quit';
  }

  overwrite.reminder = true;
  return 'pending';
}

/**
 * Writes the paged content to the log file.
 *
 * @param content - Full content lines.
 * @param append - True to append instead of overwriting.
 * @param quiet - True to skip the success report, like og opening a
 *                $LESS-named log file at startup.
 */
export function writeLogFile(
  content: string[],
  append: boolean,
  quiet: boolean = false
): void {
  const data = content.join('\n') + '\n';

  try {
    if (append) {
      fs.appendFileSync(overwrite.file, data);
    } else {
      fs.writeFileSync(overwrite.file, data);
    }

    // like less reporting the log file once it is in use
    logFile = overwrite.file;
    if (!quiet) search.message = `Log file "${overwrite.file}"`;
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'cannot write';
    search.message = `${overwrite.file}: ${code}`;
  }
}

/**
 * Reports the pager's version (`V`), like less's dispversion.
 */
export function versionMessage(): void {
  search.message = 'less-pager-mini ' + packageVersion();
}

/**
 * Prints the version to stdout for -V in $LESS, like og's opt__V at
 * INIT printing and quitting before the pager starts.
 */
export function printVersion(): void {
  process.stdout.write('less-pager-mini ' + packageVersion() + '\n');
}

let cachedVersion = '';

function packageVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    const root = typeof __dirname === 'undefined'
      ? process.cwd()
      : path.join(__dirname, '..', '..');
    const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    cachedVersion = (JSON.parse(raw) as { version: string }).version;
  } catch {
    cachedVersion = 'unknown';
  }

  return cachedVersion;
}
