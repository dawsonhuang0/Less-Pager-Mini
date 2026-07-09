import { strWidth } from 'char-width';

import { config } from '../config';

import { isAscii, splitChars } from '../helpers';

import { optWordwrap } from '../options';

import { STYLE_REGEX_G, STYLE_RESET } from '../constants';

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

/**
 * Returns the cached layout for a line, building it on first access.
 *
 * - The cache is invalidated when the screen width changes.
 *
 * @param line - The raw content line.
 * @returns The line's layout for the current screen width.
 */
export function getLayout(line: string): LineLayout {
  if (cacheWidth !== config.screenWidth || cacheWordwrap !== optWordwrap()) {
    cache = new Map();
    cacheWidth = config.screenWidth;
    cacheWordwrap = optWordwrap();
  }

  let layout = cache.get(line);

  if (!layout) {
    layout = buildLayout(line);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(line, layout);
  }

  return layout;
}

/**
 * Emits one wrapped row of a line as a string.
 *
 * - Codes anchored exactly at the row start belong to the previous row's
 *   tail, except on row 0 where leading codes are emitted inline.
 *
 * @param layout - The line's layout.
 * @param row - Wrapped row index to emit.
 * @returns The row content including inline ANSI codes.
 */
export function emitRow(layout: LineLayout, row: number): string {
  const start = layout.rowStart[row];
  const end = row + 1 < layout.rowStart.length
    ? layout.rowStart[row + 1]
    : layout.chars.length;

  const parts: string[] = [];
  let k = firstCode(layout, row === 0 ? start : start + 1);
  let width = 0;

  for (let c = start; c < end; c++) {
    while (k < layout.codeIdx.length && layout.codeIdx[k] <= c) {
      parts.push(layout.codes[k]);
      k++;
    }

    // a space run swallowed by --wordwrap stays off the screen
    if (width + layout.widths[c] > config.screenWidth) break;

    parts.push(layout.chars[c]);
    width += layout.widths[c];
  }

  while (k < layout.codeIdx.length && layout.codeIdx[k] <= end) {
    parts.push(layout.codes[k]);
    k++;
  }

  return parts.join('');
}

function buildLayout(line: string): LineLayout {
  const chars: string[] = [];
  const widths: number[] = [];
  const codeIdx: number[] = [];
  const codes: string[] = [];

  const pushChars = (segment: string): void => {
    if (!segment) return;

    if (isAscii(segment)) {
      for (const char of segment) {
        chars.push(char);
        widths.push(1);
      }
    } else {
      for (const cluster of splitChars(segment)) {
        chars.push(cluster);
        widths.push(strWidth(cluster));
      }
    }
  };

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

  const prefix = new Array<number>(chars.length + 1);
  prefix[0] = 0;
  for (let c = 0; c < chars.length; c++) prefix[c + 1] = prefix[c] + widths[c];

  const rowStart = buildRowStarts(chars, widths);

  const rowStyle = new Array<string>(rowStart.length);
  let active: string[] = [];
  let k = 0;

  for (let r = 0; r < rowStart.length; r++) {
    while (k < codeIdx.length && codeIdx[k] <= rowStart[r]) {
      if (codes[k] === STYLE_RESET) {
        active = [];
      } else {
        active.push(codes[k]);
      }

      k++;
    }

    rowStyle[r] = active.join('');
  }

  return { chars, widths, prefix, codeIdx, codes, rowStart, rowStyle };
}

const isSpace = (char: string): boolean => char === ' ' || char === '\t';

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

function firstCode(layout: LineLayout, threshold: number): number {
  const { codeIdx } = layout;
  let lo = 0, hi = codeIdx.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (codeIdx[mid] < threshold) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}
