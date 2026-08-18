import { getLayout } from '../lines/lineLayout';
import { visualWidth } from '../lines/helpers';

import fs from 'fs';
import vm from 'vm';

import { strWidth } from 'char-width';
import { PsxRegExp, quote, type Found } from 'posix-regex';

import { guardedMatch, watchWith, jsRegexNoticed, beginGuardedRun,
  jsRegexAbortedByInterrupt } from './jsRegexGuard';

import { keyboard, keyboardPollFd, pushUngot, pushUngotLive, raiseAbort }
  from '../tty/keyboard';
import { REGEX_DIALECT } from '../tty/platform';

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

import { ansiRunEnd, displayPrefixLength, maxSubRow, sourceIndexAt,
  sourceLine } from "../lines/helpers";

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
  chopLine,
  optUseJsRegexp
} from "../options";

import { hook } from "../options/shared";

import { colored, ColorKind } from "./color";

import { selectedOsc8, setSelectedOsc8 } from "./osc8";

import {
  INVERSE_ON,
  CHARSET_DESIGNATION_G,
  INVERSE_OFF,
  UNDERLINE_ON,
  UNDERLINE_OFF,
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

/**
 * What the search asks of a compiled pattern — the part PsxRegExp and
 * a host RegExp can both answer, so --use-js-regexp can swap one for
 * the other without the callers knowing which they hold.
 */
export interface SearchRegex {
  readonly source: string;
  readonly flags: string;
  readonly global: boolean;
  lastIndex: number;
  test(text: string): boolean;
  exec(text: string): Found | null;
}

interface Filter {
  regex: SearchRegex;
  invert: boolean;
  subs: Set<number>;
}

interface SearchState {
  /** Pattern currently being typed at the prompt, or null. */
  input: SearchInput | null;
  /** Last compiled pattern, reused by n/N and highlighting. */
  regex: SearchRegex | null;
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
  /** execSearch already wrote og's cmd_exec clear_bot for this
   *  command, so the next frame opens with nothing. */
  cmdExecOpened: boolean;
  /** A mid-scan note was written straight to the bottom line, so the
   *  next paint must rewrite it rather than dedupe it. */
  bottomClobbered: boolean;
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
  cmdExecOpened: false,
  bottomClobbered: false,
};

/**
 * Drops the search a session leaves behind, like a fresh less: the
 * compiled pattern, the & filters, the sub-pattern set and the
 * caseless state. The HISTORY stays — og persists that across
 * invocations through its history file.
 */
export function resetSearch(): void {
  hiliteCache.clear();
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

let globalRegex: SearchRegex | null = null;
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
 * Rebuilds the compiled pattern under whichever engine is now
 * selected (--use-js-regexp). The pattern one engine accepted the
 * other may refuse — `[[:alpha:]]` means nothing to a host RegExp, and
 * `\d` means something else — so a failure drops the search rather
 * than leaving the old engine's object behind.
 */
/**
 * Writes a message to the bottom row straight away.
 *
 * The option machinery sets search.message AFTER calling an option's
 * set(), so an option whose set() does real work reports itself only
 * once that work is done - "Search with JavaScript's RegExp" arriving
 * after the re-highlight it caused reads as if the toggle did
 * nothing for a while. This is the line-number walk's trick: straight
 * to the terminal, and the next frame told the row is spoken for.
 */
hook.flashMessage = (text: string): void => {
  // exactly as a held message renders, "(press RETURN)" and all: this
  // row is not replaced when the frame comes round, it is the SAME
  // message arriving early, and it stays until the user dismisses it
  fs.writeSync(1, '\r' + CLEAR_LINE + INVERSE_ON + text +
    '  (press RETURN)' + INVERSE_OFF);

  search.cmdExecOpened = false;
  search.bottomClobbered = true;
};

hook.recompilePattern = (): void => {
  // the point of recompiling is to see the other engine's answer, so
  // a pattern given up on under the last one gets another go
  hiliteAbandoned = false;

  if (!search.regex) return;
  if (!compile(compiledPattern, compiledLiteral, search.invert)) {
    search.regex = null;
    search.highlight = false;
  }
};

/**
 * Opens the search or filter prompt.
 *
 * @param type - `/`, `?` or `&`.
 * @param count - N-th occurrence to find.
 */
export function startSearch(type: '/' | '?' | '&', count: number): void {
  // a pattern about to be typed is not the one POSIX was answered
  // for. Clearing this when a search RUNS instead was wrong: the
  // retry repeats a search, so it cleared its own answer on the way
  // through and went back to the engine that could not finish
  forcePosix = false;

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

  // that WAS the frame's opening (og's cmd_exec clear_bot before a
  // possibly long walk, command.c:267), so the message frame that may
  // follow must not write another one
  search.cmdExecOpened = true;

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
      hiliteCache.clear();

      // og erases the highlights on screen and then, under -G's
      // default, highlights what already matches BEFORE it searches
      // (search.c:2137 and :2147). Both go through repaint_hilite,
      // whose first act is "if (squished) repaint()" - which is how a
      // short first screen fills with tildes the moment a search
      // runs, whether or not the match moves the view
      if (optHiliteSearch() || optStatusCol()) {

        // and og does not just un-squish here, it PAINTS twice before
        // the search runs: repaint_hilite(FALSE) erases what is on
        // screen, then hilite_screen() paints the new pattern's
        // on-screen matches. Both redraw every row. Repainting the
        // same rows twice is invisible - until a row is wider than
        // the screen, which only -r allows, and each paint physically
        // scrolls the terminal
        hilitePasses(content);
        unsquish();
      }
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
    const source = input.noRegex ? quote(pattern) : pattern;

    search.filters.push({
      regex: psx(source, searchCaseFlags(pattern)),
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
/**
 * og's hide_hilite while an O_HL_REPAINT toggle redraws the screen.
 *
 * toggle_option erases the highlights BEFORE it changes anything -
 * repaint_hilite(FALSE) redraws every row with hide_hilite on
 * (option.c:365) - and the chg_hilite that follows only repaints them
 * when hilite_screen finds a screen position to prep from
 * (search.c:1097). It does not on the toggle's own frame, so the
 * message lands over a screen with no highlights at all; the next
 * command paints them again, recomputed under the new setting.
 * Measured on the live binary: that frame carries exactly one SGR 7,
 * the message's own.
 */
let hiliteHidden = false;

export function setHiliteHidden(hidden: boolean): void {
  hiliteCache.clear();
  hiliteHidden = hidden;
}

export function toggleHighlight(): void {
  // og's undo_search: `osc8_active = undo_osc8()` runs FIRST and its
  // result gates the complaint - `else if (!osc8_active) error("No
  // previous regular expression")` (search.c:405). So ESC-u on a
  // selected OSC 8 link with no search pattern clears the link
  // quietly; ceac046 is the commit that stopped it erroring, and it
  // fixed the display too, since repaint_hilite runs either way.
  const hadOsc8 = selectedOsc8() !== null;
  if (hadOsc8) setSelectedOsc8(null);

  if (!search.regex) {
    if (!hadOsc8) search.message = 'No previous regular expression';
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
  match: Found
): void {
  const start = match.index;
  const end = match.end;
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

/**
 * Highlighted lines, kept between paints like og's prep region.
 *
 * og does not re-hilite what it has already hilited: prep_hilite
 * (search.c:2236) records the byte range its hilite list covers, and
 * a paint inside that range reuses it - the list is only thrown away
 * by a new search or a jump outside it (clr_hilite). We rebuilt every
 * displayed line on EVERY paint, which on a million-character line is
 * ~10ms a frame; a trackpad delivering hundreds of wheel events then
 * takes minutes, and the pager looks hung.
 *
 * Keyed by ROW, never by the text. A million-character line used as a
 * Map key is hashed in full on every lookup, which cost as much as
 * the work it was meant to save - the cache measured no faster than
 * no cache at all. Every caller that can invalidate the answer
 * already clears the whole map, so the row is enough.
 */
interface HilitedLine {
  /** enough of the line to tell it from another one, cheaply */
  len: number;
  head: string;
  tail: string;
  painted: string;
}

const hiliteCache = new Map<number, HilitedLine>();

/** What the cached answers were painted under: -g/-G and, for -g, the
 *  row the last search landed on, which is the only row it hilites. */
let hiliteCacheMode = '';
const HILITE_CACHE_MAX = 256;

/** og's clr_hilite: the list stops applying, so drop it. */
export function clearHiliteCache(): void {
  hiliteCache.clear();
}

export function highlightLine(line: string, row: number = -1): string {
  // wrap the whole thing: the body returns early in half a dozen
  // places (no pattern, -g on another row, no match at all), and each
  // of those still costs a full tokenize of the line
  if (row < 0) return highlightLineFor(line, row);

  // A ROW is not a stable name for text: the block engine's content
  // is a materialized window, so row 0 means different bytes after a
  // scroll. Hashing the whole line to tell them apart costs what the
  // cache saves - a million-character key is hashed in full on every
  // lookup, which is how this first measured no faster than nothing.
  // So the row is the key and a fingerprint confirms it.
  // -g hilites only the landing row and -G none at all, so the cached
  // answers stop applying the moment either changes
  const mode = `${optHiliteSearch()}:${lastMatchRow}:${search.invert}`;
  if (mode !== hiliteCacheMode) {
    hiliteCacheMode = mode;
    hiliteCache.clear();
  }

  const head = line.slice(0, 32);
  const tail = line.slice(-32);
  const cached = hiliteCache.get(row);

  if (cached !== undefined && cached.len === line.length &&
      cached.head === head && cached.tail === tail) {
    return cached.painted;
  }

  const painted = highlightLineFor(line, row);

  if (hiliteCache.size >= HILITE_CACHE_MAX) hiliteCache.clear();
  hiliteCache.set(row, { len: line.length, head, tail, painted });

  return painted;
}

function highlightLineFor(line: string, row: number): string {
  // og hilites through prep_hilite, which searches with SRCH_FORW |
  // SRCH_FIND_ALL and carries over only SRCH_NO_REGEX from the user's
  // search (search.c:2319). SRCH_NO_MATCH is NOT carried, so a
  // ^N/! search still marks the text that really matches - the
  // inversion decides where it JUMPS, not what it paints.
  // hiliteAbandoned: a pattern this engine could not get through, so
  // the frame stops trying rather than paying for it again on every
  // scroll. Not the same thing as the user turning highlighting off
  if (!globalRegex || !search.regex || !search.highlight || hiliteHidden ||
      hiliteAbandoned) {
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

  // og reuses the hilites it already has for this text (prep region);
  // only a new search or a jump outside it clears them
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

  // og searches the RAW line - forw_raw_line then cvt_text, which
  // only folds backspaces, CR and ANSI (search.c:1680) - and turns
  // the match's offsets into file positions through chpos. Every
  // display character carries the position of the character it came
  // from, so a tab's expansion spaces all belong to the tab and all
  // light up. Matching the DISPLAY text instead would look for the
  // pattern in text the file never contained.
  const source = sourceLine(line);

  if (source) {
    for (const range of sourceRanges(source)) ranges.push(range);
  }

  globalRegex.lastIndex = 0;
  let match: Found | null;

  while (!source && (match = globalRegex.exec(matchable)) !== null) {
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

    // og's hilite_line loops on match_pattern with the USER's search
    // type (search.c), and SRCH_NO_MATCH inverts its verdict
    // (pattern.c:444): once a line's first match is hilited, the
    // continuation asks "is there NO match in the rest", which is
    // false precisely when another one exists. So an inverted search
    // marks the first match on each line and no more.
    if (search.invert) break;
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
  // og carries ONE attribute per character (linebuf.attr[], line.c)
  // and emits the transition the next character needs. Ours are codes
  // in the byte stream, so the state has to be kept: a code that ends
  // an attribute drops the one that opened it, and a reset drops them
  // all. Accumulating every code ever seen instead replayed a whole
  // line's history after each match - "ESC[1m ESC(B ESC[m ESC[4m
  // ESC[24m" where og writes nothing at all, because by then bold and
  // underline had both been closed again.
  const open: string[] = [];
  const styleState = (code: string): void => {
    const sgr = /^\x1b\[([0-9;]*)m$/.exec(
      code.replace(CHARSET_DESIGNATION_G, '')
    );

    if (!sgr) return;

    for (const part of sgr[1].split(';')) {
      const n = part === '' ? 0 : Number(part);

      if (n === 0) {
        open.length = 0;
        continue;
      }

      // og's at_exit undoes one attribute at a time (screen.c:3108);
      // 21-29 turn off what 1-9 turned on, and 39/49 the colours
      const off = n >= 21 && n <= 29 ? n - 20 : 0;

      if (off || n === 39 || n === 49) {
        for (let i = open.length - 1; i >= 0; i--) {
          const held = /^\x1b\[([0-9;]*)m$/.exec(open[i]);
          const v = held ? Number(held[1] || '0') : -1;

          if (v === off ||
              (n === 39 && v >= 30 && v <= 38) ||
              (n === 49 && v >= 40 && v <= 48)) {
            open.splice(i, 1);
          }
        }
        continue;
      }

      open.push(`\x1b[${n}m`);
    }
  };

  // og's store_char computes link_attr = hl_attr | AT_UNDERLINE for a
  // hilited character inside an OSC 8 link, then takes the hl_attr
  // branch and never applies it (line.c:883 and :888) - so a search
  // match inside a link takes standout WITHOUT the link's underline.
  let inLink = false;

  for (const token of tokens) {
    if (token.code) {
      out.push(token.code);
      styleState(token.code);
      if (token.code.startsWith('\x1b]8;')) inLink = !isOsc8Close(token.code);
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

      // the link's underline gives way to the match's standout
      if (inLink) out.push(UNDERLINE_OFF);

      out.push(colored(
        ranges[r][2], text.slice(pos, end), INVERSE_ON, INVERSE_OFF
      ));

      if (inLink) out.push(UNDERLINE_ON);

      // only when styled text actually follows: a hilite that runs to
      // the end of its run is followed by the file's own next code
      // anyway, and og emits no transition it does not need
      if (open.length && end < text.length) out.push(open.join(''));
      pos = end;
    }
  }

  const painted = out.join('');

  // bounded: og's prep region covers the screen, not the file
  return painted;
}

// helpers

const UPPERCASE_REGEX = /\p{Lu}/u;

// smart case: -i ignores case unless the pattern contains uppercase
export const searchCaseFlags = (pattern: string): string =>
  search.caseless === 2 ||
  (search.caseless === 1 && !UPPERCASE_REGEX.test(pattern))
    ? 'i'
    : '';

/**
 * Compiles a pattern the way og's compile_pattern2 does.
 *
 * og hands the pattern to regcomp with REG_EXTENDED (pattern.h's
 * REGCOMP_FLAG) and REG_ICASE for -i. The dialect carries the extended
 * spelling itself — see REGEX_DIALECT, where leaving it to the "e"
 * flag would silently fall back to BASIC.
 *
 * Matching is by CHARACTER, as og's is — cvt_text hands regcomp a
 * UTF-8 string where "." spans one character however many bytes it
 * takes. That used to need the "u" flag, applied only when the pattern
 * still compiled with it, because "u" also rejected patterns og
 * accepts (a stray "\\d" in a class, an unescaped brace). POSIX reads
 * by code point always and has no such quarrel, so the guess is gone.
 */
/**
 * The `Pattern too complex. Try again with POSIX RegExp?` prompt, in
 * the shape og asks about a binary file: a question on the bottom row
 * that y answers and anything else declines.
 *
 * A --use-js-regexp search that had to be killed leaves the user with
 * nothing - not because the pattern is wrong, but because the engine
 * they asked for cannot finish it. The engine that can is already
 * here, so offer it rather than reporting a failure.
 */
export const posixRetry = { pending: false };

/**
 * True only while a search the USER asked for is running.
 *
 * Matching happens in two very different situations. A search is a
 * command: it can take a while, and being asked whether to finish it
 * another way is help. Highlighting is a repaint: it runs over the
 * lines already on screen, for a pattern that was compiled long ago,
 * and a question in the middle of one would arrive attached to
 * nothing the user just did - toggling --use-js-regexp re-highlights,
 * which is how this turned up.
 *
 * Both are guarded, so neither can hang. Only the first asks.
 */
let inRepaint = false;

/**
 * True once a frame's highlighting was given up on.
 *
 * Its own flag, not search.highlight: that one is the user's, set by
 * a search and cleared by undo-hilite, and a pattern this engine
 * cannot get through says nothing about whether they want
 * highlighting. Clobbering it left the pager with no highlights for
 * the rest of the session and no way to ask for them back.
 *
 * Cleared by anything that means "try again": a new search, and the
 * toggle that recompiles under the other engine.
 */
let hiliteAbandoned = false;

/** True while highlighting is being skipped for a pattern it cannot
 *  get through. */
export const hiliteGivenUp = (): boolean => hiliteAbandoned;

/** Lets highlighting be attempted again. */
export function retryHilite(): void {
  hiliteAbandoned = false;
}

/**
 * Marks the frame as the thing running, so matching done for it is
 * treated as a repaint rather than as a search.
 *
 * Decided from the RENDER, not from the search entry points. Wrapping
 * those looked right and measured backwards: a search's matching does
 * not happen inside the callback that starts it, and the frame that
 * follows does - so a search ran as "any key aborts" and had its own
 * RETURN kill it, while the repaint waited for a ^C nobody would
 * press. The frame is the one boundary that is always exactly where
 * it says it is.
 */
export function duringRepaint<T>(run: () => T): T {
  const outer = inRepaint;

  inRepaint = true;

  try {
    return run();
  } finally {
    inRepaint = outer;
  }
}

/** Kept for the search entry points: they still mark the run. */
export function duringUserSearch<T>(run: () => T): T {
  beginGuardedRun();
  hiliteAbandoned = false;
  return run();
}

/** Set while a retry runs, so this one search skips the host engine. */
let forcePosix = false;


/** Takes the next search away from --use-js-regexp, for the retry. */
export function retryWithPosix(): void {
  forcePosix = true;
}

/**
 * Puts the option back, for the next pattern.
 *
 * NOT after one compile: compiling builds two regexes - the one a
 * search walks with, and the one highlighting paints with - and
 * clearing between them sent the search to POSIX and left the
 * highlighting on the engine that could not finish, which is what "y"
 * looked like it was ignoring.
 *
 * It lasts as long as the pattern it was answered for. A new search
 * goes back to whatever the option says, and so does a toggle.
 */
export function clearForcePosix(): void {
  forcePosix = false;
}

function psx(source: string, flags: string): SearchRegex {
  if (optUseJsRegexp() && !forcePosix) return jsRegex(source, flags);

  return new PsxRegExp(source, { flags, flavor: REGEX_DIALECT });
}

/**
 * A host RegExp wearing the POSIX engine's shape, for --use-js-regexp.
 *
 * The two agree on everything the search reads but the match: a Found
 * names the whole match `value` and its far end `end`, where a
 * RegExpExecArray has `[0]` and no end at all. Rather than teach every
 * caller both shapes, the array grows the two names — it stays a real
 * RegExpExecArray, so `[n]`, `.index` and `.indices` are untouched.
 *
 * "u" goes on only when the pattern still compiles with it, which is
 * the guess the POSIX engine let us delete: without it "." counts
 * UTF-16 units and an emoji eats two dots, but with it JS rejects
 * patterns og accepts. Neither answer is og's, which is the point of
 * the option.
 */
function jsRegex(source: string, flags: string): SearchRegex {
  const host = flags.replace('e', '');
  let unicode = '';
  try {
    void new RegExp(source, host + 'u');
    unicode = 'u';
  } catch { /* the pattern outlives the stricter mode */ }

  const re = new RegExp(source, host + unicode);

  // EVERY match runs in the worker, not just the ones a detector
  // thinks are dangerous. No detector can promise how long a regex
  // takes - the shapes that blow up are the famous ones, not all of
  // them - and being able to interrupt matters more than the thread
  // hop it costs. This is the non-default engine; the POSIX one
  // underneath does not backtrack and has nothing to abort
  // a search ends on an interrupt, like og's. A repaint ends on ANY
  // key: it is running behind whatever the user does next, and a key
  // arriving means they have moved on - waiting for a ^C they have no
  // reason to press is how a RETURN went unread for seven seconds
  const fallbackPoll = (): boolean => searchInterrupted(true);

  // the same shape as the line-number walk's message, because it is
  // the same kind of thing: work the pager is doing on your behalf,
  // long enough that silence would read as a hang, with a key that
  // ends it. Straight to the terminal, since no frame is being built;
  // and bottomClobbered so the NEXT frame repaints the row instead of
  // printing its prompt onto the end of this
  /**
   * A killed match offers the engine that can finish it, whether it
   * was a search or the highlighting of a frame. Both are the same
   * question - this engine cannot get through your pattern, shall we
   * use the other one - and the answer differs only in what gets
   * redone afterwards.
   *
   * The message the bottom row is holding goes with it. A toggle sets
   * one ("Search with JavaScript's RegExp") and a message outranks the
   * prompt, so leaving it there would answer a question the user
   * cannot see.
   */
  const giveUp = (): void => {
    // a key that was not an interrupt is not a request for advice:
    // the user moved on, so highlighting stops and nothing is asked
    // the watcher's verdict when there was one: with a watcher
    // attached the poll on this side never runs, so its flag is stale
    if (inRepaint && !abortedByInterrupt() && !jsRegexAbortedByInterrupt()) {
      hiliteAbandoned = true;
      return;
    }

    posixRetry.pending = true;

    search.message = '';
    search.messageQueue.length = 0;

    // and no more matching until it is answered - whether a search
    // raised this or a repaint did. The frame that DRAWS the question
    // would otherwise paint with the pattern the question is about,
    // attach a watcher to it, and two seconds later announce itself
    // over the question
    hiliteAbandoned = true;
  };

  const runGuarded = (text: string, test: boolean):
  { test?: boolean, match?: { index: number, groups: string[] } | null }
  | null => {
    // given up on already: not this frame, this PATTERN. The frame
    // matches through more than the highlighter - the -S shift, the
    // status column, the filters - and each render opens a new run,
    // so gating one of them let the rest start the whole thing over.
    // That is what put "Searching..." on top of the question two
    // seconds after the match it belonged to had been killed
    if (hiliteAbandoned) return null;

    // the watcher needs a terminal to watch and the exact bytes to
    // write; both are this side's business, and neither changes
    watchWith(keyboardPollFd(), optIntrChar(),
      '\r' + CLEAR_LINE + INVERSE_ON +
        'Searching... (interrupt to abort)' + INVERSE_OFF,
      '\r' + CLEAR_LINE);

    // interrupt only, for a frame as much as for a search. Any key
    // ending a frame's matching was a workaround for keys that were
    // being swallowed - they are handed back and dispatched now, and
    // what the workaround does instead is kill the re-highlight
    // milliseconds after it starts, with the RETURN that dismisses
    // the message. Nothing gets a chance to happen, or to be seen
    const { answer, keys } = guardedMatch(
      { source: re.source, flags: re.flags, text, test },
      false,
      fallbackPoll,
      search.message !== '');

    // whatever the watcher took off the terminal belongs to the
    // command loop, interrupt or not: og's check_poll ungets the keys
    // it looked at (os.c)
    if (keys) pushUngotLive(Buffer.from(keys, 'binary'));

    // the message it may have written lands after the clear the
    // command already emitted, so the next frame must repaint the row
    // rather than print its prompt onto the end of it
    if (jsRegexNoticed()) {
      search.cmdExecOpened = false;
      search.bottomClobbered = true;
    }

    return answer;
  };

  return {
    source: re.source,
    flags: re.flags,
    global: re.global,
    get lastIndex() { return re.lastIndex; },
    set lastIndex(at: number) { re.lastIndex = at; },
    test: (text: string) => {
      // aborted: the caller sees no match, and searchInterrupted has
      // already set the abort in motion
      const answer = runGuarded(text, true);

      if (answer === null) giveUp();

      return answer?.test ?? false;
    },
    exec: (text: string) => {
      const answer = runGuarded(text, false);
      const found = answer?.match;

      if (answer === null) giveUp();

      if (!found) return null;

      const m = found.groups as unknown as RegExpExecArray;

      m.index = found.index;
      m.input = text;

      return Object.assign(m, {
        value: found.groups[0],
        end: found.index + found.groups[0].length,
      }) as unknown as Found;
    },
  };
}

function compile(pattern: string, literal: boolean, invert: boolean): boolean {
  // a new pattern is og's clr_hilite: the old list cannot apply
  hiliteCache.clear();

  try {
    const source = literal ? quote(pattern) : pattern;
    const flags = searchCaseFlags(pattern);
    search.regex = psx(source, flags);
    globalRegex = psx(source, flags + 'dg');
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
/** True for the OSC 8 sequence that CLOSES a link: an empty URI. */
/* eslint-disable-next-line no-control-regex */
const OSC8_CLOSE = /^\x1b\]8;[^;]*;(?:\x07|\x1b\\)/;

const isOsc8Close = (code: string): boolean => OSC8_CLOSE.test(code);

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
  const conv = m.end;
  return { conv, raw: map[conv] ?? 0 };
}

/**
 * The hilite ranges a transformed line gets, in DISPLAYED-character
 * coordinates, from a search run against its RAW text.
 *
 * convertWithMap is og's cvt_text plus chpos: it folds what cvt folds
 * and remembers where each surviving character came from. The match's
 * ends become raw offsets through that map, and each one becomes a
 * displayed offset by transforming the prefix - the same relation
 * store_tab and store_prchar record one character at a time.
 */
function sourceRanges(source: string): [number, number, ColorKind][] {
  const out: [number, number, ColorKind][] = [];
  if (!globalRegex) return out;

  // the CONVERTED text, not the raw: cvt has already folded the
  // overstrikes and dropped the ANSI, so what remains differs from
  // the display only by tab expansion and control rendering - and a
  // prefix of it can be cut anywhere, where a raw prefix could land
  // inside an overstrike pair and lose the character it belonged to
  const { text } = convertWithMap(source);
  const seen: [number, number, ColorKind][] = [];
  globalRegex.lastIndex = 0;

  for (let m = globalRegex.exec(text); m; m = globalRegex.exec(text)) {
    if (search.subs.size && m.indices) {
      for (const n of search.subs) {
        const span = m.indices[n];
        if (span && span[1] > span[0]) {
          seen.push([span[0], span[1], subColorKind(n)]);
        }
      }
    } else if (m[0]) {
      pushMatchRanges(seen, m);
    }

    if (m.index === globalRegex.lastIndex) globalRegex.lastIndex++;
    if (search.invert) break;
  }

  for (const [start, end, kind] of seen) {
    out.push([
      displayPrefixLength(text, start),
      displayPrefixLength(text, end),
      kind,
    ]);
  }

  return out;
}

function testRegex(regex: SearchRegex, text: string, subs: Set<number>): boolean {
  if (!subs.size) return regex.test(text);

  // og's subsearch_ok (pattern.c): a ^S group fails when `ep[i] ==
  // sp[i]`, i.e. it must be NON-EMPTY - merely participating is not
  // enough. And match_pattern does not judge only the first match: it
  // keeps searching AFTER each one that fails the condition, giving up
  // when `mlen == 0` because it cannot advance (e66db83 - that guard
  // is what stopped og hanging on a pattern like `(x*)`).
  const scan = regex.global ? regex : psx(regex.source, regex.flags + 'g');

  let start = 0;

  for (;;) {
    scan.lastIndex = start;

    const match = scan.exec(text);
    if (!match) return false;

    let ok = true;
    for (const n of subs) {
      const group = match[n];
      if (group === undefined || group.length === 0) ok = false;
    }

    if (ok) return true;

    const end = match.end;
    if (end === start) return false;

    start = end;
  }
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
    while (/[^\x08]\x08/.test(text)) {
      text = text.replace(/[^\x08]\x08/g, '');
    }
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
/**
 * og's LONGTIME (linenum.c:58): how long a loop runs before it says
 * so. og applies it to line numbering and to determining a file's
 * length, both through ierror, which appends "... (interrupt to
 * abort)" (output.c:767).
 */
const LONGTIME_MS = 2000;

/**
 * Says what we are doing when a search runs long, the way og's
 * delayed_msg does for its own long loops (linenum.c:229).
 *
 * NOT og: search.c has no delayed message, so a search over a very
 * long line - a nested quantifier on 200k characters - sits there
 * saying nothing until it finishes or the user interrupts. og's own
 * shape is what this borrows: nothing for the first two seconds, then
 * the note with ierror's suffix, written straight to the bottom line.
 */
function searchNote(): void {
  fs.writeSync(1, '\r' + CLEAR_LINE + colored('error',
    'Searching... (interrupt to abort)', INVERSE_ON, INVERSE_OFF));

  // a raw write past the buffer, like the other mid-scan notes: the
  // renderer has to know the bottom line no longer holds what it
  // last painted there
  search.bottomClobbered = true;
}

function guardedSlices(slice: () => boolean): 'done' | 'stop' | 'complex' {
  if (!guardContext || !guardScript) {
    guardContext = vm.createContext({ step: () => {} }) as
      { step: () => void };
    guardScript = new vm.Script('step()');
  }

  let finished = false;
  guardContext.step = () => { finished = slice(); };

  const started = Date.now();
  let noted = false;

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
      // search_range's ABORT_SIGS checks. FORCED: this loop is the
      // reason the event loop is stopped, so the rate limit that
      // protects casual callers only makes the interrupt late here -
      // and late is exactly what it felt like next to the watcher,
      // which answers a ^C the moment the kernel hands it over
      if (searchInterrupted(true)) return 'stop';

      if (!noted && Date.now() - started >= LONGTIME_MS) {
        noted = true;
        searchNote();
      }
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
      // og searches the RAW line, not the displayed one (search.c:1680
      // reads it with forw_raw_line and folds only what cvt_text
      // folds), so a pattern may span a tab or a control character
      const raw = sourceLine(content[row]) ?? content[row];

      const line = row === from && fromOffset > 0
        ? (dir > 0
          ? raw.slice(sourceIndexAt(raw, fromOffset))
          : raw.slice(0, sourceIndexAt(raw, fromOffset)))
        : raw;

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
 * Walks every line under og's interruptible slice budget, calling
 * `step` for each, and reports how the walk ended.
 *
 * filterLines and filterLineMask differ only in what they do per line
 * -- keep it, or record a boolean -- and both wrote out the same
 * deadline, the same 1024-step check and the same "Pattern too
 * complex" handling.
 *
 * @param lines - Full content lines.
 * @param step - Called with each line and its index.
 * @returns guardedSlices' own verdict: 'done', 'stop' (interrupted),
 *          or 'complex' (filters dropped and the message set here).
 */
function slicedWalk(
  lines: string[],
  step: (line: string, at: number) => void
): 'done' | 'stop' | 'complex' {
  let at = 0;

  const outcome = guardedSlices(() => {
    const deadline = Date.now() + 100;
    let steps = 0;

    while (at < lines.length) {
      step(lines[at], at);
      at++;

      if ((++steps & 0x3FF) === 0 && Date.now() > deadline) return false;
    }

    return true;
  });

  if (outcome === 'complex') {
    search.filters = [];
    search.message = 'Pattern too complex';
  }

  return outcome;
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

  const outcome = slicedWalk(lines, line => {
    if (filter(line)) kept.push(line);
  });

  if (outcome !== 'done') return null;
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

  const outcome = slicedWalk(lines, (line, at) => {
    mask[at] = filter(line);
  });

  return outcome === 'done' ? mask : null;
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
/** True while the caller wants any keypress to count as an abort. */
let anyKeyAborts = false;

/** Whether the last abort was an INTERRUPT or just some other key. */
let abortWasInterrupt = false;

/** True when what ended the last match was ^C or the --intr char. */
export const abortedByInterrupt = (): boolean => abortWasInterrupt;

/**
 * Runs matching that nobody asked for - a frame's highlighting - so
 * that any key ends it, not only an interrupt.
 */
export function duringRepaintMatch<T>(run: () => T): T {
  anyKeyAborts = true;

  try {
    return run();
  } finally {
    anyKeyAborts = false;
  }
}

export function searchInterrupted(force = false): boolean {
  // piped input reads keys from /dev/tty: poll the keyboard's fd,
  // not fd 0 (og's check_poll watches the tty, whatever stdin is)
  const kb = keyboard();
  if (!kb.isTTY) return false;

  // FIRST, and with no rate limit: node's stream is in FLOWING mode,
  // so it has already drained the tty into its own buffer - which is
  // where a ^C typed during a scroll actually sits. The readSync
  // below polls the TTY and finds it empty every time, which is why
  // no abort site in the tree ever fired. Reading the stream buffer
  // is free (memory, no syscall), so it runs on every check - og
  // tests ABORT_SIGS() per LINE it draws (output.c:64), not ten times
  // a second, and "stop immediately" needs that granularity.
  const buffered = force
    ? (kb as unknown as { read(): Buffer | string | null }).read()
    : null;

  if (buffered !== null && buffered.length) {
    const text = typeof buffered === 'string'
      ? buffered
      : buffered.toString('binary');

    if (text.includes('\x03')) {
      // og's u_interrupt rings at every ^C (signal.c lbell) and sets
      // sigs |= S_INTERRUPT, which every drawing loop then sees
      fs.writeSync(1, '\x07');
      raiseAbort();
      pushUngot(Buffer.from('\x03', 'binary'));
      abortWasInterrupt = true;
      return true;
    }

    if (text.includes(optIntrChar())) {
      abortWasInterrupt = true;
      return true;
    }

    // og's check_poll ungets ordinary keys for the command loop
    pushUngot(Buffer.from(text, 'binary'));

    // ...and for a repaint, an ordinary key IS the abort. A search is
    // a command the user is waiting on, so only an interrupt ends it.
    // Highlighting is not: it runs behind whatever they do next, and
    // a key arriving means they have moved on. Without this the key
    // sits unread until the matching finishes - which is how pressing
    // RETURN to dismiss a message did nothing for seven seconds
    if (anyKeyAborts) {
      abortWasInterrupt = false;
      return true;
    }
  }

  // The tty poll is a syscall, so it is rate limited by default - but
  // a ^C typed DURING synchronous work never reaches node's buffer at
  // all: the event loop is stopped, so nothing drains the tty. The
  // kernel queue is the only place that byte exists, and this readSync
  // is the only thing that can see it. Callers that are the reason the
  // loop is blocked pass force and pay the syscall, which is
  // microseconds against a scroll's paint.
  //
  // og needs none of this: ABORT_SIGS() reads a volatile flag its
  // SIGINT handler set (signal.c:41), so checking per line is free.
  const now = Date.now();
  if (!force && now - lastInterruptPoll < 100) return false;
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
    raiseAbort();
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

/**
 * og's two pre-search paints (search.c:2137 and :2147), which happen
 * whether the search then succeeds or fails.
 *
 * `if (hilite_search || status_col) repaint_hilite(FALSE)` - and
 * hilite_search is OPT_ONPLUS by default, which is truthy - so both
 * run for every new pattern on every terminal. They were gated on -r
 * on the theory that repainting the same rows is otherwise a no-op:
 * true on the SCREEN, but repaint_hilite ADDRESSES each row where an
 * ordinary paint scrolls, so the bytes differ for every search.
 */
function hilitePasses(content: string[]): void {
  hilitePaint?.(content);
}

// the renderer lives on the other side of an import cycle
let hilitePaint: ((content: string[]) => void) | null = null;

/** Registers og's pre-search repaint pair. */
export function onHilitePaint(
  fn: ((content: string[]) => void) | null
): void {
  hilitePaint = fn;
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
  shiftVisibleText(stripStyles(content[row]));
}

/**
 * shift_visible on a line's DISPLAY text.
 *
 * Both engines run this, and differ only in where the text comes from:
 * a row of session.content, or a line read from the seekable source.
 * Everything after that -- og's four-way choice of new hshift -- was
 * written out twice, identically.
 *
 * og reaches here only with a real match in hand (sp[0] and ep[0] are
 * non-NULL, search.c:1745), which under an inverted search they never
 * are: the line "matches" precisely because the pattern did not. The
 * invert test below says that up front; falling through to a null exec
 * says the same thing one step later.
 *
 * @param text - The line as displayed, styles already stripped.
 */
export function shiftVisibleText(text: string): void {
  if (!chopLine() || !search.regex || search.invert) return;

  const match = search.regex.exec(text);
  if (!match) return;

  const startCol = strWidth(text.slice(0, match.index));
  const endCol = startCol + strWidth(match.value);
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
export function statusColChar(
  line: string,
  row: number,
  from?: number,
  to?: number
): string {
  // the status column reads the same hilite list, built without
  // SRCH_NO_MATCH (search.c:2319)
  if (!search.regex || !globalRegex) return '';
  if (optHiliteSearch() === 1 && row !== lastMatchRow) return '';

  let text = stripStyles(line);

  // the same cvt_text as matching: overstrikes collapse, CR drops
  while (/[^\x08]\x08/.test(text)) {
    text = text.replace(/[^\x08]\x08/g, '');
  }
  if (text.endsWith('\r')) text = text.slice(0, -1);

  const ranges: { start: number, end: number }[] = [];
  globalRegex.lastIndex = 0;

  for (let m = globalRegex.exec(text); m; m = globalRegex.exec(text)) {
    if (m[0]) ranges.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === globalRegex.lastIndex) globalRegex.lastIndex++;
  }

  if (!ranges.length) return '';

  // og decides this per SCREEN ROW, from the range of characters that
  // row actually shows: is_hilited_attr(disp_pos, edisp_pos)
  // (input.c:64). A wrapped line's continuation row whose range holds
  // no match gets no marker -- we marked every row of the line.
  if (!chopLine() && !config.col) {
    if (from === undefined || to === undefined) return '*';

    // the row's span is in layout clusters; the matches above are in
    // characters of the same style-stripped line, so convert
    const chars = getLayout(line).chars;
    const start = chars.slice(0, from).join('').length;
    const stop = chars.slice(0, to).join('').length;

    return ranges.some(r => r.start < stop && r.end > start) ? '*' : '';
  }

  // og compares hilite positions against the displayed range; char
  // indexes stand in for columns here
  const left = config.col;

  // og's disp_pos is NULL_POSITION when the shift has carried the
  // whole line off the screen, and init_status_col then sets no
  // attribute at all (input.c:45): with nothing visible there is no
  // marker, not a "match lies to the left" arrow
  if (visualWidth(text) <= left) return '';
  const right = config.col + config.screenWidth;
  const before = ranges.some(r => r.start < left);
  const after = ranges.some(r => r.end > right);

  if (before && after) return '=';
  if (before) return '<';
  if (after) return '>';
  return '*';
}
