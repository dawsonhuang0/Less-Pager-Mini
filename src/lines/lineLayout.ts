import { strWidth } from 'char-width';

import { config } from '../state/config';

import { isAscii, splitChars } from './helpers';

import { controlByte } from '../features/charset';

import { optWordwrap, optCtldisp } from '../options';

import { STYLE_REGEX_G, STYLE_RESET } from '../state/constants';

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
}

const CACHE_LIMIT = 5000;

let cache = new Map<string, LineLayout>();
let cacheWidth = 0;
let cacheWordwrap = false;
let cacheCtldisp = -1;

// Which layout the cached extents came from. og never needs this: its
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
    cacheWidth = config.screenWidth;
    cacheWordwrap = optWordwrap();
    cacheCtldisp = optCtldisp();
    generation++;
  }

  let layout = cache.get(line);

  if (!layout) {
    layout = buildLayout(line);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(line, layout);
  }

  return layout;
}

function buildLayout(line: string): LineLayout {
  const chars: string[] = [];
  const widths: number[] = [];
  const codeIdx: number[] = [];
  const codes: string[] = [];

  // og's pwidth: a control character under -r moves the cursor by an
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

        // a raw -u backspace counts og's pwidth: -1, or -2 when it
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

  // og's do_append only starts the ANSI state machine when ctldisp is
  // OPT_ONPLUS (line.c:1300); under -r an ESC is not the beginning of
  // a sequence at all - store_control_char stores it as an ordinary
  // AT_NORMAL character (line.c:1193) and the "[31m" after it is
  // PLAIN VISIBLE TEXT, four columns wide. Splitting the sequence off
  // as a zero-width code made every styled line lay out as if -R were
  // still in force.
  if (rawCtl) {
    pushChars(line);
  } else {
    STYLE_REGEX_G.lastIndex = 0;
    let i = 0;
    let ansi: RegExpExecArray | null;

    while ((ansi = STYLE_REGEX_G.exec(line)) !== null) {
      pushChars(line.slice(i, ansi.index));
      codeIdx.push(chars.length);
      codes.push(ansi[0]);
      i = STYLE_REGEX_G.lastIndex;
    }

    pushChars(line.slice(i));
  }

  const prefix = new Array<number>(chars.length + 1);
  prefix[0] = 0;
  for (let c = 0; c < chars.length; c++) prefix[c + 1] = prefix[c] + widths[c];

  const rowStart = buildRowStarts(chars, widths);

  const rowStyle = new Array<string>(rowStart.length);
  const active: string[] = [];
  let k = 0;
  let joined = '';

  for (let r = 0; r < rowStart.length; r++) {
    let changed = false;

    while (k < codeIdx.length && codeIdx[k] <= rowStart[r]) {
      changed = applyStyleCode(active, codes[k]) || changed;
      k++;
    }

    if (changed) joined = active.join('');
    rowStyle[r] = joined;
  }

  return { chars, widths, prefix, codeIdx, codes, rowStart, rowStyle };
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

const firstSgrParam = (code: string): number =>
  parseInt(code.slice(2), 10) || 0;

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
  if (code === STYLE_RESET || firstSgrParam(code) === 0) {
    if (!active.length) return false;
    active.length = 0;
    return true;
  }

  const param = firstSgrParam(code);
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
 * og's forw_line reads from wherever table[TOP] points and stops when
 * the line no longer fits, so a row's extent depends on where it
 * STARTS. Under a plain width that is just from + width, but
 * --wordwrap breaks at spaces, so the answer cannot be translated from
 * the boundary grid - it has to be walked.
 */
export function rowEndFrom(layout: LineLayout, from: number): number {
  const { chars, widths } = layout;

  // og's fits_on_screen answers TRUE for everything under -r: "We're
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
    if (len > 0 && len + widths[c] > width) {
      if (wordwrap && isSpace(chars[c])) {
        // the space itself no longer fits: swallow the run
        let next = c;
        while (next < chars.length && isSpace(chars[next])) next++;
        return next;
      }

      return wordwrap && wrapAt > from ? wrapAt : c;
    }

    if (isSpace(chars[c])) {
      if (seenNonSpace) wrapAt = c + 1;
    } else {
      seenNonSpace = true;
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
 * force at `from` reopened so the row stands alone like og's (og
 * re-emits attributes per row through at_switch).
 *
 * A space run --wordwrap swallowed at the break is inside the range
 * but past the screen edge, so the width guard still drops it.
 */
export function emitRange(
  layout: LineLayout,
  from: number,
  to: number
): string {
  const { chars, widths, codeIdx, codes } = layout;
  const active: string[] = [];
  let k = 0;

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

    // the same "not counting" rule: -r draws the whole row
    if (optCtldisp() !== 1 && width + widths[c] > config.screenWidth) break;

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
function buildRowStarts(chars: string[], widths: number[]): number[] {
  const width = config.screenWidth;
  const wordwrap = optWordwrap();
  const rowStart = [0];

  let len = 0;
  let wrapAt = -1;          // after the last space run (wrap_pos)
  let seenNonSpace = false; // like skipped_leading
  let c = 0;

  while (c < chars.length) {
    if (len > 0 && len + widths[c] > width) {
      let next = c;

      if (wordwrap && isSpace(chars[c])) {
        // the space itself no longer fits: swallow the run
        while (next < chars.length && isSpace(chars[next])) next++;
        if (next >= chars.length) break;
      } else if (wordwrap && wrapAt > rowStart[rowStart.length - 1]) {
        next = wrapAt;
      }

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

    len += widths[c];
    c++;
  }

  return rowStart;
}
