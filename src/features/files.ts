import fs from 'fs';
import os from 'os';

import { config, mode } from "../config";

import { maxSubRow, ringBell } from "../helpers";

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

import { optNoHistDups, optQuotes, resetHeaderStart, checkModelines }
  from "../options";

import { decodeContent } from "./charset";

import { prExpand, eqProto } from "./prompt";

import { openAltFile, closeAltFile } from "./lessopen";

/**
 * One entry in the command line file list, like less's ifile.
 */
interface FileEntry {
  path: string;
  /** Preloaded lines for non-file content, like stdin's "-". */
  lines: string[] | null;
  /** Byte size, from stat for real files. */
  size: number;
  /** Saved screen position, like ifile.c's store_pos/get_pos. */
  saved: { row: number, subRow: number } | null;
  /** The $LESSOPEN replacement name, like ifile.c's altfilename. */
  alt?: string;
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
  files.list = [{
    path: '-',
    lines,
    size: byteOffset(lines, lines.length) - 1,
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
 * Reads a file entry's lines, reporting errors like less's edit.
 *
 * @param index - Entry index in the file list.
 * @returns The file's lines, or null with a message set on failure.
 */
export function loadFile(index: number): string[] | null {
  const entry = files.list[index];
  if (!entry) return null;

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
    checkModelines(alt.lines);
    return alt.lines;
  }

  try {
    if (fs.statSync(entry.path).isDirectory()) {
      search.message = `${entry.path} is a directory`;
      return null;
    }

    // bytes decode through the charset, like og's chardef classes:
    // invalid UTF-8 bytes survive as markers for $LESSBINFMT
    const data = decodeContent(fs.readFileSync(entry.path));
    entry.size = fs.statSync(entry.path).size;

    const lines = (data.endsWith('\n') ? data.slice(0, -1) : data)
      .split('\n');

    // --modelines scans the head of each opened file, like edit_ifile
    // calling check_modelines
    checkModelines(lines);

    return lines;
  } catch (error) {
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

  closeAltFile(entry.alt, entry.path);
  entry.alt = undefined;
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
  const name = quoteIfNeeded(filePath);
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

    // with no file to substitute, the character stays literal
    expanded += name === null ? char : quoteIfNeeded(name);
  }

  return expanded;
}

/**
 * Splits a filename list on whitespace, honoring double quotes.
 */
function splitWords(text: string): string[] {
  const words: string[] = [];
  let word = '';
  let quoted = false;
  let seen = false;

  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
      seen = true;
      continue;
    }

    if (char === ' ' && !quoted) {
      if (seen || word) words.push(word);
      word = '';
      seen = false;
      continue;
    }

    word += char;
  }

  if (seen || word) words.push(word);
  return words;
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
function glob(pattern: string): string[] {
  // like lglob: expansion is disabled under LESSSECURE
  if (!secureAllow('glob')) return [pattern];

  if (!/[*?[]/.test(pattern)) return [pattern];

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
  const matches = glob(expandHomeEnv(unquote(word)) + '*');

  if (matches.length === 1 && !fs.existsSync(matches[0])) {
    ringBell();
    return false;
  }

  cmd.inCompletion = true;
  completion.wordStart = start;
  completion.trials = [...matches.map(quoteIfNeeded), word];
  completion.index = -1;

  return true;
}

/**
 * Returns the start of the last space-delimited word, honoring quotes.
 */
function wordStart(text: string): number {
  let start = 0;
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    if (text[i] === ' ' && !quoted) start = i + 1;
  }

  return start;
}

function unquote(word: string): string {
  const { open, close } = optQuotes();
  let out = word;

  if (open) out = out.split(open).join('');
  if (close && close !== open) out = out.split(close).join('');

  return out;
}

// filenames with spaces take the -" quote characters, like less
function quoteIfNeeded(name: string): string {
  const { open, close } = optQuotes();
  if (!open || !/[ "]/.test(name)) return name;
  return open + unquote(name) + close;
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

  if (config.chopLongLines || config.col) {
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
