import { BlockFile } from './ch';

import { decodeContent } from '../features/charset';

/**
 * On-demand line reading over a BlockFile, ported from og input.c's
 * forw_line/back_line: lines materialize from byte positions, so no
 * line index or full scan is ever required.
 */

/** Pathological lines split at this many bytes (og grows linebuf;
 *  we bound memory instead — the renderer wraps/chops anyway). */
export const MAX_LINE = 1 << 20;

export interface ForwLine {
  text: string;
  /** Start of the next line (past the newline), or the file size. */
  next: number;
  /** True when the cap split a newline-less monster line. */
  split: boolean;
}

export interface BackLine {
  text: string;
  /** Start position of the returned line. */
  start: number;
}

/**
 * Reads the line starting at `pos`, like forw_line.
 */
export function forwLine(bf: BlockFile, pos: number): ForwLine | null {
  if (pos >= bf.size) return null;

  const nl = bf.findNewline(pos, MAX_LINE);

  if (nl < 0) {
    const end = Math.min(pos + MAX_LINE, bf.size);
    return {
      text: decodeContent(bf.readRange(pos, end - pos)),
      next: end,
      split: end < bf.size,
    };
  }

  return {
    text: decodeContent(bf.readRange(pos, nl - pos)),
    next: nl + 1,
    split: false,
  };
}

/**
 * Reads the line that ends just before line-start `pos`, like
 * back_line walking to the previous newline.
 *
 * @param pos - A known line start (0 returns null).
 */
export function backLine(bf: BlockFile, pos: number): BackLine | null {
  if (pos <= 0) return null;

  // pos - 1 is the newline ending the previous line (or the last
  // byte of a split segment); find the newline before it
  const prevNl = bf.findNewlineBack(pos - 1, MAX_LINE);
  const start = prevNl < 0 ? Math.max(pos - 1 - MAX_LINE, 0) : prevNl + 1;
  const end = bf.readRange(pos - 1, 1)[0] === 0x0A ? pos - 1 : pos;

  return {
    text: decodeContent(bf.readRange(start, end - start)),
    start,
  };
}

/**
 * The start of the last line of the file, like og's end-of-file seek
 * for G: a trailing newline belongs to the line before it.
 */
export function lastLineStart(bf: BlockFile): number {
  if (bf.size === 0) return 0;

  const lastByte = bf.readRange(bf.size - 1, 1)[0];
  const scanFrom = lastByte === 0x0A ? bf.size - 1 : bf.size;
  const nl = bf.findNewlineBack(scanFrom, MAX_LINE);

  return nl < 0 ? Math.max(scanFrom - MAX_LINE, 0) : nl + 1;
}
