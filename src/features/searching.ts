import fs from 'fs';
import vm from 'vm';

import { strWidth } from 'char-width';

import { keyboard, keyboardPollFd, pushUngot } from '../tty/keyboard';

import { config, mode } from "../state/config";

import {
  cmd,
  stepText,
  cmdOpen,
  cmdClose,
  cmdChar,
  cmdUngot,
  cmdDisplay,
  cmdPrompt
} from "./cmdbuf";

import { ansiRunEnd, maxSubRow } from "../lines/helpers";

import { jumpLoc, subRowStart, subRowOfIndex } from "./jumping";

import { revealSize } from "./files";

import {
  jumpSindex,
  optHowSearch,
  optBsMode,
  optProcBackspace,
  optProcReturn,
  optCtldisp,
  optHiliteSearch,
  optStatusCol,
  optNoHistDups,
  optHeader,
  optNoSearchHeaders,
  optDefSearchType,
  optAutosaveAction,
  optMatchShift,
  optRscroll,
  optIntrChar,
  optNoInit,
  chopLine
} from "../options";

import { colored, ColorKind } from "./color";

import {
  INVERSE_ON,
  INVERSE_OFF,
  CLEAR_LINE
} from "../state/constants";

interface SearchInput {
  /** `/` forward search, `?` backward search, `&` display filter. */
  type: '/' | '?' | '&';
  chars: string[];
  count: number;

  // modifier flags, toggled interactively while the pattern is empty
  invert: boolean;      // ^N or !
  fromStart: boolean;   // ^F or @
  pastEof: boolean;     // ^E or *
  keep: boolean;        // ^K
  noRegex: boolean;     // ^R
  wrap: boolean;        // ^W
  subs: Set<number>;    // ^S digit
  litNext: boolean;     // ^L pending: next char is literal
  subPrompt: boolean;   // ^S pending: awaiting sub-pattern digit

  /** Position when the prompt opened, restored by --incsearch. */
  originRow: number;
  originSubRow: number;
  originEof: boolean;
}

interface Filter {
  regex: RegExp;
  invert: boolean;
  subs: Set<number>;
}

interface SearchState {
  /** Pattern currently being typed at the prompt, or null. */
  input: SearchInput | null;
  /** Last compiled pattern, reused by n/N and highlighting. */
  regex: RegExp | null;
  /** Whether the pattern matches NON-matching lines (^N / !). */
  invert: boolean;
  /** Direction of the last search: 1 forward, -1 backward. */
  lastDir: 1 | -1;
  /** Whether matches are highlighted (toggled by ESC-u). */
  highlight: boolean;
  /** Sub-pattern groups the last search was restricted to (^S). */
  subs: Set<number>;
  /** Active `&` display filters; lines must match all of them. */
  filters: Filter[];
  /** Case sensitivity: 0 sensitive, 1 smart (-i), 2 always ignore (-I). */
  caseless: 0 | 1 | 2;
  /** Previously entered patterns, shared by `/`, `?` and `&` like less. */
  history: string[];
  /** Transient status message shown at the prompt. */
  message: string;
  /** Follow-up messages shown as each one is dismissed, like less's
   *  consecutive blocking error() calls. */
  messageQueue: string[];
}

export const search: SearchState = {
  input: null,
  regex: null,
  invert: false,
  lastDir: 1,
  highlight: true,
  subs: new Set(),
  filters: [],
  caseless: 0,
  history: [],
  message: '',
  messageQueue: [],
};

/**
 * Drops the search a session leaves behind, like a fresh less: the
 * compiled pattern, the & filters, the sub-pattern set and the
 * caseless state. The HISTORY stays — og persists that across
 * invocations through its history file.
 */
export function resetSearch(): void {
  search.input = null;
  search.regex = null;
  search.invert = false;
  search.lastDir = 1;
  search.highlight = true;
  search.subs = new Set();
  search.filters = [];
  search.caseless = 0;
  search.message = '';
  search.messageQueue = [];
}

const HISTORY_LIMIT = 100;

/**
 * Points the recall spot past the newest entry, for when the history
 * is replaced wholesale (loading the history file).
 */
export function resetHistoryRecall(): void {
  if (cmd.active && cmd.history === search.history) {
    cmd.histPos = search.history.length;
    cmd.updownMatch = -1;
  }
}

let globalRegex: RegExp | null = null;
let compiledPattern = '';
let compiledLiteral = false;

// the row the last search landed on, highlighted alone by -g
let lastMatchRow = -1;

/**
 * Changes case sensitivity (-i / -I) and recompiles the current pattern so
 * highlighting and repeats follow the new setting immediately.
 *
 * @param caseless - 0 sensitive, 1 smart (-i), 2 always ignore (-I).
 */
export function chgCaseless(caseless: 0 | 1 | 2): void {
  search.caseless = caseless;
  if (search.regex) compile(compiledPattern, compiledLiteral, search.invert);
}

/**
 * Opens the search or filter prompt.
 *
 * @param type - `/`, `?` or `&`.
 * @param count - N-th occurrence to find.
 */
export function startSearch(type: '/' | '?' | '&', count: number): void {
  // --search-options presets the modifiers for every search
  const defaults = optDefSearchType();

  search.input = {
    type,
    chars: [],
    count,
    invert: defaults.invert,
    fromStart: defaults.fromStart,
    pastEof: defaults.pastEof,
    keep: defaults.keep,
    noRegex: defaults.noRegex,
    wrap: defaults.wrap,
    subs: new Set(defaults.subs),
    litNext: false,
    subPrompt: false,
    originRow: config.row,
    originSubRow: config.subRow,
    originEof: mode.EOF,
  };

  // the shared command buffer holds the pattern; set_mlist points
  // the recall spot back at the newest entry
  cmdOpen(searchPrompt() ?? type, { history: search.history });
}

/**
 * Restores the position captured when the search prompt opened, like
 * less's incremental search undoing on cancel or pattern change.
 */
export function restoreSearchOrigin(input: {
  originRow: number,
  originSubRow: number,
  originEof: boolean,
}): void {
  config.row = input.originRow;
  config.subRow = input.originSubRow;
  mode.EOF = input.originEof;
}

/**
 * Searches while the pattern is being typed (--incsearch): each change
 * restarts from the original position; failures stay silent.
 *
 * @param content - Full content lines.
 */
export function incrementalSearch(
  content: string[],
  finder: SearchFinder | null = null
): void {
  const input = search.input;
  if (!input || input.type === '&') return;

  restoreSearchOrigin(input);

  const pattern = input.chars.join('');
  if (!pattern) return;

  const message = search.message;

  if (compile(pattern, input.noRegex, input.invert)) {
    search.subs = new Set(input.subs);
    const dir: 1 | -1 = input.type === '?' ? -1 : 1;
    const request: SearchRequest = {
      dir,
      count: input.count,
      fromStart: input.fromStart,
      wrap: input.wrap,
      afterTarget: false,
      pattern,
      incremental: true,
    };

    if (!finder?.(request)) {
      findMatch(content, dir, input.count, input.fromStart, input.wrap, false);
    }
  }

  // errors wait for RETURN, like less's incsearch staying quiet
  search.message = message;
}

/**
 * Feeds one keypress into the pattern being typed at the prompt.
 *
 * - CR submits, ^C cancels, backspace edits (and cancels on empty).
 * - While the pattern is empty, modifier keys toggle search flags like
 *   less (^N/!, ^E/*, ^F/@, ^K, ^R, ^S, ^W, ^L).
 * - Up/Down recall previous patterns starting with the typed text,
 *   like cmdbuf.c's cmd_updown; other escape sequences are ignored.
 *
 * @param key - Raw key input.
 * @returns `run` to execute, `cancel` when aborted, otherwise `pending`.
 */
export function searchInputKey(key: string): 'pending' | 'run' | 'cancel' {
  const input = search.input;
  if (!input) return 'cancel';

  if (input.subPrompt) {
    input.subPrompt = false;
    const n = key.charCodeAt(0) - 0x30;

    if (n >= 1 && n <= 5) {
      if (input.subs.has(n)) {
        input.subs.delete(n);
      } else {
        input.subs.add(n);
      }
    }

    cmdPrompt(searchPrompt() ?? input.type);
    return 'pending';
  }

  // keys inside a pending ESC combo go to the editor first, like
  // og's editchar collecting the sequence with getcc
  if (!cmd.prefix) {
    if (key === '\x0D' || key === '\x0A') return 'run';

    if (key === '\x03') {
      search.input = null;
      cmdClose();
      return 'cancel';
    }

    if (input.litNext) {
      // ^L latched: the next char is a literal pattern char
      input.litNext = false;
      cmdChar('\x16'); // EC_LITERAL
      const result = feedKey(input, key);
      cmdPrompt(searchPrompt() ?? input.type);
      return result;
    }

    if (
      !cmd.steps.length && !cmd.literal && handleModifier(input, key)
    ) {
      cmdPrompt(searchPrompt() ?? input.type);
      return 'pending';
    }
  }

  return feedKey(input, key);
}

/**
 * Feeds a key through the command buffer, replaying any chars a dead
 * escape sequence ungets, like og's ungetcc loop.
 */
function feedKey(
  input: SearchInput,
  key: string
): 'pending' | 'run' | 'cancel' {
  const result = cmdChar(key);
  input.chars = [...cmd.steps];

  if (result === 'quit') {
    search.input = null;
    cmdClose();
    return 'cancel';
  }

  for (let u = cmdUngot(); u !== null; u = cmdUngot()) {
    const replayed = searchInputKey(u);
    if (replayed !== 'pending') return replayed;
  }

  return 'pending';
}

/**
 * Builds the bottom-line prompt for the pattern being typed, mirroring
 * less's modifier prefixes (e.g. `Non-match &/`).
 *
 * @returns The prompt string, or null when no pattern is being typed.
 */
export function searchPrompt(): string | null {
  const input = search.input;
  if (!input) return null;

  if (input.subPrompt) return 'Sub-pattern (1-5):';

  let prompt = '';

  if (input.invert) prompt += 'Non-match ';
  if (input.fromStart) prompt += 'First-file ';
  if (input.pastEof) prompt += 'EOF-ignore ';
  if (input.keep) prompt += 'Keep-pos ';
  if (input.noRegex) prompt += 'Regex-off ';
  if (input.wrap) prompt += 'Wrap ';
  for (const n of [...input.subs].sort()) prompt += `Sub-${n} `;
  if (input.litNext) prompt += 'Lit ';

  prompt += input.type === '&' ? '&/' : input.type;

  return prompt + cmdDisplay();
}

// history autosave hook, registered by the pager to avoid a module
// cycle with histfile.ts
let autosaveHook: () => void = () => {};

/** Registers the --autosave history file writer. */
export function onAutosave(fn: () => void): void {
  autosaveHook = fn;
}

// histfile hooks, same cycle-avoiding registration: the entry
// recorder is og's cmdbuf.c:798 entry-modified bit (raised BEFORE
// the autosave attempt), the touch hook is cmd_accept's list flag
// (raised AFTER it - the attempt sees only earlier state)
let recordHook: (entry: string) => void = () => {};
let touchHook: () => void = () => {};

/** Registers the new-entry recorder. */
export function onHistRecord(fn: (entry: string) => void): void {
  recordHook = fn;
}

/** Registers the history modified-flag raiser (og's cmd_accept). */
export function onHistTouch(fn: () => void): void {
  touchHook = fn;
}

/**
 * Records an accepted pattern, like cmd_accept: empty and repeated
 * patterns stay out, the list caps at less's history size, and
 * --autosave writes the file right away.
 */
export function addHistory(pattern: string): void {
  if (!pattern) return;

  // --no-histdups drops older copies from anywhere in the list
  if (optNoHistDups()) {
    search.history = search.history.filter(entry => entry !== pattern);
  }

  const last = search.history[search.history.length - 1];
  const pushed = pattern !== last;

  if (pushed) {
    search.history.push(pattern);
    if (search.history.length > HISTORY_LIMIT) search.history.shift();
    recordHook(pattern);
  }

  if (optAutosaveAction('/')) autosaveHook();

  // og's cmd_accept raises the list modified flag only AFTER
  // cmd_addhist's autosave attempt: the first accept of a clean
  // session skips its own autosave unless the action already
  // dirtied the file (a far search jump's lastmark)
  touchHook();
}

function handleModifier(input: SearchInput, key: string): boolean {
  // search-only modifiers are literal pattern characters in a filter
  const searchOnly = (toggle: () => void): boolean => {
    if (input.type === '&') {
      if (key < '\x20') {
        cmdChar('\x16'); // EC_LITERAL
        cmdChar(key);
        input.chars = [...cmd.steps];
        return true;
      }

      return false;
    }

    toggle();
    return true;
  };

  switch (key) {
    case '\x05': // ^E
    case '*':
      return searchOnly(() => {
        input.pastEof = !input.pastEof;
        input.wrap = false;
      });

    case '\x06': // ^F
    case '@':
      return searchOnly(() => { input.fromStart = !input.fromStart; });

    case '\x0B': // ^K
      return searchOnly(() => { input.keep = !input.keep; });

    case '\x17': // ^W
      return searchOnly(() => {
        input.wrap = !input.wrap;
        if (input.wrap) input.pastEof = false;
      });

    case '\x12': // ^R
      input.noRegex = !input.noRegex;
      return true;

    case '\x0E': // ^N
    case '!':
      input.invert = !input.invert;
      return true;

    case '\x13': // ^S
      input.subPrompt = true;
      return true;

    case '\x0C': // ^L
      input.litNext = true;
      return true;
  }

  return false;
}

/**
 * Executes the typed `/` or `?` search: compiles the pattern and jumps to
 * the N-th matching line.
 *
 * - An empty pattern repeats the previous search in the typed direction.
 * - `^K` compiles and highlights without moving.
 */
export interface SearchRequest {
  dir: 1 | -1;
  count: number;
  fromStart: boolean;
  wrap: boolean;
  afterTarget: boolean;
  pattern: string;
  incremental?: boolean;
}

export type SearchFinder = (request: SearchRequest) => boolean;

export function execSearch(
  content: string[],
  finder: SearchFinder | null = null
): void {
  // og's exec_mca runs cmd_exec() before the search: the /pattern
  // command line clears and flushes ahead of a possibly long walk
  // (command.c:267); sync, since the search blocks the loop
  fs.writeSync(1, (optNoInit() && !mode.DUMB
    ? '\r'
    : `\x1b[${config.window};1H`) + CLEAR_LINE);

  const input = search.input;
  if (!input) return;
  search.input = null;
  cmdClose();

  const pattern = input.chars.join('');
  const dir: 1 | -1 = input.type === '?' ? -1 : 1;

  // og's cmd_accept runs at the TOP OF THE NEXT command iteration
  // (command.c:1517), i.e. after the search executed: its autosave
  // attempt sees the jump's lastmark dirtying the file
  try {
    if (pattern) {
      if (!compile(pattern, input.noRegex, input.invert)) return;
      search.subs = new Set(input.subs);

      // og erases the highlights on screen and then, under -G's
      // default, highlights what already matches BEFORE it searches
      // (search.c:2137 and :2147). Both go through repaint_hilite,
      // whose first act is "if (squished) repaint()" - which is how a
      // short first screen fills with tildes the moment a search
      // runs, whether or not the match moves the view
      if (optHiliteSearch() || optStatusCol()) unsquish();
    } else if (!search.regex) {
      search.message = 'No previous regular expression';
      return;
    } else if (optHiliteSearch() === 1 || optStatusCol()) {
      // the previous-pattern branch only erases (search.c:2115), so
      // it un-squishes under the narrower -g gate
      unsquish();
    }

    // every search unhides highlighting, like less resetting
    // hide_hilite
    search.highlight = true;
    search.lastDir = dir;

    if (input.keep) return;

    // an empty pattern repeats the previous search past the current
    // position
    const request: SearchRequest = {
      dir,
      count: input.count,
      fromStart: input.fromStart,
      wrap: input.wrap,
      afterTarget: !pattern,
      pattern: pattern || compiledPattern,
    };

    if (!finder?.(request)) {
      findMatch(content, dir, input.count, input.fromStart, input.wrap,
        !pattern);
    }
  } finally {
    addHistory(pattern);
  }
}

type LineFilter = (line: string) => boolean;

/**
 * Executes the typed `&` filter pattern.
 *
 * - Filters stack like less's filter list: lines must match all of them.
 * - Filters are independent of the search pattern and its highlighting.
 *
 * @returns A line matcher to filter content with, `null` when the pattern is
 *          empty (remove all filters), or `undefined` when invalid.
 */
export function execFilter(): LineFilter | null | undefined {
  const input = search.input;
  if (!input) return undefined;
  search.input = null;
  cmdClose();

  const pattern = input.chars.join('');

  addHistory(pattern);

  if (!pattern) {
    search.filters = [];
    return null;
  }

  try {
    const source = input.noRegex ? escapeRegExp(pattern) : pattern;

    search.filters.push({
      regex: new RegExp(source, searchCaseFlags(pattern)),
      invert: input.invert,
      subs: new Set(input.subs),
    });
  } catch {
    search.message = 'Invalid pattern';
    return undefined;
  }

  return (line: string): boolean => {
    const stripped = stripStyles(line);
    return search.filters.every(
      filter => testRegex(filter.regex, stripped, filter.subs) !== filter.invert
    );
  };
}

/**
 * Repeats the previous search.
 *
 * @param content - Full content lines.
 * @param count - N-th occurrence to find.
 * @param reverse - Whether to search opposite to the previous direction.
 */
export function repeatSearch(
  content: string[],
  count: number,
  reverse: boolean,
  finder: SearchFinder | null = null
): void {
  if (!search.regex) {
    search.message = 'No previous regular expression';
    return;
  }

  search.highlight = true;

  const dir: 1 | -1 = reverse
    ? (search.lastDir === 1 ? -1 : 1)
    : search.lastDir;

  const request: SearchRequest = {
    dir,
    count,
    fromStart: false,
    wrap: false,
    afterTarget: true,
    pattern: compiledPattern,
  };

  if (!finder?.(request)) {
    findMatch(content, dir, count, false, false, true);
  }
}

/**
 * Toggles search match highlighting (ESC-u).
 *
 * - Reports an error when there is no pattern to highlight, like less.
 */
export function toggleHighlight(): void {
  if (!search.regex) {
    search.message = 'No previous regular expression';
    return;
  }

  search.highlight = !search.highlight;
}

/**
 * Clears search highlighting by forgetting the pattern entirely (ESC-U).
 *
 * - Mirrors less's `clear_pattern`: afterwards `n` has nothing to repeat.
 */
export function clearHighlight(): void {
  search.regex = null;
  globalRegex = null;
  search.subs = new Set();
  search.highlight = true;
  lastMatchRow = -1;
}

/**
 * Wraps search matches in a line with inverse-video codes.
 *
 * - Matches are found on the ANSI-stripped text, then mapped back onto the
 *   raw line so existing styles are preserved.
 * - `-G` disables highlighting; `-g` highlights only the row the last
 *   search landed on, like less's hilite_search states.
 *
 * @param line - The raw content line.
 * @param row - The content row, for the -g single-match mode.
 * @returns The line with matches highlighted, or unchanged.
 */
/** The subsearch color kind for ^S group n (AT_COLOR_SUBSEARCH). */
const subColorKind = (n: number): ColorKind =>
  `sub${Math.min(Math.max(n, 1), 5)}` as ColorKind;

/**
 * Pushes a match's highlight ranges: the whole match takes the search
 * color, while capture groups 1-5 carve out their own subsearch
 * colors, like og assigning AT_COLOR_SUBSEARCH to group matches.
 */
function pushMatchRanges(
  ranges: [number, number, ColorKind][],
  match: RegExpExecArray
): void {
  const start = match.index;
  const end = match.index + match[0].length;
  const groups: [number, number, ColorKind][] = [];

  if (match.indices) {
    for (let n = 1; n <= 5 && n < match.indices.length; n++) {
      const span = match.indices[n];

      if (span && span[1] > span[0]) {
        groups.push([span[0], span[1], subColorKind(n)]);
      }
    }
  }

  if (!groups.length) {
    ranges.push([start, end, 'search']);
    return;
  }

  // split the match at every group boundary; the innermost (last)
  // covering group colors each piece
  const points = [start, end];
  for (const [gs, ge] of groups) points.push(gs, ge);
  points.sort((a, b) => a - b);

  for (let i = 0; i + 1 < points.length; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segEnd <= segStart) continue;

    let kind: ColorKind = 'search';

    for (const [gs, ge, gKind] of groups) {
      if (gs <= segStart && segEnd <= ge) kind = gKind;
    }

    ranges.push([segStart, segEnd, kind]);
  }
}

export function highlightLine(line: string, row: number = -1): string {
  if (!globalRegex || !search.regex || !search.highlight || search.invert) {
    return line;
  }

  // og's hilite list holds only lines a search actually matched:
  // under --no-search-header-lines the start adjust keeps the first
  // header_lines FILE lines out of it (search.c:1541, absolute like
  // the adjust), so they never highlight - pinned overlay included
  if (optNoSearchHeaders().lines && row >= 0 &&
      row < optHeader().lines) {
    return line;
  }

  const hilite = optHiliteSearch();
  if (hilite === 0) return line;
  if (hilite === 1 && row !== lastMatchRow) return line;

  if (!line) return line;

  // tokenize into text runs and ANSI codes, tracking stripped offsets
  const tokens: { code: string; text: string; start: number }[] = [];
  let strippedLength = 0;

  const pushText = (text: string): void => {
    if (!text) return;
    tokens.push({ code: '', text, start: strippedLength });
    strippedLength += text.length;
  };

  // the split has to agree with cvt_text, or the offsets a match
  // reports would not be the offsets this line hilites: an ABORTED
  // sequence is one og drops whole, so it cannot be left sitting
  // inside a text run (github265's "y he" spans ESC[01;31m ESC[K)
  let i = 0;
  let run = 0;

  while (i < line.length) {
    if (line[i] !== '\x1b') {
      i++;
      continue;
    }

    const end = ansiRunEnd(line, i);
    pushText(line.slice(run, i));
    tokens.push({ code: line.slice(i, end), text: '', start: strippedLength });
    i = end;
    run = i;
  }

  pushText(line.slice(run));

  const stripped = tokens.map(token => token.text).join('');

  // og matches the column-skipped text and hilites at linepos +
  // skip_bytes (search_range's skip_columns): with
  // --no-search-header-columns active, only matches past the
  // header columns exist to highlight
  let matchable = stripped;
  let base = 0;

  if (optNoSearchHeaders().cols && optHeader().cols > 0) {
    matchable = skipColumns(stripped, optHeader().cols);
    base = stripped.length - matchable.length;
  }

  const ranges: [number, number, ColorKind][] = [];
  globalRegex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = globalRegex.exec(matchable)) !== null) {
    if (search.subs.size && match.indices) {
      for (const n of search.subs) {
        const span = match.indices[n];

        if (span && span[1] > span[0]) {
          ranges.push([span[0], span[1], subColorKind(n)]);
        }
      }
    } else if (match[0]) {
      pushMatchRanges(ranges, match);
    }

    if (match.index === globalRegex.lastIndex) globalRegex.lastIndex++;
  }

  if (!ranges.length) return line;

  // shift the skipped-text offsets back into the full line
  if (base) {
    for (const range of ranges) {
      range[0] += base;
      range[1] += base;
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);

  const out: string[] = [];
  let r = 0;

  // the sequences in force at this point in the line: og carries an
  // attribute per CHARACTER, so a hilite that ends mid-colour leaves
  // the file's own bold or colour still running underneath. Splicing
  // standout into the byte stream loses that, because ending it
  // resets everything - so the state goes back in behind it.
  let active = '';

  for (const token of tokens) {
    if (token.code) {
      out.push(token.code);
      active += token.code;
      continue;
    }

    const { text, start } = token;
    let pos = 0;

    while (pos < text.length) {
      const absolute = start + pos;

      while (r < ranges.length && ranges[r][1] <= absolute) r++;

      if (r === ranges.length || ranges[r][0] >= start + text.length) {
        out.push(text.slice(pos));
        break;
      }

      const [rangeStart, rangeEnd] = ranges[r];

      if (absolute < rangeStart) {
        out.push(text.slice(pos, rangeStart - start));
        pos = rangeStart - start;
        continue;
      }

      const end = Math.min(rangeEnd - start, text.length);
      out.push(colored(
        ranges[r][2], text.slice(pos, end), INVERSE_ON, INVERSE_OFF
      ));

      // only when styled text actually follows: a hilite that runs to
      // the end of its run is followed by the file's own next code
      // anyway, and og emits no transition it does not need
      if (active && end < text.length) out.push(active);
      pos = end;
    }
  }

  return out.join('');
}

// helpers

const escapeRegExp = (pattern: string): string =>
  pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const UPPERCASE_REGEX = /\p{Lu}/u;

// smart case: -i ignores case unless the pattern contains uppercase
export const searchCaseFlags = (pattern: string): string =>
  search.caseless === 2 ||
  (search.caseless === 1 && !UPPERCASE_REGEX.test(pattern))
    ? 'i'
    : '';

function compile(pattern: string, literal: boolean, invert: boolean): boolean {
  try {
    const source = literal ? escapeRegExp(pattern) : pattern;
    const flags = searchCaseFlags(pattern);
    search.regex = new RegExp(source, flags);
    globalRegex = new RegExp(source, flags + 'dg');
  } catch {
    search.message = 'Invalid pattern';
    return false;
  }

  compiledPattern = pattern;
  compiledLiteral = literal;
  search.invert = invert;
  search.highlight = true;
  return true;
}

/**
 * Removes escape sequences the way cvt_text's CVT_ANSI does: og walks
 * ansi_step and drops everything the run consumed, so a sequence that
 * ABORTS (ESC[K, ESC(B) goes too, not just its valid prefix. Matching
 * a valid-sequence pattern instead would leave those bytes sitting
 * inside the text a search runs against - github265's bug, where
 * "y he" fails to find "Why <ESC>[01;31m<ESC>[Khello".
 */
export function stripStyles(line: string): string {
  if (!line.includes('\x1b')) return line;

  let out = '';

  for (let i = 0; i < line.length; ) {
    if (line[i] === '\x1b') {
      i = ansiRunEnd(line, i);
      continue;
    }

    out += line[i++];
  }

  return out;
}

/**
 * Converts a candidate line like matchesLine and maps each converted
 * index back to its raw string index, like og's cvt chpos array.
 */
function convertWithMap(raw: string): { text: string; map: number[] } {
  const ops = cvtOps();
  const spans: Array<[number, number]> = [];

  if (ops.ansi) {
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== '\x1b') continue;
      const end = ansiRunEnd(raw, i);
      spans.push([i, end]);
      i = end - 1;
    }
  }

  const out: Array<{ ch: string; at: number }> = [];
  let s = 0;

  for (let i = 0; i < raw.length; i++) {
    if (s < spans.length && i === spans[s][0]) {
      i = spans[s][1] - 1;
      s++;
      continue;
    }

    const ch = raw[i];

    // overstrikes collapse like cvt_text's CVT_BS
    if (ops.bs && ch === '\x08' && out.length &&
      out[out.length - 1].ch !== '\x08') {
      out.pop();
      continue;
    }

    out.push({ ch, at: i });
  }

  // CVT_CRLF: a trailing carriage return drops
  if (ops.crlf && out.length && out[out.length - 1].ch === '\r') {
    out.pop();
  }

  return { text: out.map(o => o.ch).join(''), map: out.map(o => o.at) };
}

/**
 * Locates the first match's end in a candidate line, like og's ep[0]
 * after match_pattern.
 *
 * @returns The end as a converted-text offset (og's end_off) and the
 *          raw index it maps to (og's chpos[end_off]), or null when
 *          there is no real match (inverted searches have no ep).
 */
function matchEnd(
  candidate: string
): { conv: number; raw: number } | null {
  const regex = search.regex;
  if (!regex || search.invert) return null;

  let { text, map } = convertWithMap(candidate);

  if (optNoSearchHeaders().cols && optHeader().cols > 0) {
    const kept = skipColumns(text, optHeader().cols);
    map = map.slice(text.length - kept.length);
    text = kept;
  }

  const m = regex.exec(text);
  if (!m) return null;

  // og 707 never fills chpos past the last char (cvt_text's trailing
  // assignment sits behind a FIXME comment) and the calloc'd array
  // reads 0 there: a match ending exactly at the line end computes
  // tpos = linepos and never bottom-jumps
  const conv = m.index + m[0].length;
  return { conv, raw: map[conv] ?? 0 };
}

function testRegex(regex: RegExp, text: string, subs: Set<number>): boolean {
  if (!subs.size) return regex.test(text);

  const match = regex.exec(text);
  if (!match) return false;

  for (const n of subs) {
    if (match[n] === undefined) return false;
  }

  return true;
}

/**
 * og's get_cvt_ops (search.c:230): which conversions apply to search
 * candidates under the current display modes. The CRLF condition
 * genuinely consults proc_BACKSPACE, quirky but og's own.
 */
function cvtOps(): { bs: boolean; crlf: boolean; ansi: boolean } {
  const pb = optProcBackspace();

  return {
    bs: pb === 1 || (optBsMode() === 0 && pb === 0),
    crlf: optProcReturn() === 1 || (optBsMode() !== 2 && pb === 0),
    ansi: optCtldisp() === 2,
  };
}

export function matchesSearchLine(line: string): boolean {
  const regex = search.regex;
  if (!regex) return false;

  const ops = cvtOps();
  let text = ops.ansi ? stripStyles(line) : line;

  // like cvt_text: overstrikes collapse (CVT_BS) and a trailing
  // carriage return drops (CVT_CRLF) before matching, each under
  // its own display-mode gate
  if (ops.bs) {
    /* eslint-disable no-control-regex */
    while (/[^\x08]\x08/.test(text)) {
      text = text.replace(/[^\x08]\x08/g, '');
    }
    /* eslint-enable no-control-regex */
  }

  if (ops.crlf && text.endsWith('\r')) text = text.slice(0, -1);

  // --no-search-header-columns cuts the pinned columns off before
  // matching, like search.c's skip_columns
  if (optNoSearchHeaders().cols && optHeader().cols > 0) {
    text = skipColumns(text, optHeader().cols);
  }

  return testRegex(regex, text, search.subs) !== search.invert;
}

/**
 * Strips the first `cols` visual columns off a plain-text line.
 */
function skipColumns(text: string, cols: number): string {
  if (isAsciiText(text)) return text.slice(cols);

  const chars = [...text];
  let width = 0;
  let i = 0;

  while (i < chars.length && width < cols) {
    width += strWidth(chars[i]);
    i++;
  }

  return chars.slice(i).join('');
}

const isAsciiText = (text: string): boolean =>
  // eslint-disable-next-line no-control-regex
  /^[\x00-\x7F]*$/.test(text);

/**
 * og's search_range start adjust (search.c:1541): with
 * --no-search-header-lines a start within the first header_lines
 * lines of the FILE (ABSOLUTE line numbers - og's own quirk, blind
 * to where the header actually starts) moves past them. That is the
 * ONLY exclusion: og never skips header lines mid-scan, so backward
 * and wrapped searches still run INTO the header and can match it.
 */
function noSearchStart(start: ScreenPos): ScreenPos {
  if (!optNoSearchHeaders().lines) return start;

  const lines = optHeader().lines;
  if (lines === 0 || start.row >= lines) return start;

  return { row: lines, sub: 0 };
}

/**
 * Finds the N-th match and jumps to it.
 *
 * - The start is a screen position like less's search_pos: the
 *   default (state 2) includes the whole displayed screen for fresh
 *   searches, `-a` skips the screen entirely, and state 0 starts
 *   fresh searches at the -j target line like repeats.
 * - Repeats (`afterTarget`) start just past the target line.
 * - A start falling mid-line (a wrapped line straddling the screen
 *   edge) bounds the first candidate: forward searches read the
 *   remainder and land on its sub-row, backward searches the head.
 */
function findMatch(
  content: string[],
  dir: 1 | -1,
  count: number,
  fromStart: boolean,
  wrap: boolean,
  afterTarget: boolean
): void {
  let first: number;
  let firstOffset = 0;
  let firstSub = 0;

  if (fromStart) {
    // the start adjust covers ch_zero starts too (search.c:1541)
    first = dir > 0 ? noSearchStart({ row: 0, sub: 0 }).row
      : content.length - 1;
  } else {
    let start = searchStartPos(content, dir, afterTarget);

    if (start === null) {
      // og's search_pos found no place to start from
      search.message = 'Nothing to search';
      return;
    }

    start = noSearchStart(start);

    if (dir > 0) {
      first = start.row;
      if (start.sub > 0) {
        firstSub = start.sub;
        firstOffset = subRowStart(content[first], start.sub);
      }
    } else if (start.sub > 0) {
      // backward candidates lie strictly before the position: the
      // head of a mid-line row first, then whole lines above it
      first = start.row;
      firstOffset = subRowStart(content[first], start.sub);
    } else {
      first = start.row - 1;
    }
  }

  const state = { remaining: count };
  const main = scanRange(content, first, dir, null, state, firstOffset);

  if (main === 'stop') return;

  if (main !== 'miss') {
    const bottomSub =
      lastLineSub(content, main, dir, first, firstOffset, firstSub);

    if (bottomSub !== null) {
      jumpBottom(content, main, bottomSub);
    } else {
      jumpTo(content, main, main === first ? firstSub : 0);
    }

    return;
  }

  if (wrap) {
    const start = dir > 0 ? 0 : content.length - 1;
    // a partial first row leaves its other part to the wrapped scan,
    // which reads the boundary line whole like og's endpos check
    const until = firstOffset > 0 ? first + dir : first;
    const wrapped = scanRange(content, start, dir, until, state);

    if (wrapped === 'stop') return;

    if (wrapped !== 'miss') {
      // a forward search that wrapped read through EOF first, so a
      // pipe's length becomes known, like og's ch
      if (dir > 0) revealSize();

      const wrapSub = lastLineSub(content, wrapped, dir, start, 0, 0);

      if (wrapSub !== null) {
        jumpBottom(content, wrapped, wrapSub);
      } else {
        jumpTo(content, wrapped);
      }

      // ^W wrap reports where the search resumed, like og's
      // search_wrapped message
      search.message = dir > 0
        ? 'Search hit bottom; continuing at top'
        : 'Search hit top; continuing at bottom';
      return;
    }
  }

  // a missed forward search scanned to the end of the input, which
  // teaches og a pipe's length
  if (dir > 0) revealSize();

  // og shows the pattern in the miss message (v693); control chars
  // print in display form (ESC, ^X) like og's message line
  search.message = compiledPattern
    ? `Pattern not found: ${displayText(compiledPattern)}`
    : 'Pattern not found';
}

/** Formats embedded control characters like og's prchar. */
const displayText = (text: string): string =>
  Array.from(text, stepText).join('');

// the reusable guard context; its step slot changes per run
let guardContext: { step: () => void } | null = null;
let guardScript: vm.Script | null = null;

/**
 * Drives a slice function inside vm timeouts: V8's backtracking
 * regexes can hang forever on a catastrophic pattern (og's POSIX
 * engine does not blow up), and terminating a vm script is the only
 * way to stop a match mid-flight. Slices self-limit to ~100ms, so the
 * timeout only fires when one match call hangs.
 *
 * @param slice - Scans for a while; true when the work is finished.
 * @returns How the run ended: the guard tripped (`complex`) or the
 *          user interrupted (`stop`).
 */
function guardedSlices(slice: () => boolean): 'done' | 'stop' | 'complex' {
  if (!guardContext || !guardScript) {
    guardContext = vm.createContext({ step: () => {} }) as
      { step: () => void };
    guardScript = new vm.Script('step()');
  }

  let finished = false;
  guardContext.step = () => { finished = slice(); };

  try {
    for (;;) {
      try {
        guardScript.runInContext(
          guardContext as vm.Context, { timeout: 1000 }
        );
      } catch {
        return 'complex';
      }

      if (finished) return 'done';

      // ctrl-C and the --intr char abort between slices, like
      // search_range's ABORT_SIGS checks
      if (searchInterrupted()) return 'stop';
    }
  } finally {
    guardContext.step = () => {};
  }
}

/**
 * Scans a row range for the remaining matches in guarded slices.
 *
 * @param until - Exclusive stop row for a wrapped scan, or null.
 * @param fromOffset - Raw string index bounding the partial first
 *          row: forward scans read from it, backward scans up to it,
 *          like og reading a raw line at a mid-line start position.
 * @returns The matching row, `miss`, or `stop` after an interrupt or
 *          a dropped catastrophic pattern.
 */
function scanRange(
  content: string[],
  from: number,
  dir: 1 | -1,
  until: number | null,
  state: { remaining: number },
  fromOffset: number = 0
): number | 'miss' | 'stop' {
  let row = from;
  let hit = -1;

  const outcome = guardedSlices(() => {
    const deadline = Date.now() + 100;
    let steps = 0;

    while (row >= 0 && row < content.length && row !== until) {
      const line = row === from && fromOffset > 0
        ? (dir > 0
          ? content[row].slice(fromOffset)
          : content[row].slice(0, fromOffset))
        : content[row];

      if (matchesSearchLine(line) && --state.remaining === 0) {
        hit = row;
        return true;
      }

      row += dir;

      if ((++steps & 0x3FF) === 0 && Date.now() > deadline) return false;
    }

    return true;
  });

  if (outcome === 'complex') {
    dropPattern();
    return 'stop';
  }

  if (outcome === 'stop') return 'stop';
  return hit >= 0 ? hit : 'miss';
}

/**
 * Runs the normal guarded matcher over one bounded source batch. The
 * remaining count is shared across batches, allowing a file input to scan
 * by byte position without retaining the traversed lines.
 */
export function scanSearchBatch(
  lines: string[],
  state: { remaining: number }
): number | 'miss' | 'stop' {
  return scanRange(lines, 0, 1, null, state);
}

/** Records the local row a source-backed search landed on for -g. */
export function recordSearchMatch(row: number): void {
  lastMatchRow = row;
}

/**
 * Drops a pattern that hung the regex engine, so highlighting can
 * never run it again.
 */
function dropPattern(): void {
  search.regex = null;
  search.highlight = false;
  search.message = 'Pattern too complex';
}

/**
 * Applies a `&` display filter in the same guarded slices as a search.
 *
 * @param lines - Full content lines.
 * @param filter - The combined filter matcher.
 * @returns The kept lines, or null when the filter must be dropped
 *          (catastrophic pattern) or the user interrupted.
 */
export function filterLines(
  lines: string[],
  filter: (line: string) => boolean
): string[] | null {
  const kept: string[] = [];
  let at = 0;

  const outcome = guardedSlices(() => {
    const deadline = Date.now() + 100;
    let steps = 0;

    while (at < lines.length) {
      if (filter(lines[at])) kept.push(lines[at]);
      at++;

      if ((++steps & 0x3FF) === 0 && Date.now() > deadline) return false;
    }

    return true;
  });

  if (outcome === 'complex') {
    search.filters = [];
    search.message = 'Pattern too complex';
    return null;
  }

  if (outcome === 'stop') return null;
  return kept;
}

/**
 * The guarded filter result for each input row. File-backed inputs use the
 * mask to retain byte positions while sharing the regular filter engine.
 */
export function filterLineMask(
  lines: string[],
  filter: (line: string) => boolean
): boolean[] | null {
  const mask = new Array<boolean>(lines.length);
  let at = 0;

  const outcome = guardedSlices(() => {
    const deadline = Date.now() + 100;
    let steps = 0;

    while (at < lines.length) {
      mask[at] = filter(lines[at]);
      at++;

      if ((++steps & 0x3FF) === 0 && Date.now() > deadline) return false;
    }

    return true;
  });

  if (outcome === 'complex') {
    search.filters = [];
    search.message = 'Pattern too complex';
    return null;
  }

  return outcome === 'stop' ? null : mask;
}

// the last synchronous interrupt poll, at most one per ~100ms of scan
let lastInterruptPoll = 0;

/**
 * Polls the terminal in the middle of a long synchronous search, like
 * og's read layer watching for the interrupt: while a search runs the
 * event loop cannot deliver keys, so the raw tty is read directly.
 * Ctrl-C goes back on the stream so -K can still quit at the prompt;
 * other typed keys queue as normal input.
 *
 * @returns True when the search should abort.
 */
export function searchInterrupted(): boolean {
  // piped input reads keys from /dev/tty: poll the keyboard's fd,
  // not fd 0 (og's check_poll watches the tty, whatever stdin is)
  const kb = keyboard();
  if (!kb.isTTY) return false;

  const now = Date.now();
  if (now - lastInterruptPoll < 100) return false;
  lastInterruptPoll = now;

  // the poll must NEVER block: the keyboard fd's blocking state is
  // not ours to trust (fs.openSync default, or fd 0 as the shell
  // left it) — a blocking read here freezes the scan until a key
  // arrives, so peek through the dedicated O_NONBLOCK tty fd
  const fd = keyboardPollFd();
  if (fd === null) return false;

  const data = Buffer.alloc(64);
  let n: number;

  try {
    n = fs.readSync(fd, data, 0, data.length, null);
  } catch {
    // EAGAIN: nothing typed
    return false;
  }

  if (n <= 0) return false;

  const text = data.subarray(0, n).toString();

  if (text.includes('\x03')) {
    // og's u_interrupt rings at every ^C (signal.c lbell), even
    // with the event loop blocked mid-scan
    fs.writeSync(1, '\x07');
    // queued so -K can still quit; an abort's getcc_clear drops it
    pushUngot(Buffer.from('\x03'));
    return true;
  }

  if (text.includes(optIntrChar())) return true;

  // og's check_poll ungets ordinary keys for the command loop —
  // never back through the stream, whose flowing-mode unshift would
  // re-enter the key handler in the middle of the scan
  pushUngot(Buffer.from(data.subarray(0, n)));
  return false;
}

interface ScreenPos { row: number; sub: number }

/**
 * The content position displayed at a screen row, like position():
 * row `k` counted from the top of the window, the end-of-file
 * position just past the last line (og's table entry pushed after
 * the paint loop), or null beyond that on a short screen.
 */
function screenPos(content: string[], k: number): ScreenPos | null {
  // blank rows above the top of the file hold no position
  if (k < config.blankTop) return null;
  k -= config.blankTop;

  if (chopLine() || config.col) {
    const row = config.row + k;
    return row > content.length ? null : { row, sub: 0 };
  }

  let row = config.row;
  let sub = config.subRow;

  for (let i = 0; i < k; i++) {
    if (row >= content.length) return null;

    if (sub < maxSubRow(content[row])) {
      sub++;
    } else {
      row++;
      sub = 0;
    }
  }

  return { row, sub };
}

/**
 * Where a search range begins, like search_pos: a screen position
 * resolved to its content row and sub-row.
 *
 * @returns The start, or null when there is nothing to search from.
 */
function searchStartPos(
  content: string[],
  dir: 1 | -1,
  afterTarget: boolean
): ScreenPos | null {
  let k: number;
  let addOne = false;

  if (optHowSearch() === 1) {
    // -a: the search does not include the current screen
    k = dir > 0 ? config.window - 1 : 0;
  } else if (optHowSearch() === 2 && !afterTarget) {
    // the default includes all of the displayed screen
    k = dir > 0 ? 0 : config.window - 1;
  } else {
    // state 0 and repeats start at the -j target line
    k = jumpSindex();
    if (dir > 0) addOne = true;
  }

  let p = screenPos(content, k);

  if (p && addOne) {
    // og's add_one reads past the whole target line (forw_raw_line)
    p = p.row < content.length ? { row: p.row + 1, sub: 0 } : null;
  }

  // "look around for a plausible starting place": og walks the
  // screen rows toward the search direction while the row is empty
  while (p === null) {
    k += dir;
    if (k < 0 || k >= config.window) return null;
    p = screenPos(content, k);
  }

  return p;
}

/** og's repaint_hilite: a squished short first screen repaints in
 *  full - tildes past EOF included - before anything is highlighted
 *  (search.c:281). */
function unsquish(): void {
  if (mode.INIT) mode.INIT = false;
}

function jumpTo(content: string[], row: number, sub: number = 0): void {
  unsquish();

  lastMatchRow = row;

  // og skips the jump when the match already sits at the -j target
  // screen row (search.c: pos != opos), with no bell
  const opos = screenPos(content, jumpSindex());

  if (!opos || opos.row !== row || opos.sub !== sub) {
    // matches land on the -j target line, like search calling
    // jump_loc
    jumpLoc(content, row, sub, jumpSindex());
  }

  shiftVisible(content, row);
}

/**
 * og's long-line rule (search_range's plastlinepos): when a match in
 * a wrapped line ends at least a quarter screenful into the candidate
 * (`end_off >= swidth*sheight/4`) and its sub-row falls a screenful
 * or more below the candidate's start (get_lastlinepos), the jump
 * shows that sub-row on the bottom line instead.
 *
 * @returns The sub-row to land on the bottom line, or null.
 */
function lastLineSub(
  content: string[],
  row: number,
  dir: 1 | -1,
  fromRow: number,
  fromOffset: number,
  fromSub: number
): number | null {
  // og computes lastlinepos only when not chopping (the chop branch
  // shifts horizontally instead)
  if (chopLine() || config.col) return null;

  const partial = row === fromRow && fromOffset > 0;
  const candidate = partial
    ? (dir > 0
      ? content[row].slice(fromOffset)
      : content[row].slice(0, fromOffset))
    : content[row];

  const end = matchEnd(candidate);
  if (end === null) return null;

  const sheight = config.window - jumpSindex();

  if (end.conv < Math.floor(config.screenWidth * sheight / 4)) {
    return null;
  }

  const base = partial && dir > 0 ? fromOffset : 0;
  const startSub = partial && dir > 0 ? fromSub : 0;
  const endSub = subRowOfIndex(content[row], base + end.raw);

  return endSub - startSub >= sheight ? endSub : null;
}

/**
 * Lands a long-line match with its final sub-row on the bottom line,
 * like jump_loc(lastlinepos, BOTTOM).
 */
function jumpBottom(content: string[], row: number, sub: number): void {
  unsquish();

  lastMatchRow = row;

  jumpLoc(content, row, sub, config.window - 2);
  shiftVisible(content, row);
}

/**
 * Shifts the screen horizontally so the match is visible, like
 * search.c's shift_visible: an off-screen match lands --match-shift
 * columns from the left edge.
 */
function shiftVisible(content: string[], row: number): void {
  if (!chopLine() || !search.regex || search.invert) return;

  const text = stripStyles(content[row]);
  const match = search.regex.exec(text);
  if (!match) return;

  const startCol = strWidth(text.slice(0, match.index));
  const endCol = startCol + strWidth(match[0]);
  // the marker column only exists while --rscroll is enabled
  // (search.c:641: sc_width - (rscroll_char ? 1 : 0))
  const swidth = config.screenWidth - (optRscroll() ? 1 : 0);
  let newCol: number;

  if (endCol < swidth) {
    // the whole match fits the unshifted screen
    newCol = 0;
  } else if (startCol > config.col && endCol < config.col + swidth) {
    // already visible; leave the shift unchanged
    newCol = config.col;
  } else {
    const eolCol = strWidth(text) - swidth;

    newCol = startCol >= eolCol
      ? eolCol
      : startCol < optMatchShift() ? 0 : startCol - optMatchShift();
  }

  config.col = Math.max(newCol, 0);
}

/**
 * Whether a content line matches the current search pattern, for the
 * -J status column marker.
 *
 * @param line - The raw content line.
 */
export function lineMatches(line: string): boolean {
  if (!search.regex || !search.highlight) return false;
  return matchesSearchLine(line);
}

/**
 * The -J status column search char, like og's init_status_col: `*`
 * for a match in the displayed part of the line, `<`/`>` for matches
 * chopped off before/after the visible columns, `=` for both sides.
 * Hidden highlights (ESC-u) and -G0 still mark the column, like og's
 * is_hilited_attr status-column path ignoring hide_hilite; -g marks
 * only the last search's match line.
 *
 * @param line - The raw content line.
 * @param row - The content row, for the -g current-match gate.
 */
export function statusColChar(line: string, row: number): string {
  if (!search.regex || !globalRegex || search.invert) return '';
  if (optHiliteSearch() === 1 && row !== lastMatchRow) return '';

  let text = stripStyles(line);

  // the same cvt_text as matching: overstrikes collapse, CR drops
  /* eslint-disable no-control-regex */
  while (/[^\x08]\x08/.test(text)) {
    text = text.replace(/[^\x08]\x08/g, '');
  }
  /* eslint-enable no-control-regex */
  if (text.endsWith('\r')) text = text.slice(0, -1);

  const ranges: { start: number, end: number }[] = [];
  globalRegex.lastIndex = 0;

  for (let m = globalRegex.exec(text); m; m = globalRegex.exec(text)) {
    if (m[0]) ranges.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === globalRegex.lastIndex) globalRegex.lastIndex++;
  }

  if (!ranges.length) return '';

  // wrapped lines display every part, so a match is always visible
  if (!chopLine() && !config.col) return '*';

  // og compares hilite positions against the displayed range; char
  // indexes stand in for columns here
  const left = config.col;
  const right = config.col + config.screenWidth;
  const before = ranges.some(r => r.start < left);
  const after = ranges.some(r => r.end > right);

  if (before && after) return '=';
  if (before) return '<';
  if (after) return '>';
  return '*';
}
