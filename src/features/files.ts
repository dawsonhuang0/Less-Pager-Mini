import fs from 'fs';
import os from 'os';

import { Writable } from 'stream';

import { spawnSync } from 'child_process';

import { config, mode } from "../state/config";

import { ringBell } from "../helpers";
import { maxSubRow } from "../lines/helpers";

import { secureAllow } from "./secure";

import {
  cmd,
  Completer,
  cmdOpen,
  cmdClose,
  cmdChar,
  cmdUngot,
  cmdText,
  cmdRight,
  cmdReplaceRange
} from "./cmdbuf";

import { search } from "./searching";

import { opt, optNoHistDups, optNoShell, optQuotes, resetHeaderStart,
  checkModelines,
  chopLine } from "../options";

import { decodeContent, rawByteOf, binaryByte, ubinChar }
  from "./charset";

import { keyboard } from "../tty/keyboard";

import { STYLE_REGEX_G } from "../state/constants";

import { DEF_METACHARS, DEF_METAESCAPE, isWindows, shellArgv }
  from "../tty/platform";

import { prExpand, eqProto, shellQuote } from "./prompt";

import { openAltFile, closeAltFile, streamAltFile } from "./lessopen";

import { lgetenv } from '../startup/environment';

/**
 * One entry in the command line file list, like less's ifile.
 */
interface FileEntry {
  path: string;
  /** Preloaded lines for non-file content, like stdin's "-". */
  lines: string[] | null;
  /** Byte size, from stat for real files. */
  size: number;
  /** False while a pipe's length reads as unknown, like ch_length()
   *  returning NULL_POSITION before ch has read to EOF. */
  sizeKnown: boolean;
  /** True once the entry opened successfully, like og's opened():
   *  a re-open skips the binary file confirmation. */
  everOpened?: boolean;
  /** True while a pipe is still delivering data, like og's ch layer
   *  before read() returns end-of-file. */
  streaming?: boolean;
  /** Early pipe data recycled away under memory pressure, like og's
   *  ch_addbuf failure reusing the oldest buffer: these lines and
   *  bytes are gone but still count in line numbers and offsets. */
  discardedLines?: number;
  discardedBytes?: number;
  /** Saved screen position, like ifile.c's store_pos/get_pos. */
  saved: { row: number, subRow: number } | null;
  /** The $LESSOPEN replacement name, like ifile.c's altfilename. */
  alt?: string;
  /** A failed pipe preprocessor's message, reported at close like
   *  og's close_altfile (edit.c:288). */
  preprocError?: string;
}

/**
 * The command line file list state.
 *
 * - `index` is -1 before any file is opened.
 * - `newFile` shows the filename prompt after opening, like prompt.c's
 *   new_file flag (`%n` in the default prompt).
 */
export const files = {
  list: [] as FileEntry[],
  index: -1,
  newFile: false,
};

interface SourceFileHooks {
  /** Undefined declines the file; null is an acquisition failure. */
  load(index: number): string[] | null | undefined;
  /** Completes a successful shared switch after files.index changes. */
  activate(index: number): void;
}

let sourceFileHooks: SourceFileHooks | null = null;

/** Registers the active seekable input with the shared file workflow. */
export function onSourceFiles(hooks: SourceFileHooks | null): void {
  sourceFileHooks = hooks;
}

/** Finishes a source-backed switch after the common edit bookkeeping. */
export function activateSourceFile(index: number): void {
  sourceFileHooks?.activate(index);
}

/**
 * `Examine: ` prompt state (`:e`, `^X^V`).
 */
export const examine = {
  pending: false,
  text: '',
};

// the previously examined file, for '#' expansion (less's old_ifile)
let previousPath: string | null = null;

/**
 * Session-only `Examine: ` history, like less's ml_examine: every
 * opened file joins it, and it is never written to the history file.
 */
const examineHistory: string[] = [];

// TAB completion state, like cmdbuf.c's tk_* statics; the cycling
// flag itself lives in the shared buffer as cmd.inCompletion
const completion = {
  wordStart: 0,
  trials: [] as string[],
  index: 0,
};

/**
 * Remembers the file being left as the previous file, like less updating
 * old_ifile in edit_ifile.
 *
 * @param filePath - Path of the file being switched away from.
 */
export function setPreviousPath(filePath: string | null): void {
  previousPath = filePath;
}

/**
 * Starts a session over in-memory content, registered as the pseudo-file
 * `-` so `:e`/`:p` can navigate back to it, like less reading stdin.
 *
 * @param lines - The content to page.
 */
export function initContent(lines: string[]): void {
  // new content, new screen: og's position table describes rows of the
  // file it was filled from, so it cannot outlive it (pos_clear)
  config.screen = [];

  files.list = [{
    path: '-',
    lines,
    size: byteOffset(lines, lines.length) - 1,
    // a pipe's length is unknown until a read returns EOI —
    // --file-size runs that read up front (og's edit.c scan_eof),
    // which reveals the size through the pipe machinery itself
    sizeKnown: false,
    saved: null,
  }];
  files.index = 0;
  files.newFile = false;
  examine.pending = false;
  examine.text = '';

  // the pseudo-file is "opened" right away, like less reading stdin
  examineHistory.length = 0;
  addExamineHistory('-');
  resetHeaderStart();
  checkModelines(lines);
}

/**
 * Starts a session over a command line file list.
 *
 * @param paths - File paths to page.
 */
export function initFiles(paths: string[]): void {
  files.list = paths.map(path => ({
    path,
    lines: null,
    size: 0,
    // regular files are seekable: og knows their length at once
    sizeKnown: true,
    saved: null,
  }));
  files.index = -1;
  files.newFile = false;
  examine.pending = false;
  examine.text = '';
  examineHistory.length = 0;
  resetHeaderStart();
}

/**
 * The `"X" may be a binary file.  See it anyway?` confirmation state,
 * like og's edit query: loadFile raises `request`, and the caller
 * either answers synchronously (startup) or arms the `pending` prompt
 * answered with y/Y (runtime).
 */
export const binaryConfirm = {
  request: false,
  pending: false,
  path: '',
  proceed: null as (() => void) | null,
};

/**
 * True when a file's first 256 bytes look binary, like og's bin_file:
 * malformed UTF-8 and IS_BINARY_CHAR chars count, ANSI sequences skip
 * under -R, and more than 5 binary characters qualify.
 */
export function binFile(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 256);
  if (head.length <= 4) return false;

  let text = decodeContent(head);
  if (opt.ctldisp === 2) text = text.replace(STYLE_REGEX_G, '');

  let count = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;

    if (rawByteOf(char) >= 0 || (code < 0x100 && binaryByte(code)) ||
        ubinChar(char)) {
      count++;
    }
  }

  return count > 5;
}

/**
 * og's bad_file and isatty checks, ahead of the open itself.
 *
 * @returns True when the file may be opened, false with a message
 *   set; a stat failure throws for the caller's errno report.
 */
function statGuard(path: string): boolean {
  const stat = fs.statSync(path);

  // -f skips the directory guard and lets the read report the OS
  // error, like og's force_open bypassing bad_file's is_dir check
  if (stat.isDirectory() && !opt.forceOpen) {
    search.message = `${path} is a directory`;
    return false;
  }

  // bad_file's second guard is S_ISREG, not isatty: EVERY non-regular
  // file is refused with the same message - devices, fifos, sockets
  // alike (filename.c:1119). og's "is a terminal" message belongs to a
  // later, different check (edit.c:582), which only ever sees a
  // descriptor bad_file did not screen: standard input
  if (!stat.isFile() && !opt.forceOpen) {
    search.message = `${path} is not a regular file (use -f to see it)`;
    return false;
  }

  return true;
}

/**
 * Opens an entry the way a NON-terminal session needs it, like og
 * reaching cat_file through the same edit_ifile every session uses.
 *
 * $LESSOPEN applies with output on a pipe exactly as it does on a
 * screen (main.c:376 runs edit_first before the cat loop), but the
 * copy that follows is byte for byte - ch_forw_get, no line
 * processing - so a pipe preprocessor writes straight to `out` and
 * anything else hands back a path to stream. og's binary-file
 * question is gated on is_tty and never asked here.
 *
 * @param index - Entry index in the file list.
 * @param out - Where a pipe preprocessor's bytes go.
 * @returns A file left to stream, or null with a message set.
 */
export async function openForCat(
  index: number,
  out: Writable
): Promise<{ path?: string } | null> {
  const entry = files.list[index];
  if (!entry) return null;

  const alt = await streamAltFile(entry.path, out);

  if (alt) {
    entry.alt = alt.alt;
    entry.preprocError = alt.preprocError;
    entry.sizeKnown = alt.alt !== '-';
    entry.everOpened = true;

    // a replacement FILE is copied from disk like any other; a pipe's
    // bytes have already gone out, and the "||" empty file has none
    return { path: alt.path };
  }

  try {
    if (!statGuard(entry.path)) return null;
  } catch (error) {
    search.message = `${entry.path}: ${errorText(error)}`;
    return null;
  }

  entry.everOpened = true;
  return { path: entry.path };
}

/**
 * Reads a file entry's lines, reporting errors like less's edit.
 *
 * - A binary-looking file sets binaryConfirm.request instead of
 *   opening, unless -f, a re-open, or a non-tty session (edit.c).
 *
 * @param index - Entry index in the file list.
 * @returns The file's lines, or null with a message set on failure.
 */
export function loadFile(index: number): string[] | null {
  const entry = files.list[index];
  if (!entry) return null;

  const sourced = sourceFileHooks?.load(index);
  if (sourced !== undefined) return sourced;

  if (entry.lines) return entry.lines;

  // a re-open replaces any previous $LESSOPEN product, like og's edit
  // closing the old alt file first
  closeAlt(entry);

  // $LESSOPEN runs before the file itself opens (it may even handle
  // directories), like edit_ifile calling open_altfile
  const alt = openAltFile(entry.path);

  if (alt) {
    entry.size = alt.size;
    entry.alt = alt.alt;
    entry.preprocError = alt.preprocError;

    // a pipe-form $LESSOPEN ("|cmd") feeds a pipe whose length og
    // does not know; the file-replacement form is a seekable file
    entry.sizeKnown = alt.alt !== '-';
    entry.everOpened = true;

    checkModelines(alt.lines);
    return alt.lines;
  }

  let stated = false;

  try {
    stated = statGuard(entry.path);
    if (!stated) return null;

    const bytes = fs.readFileSync(entry.path);

    // og asks before opening what looks like a binary file, unless
    // -f, a previous open, or a non-tty session (edit.c's bin_file)
    if (!opt.forceOpen && !entry.everOpened && keyboard().isTTY &&
        binFile(bytes)) {
      binaryConfirm.request = true;
      binaryConfirm.path = entry.path;
      return null;
    }

    // bytes decode through the charset, like og's chardef classes:
    // invalid UTF-8 bytes survive as markers for $LESSBINFMT
    const data = decodeContent(bytes);
    entry.size = fs.statSync(entry.path).size;
    entry.sizeKnown = true;
    entry.everOpened = true;

    const lines = (data.endsWith('\n') ? data.slice(0, -1) : data)
      .split('\n');

    // --modelines scans the head of each opened file, like edit_ifile
    // calling check_modelines
    checkModelines(lines);

    return lines;
  } catch (error) {
    // -f forced the open past bad_file: og's read then fails
    // (EISDIR) and the pager runs on the empty file, with
    // prompt_message reporting og's "read error"
    if (opt.forceOpen && stated) {
      search.message = 'read error';
      entry.size = 0;
      entry.sizeKnown = true;
      entry.everOpened = true;
      return [''];
    }

    search.message = `${entry.path}: ${errorText(error)}`;
    return null;
  }
}

/**
 * Runs $LESSCLOSE for an entry's $LESSOPEN product and forgets it,
 * like og's close_altfile when a file is left.
 */
export function closeAlt(entry: FileEntry | undefined): void {
  if (!entry || !entry.alt) return;

  closeAltFile(entry.alt, entry.path, entry.preprocError);
  entry.alt = undefined;
  entry.preprocError = undefined;
}

/**
 * Saves the current screen position into the current file entry, like
 * less's store_pos when leaving a file.
 */
export function saveFilePosition(): void {
  const entry = files.list[files.index];
  if (entry) entry.saved = { row: config.row, subRow: config.subRow };
}

/**
 * Resolves the target of `:n`/`:p`, reporting like less when the list
 * runs out.
 *
 * @param delta - 1 for next, -1 for previous.
 * @param n - How many files to step.
 * @returns The target index, or null with a message set.
 */
export function stepFileTarget(delta: 1 | -1, n: number): number | null {
  const target = files.index + delta * n;

  if (target < 0 || target >= files.list.length) {
    const nth = n > 1 ? '(N-th) ' : '';
    search.message = `No ${nth}${delta > 0 ? 'next' : 'previous'} file`;
    return null;
  }

  return target;
}

/**
 * Resolves the target of `:x`, reporting like less when out of range.
 *
 * @param n - 1-based file number.
 * @returns The target index, or null with a message set.
 */
export function indexFileTarget(n: number): number | null {
  if (n < 1 || n > files.list.length) {
    search.message = 'No such file';
    return null;
  }

  return n - 1;
}

/**
 * Adds an opened file to the examine history, quoted like edit_ifile's
 * cmd_addhist call: consecutive duplicates are skipped and
 * --no-histdups drops older occurrences anywhere.
 *
 * @param filePath - Path of the file just opened.
 */
export function addExamineHistory(filePath: string): void {
  // og shell_quotes the entry (edit.c:683), never the -" pair on a
  // shell with an escape char
  const name = shellQuote(filePath);
  if (!name) return;

  if (examineHistory[examineHistory.length - 1] !== name) {
    if (optNoHistDups()) {
      const i = examineHistory.indexOf(name);
      if (i !== -1) examineHistory.splice(i, 1);
    }

    examineHistory.push(name);
  }

  // Up at the next prompt starts from the newest entry, like
  // cmd_addhist leaving curr_mp just past the added command
  if (cmd.active && cmd.history === examineHistory) {
    cmd.histPos = examineHistory.length;
  }
}

/**
 * Opens the `Examine: ` prompt over the shared command buffer.
 */
export function startExamine(): void {
  examine.pending = true;
  examine.text = '';

  cmdOpen('Examine: ', {
    history: examineHistory,
    complete: filenameComplete,
  });
}

/**
 * Handles a key at the `Examine: ` prompt.
 *
 * - Backspacing past the start aborts, like less's CF_QUIT_ON_ERASE.
 * - TAB / ^O cycle filename completions of the last word, ^L expands it
 *   to all matches, like cmdbuf.c's cmd_complete.
 * - Up/Down recall previously opened file names starting with the
 *   typed text, like cmdbuf.c's cmd_updown; editing the text starts
 *   a fresh prefix match.
 *
 * @param key - Raw key input.
 * @returns `run` to open the entered path, `pending` or `cancel`.
 */
export function examineKey(key: string): 'run' | 'pending' | 'cancel' {
  if (!cmd.prefix) {
    if (key === '\x0D' || key === '\x0A') {
      examine.pending = false;
      examine.text = cmdText();
      cmdClose();
      return 'run';
    }

    if (key === '\x03') {
      examine.pending = false;
      examine.text = '';
      cmdClose();
      return 'cancel';
    }
  }

  const result = cmdChar(key);
  examine.text = cmdText();

  if (result === 'quit') {
    examine.pending = false;
    examine.text = '';
    cmdClose();
    return 'cancel';
  }

  for (let u = cmdUngot(); u !== null; u = cmdUngot()) {
    const replayed = examineKey(u);
    if (replayed !== 'pending') return replayed;
  }

  return 'pending';
}

/**
 * Expands an `Examine: ` answer into filenames, like less's edit_list
 * pipeline: `%`/`#` substitution (fexpand), whitespace splitting with
 * quotes, `~`/`$VAR` expansion and globbing (lglob via the shell).
 *
 * @param text - The raw prompt answer.
 * @returns Expanded filenames, in order.
 */
export function expandExamineList(text: string): string[] {
  const names: string[] = [];

  for (const word of splitWords(fexpand(text))) {
    names.push(...glob(expandHomeEnv(word)));
  }

  return names;
}

/**
 * Substitutes `%` with the current filename and `#` with the previous
 * one, doubling to escape, like filename.c's fexpand.
 */
export function fexpand(text: string): string {
  let expanded = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char !== '%' && char !== '#') {
      expanded += char;
      continue;
    }

    if (text[i + 1] === char) {
      expanded += char;
      i++;
      continue;
    }

    const name = char === '%'
      ? files.list[files.index]?.path ?? null
      : previousPath;

    // with no file to substitute, the character stays literal;
    // og shell_quotes the substituted name (xcpy_filename)
    expanded += name === null ? char : shellQuote(name);
  }

  return expanded;
}

/**
 * Splits a filename list on unquoted spaces, like init_textlist: the
 * -" quote pair groups words and the meta escape (LESSMETAESCAPE,
 * default backslash) protects the next character; both stay in the
 * word for unquoteWord, like og deferring to shell_unquote.
 */
function splitWords(text: string): string[] {
  const { open, close } = optQuotes();
  const esc = lgetenv('LESSMETAESCAPE') ?? DEF_METAESCAPE;

  const words: string[] = [];
  let word = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (!quoted && esc && text.startsWith(esc, i) &&
        i + esc.length < text.length) {
      word += text.slice(i, i + esc.length + 1);
      i += esc.length;
      continue;
    }

    if (quoted) {
      if (char === close) quoted = false;
      word += char;
      continue;
    }

    if (char === open && open !== '') {
      quoted = true;
      word += char;
      continue;
    }

    if (char === ' ') {
      if (word) words.push(word);
      word = '';
      continue;
    }

    word += char;
  }

  if (word) words.push(word);
  return words.map(unquoteWord);
}

/**
 * Strips the quotes or escapes from one word, like shell_unquote: a
 * word starting with the open quote reads to the closing quote (a
 * doubled close quote is a literal one) and drops anything after
 * it; otherwise each meta escape collapses into the next character.
 */
function unquoteWord(word: string): string {
  const { open, close } = optQuotes();
  const esc = lgetenv('LESSMETAESCAPE') ?? DEF_METAESCAPE;
  let out = '';

  if (open && word[0] === open) {
    for (let i = 1; i < word.length; i++) {
      if (word[i] === close) {
        if (word[i + 1] !== close) break;
        i++;
      }

      out += word[i];
    }

    return out;
  }

  for (let i = 0; i < word.length; i++) {
    if (esc && word.startsWith(esc, i)) {
      i += esc.length;
      out += word[i] ?? '';
      continue;
    }

    out += word[i];
  }

  return out;
}

/**
 * Expands a leading `~` and `$VAR`/`${VAR}` references, as the shell
 * would during less's glob step. Unset variables expand to nothing.
 */
export function expandHomeEnv(word: string): string {
  let expanded = word;

  if (expanded === '~' || expanded.startsWith('~/')) {
    expanded = os.homedir() + expanded.slice(1);
  }

  return expanded.replace(
    /\$(?:\{(\w+)\}|(\w+))/g,
    (_, braced: string, plain: string) => process.env[braced || plain] ?? ''
  );
}

/**
 * Expands shell glob metacharacters (`*`, `?`, `[...]`) against the
 * filesystem, sorted like the shell.
 *
 * - A pattern matching nothing is returned as-is, like less trying to
 *   open the raw filename when the glob does not expand.
 *
 * @param pattern - The pattern to expand.
 */
export function glob(pattern: string): string[] {
  // like lglob: expansion is disabled under LESSSECURE
  if (!secureAllow('glob')) return [pattern];

  if (!/[*?[]/.test(pattern)) return [pattern];

  // A configured LESSECHO replaces the helper executable exactly as
  // in filename.c. The shell expands the pattern; lessecho quotes the
  // resulting names so init_textlist can recover spaces safely.
  const lessecho = lgetenv('LESSECHO');
  if (lessecho) {
    const { open, close } = optQuotes();
    const escape = lgetenv('LESSMETAESCAPE') ?? DEF_METAESCAPE;
    const metas = lgetenv('LESSMETACHARS') ?? DEF_METACHARS;
    const flags = [
      `-p0x${(open.charCodeAt(0) || 0).toString(16)}`,
      `-d0x${(close.charCodeAt(0) || 0).toString(16)}`,
      `-e${shellQuote(escape || '-')}`,
      ...[...metas].map(char => `-n0x${char.charCodeAt(0).toString(16)}`),
    ].join(' ');
    // $LESSECHO names a program: a --no-shell session runs none
    const [shell, args] = shellArgv(`${lessecho} ${flags} -- ${pattern}`);
    const result = optNoShell()
      ? { stdout: '' } as ReturnType<typeof spawnSync>
      : spawnSync(shell, args, { encoding: 'utf8' });
    const text = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    if (text) return splitWords(text);
  }

  const absolute = pattern.startsWith('/');
  const segments = pattern.split('/').filter(Boolean);
  let candidates = [absolute ? '/' : ''];

  for (const segment of segments) {
    const next: string[] = [];

    for (const base of candidates) {
      const dir = base === '' ? '.' : base;

      if (!/[*?[]/.test(segment)) {
        next.push(joinPath(base, segment));
        continue;
      }

      const regex = globRegex(segment);
      let entries: string[];

      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }

      for (const entry of entries.sort()) {
        // like the shell, * does not match a leading dot
        if (entry.startsWith('.') && !segment.startsWith('.')) continue;
        if (regex.test(entry)) next.push(joinPath(base, entry));
      }
    }

    candidates = next;
  }

  const matches = candidates.filter(name => fs.existsSync(name));
  return matches.length ? matches : [pattern];
}

function joinPath(base: string, segment: string): string {
  if (base === '') return segment;
  return base.endsWith('/') ? base + segment : base + '/' + segment;
}

function globRegex(segment: string): RegExp {
  let source = '^';

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];

    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const end = segment.indexOf(']', i + 2);

      if (end < 0) {
        source += '\\[';
      } else {
        const body = segment.slice(i + 1, end).replace(/^!/, '^');
        source += `[${body}]`;
        i = end;
      }
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(source + '$');
}

/**
 * Cycles the last word through its filename completions (TAB / ^O),
 * like cmd_complete: through the matches, then back to the original.
 *
 * @param direction - 1 to cycle forward, -1 backward.
 */
/** Filename completion for any prompt, like cmd_complete. */
export const filenameComplete: Completer = action => {
  if (action === 'expand') expandWord();
  else completeWord(action === 'complete' ? 1 : -1);
};

function completeWord(direction: 1 | -1): void {
  if (!cmd.inCompletion && !buildCompletions()) return;

  const count = completion.trials.length;
  completion.index = (completion.index + direction + count) % count;

  cmdReplaceRange(completion.wordStart, completion.trials[completion.index]);
}

/**
 * Replaces the last word with all of its completions (^L), like
 * cmd_complete's EC_EXPAND.
 */
function expandWord(): void {
  cmd.inCompletion = false;
  if (!buildCompletions()) return;

  cmdReplaceRange(
    completion.wordStart, completion.trials.slice(0, -1).join(' ')
  );
}

/**
 * Builds the completion list by globbing `word*`, like fcomplete.
 *
 * @returns False with a bell when nothing matches.
 */
function buildCompletions(): boolean {
  // put the cursor at the end of the word under it, like delimit_word
  if (cmd.cur < cmd.steps.length && cmd.steps[cmd.cur] !== ' ') {
    while (cmd.cur < cmd.steps.length && cmd.steps[cmd.cur] !== ' ') {
      cmdRight();
    }
  }

  if (cmd.cur === 0) {
    ringBell();
    return false;
  }

  const start = wordStart(cmd.steps.slice(0, cmd.cur).join(''));
  const word = cmd.steps.slice(start, cmd.cur).join('');
  const matches = glob(expandHomeEnv(unquoteWord(word)) + '*');

  if (matches.length === 1 && !fs.existsSync(matches[0])) {
    ringBell();
    return false;
  }

  cmd.inCompletion = true;
  completion.wordStart = start;
  // og shell_quotes each expanded name (lglob, filename.c:665)
  const separator = lgetenv('LESSSEPARATOR') ?? (isWindows ? '\\' : '/');
  completion.trials = [
    ...matches.map(name => shellQuote(name) +
      (fs.statSync(name, { throwIfNoEntry: false })?.isDirectory()
        ? separator : '')),
    word,
  ];
  completion.index = -1;

  return true;
}

/**
 * Returns the start of the last space-delimited word, honoring the
 * -" quote pair and the meta escape like og's delimit_word.
 */
function wordStart(text: string): number {
  const { open, close } = optQuotes();
  const esc = lgetenv('LESSMETAESCAPE') ?? DEF_METAESCAPE;
  let start = 0;
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    if (!quoted && esc && text.startsWith(esc, i) &&
        i + esc.length < text.length) {
      i += esc.length;
      continue;
    }

    if (quoted) {
      if (text[i] === close) quoted = false;
    } else if (text[i] === open && open !== '') {
      quoted = true;
    } else if (text[i] === ' ') {
      start = i + 1;
    }
  }

  return start;
}

/**
 * Builds the new-file prompt, like the `%f (file %i of %m)` part of
 * less's default prompt. The stdin pseudo-file shows no name.
 */
export function fileTitle(): string {
  const entry = files.list[files.index];
  const name = entry && entry.path !== '-' ? entry.path : '';
  const multi = files.list.length > 1
    ? `(file ${files.index + 1} of ${files.list.length})`
    : '';

  return [name, multi].filter(Boolean).join(' ');
}

/**
 * Returns the path shown by the `(END) - Next: x` marker, or an empty
 * string when there is no next file.
 */
export function nextFileName(): string {
  const next = files.list[files.index + 1];
  return files.index >= 0 && next ? next.path : '';
}

/**
 * Reports the current file name and position (`=`, `^G`, `:f`) by
 * expanding less's e_proto (changeable with -P=).
 *
 * @param content - Displayed content lines.
 */
export function fileInfo(content: string[]): void {
  if (mode.HELP) return;

  search.message = prExpand(content, eqProto());
}

/**
 * Returns the last content row displayed on screen.
 *
 * @param content - Displayed content lines.
 */
export function bottomRow(content: string[]): number {
  let steps = config.window - 2 - config.blankTop;

  if (chopLine() || config.col) {
    return Math.min(config.row + steps, content.length - 1);
  }

  let row = config.row;
  let subRow = config.subRow;

  while (steps > 0 && row < content.length - 1) {
    const currMaxSubRow = maxSubRow(content[row]);
    if (subRow + steps <= currMaxSubRow) break;

    steps -= currMaxSubRow - subRow + 1;
    row++;
    subRow = 0;
  }

  return row;
}

/**
 * Returns the byte offset of the start of a content row, counting one
 * newline per line.
 *
 * @param content - Content lines.
 * @param row - Row whose starting offset to compute.
 */
export function byteOffset(content: string[], row: number): number {
  let bytes = 0;

  for (let i = 0; i < row && i < content.length; i++) {
    bytes += Buffer.byteLength(content[i]) + 1;
  }

  return bytes;
}

/**
 * True when the current file's length is known, like og's
 * ch_length() != NULL_POSITION: displaying the last line of a pipe
 * is not enough — the length arrives only when a read past the end
 * returns EOI (revealPipeEnd, or revealSize for explicit scans).
 */
export function sizeIsKnown(): boolean {
  // a session without file bookkeeping is all in memory: file-like
  return files.list[files.index]?.sizeKnown ?? true;
}

/**
 * A forward read past the end of a completed pipe returns EOI and
 * teaches the length, like og's ch_forw_get at end-of-input; a pipe
 * still delivering has no end to return yet.
 */
export function revealPipeEnd(): void {
  const entry = files.list[files.index];
  if (entry && !entry.streaming) entry.sizeKnown = true;
}

/**
 * og reads a pipe-form $LESSOPEN alt to EOI when its content ends
 * within the first screen: the length is learned at the first paint
 * and the prompt shows (END), like eof_displayed.
 */
export function revealAltEnd(content: string[]): void {
  const entry = files.list[files.index];
  if (!entry || entry.alt !== '-' || entry.sizeKnown) return;

  let rows = 0;

  for (const line of content) {
    rows += maxSubRow(line) + 1;
    if (rows > config.window - 1) return;
  }

  entry.sizeKnown = true;
}

/**
 * Learns the current file's size now, like og's scan_eof: --file-size
 * turning on, or a forward search scanning to the end of a pipe.
 */
export function revealSize(): void {
  const entry = files.list[files.index];
  if (entry) entry.sizeKnown = true;
}

/**
 * The bottom line state while a pipe drains for G/%: og's G reads
 * with a blank command line, while % shows ierror's interruptible
 * "Determining length of file" note.
 */
export const pipeDraining = {
  active: false,
  note: '',
  cancelMessage: '',
};

/**
 * A forward move blocked reading a live pipe, like og's forw loop
 * waiting in forw_line: the display rows still owed, and whether any
 * line has painted yet (forw's nlines, deciding the eof_bell).
 */
export const pendingScroll = {
  rows: 0,
  moved: false,
};

/** Lines recycled off the front of a streaming pipe (0 otherwise). */
export function lineBase(): number {
  return files.list[files.index]?.discardedLines ?? 0;
}

/** Bytes recycled off the front of a streaming pipe (0 otherwise). */
export function byteBase(): number {
  return files.list[files.index]?.discardedBytes ?? 0;
}

/**
 * Integer percentage, rounded half to even like less's percentage().
 */
export function percentage(num: number, den: number): number {
  const scaled = num * 100;
  let pct = Math.floor(scaled / den);
  const rem = scaled % den;

  if (rem * 2 > den || (rem * 2 === den && pct % 2 === 1)) pct++;
  return pct;
}

/**
 * Renders a file open error like less's errno messages.
 */
export function errorText(error: unknown): string {
  const code = (error as { code?: string }).code;

  switch (code) {
    case 'ENOENT': return 'No such file or directory';
    case 'EACCES': return 'Permission denied';
    default: return code ?? 'Cannot open';
  }
}
