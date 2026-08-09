import { BlockFile } from './blockFile';

import { decodeContent } from '../features/charset';

import { optSqueeze } from '../options';

/** True when the byte is a newline char, like og's '\n' || '\r'. */
const isNl = (b: number | undefined): boolean => b === 0x0A || b === 0x0D;

/**
 * On-demand line reading over a BlockFile, ported from og input.c's
 * forw_line/back_line: lines materialize from byte positions, so no
 * line index or full scan is ever required.
 */

/** Pathological lines split at this many bytes (og grows linebuf;
 *  we bound memory instead — the renderer wraps/chops anyway, and
 *  every split segment costs a transform+layout per visible row). */
export const MAX_LINE = 1 << 16;

interface ForwLine {
  text: string;
  /** Start of the next line (past the newline), or the file size. */
  next: number;
  /** True when the cap split a newline-less monster line. */
  split: boolean;
}

interface BackLine {
  text: string;
  /** Start position of the returned line. */
  start: number;
}

// og builds a line's linebuf ONCE, reading its bytes through
// ch_forw_get's buffered blocks, and every row of that line is then
// drawn out of the buffer it already holds. Ours rebuilds the decoded
// string from scratch on each call, and a screen walk asks for the
// same line once per display row it covers - twenty-odd times inside
// one long line, per keypress, each time decoding and allocating
// another 64K copy. Remembering the last few lines makes the repeats
// free, and hands back the same string OBJECT, so the transform and
// layout memos keyed on it hit instead of re-hashing 64K.
const lineMemo = new WeakMap<BlockFile, {
  size: number,
  squeeze: boolean,
  lines: Map<number, ForwLine>,
}>();

const LINE_MEMO_LIMIT = 64;

/**
 * Reads the line starting at `pos`, like forw_line.
 *
 * The result is shared with the other callers reading the same
 * position, so it must be treated as read-only.
 */
export function forwLine(bf: BlockFile, pos: number): ForwLine | null {
  if (pos >= bf.size) return null;

  const squeeze = optSqueeze();
  let memo = lineMemo.get(bf);

  // a growing file (a spool, an -F follow) can turn what was the last
  // line into the start of a longer one, and -s changes which lines
  // fold together, so neither can be answered from the old memo
  if (!memo || memo.size !== bf.size || memo.squeeze !== squeeze) {
    memo = { size: bf.size, squeeze, lines: new Map() };
    lineMemo.set(bf, memo);
  }

  const hit = memo.lines.get(pos);
  if (hit) return hit;

  const line = readForwLine(bf, pos, squeeze);

  if (memo.lines.size >= LINE_MEMO_LIMIT) memo.lines.clear();
  memo.lines.set(pos, line);

  return line;
}

function readForwLine(
  bf: BlockFile,
  pos: number,
  squeeze: boolean
): ForwLine {
  const nl = bf.findNewline(pos, MAX_LINE);

  if (nl < 0) {
    // no newline in reach: cut at the absolute MAX_LINE grid so the
    // same boundaries appear when walking backward
    const grid = (Math.floor(pos / MAX_LINE) + 1) * MAX_LINE;
    const end = Math.min(grid, bf.size);
    return {
      text: decodeContent(bf.readRange(pos, end - pos)),
      next: end,
      split: end < bf.size,
    };
  }

  let next = nl + 1;

  // og's forw_line under -s: a blank line skips down to the last
  // contiguous blank and pretends to be it (input.c:325), so the
  // run displays as this one line
  if (squeeze && nl === pos) {
    while (next < bf.size && isNl(bf.readRange(next, 1)[0])) next++;
  }

  return {
    text: decodeContent(bf.readRange(pos, nl - pos)),
    next,
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

  // og's back_line under -s: when the current line is blank, the
  // whole preceding blank run skips away — the run's first newline
  // folds into the non-blank line above (input.c:387)
  if (optSqueeze() && pos < bf.size &&
      isNl(bf.readRange(pos, 1)[0])) {
    while (pos > 0 && isNl(bf.readRange(pos - 1, 1)[0])) pos--;
    if (pos === 0) return null;
  }

  const endsAtNl = bf.readRange(pos - 1, 1)[0] === 0x0A;
  const end = endsAtNl ? pos - 1 : pos;
  const prevNl = bf.findNewlineBack(end, MAX_LINE);

  // without a newline in reach the previous segment starts on the
  // same absolute grid the forward walk cuts at
  const grid = Math.floor((end - 1) / MAX_LINE) * MAX_LINE;
  const start = prevNl < 0
    ? Math.max(grid, 0)
    : Math.max(prevNl + 1, endsAtNl ? 0 : grid);

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
