import { strWidth } from 'char-width';

import { config } from '../state/config';

import { isAscii, splitChars, atomsOf, tabsOf, tabWidth }
  from './helpers';

import { controlByte } from '../features/charset';

import { optWordwrap, optCtldisp } from '../options';

import { STYLE_OR_CHARSET_G, STYLE_REGEX_G, STYLE_RESET }
  from '../state/constants';

/**
 * Pre-computed layout of a single content line.
 *
 * - Grapheme clusters and ANSI codes are separated so row emission never
 *   splits a sequence or miscounts a width.
 * - Row boundaries and per-row active styles are computed once per line and
 *   screen width, then reused on every render.
 */
export interface LineLayout {
  /** Grapheme clusters, excluding ANSI codes. */
  chars: string[];
  /** Visual width of each cluster. */
  widths: number[];
  /** prefix[i] - total visual width of chars[0..i-1]. */
  prefix: number[];
  /** Cluster index each ANSI code is anchored before. */
  codeIdx: number[];
  /** ANSI codes in order of appearance. */
  codes: string[];
  /** Cluster index starting each wrapped row. */
  rowStart: number[];
  /** Active ANSI style prefix at each wrapped row start. */
  rowStyle: string[];
  /** Column spans of the control/binary reps, which never split. */
  atoms?: number[];
  /** Column spans of the expanded tabs, re-measured per row. */
  tabs?: number[];
  /** The same styles unjoined, so a row can be drawn from its own
   *  boundary instead of from the start of the line. Rows whose style
   *  did not change share one array; emitRange copies before using it. */
  rowActive: string[][];
}

const CACHE_LIMIT = 5000;

/**
 * How much the cache may hold, counted in display characters.
 *
 * A count of ENTRIES does not bound anything: a layout carries a
 * chars/widths/rowStyle entry per character, so it costs roughly a
 * hundred times the line it describes, and 5000 of them off a file of
 * 2 KB lines reached 228 MB against less's 16 MB. less has no layout cache
 * at all - it keeps one linebuf and rebuilds - so any budget here is
 * memory less never spends; the point is only that it be A budget.
 *
 * Half a million characters holds a screenful of the longest line we
 * will ever build (MAX_LINE) many times over, and everything an
 * ordinary file displays.
 */
const CACHE_CHAR_BUDGET = 1 << 19;

let cache = new Map<string, LineLayout>();
/** Display characters currently held, the budget's running total. */
let cacheChars = 0;
let cacheWidth = 0;
let cacheWordwrap = false;
let cacheCtldisp = -1;

// Which layout the cached extents came from. less never needs this: its
// position table holds STARTS only and forw_line re-derives the extent
// at every draw, so a width or ctldisp change re-extents every row for
// free. Ours stores each row's end - the bottom row has no next entry
// to read it from, and a row a scroll seam cut short has to stay short
// - and those ends mean nothing under a different layout.
let generation = 0;

/** Bumped whenever the cached layouts stop applying. */
export const layoutGeneration = (): number => generation;

/**
 * Returns the cached layout for a line, building it on first access.
 *
 * - The cache is invalidated when the screen width changes.
 *
 * @param line - The raw content line.
 * @returns The line's layout for the current screen width.
 */
export function getLayout(line: string): LineLayout {
  // -r/-R change what a line DISPLAYS (control chars raw, as ANSI, or
  // as ^X) and therefore how it wraps, so a layout cached under one
  // ctldisp cannot be reused under another - handing back the stale
  // one made the carry recompute the SAME sub-row it was correcting.
  if (cacheWidth !== config.screenWidth || cacheWordwrap !== optWordwrap() ||
      cacheCtldisp !== optCtldisp()) {
    cache = new Map();
    cacheChars = 0;
    cacheWidth = config.screenWidth;
    cacheWordwrap = optWordwrap();
    cacheCtldisp = optCtldisp();
    generation++;
  }

  const layout = cache.get(line);

  if (layout) {
    // freshen: Map keeps insertion order, so re-inserting moves this
    // to the young end and the eviction below cannot take a line the
    // screen is still drawing - the one long line of a file like
    // `long` is asked for every frame but inserted only once
    cache.delete(line);
    cache.set(line, layout);
    return layout;
  }

  const built = buildLayout(line);

  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
    cacheChars = 0;
  }

  cache.set(line, built);
  cacheChars += built.chars.length;

  // evict oldest-first until the budget holds, always keeping the one
  // just built - the caller is about to draw from it
  while (cacheChars > CACHE_CHAR_BUDGET && cache.size > 1) {
    const oldest = cache.keys().next().value as string;
    const gone = cache.get(oldest);
    cache.delete(oldest);
    if (gone) cacheChars -= gone.chars.length;
  }

  return built;
}

function buildLayout(line: string): LineLayout {
  const chars: string[] = [];
  const widths: number[] = [];
  const codeIdx: number[] = [];
  const codes: string[] = [];

  // less's pwidth: a control character under -r moves the cursor by an
  // unpredictable amount, "so we don't even try to guess; say it
  // doesn't move ... this can only happen if the -r flag is in
  // effect" (line.c:545). It is still a CHARACTER in the line buffer.
  const rawCtl = optCtldisp() === 1;
  const ctlWidth = (char: string): number | null =>
    rawCtl && char.length === 1 && controlByte(char.charCodeAt(0)) &&
      char !== '\b' && char !== '\t'
      ? 0
      : null;

  const pushChars = (segment: string): void => {
    if (!segment) return;

    if (isAscii(segment) && !segment.includes('\x08') && !rawCtl) {
      for (const char of segment) {
        chars.push(char);
        widths.push(1);
      }
    } else if (rawCtl) {
      for (const cluster of splitChars(segment)) {
        chars.push(cluster);

        const ctl = ctlWidth(cluster);

        if (ctl !== null) {
          widths.push(ctl);
        } else if (cluster === '\b') {
          const prev = widths.length ? widths[widths.length - 1] : 0;
          widths.push(prev === 2 ? -2 : -1);
        } else {
          widths.push(isAscii(cluster) ? 1 : strWidth(cluster));
        }
      }
    } else {
      for (const cluster of splitChars(segment)) {
        chars.push(cluster);

        // a raw -u backspace counts less's pwidth: -1, or -2 when it
        // overprints a wide char (line.c:535)
        if (cluster === '\b') {
          const prev = widths.length ? widths[widths.length - 1] : 0;
          widths.push(prev === 2 ? -2 : -1);
        } else {
          widths.push(isAscii(cluster) ? 1 : strWidth(cluster));
        }
      }
    }
  };

  // less's do_append only starts the ANSI state machine when ctldisp is
  // OPT_ONPLUS (line.c:1300); under -r an ESC is not the beginning of
  // a sequence at all - store_control_char stores it as an ordinary
  // AT_NORMAL character (line.c:1193) and the "[31m" after it is
  // PLAIN VISIBLE TEXT, four columns wide. Splitting the sequence off
  // as a zero-width code made every styled line lay out as if -R were
  // still in force.
  if (rawCtl) {
    pushChars(line);
  } else {
    // a charset designation counts here too: sgr0 leads with "\E(B"
    // on xterm and it is not a sequence by less's rule, so laying it out
    // as three printing columns wrapped lines that fit
    STYLE_OR_CHARSET_G.lastIndex = 0;
    let i = 0;
    let ansi: RegExpExecArray | null;

    while ((ansi = STYLE_OR_CHARSET_G.exec(line)) !== null) {
      pushChars(line.slice(i, ansi.index));
      codeIdx.push(chars.length);
      codes.push(ansi[0]);
      i = STYLE_OR_CHARSET_G.lastIndex;
    }

    pushChars(line.slice(i));
  }

  const prefix = new Array<number>(chars.length + 1);
  prefix[0] = 0;
  for (let c = 0; c < chars.length; c++) prefix[c + 1] = prefix[c] + widths[c];

  const atoms = atomsOf(line);
  const tabs = tabsOf(line);
  const rowStart = buildRowStarts(chars, widths, prefix, atoms, tabs);

  const rowStyle = new Array<string>(rowStart.length);
  const rowActive = new Array<string[]>(rowStart.length);
  const active: string[] = [];
  let k = 0;
  let joined = '';
  let snapshot: string[] = [];

  for (let r = 0; r < rowStart.length; r++) {
    let changed = false;

    while (k < codeIdx.length && codeIdx[k] <= rowStart[r]) {
      changed = applyStyleCode(active, codes[k]) || changed;
      k++;
    }

    if (changed) {
      joined = active.join('');
      // `active` keeps mutating, so the row keeps a copy - one per
      // distinct style state, shared by every row that repeats it
      snapshot = active.slice();
    }

    rowStyle[r] = joined;
    rowActive[r] = snapshot;
  }

  return {
    chars, widths, prefix, codeIdx, codes, rowStart, rowStyle, rowActive,
    atoms, tabs,
  };
}

// SGR parameters that end styles, mapped to the openers they cancel
const SGR_CLOSERS = new Map<number, (open: number) => boolean>([
  [22, p => p === 1 || p === 2],
  [23, p => p === 3],
  [24, p => p === 4],
  [25, p => p === 5],
  [27, p => p === 7],
  [28, p => p === 8],
  [29, p => p === 9],
  [39, p => (p >= 30 && p <= 38) || (p >= 90 && p <= 97)],
  [49, p => (p >= 40 && p <= 48) || (p >= 100 && p <= 107)],
]);

// the exit each opening SGR parameter needs, the inverse of
// SGR_CLOSERS - og's at_exit undoes what is on, mode by mode
function closerFor(param: number): number {
  if (param === 1 || param === 2) return 22;
  if (param >= 3 && param <= 9) return param + 20;
  if ((param >= 30 && param <= 38) || (param >= 90 && param <= 97)) return 39;
  if ((param >= 40 && param <= 48) || (param >= 100 && param <= 107)) return 49;

  return 0;
}

/**
 * The escapes that close whatever `text` leaves open.
 *
 * og's pdone ends a row with at_exit(), which emits the EXIT for each
 * attribute mode that is on - "se" for standout, and so on - in the
 * reverse order they were entered (screen.c). It does not blanket-
 * reset: a row of binary markers closes with ESC[27m, not with sgr0.
 * Ours only started needing this once the markers were coalesced into
 * one run, which is what leaves an attribute open at the row edge.
 */
export function closersFor(text: string): string {
  const active: string[] = [];
  STYLE_REGEX_G.lastIndex = 0;

  let code: RegExpExecArray | null;
  while ((code = STYLE_REGEX_G.exec(text)) !== null) {
    applyStyleCode(active, code[0]);
  }

  if (!active.length) return '';

  const seen = new Set<number>();
  let out = '';

  // reverse, like at_exit undoing in the order it did them
  for (let i = active.length - 1; i >= 0; i--) {
    const param = firstSgrParam(active[i]);

    // at_exit opens with tput_color("*"), which puts the COLOUR back
    // to normal rather than naming what to undo. Ours has always spent
    // a full reset for that, and a colour is the one thing here that
    // may have been written by the file itself under -R
    if (param >= 30) return STYLE_RESET;

    const exit = closerFor(param);

    if (exit && !seen.has(exit)) {
      seen.add(exit);
      out += '\x1b[' + exit + 'm';
    }
  }

  return out || STYLE_RESET;
}

/**
 * The first numeric parameter of an SGR code, or 0.
 *
 * Read digit by digit rather than through slice + parseInt: binary
 * content puts an inverse-video pair around EVERY control byte, so a
 * 32K line arrives as 65K codes and this is the hottest thing in the
 * renderer - it was a quarter of the whole profile on a scroll.
 */
function firstSgrParam(code: string): number {
  let value = 0;
  let digits = false;

  for (let i = 2; i < code.length; i++) {
    const ch = code.charCodeAt(i);

    if (ch < 48 || ch > 57) break;

    value = value * 10 + (ch - 48);
    digits = true;
  }

  return digits ? value : 0;
}

/**
 * Applies one ANSI code to the active-style list: a reset clears it,
 * a closing SGR removes the openers it ends, and an opener joins the
 * list once. Without the cancellation, paired codes (bold marker
 * text on binary data) would pile up thousands deep and every
 * continuation row would drag them along.
 *
 * @returns Whether the list changed.
 */
function applyStyleCode(active: string[], code: string): boolean {
  const param = firstSgrParam(code);

  if (code === STYLE_RESET || param === 0) {
    if (!active.length) return false;
    active.length = 0;
    return true;
  }

  const closes = SGR_CLOSERS.get(param);

  if (closes) {
    let changed = false;

    for (let i = active.length - 1; i >= 0; i--) {
      if (closes(firstSgrParam(active[i]))) {
        active.splice(i, 1);
        changed = true;
      }
    }

    return changed;
  }

  if (active.includes(code)) return false;
  active.push(code);
  return true;
}

const isSpace = (char: string): boolean => char === ' ' || char === '\t';

/**
 * Where the screen row that begins at `from` ends - one step of
 * buildRowStarts, taken from an arbitrary character rather than from a
 * boundary.
 *
 * less's forw_line reads from wherever table[TOP] points and stops when
 * the line no longer fits, so a row's extent depends on where it
 * STARTS. Under a plain width that is just from + width, but
 * --wordwrap breaks at spaces, so the answer cannot be translated from
 * the boundary grid - it has to be walked.
 */
/**
 * How many BYTES of the line the first `offset` display characters
 * take up, ANSI codes included.
 *
 * A layout's offsets index `chars`, which holds no codes - they are
 * kept aside in `codes`, anchored by the cluster they precede. So
 * slicing the line by an offset skips every escape above it, and a
 * position derived that way lands short: on a row of colour codes 80
 * columns wide it read 80 bytes where the row really spans 103.
 *
 * A code anchored AT the offset counts: less reads a zero-width
 * escape without triggering the wrap, so it belongs to the row that
 * was being filled when it arrived, not to the one that starts next.
 */
export function rawByteLength(layout: LineLayout, offset: number): number {
  let bytes = 0;

  for (let i = 0; i < offset && i < layout.chars.length; i++) {
    bytes += Buffer.byteLength(layout.chars[i]);
  }

  for (let j = 0; j < layout.codeIdx.length; j++) {
    if (layout.codeIdx[j] > offset) break;
    bytes += Buffer.byteLength(layout.codes[j]);
  }

  return bytes;
}

export function rowEndFrom(layout: LineLayout, from: number): number {
  const { chars, widths, prefix, atoms, tabs } = layout;

  // less's fits_on_screen answers TRUE for everything under -r: "We're
  // not counting" (line.c:842). The whole line is then ONE screen row,
  // however wide, and the terminal wraps it - which is exactly what
  // the manual warns about -r splitting lines in the wrong place.
  if (optCtldisp() === 1) return chars.length;

  const width = config.screenWidth;
  const wordwrap = optWordwrap();

  let len = 0;
  let wrapAt = -1;
  let seenNonSpace = false;
  let c = from;

  while (c < chars.length) {
    // a tab is re-measured from THIS row's left edge, like less's
    // end_column, and consumed whole
    const tab = tabRunAt(tabs, prefix, c, len);
    const step = tab ? tab[0] : widths[c];

    if (len > 0 && len + step > width) {
      if (wordwrap && isSpace(chars[c])) {
        // the space itself no longer fits: swallow the run
        let next = c;
        while (next < chars.length && isSpace(chars[next])) next++;
        return next;
      }

      const at = wordwrap && wrapAt > from ? wrapAt : c;

      // og stores a control or binary rep as ONE unit: storeline
      // refuses to store one that will not fit, so the row ends BEFORE
      // it (line.c). Without this a "^@" at the right margin came out
      // as "^" on this row and "@" on the next, which og never emits.
      return backToRepStart(atoms, prefix, at, from);
    }

    if (isSpace(chars[c])) {
      if (seenNonSpace) wrapAt = c + 1;
    } else {
      seenNonSpace = true;
    }

    if (tab) {
      len += tab[0];
      c += tab[1];
      continue;
    }

    len += widths[c];
    c++;
  }

  return chars.length;
}

/**
 * The index into the raw line string that a display-CHARACTER offset
 * names.
 *
 * The two spaces differ on every styled line - the layout keeps its
 * escape codes in a separate list, so a character index is not a
 * string index - and on every line with clusters or wide characters.
 * Anything holding a position (the screen table, the view's top) works
 * in character space; anything scanning the text itself needs this.
 */
export function stringIndexAt(layout: LineLayout, at: number): number {
  const { chars, codeIdx, codes } = layout;
  if (at <= 0) return 0;

  const stop = Math.min(at, chars.length);
  let index = 0;

  for (let c = 0; c < stop; c++) index += chars[c].length;

  for (let k = 0; k < codeIdx.length; k++) {
    if (codeIdx[k] > stop) break;
    index += codes[k].length;
  }

  return index;
}

/**
 * The display-CHARACTER offset naming a raw string index - the
 * inverse of stringIndexAt, for coming back from a position measured
 * in the line's own bytes.
 */
export function charIndexAt(layout: LineLayout, at: number): number {
  const { chars, codeIdx, codes } = layout;
  if (at <= 0) return 0;

  let index = 0;
  let k = 0;

  for (let c = 0; c < chars.length; c++) {
    while (k < codeIdx.length && codeIdx[k] <= c) {
      index += codes[k].length;
      k++;
    }

    if (index >= at) return c;
    index += chars[c].length;
  }

  return chars.length;
}

/**
 * The drawn text of the characters in [from, to), with the style in
 * force at `from` reopened so the row stands alone like less's (less
 * re-emits attributes per row through at_switch).
 *
 * A space run --wordwrap swallowed at the break is inside the range
 * but past the screen edge, so the width guard still drops it.
 */
/** The last index of `sorted` whose value is <= `target`, or 0. */
function rowIndexAt(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if (sorted[mid] <= target) lo = mid;
    else hi = mid - 1;
  }

  return lo < 0 ? 0 : lo;
}

/** The first index of `sorted` whose value is > `target`. */
function upperBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (sorted[mid] <= target) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

export function emitRange(
  layout: LineLayout,
  from: number,
  to: number
): string {
  const { chars, widths, prefix, codeIdx, codes, rowStart, rowActive } =
    layout;

  // Start from the row boundary at or before `from`, whose active
  // styles the layout already worked out, rather than replaying the
  // whole line's codes. Replaying was quadratic in the number of rows,
  // and binary content is where that bites: every control byte becomes
  // an inverse-video PAIR, so one 32K line is 65K codes across 821
  // rows and drawing them all cost 1.9 SECONDS. A trackpad fling over
  // a binary file therefore stopped painting until it caught up.
  const r = rowIndexAt(rowStart, from);
  const active = rowActive.length > r ? rowActive[r].slice() : [];
  let k = upperBound(codeIdx, rowStart.length > r ? rowStart[r] : 0);

  // whatever falls between that boundary and `from` - one row's worth
  while (k < codeIdx.length && codeIdx[k] <= from) {
    applyStyleCode(active, codes[k]);
    k++;
  }

  const parts: string[] = [...active];
  let width = 0;

  for (let c = from; c < to; c++) {
    while (k < codeIdx.length && codeIdx[k] <= c) {
      parts.push(codes[k]);
      k++;
    }

    // a tab is as wide as THIS row makes it - the row walk measured it
    // the same way, so the two agree on where the row ends
    const tab = tabRunAt(layout.tabs, prefix, c, width);
    const step = tab ? tab[0] : widths[c];

    // the same "not counting" rule: -r draws the whole row
    if (optCtldisp() !== 1 && width + step > config.screenWidth) break;

    if (tab) {
      parts.push(' '.repeat(tab[0]));
      width += tab[0];
      c += tab[1] - 1;
      continue;
    }

    parts.push(chars[c]);
    width += widths[c];
  }

  while (k < codeIdx.length && codeIdx[k] <= to) {
    parts.push(codes[k]);
    k++;
  }

  return parts.join('');
}

/**
 * Computes the sub-row boundaries: fixed width normally; --wordwrap
 * breaks after the last space run, like less's forw_line_seg, where an
 * overflowing space run is swallowed and a single long word still
 * breaks hard at the screen edge.
 */
/**
 * The column a rep containing `col` starts at, or -1.
 *
 * `atoms` is flat start/end pairs in ascending order, so a binary
 * search over the starts finds the only span that can contain it.
 */
function atomStart(atoms: number[], col: number): number {
  let lo = 0;
  let hi = atoms.length / 2;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (atoms[mid * 2] <= col) lo = mid + 1;
    else hi = mid;
  }

  if (lo === 0) return -1;

  const start = atoms[(lo - 1) * 2];

  // strictly inside: a break exactly ON the start is already legal
  return col > start && col < atoms[(lo - 1) * 2 + 1] ? start : -1;
}

/**
 * The width of the tab run starting at char `c`, measured from `len`.
 *
 * less measures a tab from the start of the SCREEN ROW - prewind()
 * zeroes end_column once per row (input.c:148) - while we expanded it
 * against the whole logical line, before rows existed. `len` here IS
 * less's end_column, so re-measuring against it is the same sum less
 * does; the run's own recorded width is discarded.
 *
 * @returns [columns to emit, char entries the run occupies], or null.
 */
function tabRunAt(
  tabs: number[] | undefined,
  prefix: number[],
  c: number,
  len: number
): [number, number] | null {
  if (!tabs) return null;

  const col = prefix[c];

  // the runs are in order, so a binary search over the starts finds it
  let lo = 0;
  let hi = tabs.length / 2;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (tabs[mid * 2] < col) lo = mid + 1;
    else hi = mid;
  }

  if (lo >= tabs.length / 2 || tabs[lo * 2] !== col) return null;

  // every column of an expanded tab is one space, so the run is as
  // many char entries as it is columns
  return [tabWidth(len), tabs[lo * 2 + 1] - col];
}

/**
 * `at`, pulled back to the start of the rep it lands inside.
 *
 * Never past `floor`: a rep wider than the screen has to split, as it
 * must in og too - storeline gives up and the char goes on alone.
 */
function backToRepStart(
  atoms: number[] | undefined,
  prefix: number[],
  at: number,
  floor: number
): number {
  if (!atoms) return at;

  const start = atomStart(atoms, prefix[at]);

  if (start < 0) return at;

  let back = at;

  while (back > 0 && prefix[back] > start) back--;

  return back > floor ? back : at;
}

function buildRowStarts(
  chars: string[],
  widths: number[],
  prefix: number[],
  atoms?: number[],
  tabs?: number[]
): number[] {
  const width = config.screenWidth;
  const wordwrap = optWordwrap();
  const rowStart = [0];

  let len = 0;
  let wrapAt = -1;          // after the last space run (wrap_pos)
  let seenNonSpace = false; // like skipped_leading
  let c = 0;

  while (c < chars.length) {
    // re-measured from this row's left edge, like less's end_column
    const tab = tabRunAt(tabs, prefix, c, len);
    const step = tab ? tab[0] : widths[c];

    if (len > 0 && len + step > width) {
      let next = c;

      if (wordwrap && isSpace(chars[c])) {
        // the space itself no longer fits: swallow the run
        while (next < chars.length && isSpace(chars[next])) next++;
        if (next >= chars.length) break;
      } else if (wordwrap && wrapAt > rowStart[rowStart.length - 1]) {
        next = wrapAt;
      }

      // og keeps a rep whole - see backToRepStart
      next = backToRepStart(
        atoms, prefix, next, rowStart[rowStart.length - 1]);

      rowStart.push(next);
      len = 0;
      wrapAt = -1;
      seenNonSpace = false;
      c = next;
      continue;
    }

    if (isSpace(chars[c])) {
      if (seenNonSpace) wrapAt = c + 1;
    } else {
      seenNonSpace = true;
    }

    if (tab) {
      len += tab[0];
      c += tab[1];
      continue;
    }

    len += widths[c];
    c++;
  }

  return rowStart;
}
