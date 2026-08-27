import fs from 'fs';

import { globSync } from 'shell-glob';
import os from 'os';

import { Writable } from 'stream';

import { spawnSync } from 'child_process';

import { config, mode } from "../state/config";

import { ringBell } from "../helpers";
import { maxSubRow, sourceLine, sourceIndexAt } from "../lines/helpers";

import { getLayout, rawByteLength } from "../lines/lineLayout";

import { session } from "../state/session";

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

import { opt, optNoHistDups, optQuotes, resetHeaderStart,
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
export interface FileEntry {
  path: string;
  /**
   * What to CALL this file, when its path is not the answer.
   *
   * A lesskey form that is not a file - a compiled one, or a content
   * variable - is materialized as a temp file so it can be paged and
   * edited, and the path that produces says nothing:
   * /var/folders/3z/b8wpqjgn.../T/lesskey-Ab12Cd/LESSKEY_CONTENT.
   * The prompt shows this instead, so the screen names the thing the
   * text came FROM. Everything that opens, reads or shells out still
   * uses path.
   */
  display?: string;
  /** Preloaded lines for non-file content, like stdin's "-". */
  lines: string[] | null;
  /** Byte size, from stat for real files. */
  size: number;
  /** False while a pipe's length reads as unknown, like ch_length()
   *  returning NULL_POSITION before ch has read to EOF. */
  sizeKnown: boolean;
  /** True once the entry opened successfully, like less's opened():
   *  a re-open skips the binary file confirmation. */
  everOpened?: boolean;
  /** True while a pipe is still delivering data, like less's ch layer
   *  before read() returns end-of-file. */
  streaming?: boolean;
  /** Early pipe data recycled away under memory pressure, like less's
   *  ch_addbuf failure reusing the oldest buffer: these lines and
   *  bytes are gone but still count in line numbers and offsets. */
  discardedLines?: number;
  discardedBytes?: number;
  /** Saved screen position, like ifile.c's store_pos/get_pos. */
  saved: { row: number, subRow: number } | null;
  /** The $LESSOPEN replacement name, like ifile.c's altfilename. */
  alt?: string;
  /** A failed pipe preprocessor's message, reported at close like
   *  less's close_altfile (edit.c:288). */
  preprocError?: string;
  /** Where the "-" entry's spooled standard input lives. less keeps fd0
   *  open with CH_KEEPOPEN and buffers it in ch; the spool is our ch,
   *  and it makes the entry an ordinary growing file to everything
   *  downstream. */
  spoolPath?: string;
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
  /** Drops a remembered position, for a file that will not be back. */
  forget(filePath: string): void;
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
 * Forgets where a file was left.
 *
 * The engine remembers a position per PATH so :n and :p come back to
 * it, which is right for a file list the user assembled and wrong for
 * one the pager put up on its own: a screen you quit out of should
 * open at the top next time, the way quitting help does.
 */
export function forgetSourceFile(filePath: string): void {
  sourceFileHooks?.forget(filePath);
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

/** The `#` file, for a caller that has to put it back. */
export function getPreviousPath(): string | null {
  return previousPath;
}

/** How many examine entries exist, so a swap can trim its own back. */
export function examineHistoryLength(): number {
  return examineHistory.length;
}

/** Drops examine entries added after a mark, like a file list that
 *  was only ever on screen to be looked at. */
export function trimExamineHistory(length: number): void {
  examineHistory.length = Math.min(examineHistory.length, length);
}

/**
 * Starts a session over in-memory content, registered as the pseudo-file
 * `-` so `:e`/`:p` can navigate back to it, like less reading stdin.
 *
 * @param lines - The content to page.
 */
export function initContent(
  lines: string[],
  sizeKnown = false,
  size?: number
): void {
  // new content, new screen: less's position table describes rows of the
  // file it was filled from, so it cannot outlive it (pos_clear)
  config.screen = [];

  // the SAME entry when there already is one: less's stdin ifile is
  // opened once and outlives every read, and a mark holds the entry
  // itself - handing out a new object for the same pseudo-file would
  // quietly orphan every mark set before it
  const existing = files.list.length === 1 && files.list[0].path === '-'
    ? files.list[0]
    : null;

  const entry: FileEntry = existing ?? {
    path: '-',
    lines,
    size: 0,
    sizeKnown,
    saved: null,
  };

  entry.lines = lines;

  // the caller's own byte count when it has one: the lines cannot say
  // whether a trailing newline was there, and less counts it (a
  // two-line file reads 7 bytes without one and 8 with). Reconstructed
  // otherwise, which is that count without the final newline.
  entry.size = size ?? byteOffset(lines, lines.length) - 1;

  // Whether that size can be REPORTED is the caller's fact, not ours:
  // a pipe's length is unknown until a read returns EOI (less's
  // ch_length before ch has read to the end), and a value the caller
  // already holds is known the moment it arrives. We measured it two
  // lines up either way.
  //
  // It used to be hardcoded to a live pipe's answer, and every caller
  // was expected to correct it afterwards. streamPager did, from
  // spool.ended; paramPager did not, so the library path spent whole
  // sessions unable to report a length it had already measured - and
  // `?e` refused to expand, so the last screen said ":" until some
  // later move happened to run revealPipeEnd. Stated here, at the one
  // place each caller knows the answer, there is nothing to forget.
  entry.sizeKnown = sizeKnown;

  files.list = [entry];
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
/** A file list from paths, with nothing opened yet. */
export function makeFileList(paths: string[]): FileEntry[] {
  return paths.map(path => ({
    path,
    lines: null,
    size: 0,
    // regular files are seekable: less knows their length at once
    sizeKnown: true,
    saved: null,
  }));
}

export function initFiles(paths: string[]): void {
  files.list = makeFileList(paths);
  files.index = -1;
  files.newFile = false;
  examine.pending = false;
  examine.text = '';
  examineHistory.length = 0;
  resetHeaderStart();
}

/**
 * The `"X" may be a binary file.  See it anyway?` confirmation state,
 * like less's edit query: loadFile raises `request`, and the caller
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
 * True when a file's first 256 bytes look binary, like less's bin_file:
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
 * less's bad_file and isatty checks, ahead of the open itself.
 *
 * @returns True when the file may be opened, false with a message
 *   set; a stat failure throws for the caller's errno report.
 */
function statGuard(path: string): boolean {
  const stat = fs.statSync(path);

  // -f skips the directory guard and lets the read report the OS
  // error, like less's force_open bypassing bad_file's is_dir check
  if (stat.isDirectory() && !opt.forceOpen) {
    search.message = `${path} is a directory`;
    return false;
  }

  // bad_file's second guard is S_ISREG, not isatty: EVERY non-regular
  // file is refused with the same message - devices, fifos, sockets
  // alike (filename.c:1119). less's "is a terminal" message belongs to a
  // later, different check (edit.c:582), which only ever sees a
  // descriptor bad_file did not screen: standard input
  if (!stat.isFile() && !opt.forceOpen) {
    search.message = `${path} is not a regular file (use -f to see it)`;
    return false;
  }

  return true;
}

/**
 * Opens an entry the way a NON-terminal session needs it, like less
 * reaching cat_file through the same edit_ifile every session uses.
 *
 * $LESSOPEN applies with output on a pipe exactly as it does on a
 * screen (main.c:376 runs edit_first before the cat loop), but the
 * copy that follows is byte for byte - ch_forw_get, no line
 * processing - so a pipe preprocessor writes straight to `out` and
 * anything else hands back a path to stream. less's binary-file
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

  // less's edit_ifile takes the name "-" to mean standard input, on the
  // descriptor it already has and with CH_KEEPOPEN so it is never
  // closed and reopened (edit.c:516). bad_file never sees it
  if (entry.path === '-') {
    entry.everOpened = true;

    await new Promise<void>(resolve => {
      process.stdin.pipe(out, { end: false });
      process.stdin.on('end', resolve);
    });

    return {};
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

  // a re-open replaces any previous $LESSOPEN product, like less's edit
  // closing the old alt file first
  closeAltQuiet(entry);

  // $LESSOPEN runs before the file itself opens (it may even handle
  // directories), like edit_ifile calling open_altfile
  const alt = openAltFile(entry.path);

  if (alt) {
    entry.size = alt.size;
    entry.alt = alt.alt;
    entry.preprocError = alt.preprocError;

    // a pipe-form $LESSOPEN ("|cmd") feeds a pipe whose length less
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

    // less asks before opening what looks like a binary file, unless
    // -f, a previous open, or a non-tty session (edit.c's bin_file)
    if (!opt.forceOpen && !entry.everOpened && keyboard().isTTY &&
        binFile(bytes)) {
      binaryConfirm.request = true;
      binaryConfirm.path = entry.path;
      return null;
    }

    // bytes decode through the charset, like less's chardef classes:
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
    // -f forced the open past bad_file: less's read then fails
    // (EISDIR) and the pager runs on the empty file, with
    // prompt_message reporting less's "read error"
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
 * like less's close_altfile when a file is left.
 */
export async function closeAlt(entry: FileEntry | undefined): Promise<void> {
  if (!entry || !entry.alt) return;

  await closeAltFile(entry.alt, entry.path, entry.preprocError);
  entry.alt = undefined;
  entry.preprocError = undefined;
}

/**
 * The same, without the gate the preprocessor's complaint would open.
 *
 * For an entry being RE-opened: whatever its old product had to say
 * was said when that product was on the screen, and gating here would
 * ask the user to dismiss it a second time. It also keeps loadFile
 * synchronous, which every file open depends on.
 */
export function closeAltQuiet(entry: FileEntry | undefined): void {
  if (!entry || !entry.alt) return;

  void closeAltFile(entry.alt, entry.path, undefined);
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
  // less shell_quotes the entry (edit.c:683), never the -" pair on a
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

  // the word keeps its quotes here: less hands the quoted word to
  // lglob and shell_unquotes what comes back (edit.c:728), which is
  // the only reason a name with spaces survives the shell
  for (const word of splitWordsRaw(fexpand(text))) {
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
    // less shell_quotes the substituted name (xcpy_filename)
    expanded += name === null ? char : shellQuote(name);
  }

  return expanded;
}

/**
 * Splits a filename list on unquoted spaces, like init_textlist: the
 * -" quote pair groups words and the meta escape (LESSMETAESCAPE,
 * default backslash) protects the next character; both stay in the
 * word for unquoteWord, like less deferring to shell_unquote.
 */
function splitWords(text: string): string[] {
  return splitWordsRaw(text).map(unquoteWord);
}

/**
 * less's init_textlist (edit.c:63): unquoted spaces become word
 * separators and NOTHING ELSE CHANGES - the quotes stay on the word.
 *
 * That is what carries a name with spaces safely through lglob: the
 * still-quoted word goes to the shell, which honours the quotes and
 * hands back one name. shell_unquote runs afterwards, on the result.
 */
function splitWordsRaw(text: string): string[] {
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
  return words;
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
 * Expands a filename pattern, like lglob.
 *
 * - A pattern matching nothing is returned as-is, like less trying to
 *   open the raw filename when the glob does not expand.
 *
 * @param pattern - The pattern to expand.
 */
export function glob(pattern: string): string[] {
  // less's caller shell_unquotes whatever lglob hands back, expanded
  // or not, so every path out of here owes an unquoted name
  const plain = unquoteWord(pattern);

  // like lglob: expansion is disabled under LESSSECURE
  if (!secureAllow('glob')) return [plain];

  // less's lglob on unix does NOT glob. It hands the pattern to $SHELL
  // and lets the shell expand it (filename.c:750, the HAVE_POPEN
  // branch); glob(3) appears exactly once in all of less, guarded by
  // `#if MSDOS_COMPILER==DJGPPC` (lglob.h:34).
  //
  // That is why "[[:upper:]]*" and "{a,b}" expand in less, and why no
  // in-process implementation can match it: the answer depends on
  // WHICH shell the user runs, down to the setopts its startup file
  // applies to a non-interactive one.
  //
  // There is no fast path for a pattern without metacharacters
  // either - less shells out for every name it is given.
  // --use-zsh-glob asks for the globber below instead, which is ours
  // and not less's - see options/use-zsh-glob.ts
  if (!isWindows && !opt.useZshGlob) {
    const expanded = shellExpand(pattern);

    // a shell that ran is the answer, whatever it said. Only a shell
    // that could not run at all falls through to the globber below
    if (expanded !== NO_SHELL) {
      return expanded !== null && expanded.length ? expanded : [plain];
    }
  }

  // Windows has no such delegation: less walks the directory itself
  // through _findfirst/_findnext (lglob.h:61), which is DOS wildcard
  // matching - "*" and "?" only, case-insensitive, no bracket
  // expressions. We used to answer with a hand-rolled walk of about
  // the same power; shell-glob is a real globber, so the one platform
  // where less does its own matching now gets a better one than less
  // has. A deliberate divergence, and the only kind available here:
  // there is no $SHELL to delegate to.
  // zsh ERRORS rather than returning an empty list - `nomatch` - and a
  // bad pattern throws as well; shell-glob keeps both, and words them
  // as zsh does: "no matches found: nonexistent*", "bad pattern: [a".
  //
  // So it is SHOWN, not swallowed. That is what a zsh user already
  // gets on unix, where the shell's own complaint reaches the terminal
  // because less redirects stdout only (filename.c:614) - see
  // emitShellError. This is the same complaint from the same grammar,
  // on the one platform that has no shell to produce it.
  //
  // The name still comes back unexpanded either way: less's lglob
  // answers with what it was given and lets the open fail.
  //
  // Unix reaches here two ways. --use-zsh-glob asks for it outright,
  // and otherwise by the one route that leaves it in the same
  // position Windows is always in: the shell could not be EXECUTED -
  // no /bin/sh, or a $SHELL that has been uninstalled. less degrades
  // there rather than deciding to: popen forks fine, the child cannot
  // exec, and lglob reads the empty pipe as "did not expand"
  // (filename.c:790, which never looks at the status). Since we are
  // already carrying a globber for Windows, spending it here costs
  // nothing and keeps :e working on a machine whose shell is gone.
  // A shell that RAN and matched nothing never arrives here - that is
  // an answer, and it stays less's.
  let matched: string[];

  try {
    matched = globSync(plain);
  } catch (error) {
    emitShellError(String((error as Error).message ?? '').trim() + '\n');

    return [plain];
  }

  // like the unix branch, and like less: a pattern that expands to
  // nothing comes back as itself, for the caller to try opening
  return matched.length ? matched : [plain];
}

/**
 * The shell could not be executed at all - distinct from a shell that
 * ran and matched nothing, which is an answer and stays less's.
 */
const NO_SHELL = Symbol('no shell');

/**
 * less's lglob shell pipeline (filename.c:750): build a command, run it
 * through `$SHELL -c`, read back the names the shell expanded.
 *
 * less runs `lessecho`, whose entire job is to quote those names so
 * init_textlist can split them on spaces again. We prefer the real
 * binary where it exists, so a user's $LESSECHO is honoured and the
 * quoting round trip is less's own. Where it is missing - less simply
 * fails to expand at all then - the same shell reports the same names
 * NUL-delimited instead, which needs no quoting to survive.
 *
 * @param pattern - The pattern, passed to the shell unquoted.
 * @returns The expanded names, or null when the shell produced none.
 */
function shellExpand(pattern: string): string[] | null | typeof NO_SHELL {
  // less: $LESSECHO, else LIBEXECDIR/lessecho, else "lessecho" on PATH
  const lessecho = lgetenv('LESSECHO') || 'lessecho';
  const { open, close } = optQuotes();
  const escape = lgetenv('LESSMETAESCAPE') ?? DEF_METAESCAPE;
  const metas = lgetenv('LESSMETACHARS') ?? DEF_METACHARS;
  const flags = [
    `-p0x${(open.charCodeAt(0) || 0).toString(16)}`,
    `-d0x${(close.charCodeAt(0) || 0).toString(16)}`,
    `-e${shellQuote(escape || '-')}`,
    ...[...metas].map(char => `-n0x${char.charCodeAt(0).toString(16)}`),
  ].join(' ');

  const first = runShell(`${lessecho} ${flags} -- ${pattern}`);

  // nothing was asked, because there was nothing to ask. Reading the
  // silence as "matched nothing" would hand the pattern back
  // unexpanded, which is what less does - but less has no in-process
  // globber on unix to do better with, and we do.
  if (!first.ran) return NO_SHELL;

  // 127 is the shell saying it could not find lessecho, which less
  // treats as fatal (it has no fallback) but we can do better. ANY
  // other status - including zsh's 1 for a pattern that matched
  // nothing - is an answer, and less takes it: `if (*gfilename ==
  // '\0') return (filename)` returns the pattern unexpanded rather
  // than asking a second time.
  //
  // Telling those apart matters for more than tidiness. Reading an
  // empty stdout as "no lessecho" ran the fallback whenever a glob
  // simply missed, so the shell evaluated the pattern TWICE and every
  // side effect it has - the "no matches found" on the terminal, and
  // the cost of a second process - happened twice over.
  if (first.status !== 127) {
    emitShellError(first.stderr);
    return first.stdout === null ? null : splitWords(first.stdout);
  }

  // no lessecho here. `for f in <pattern>` is the same expansion the
  // same shell would have done for it, and NUL keeps a name with
  // spaces whole - which is the only thing lessecho's quoting buys.
  // The first run's stderr is dropped: it is the shell reporting a
  // missing lessecho, which is ours to handle and not the user's
  // business
  const raw = runShell(`for f in ${pattern}; do printf '%s\\0' "$f"; done`);
  emitShellError(raw.stderr);

  if (raw.stdout === null) return null;

  return raw.stdout.split('\0').filter(name => name !== '');
}

/**
 * Puts a child's stderr on the terminal, as less's popen does.
 *
 * less redirects STDOUT only (filename.c:614), so a shell complaining
 * about the user's pattern is seen: with $SHELL=zsh, ":e nonexistent*"
 * shows "zsh:1: no matches found" above less's own error. bash and
 * dash say nothing there, because they pass an unmatched pattern
 * through on stdout instead.
 *
 * Written and then FORGOTTEN, exactly as less forgets it. popen tells
 * less nothing, so less's screen model never learns the child's
 * newline scrolled the terminal, and the text simply sits there: it
 * survives RETURN, j, k and even a horizontal shift, and goes only
 * when something repaints the whole screen (h, or the paint after a
 * help exit). Measured on the binary - YES YES YES YES YES no no.
 *
 * Marking a full repaint here would be the tidier thing to do and the
 * wrong one: it wiped the message a keystroke later, where less leaves
 * it for the user to read.
 */
function emitShellError(text: string): void {
  if (!text) return;

  fs.writeSync(2, text);
}

/**
 * One command through the shell, like less's shellcmd + readfd.
 *
 * @returns stdout (null when empty, less's `*gfilename == '\0'`),
 *          the child's stderr, and the exit status the caller needs
 *          to tell "no such command" from "the glob matched nothing".
 */
function runShell(cmd: string): {
  stdout: string | null;
  stderr: string;
  status: number;
  ran: boolean;
} {
  const [shell, args] = shellArgv(cmd);

  try {
    const result = spawnSync(shell, args, { encoding: 'utf8' });
    const text = typeof result.stdout === 'string' ? result.stdout : '';

    return {
      stdout: text.replace(/\n+$/, '') || null,
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      status: result.status ?? 0,
      // spawnSync does not throw when the binary is missing: it comes
      // back with an error and a NULL status, which reads exactly like
      // a shell that ran and said nothing. They are not the same thing
      // and only one of them has a fallback
      ran: result.error === undefined,
    };
  } catch {
    // less: `if (fd == NULL) return (filename)` - the pipe never opened
    return { stdout: null, stderr: '', status: 127, ran: false };
  }
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
  // less shell_quotes each expanded name (lglob, filename.c:665)
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
 * -" quote pair and the meta escape like less's delimit_word.
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
 * Where a DISPLAY row starts in the source, for a session with no
 * position table to ask.
 *
 * less's `=` reports a byte in the FILE, and the file is not what is
 * on the screen: -r spells a control character as "^A", an escape as
 * "ESC[31m", a tab as spaces, and -s drops blank lines and an &
 * filter drops whole lines. Measuring the displayed text answered in
 * units of the rendering - on a file of colour codes read without -R
 * it reported byte 1924 where less says 1251.
 *
 * So the row goes back through session.sourceRow to the line it was
 * made from, and the count runs over the RAW lines. With no map (the
 * help screen, a parked copy) the display text is all there is, which
 * is what this always did.
 */
/**
 * The display row `steps` below the screen's top, as a content row and
 * a display-character offset into it.
 *
 * This is what the block engine reads off less's position table
 * (position(sindex)) and what an array session has to walk for: on a
 * wrapped line a screen row starts PART WAY into the line, and both
 * "which line is at the bottom" and "what byte is the screen's last
 * row" are answers about that offset, not about the line.
 */
export function screenPosAt(
  content: string[],
  steps: number
): { row: number, offset: number } {
  if (chopLine() || config.col) return { row: config.row + steps, offset: 0 };

  let row = config.row;
  let subRow = config.subRow;

  while (steps > 0 && row < content.length) {
    const currMaxSubRow = maxSubRow(content[row]);

    if (subRow + steps <= currMaxSubRow) {
      subRow += steps;
      steps = 0;
      break;
    }

    steps -= currMaxSubRow - subRow + 1;
    row++;
    subRow = 0;
  }

  // ...and a row PAST the last line stays past it. less's position
  // table holds NULL_POSITION there and curr_byte walks forward to
  // ch_length (prompt.c:196), so BOTTOM_PLUS_ONE on a short screen is
  // the end of the file. Clamping to the last line answered with that
  // line's start instead.
  if (row >= content.length) return { row: content.length, offset: 0 };

  const starts = getLayout(content[row] ?? '').rowStart;

  return { row, offset: starts[subRow] ?? 0 };
}

export function sourceByteOffset(
  content: string[],
  row: number,
  offset = 0
): number {
  const map = session.sourceRow;
  const raw = session.fullContent;

  if (!map.length || map.length < content.length || !raw.length) {
    return byteOffset(content, row);
  }

  // one past the last row is the end of the file, like less's
  // BOTTOM_PLUS_ONE at (END) reading ch_length
  const at = row < map.length ? map[row] : raw.length;
  const start = byteOffset(raw, at);

  if (offset <= 0 || at >= raw.length) return start;

  // a screen row that begins PART WAY into a wrapped line answers with
  // a byte part way into it too. The offset counts DISPLAY characters
  // and the file holds bytes, so it converts through the raw line the
  // display was built from - the same trip the block engine makes
  // through its own position table, and with the same two cases.
  const shown = content[row] ?? '';
  const source = sourceLine(shown);

  // spelled out by a transform: the escapes are visible text now, so
  // the offset counts them and the map back is the conversion
  if (source !== undefined) {
    return start +
      Buffer.byteLength(source.slice(0, sourceIndexAt(source, offset)));
  }

  // untouched, which does NOT make the offset an index into it: the
  // layout keeps ANSI codes out of its characters, so a slice skips
  // every escape above the row
  return start + rawByteLength(getLayout(shown), offset);
}

/**
 * True when the current file's length is known, like less's
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
 * teaches the length, like less's ch_forw_get at end-of-input; a pipe
 * still delivering has no end to return yet.
 */
export function revealPipeEnd(): void {
  const entry = files.list[files.index];
  if (entry && !entry.streaming) entry.sizeKnown = true;
}

/**
 * less reads a pipe-form $LESSOPEN alt to EOI when its content ends
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
 * Learns the current file's size now, like less's scan_eof: --file-size
 * turning on, or a forward search scanning to the end of a pipe.
 */
export function revealSize(): void {
  const entry = files.list[files.index];
  if (entry) entry.sizeKnown = true;
}

/**
 * The bottom line state while a pipe drains for G/%: less's G reads
 * with a blank command line, while % shows ierror's interruptible
 * "Determining length of file" note.
 */
export const pipeDraining = {
  active: false,
  note: '',
  cancelMessage: '',
};

/**
 * A forward move blocked reading a live pipe, like less's forw loop
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
