import { config, mode } from "../config";

import { maxSubRow } from "../helpers";

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
  /** Transient status message shown at the prompt. */
  message: string;
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
  message: '',
};

let globalRegex: RegExp | null = null;
let compiledPattern = '';
let compiledLiteral = false;

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
  search.input = {
    type,
    chars: [],
    count,
    invert: false,
    fromStart: false,
    pastEof: false,
    keep: false,
    noRegex: false,
    wrap: false,
    subs: new Set(),
    litNext: false,
    subPrompt: false,
  };
}

/**
 * Feeds one keypress into the pattern being typed at the prompt.
 *
 * - CR submits, ^C cancels, backspace edits (and cancels on empty).
 * - While the pattern is empty, modifier keys toggle search flags like
 *   less (^N/!, ^E/*, ^F/@, ^K, ^R, ^S, ^W, ^L).
 * - Escape sequences (arrows etc.) are ignored.
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

    return 'pending';
  }

  if (key === '\x0D') return 'run';

  if (key === '\x03') {
    search.input = null;
    return 'cancel';
  }

  if (key === '\x08' || key === '\x7F') {
    if (input.litNext) {
      input.litNext = false;
      return 'pending';
    }

    if (!input.chars.length) {
      search.input = null;
      return 'cancel';
    }

    input.chars.pop();
    return 'pending';
  }

  if (input.litNext) {
    input.litNext = false;
    input.chars.push(...key);
    return 'pending';
  }

  if (key.startsWith('\x1B')) return 'pending';

  if (!input.chars.length && handleModifier(input, key)) return 'pending';

  for (const char of key) {
    if (char >= '\x20') input.chars.push(char);
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

  return prompt + input.chars.map(displayChar).join('');
}

const displayChar = (char: string): string => {
  if (char === '\x7F') return '^?';
  if (char >= '\x20') return char;
  return '^' + String.fromCharCode(char.charCodeAt(0) + 0x40);
};

function handleModifier(input: SearchInput, key: string): boolean {
  // search-only modifiers are literal pattern characters in a filter
  const searchOnly = (toggle: () => void): boolean => {
    if (input.type === '&') {
      if (key < '\x20') {
        input.chars.push(key);
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

  const pattern = input.chars.join('');
  const dir: 1 | -1 = input.type === '?' ? -1 : 1;

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

  const pattern = input.chars.join('');

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
}

/**
 * Wraps search matches in a line with inverse-video codes.
 *
 * - Matches are found on the ANSI-stripped text, then mapped back onto the
 *   raw line so existing styles are preserved.
 *
 * @param line - The raw content line.
 * @returns The line with matches highlighted, or unchanged.
 */
export function highlightLine(line: string): string {
  if (!globalRegex || !search.regex || !search.highlight || search.invert) {
    return line;
  }

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

  const ranges: [number, number][] = [];
  globalRegex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = globalRegex.exec(stripped)) !== null) {
    if (search.subs.size && match.indices) {
      for (const n of search.subs) {
        const span = match.indices[n];
        if (span && span[1] > span[0]) ranges.push([span[0], span[1]]);
      }
    } else if (match[0]) {
      ranges.push([match.index, match.index + match[0].length]);
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
      out.push(INVERSE_ON + text.slice(pos, end) + INVERSE_OFF);
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
  return testRegex(regex, stripStyles(line), search.subs) !== search.invert;
}

/**
 * Finds the N-th match and jumps to it.
 *
 * - Fresh searches include the displayed screen, matching less's default:
 *   forward starts at the top displayed line, backward at the bottom one.
 * - Repeats (`afterTarget`) start strictly past the current top line.
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
  } else if (afterTarget) {
    first = config.row + dir;
  } else {
    first = dir > 0 ? config.row : lastVisibleRow(content);
  }

  let remaining = count;

  for (let row = first; row >= 0 && row < content.length; row += dir) {
    if (matchesLine(content[row]) && --remaining === 0) {
      jumpTo(content, row);
      return;
    }
  }

  if (wrap) {
    let row = dir > 0 ? 0 : content.length - 1;

    for (; row !== first && row >= 0 && row < content.length; row += dir) {
      if (matchesLine(content[row]) && --remaining === 0) {
        jumpTo(content, row);
        return;
      }
    }
  }

  search.message = 'Pattern not found';
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
  config.row = row;
  config.subRow = 0;

  if (mode.INIT) mode.INIT = false;

  if (config.chopLongLines || config.col) {
    const lastRow = Math.max(content.length - config.window + 1, 0);
    mode.EOF = config.row >= lastRow;
  } else {
    mode.EOF = config.row > config.endRow || (
      config.row === config.endRow && config.subRow >= config.endSubRow
    );
  }
}
