import fs from 'fs';
import vm from 'vm';

import { strWidth } from 'char-width';

import { config, mode } from "../config";

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

import { maxSubRow, } from "../helpers";

import { jumpLoc } from "./jumping";

import {
  jumpSindex,
  optHowSearch,
  optHiliteSearch,
  optNoHistDups,
  optHeader,
  optNoSearchHeaders,
  optDefSearchType,
  optAutosaveAction,
  optMatchShift,
  optIntrChar
} from "../options";

import { colored, ColorKind } from "./color";

import {
  STYLE_REGEX,
  STYLE_REGEX_G,
  INVERSE_ON,
  INVERSE_OFF
} from "../constants";

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
export function incrementalSearch(content: string[]): void {
  const input = search.input;
  if (!input || input.type === '&') return;

  restoreSearchOrigin(input);

  const pattern = input.chars.join('');
  if (!pattern) return;

  const message = search.message;

  if (compile(pattern, input.noRegex, input.invert)) {
    search.subs = new Set(input.subs);
    const dir: 1 | -1 = input.type === '?' ? -1 : 1;
    findMatch(content, dir, input.count, input.fromStart, input.wrap, false);
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

/**
 * Records an accepted pattern, like cmd_accept: empty and repeated
 * patterns stay out, the list caps at less's history size, and
 * --autosave writes the file right away.
 */
function addHistory(pattern: string): void {
  if (!pattern) return;

  // --no-histdups drops older copies from anywhere in the list
  if (optNoHistDups()) {
    search.history = search.history.filter(entry => entry !== pattern);
  }

  const last = search.history[search.history.length - 1];

  if (pattern !== last) {
    search.history.push(pattern);
    if (search.history.length > HISTORY_LIMIT) search.history.shift();
  }

  if (optAutosaveAction('/')) autosaveHook();
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
export function execSearch(content: string[]): void {
  const input = search.input;
  if (!input) return;
  search.input = null;
  cmdClose();

  const pattern = input.chars.join('');
  const dir: 1 | -1 = input.type === '?' ? -1 : 1;

  addHistory(pattern);

  if (pattern) {
    if (!compile(pattern, input.noRegex, input.invert)) return;
    search.subs = new Set(input.subs);
  } else if (!search.regex) {
    search.message = 'No previous regular expression';
    return;
  }

  // every search unhides highlighting, like less resetting hide_hilite
  search.highlight = true;
  search.lastDir = dir;

  if (input.keep) return;

  // an empty pattern repeats the previous search past the current position
  findMatch(content, dir, input.count, input.fromStart, input.wrap, !pattern);
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
      regex: new RegExp(source, caseFlags(pattern)),
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
  reverse: boolean
): void {
  if (!search.regex) {
    search.message = 'No previous regular expression';
    return;
  }

  search.highlight = true;

  const dir: 1 | -1 = reverse
    ? (search.lastDir === 1 ? -1 : 1)
    : search.lastDir;

  findMatch(content, dir, count, false, false, true);
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

  STYLE_REGEX_G.lastIndex = 0;
  let i = 0;
  let ansi: RegExpExecArray | null;

  while ((ansi = STYLE_REGEX_G.exec(line)) !== null) {
    pushText(line.slice(i, ansi.index));
    tokens.push({ code: ansi[0], text: '', start: strippedLength });
    i = STYLE_REGEX_G.lastIndex;
  }

  pushText(line.slice(i));

  const stripped = tokens.map(token => token.text).join('');

  const ranges: [number, number, ColorKind][] = [];
  globalRegex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = globalRegex.exec(stripped)) !== null) {
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

  ranges.sort((a, b) => a[0] - b[0]);

  const out: string[] = [];
  let r = 0;

  for (const token of tokens) {
    if (token.code) {
      out.push(token.code);
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
const caseFlags = (pattern: string): string =>
  search.caseless === 2 ||
  (search.caseless === 1 && !UPPERCASE_REGEX.test(pattern))
    ? 'i'
    : '';

function compile(pattern: string, literal: boolean, invert: boolean): boolean {
  try {
    const source = literal ? escapeRegExp(pattern) : pattern;
    const flags = caseFlags(pattern);
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

function stripStyles(line: string): string {
  if (!STYLE_REGEX.test(line)) return line;
  return line.replace(STYLE_REGEX_G, '');
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

function matchesLine(line: string): boolean {
  const regex = search.regex;
  if (!regex) return false;

  let text = stripStyles(line);

  // like cvt_text: overstrikes collapse (CVT_BS) and a trailing
  // carriage return drops (CVT_CRLF) before matching
  /* eslint-disable no-control-regex */
  while (/[^\x08]\x08/.test(text)) {
    text = text.replace(/[^\x08]\x08/g, '');
  }
  /* eslint-enable no-control-regex */
  if (text.endsWith('\r')) text = text.slice(0, -1);

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
 * Whether a row is excluded from searches by --no-search-header-lines.
 */
function searchSkipsRow(row: number): boolean {
  if (!optNoSearchHeaders().lines) return false;

  const header = optHeader();
  return header.lines > 0 && row >= header.start &&
    row < header.start + header.lines;
}

/**
 * Finds the N-th match and jumps to it.
 *
 * - Start positions follow -a/-A, like less's search_pos: the default
 *   (state 2) includes the whole displayed screen for fresh searches,
 *   `-a` skips the screen entirely, and state 0 starts fresh searches
 *   at the -j target line like repeats.
 * - Repeats (`afterTarget`) start just past the target line.
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

  if (fromStart) {
    first = dir > 0 ? 0 : content.length - 1;
  } else if (afterTarget || optHowSearch() === 0) {
    const target = Math.min(config.row + jumpSindex(), content.length - 1);
    first = dir > 0 ? target + 1 : target - 1;
  } else if (optHowSearch() === 1) {
    first = dir > 0 ? lastVisibleRow(content) + 1 : config.row - 1;
  } else {
    first = dir > 0 ? config.row : lastVisibleRow(content);
  }

  const state = { remaining: count };
  const main = scanRange(content, first, dir, null, state);

  if (main === 'stop') return;

  if (main !== 'miss') {
    jumpTo(content, main);
    return;
  }

  if (wrap) {
    const start = dir > 0 ? 0 : content.length - 1;
    const wrapped = scanRange(content, start, dir, first, state);

    if (wrapped === 'stop') return;

    if (wrapped !== 'miss') {
      jumpTo(content, wrapped);

      // ^W wrap reports where the search resumed, like og's
      // search_wrapped message
      search.message = dir > 0
        ? 'Search hit bottom; continuing at top'
        : 'Search hit top; continuing at bottom';
      return;
    }
  }

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
 * @returns The matching row, `miss`, or `stop` after an interrupt or
 *          a dropped catastrophic pattern.
 */
function scanRange(
  content: string[],
  from: number,
  dir: 1 | -1,
  until: number | null,
  state: { remaining: number }
): number | 'miss' | 'stop' {
  let row = from;
  let hit = -1;

  const outcome = guardedSlices(() => {
    const deadline = Date.now() + 100;
    let steps = 0;

    while (row >= 0 && row < content.length && row !== until) {
      if (!searchSkipsRow(row) && matchesLine(content[row]) &&
        --state.remaining === 0) {
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
function searchInterrupted(): boolean {
  if (!process.stdin.isTTY) return false;

  const now = Date.now();
  if (now - lastInterruptPoll < 100) return false;
  lastInterruptPoll = now;

  const data = Buffer.alloc(64);
  let n: number;

  try {
    n = fs.readSync(0, data, 0, data.length, null);
  } catch {
    // EAGAIN: nothing typed
    return false;
  }

  if (n <= 0) return false;

  const text = data.subarray(0, n).toString();

  if (text.includes('\x03')) {
    process.stdin.unshift(Buffer.from('\x03'));
    return true;
  }

  if (text.includes(optIntrChar())) return true;

  process.stdin.unshift(data.subarray(0, n));
  return false;
}

/**
 * Returns the last content row visible in the current window.
 */
function lastVisibleRow(content: string[]): number {
  const last = content.length - 1;
  if (last < 0) return -1;

  if (config.chopLongLines || config.col) {
    return Math.min(config.row + config.window - 2, last);
  }

  let row = config.row;
  let rows = config.window - 1;
  rows -= maxSubRow(content[row]) + 1 - config.subRow;

  while (rows > 0 && row < last) {
    row++;
    rows -= maxSubRow(content[row]) + 1;
  }

  return row;
}

function jumpTo(content: string[], row: number): void {
  if (mode.INIT) mode.INIT = false;

  lastMatchRow = row;

  // matches land on the -j target line, like search calling jump_loc
  jumpLoc(content, row, 0, jumpSindex());

  shiftVisible(content, row);
}

/**
 * Shifts the screen horizontally so the match is visible, like
 * search.c's shift_visible: an off-screen match lands --match-shift
 * columns from the left edge.
 */
function shiftVisible(content: string[], row: number): void {
  if (!config.chopLongLines || !search.regex || search.invert) return;

  const text = stripStyles(content[row]);
  const match = search.regex.exec(text);
  if (!match) return;

  const startCol = strWidth(text.slice(0, match.index));
  const endCol = startCol + strWidth(match[0]);
  const swidth = config.screenWidth - 1;
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
  return matchesLine(line);
}
