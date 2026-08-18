import { BlockFile } from './blockFile';

import { decodeContent } from '../features/charset';

import { optSqueeze, chopLine } from '../options';

import { config } from '../state/config';

/** True when the byte is a newline char, like less's '\n' || '\r'. */
const isNl = (b: number | undefined): boolean => b === 0x0A || b === 0x0D;

/**
 * On-demand line reading over a BlockFile, ported from less input.c's
 * forw_line/back_line: lines materialize from byte positions, so no
 * line index or full scan is ever required.
 */

/** Pathological lines split at this many bytes (less grows linebuf;
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

// less builds a line's linebuf ONCE, reading its bytes through
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
  /** less's skipeol: `chop_line() || hshift > 0` (input.c:348). */
  skipeol: boolean,
  /** How much of the line skipeol kept, so a wider shift re-reads. */
  extent: number,
  lines: Map<number, ForwLine>,
}>();

const LINE_MEMO_LIMIT = 64;

/**
 * Reads the line starting at `pos`, like forw_line.
 *
 * The result is shared with the other callers reading the same
 * position, so it must be treated as read-only.
 */
export function forwLine(
  bf: BlockFile,
  pos: number,
  noScan = false
): ForwLine | null {
  if (pos >= bf.size) return null;

  const squeeze = optSqueeze();
  // less's skipeol, and how much of the line it keeps
  const skipeol = chopLine() || config.col > 0;
  const extent = config.col + config.screenWidth;
  let memo = lineMemo.get(bf);

  // a growing file (a spool, an -F follow) can turn what was the last
  // line into the start of a longer one, and -s changes which lines
  // fold together, so neither can be answered from the old memo.
  //
  // Nor can a change of skipeol: the same position yields a DIFFERENT
  // line under it - one visible row ending at the real newline, versus
  // the 64 KiB grid piece a wrapped read cuts. Without this the memo
  // serves the pre-shift pieces after ESC-) and the fix above reaches
  // only positions nothing has read yet.
  if (!memo || memo.size !== bf.size || memo.squeeze !== squeeze ||
      memo.skipeol !== skipeol || (skipeol && memo.extent !== extent)) {
    memo = { size: bf.size, squeeze, skipeol, extent, lines: new Map() };
    lineMemo.set(bf, memo);
  }

  const hit = memo.lines.get(pos);
  if (hit) return hit;

  const line = readForwLine(bf, pos, squeeze, noScan);

  // declined, not read: nothing to remember, and the caller asks
  // again without noScan when it decides to pay after all
  if (!line) return null;

  if (memo.lines.size >= LINE_MEMO_LIMIT) memo.lines.clear();
  memo.lines.set(pos, line);

  return line;
}

/**
 * less's skip to the end of the line: `while (c != '\n') c =
 * ch_forw_get()`. Unbounded, because the LINE's end is where the next
 * one starts - the 64 KiB bound applies to what we build, not to how
 * far the line runs.
 */
function newlineAfter(bf: BlockFile, pos: number): number {
  let at = pos;

  for (;;) {
    const nl = bf.findNewline(at, MAX_LINE);
    if (nl >= 0) return nl + 1;

    at += MAX_LINE;
    if (at >= bf.size) return bf.size;
  }
}

/**
 * @param noScan - Return null rather than run the unbounded scan for
 *   a chopped line's end. Only the read-ahead passes it: the newline
 *   search here is the ONE the line costs, so a caller that probes
 *   with noScan and then reads for real pays it twice - and a caller
 *   that probes separately, before calling at all, pays it twice on
 *   EVERY line. That cost is what pushed G past the slow-command
 *   threshold and left the -M prompt held off the screen.
 */
function readForwLine(
  bf: BlockFile,
  pos: number,
  squeeze: boolean,
  noScan = false
): ForwLine | null {
  const nl = bf.findNewline(pos, MAX_LINE);

  if (nl < 0) {
    // less's forw_line passes skipeol = `chop_line() || hshift > 0`
    // (input.c:348): it builds the ONE visible row and then breaks
    // with `endline = TRUE; chopped = TRUE` (input.c:502), skipping
    // the rest of the line to its newline. One file line is one screen
    // row, however long the line is.
    //
    // Cutting at the MAX_LINE grid instead handed each 64 KiB piece
    // back as its own LINE, so a 360 KB line drew as six rows, each
    // chopped from hshift and 65536 bytes apart. The cap is there to
    // bound MEMORY; it must bound what we BUILD, not what counts as a
    // line.
    if (chopLine() || config.col) {
      // the end is not within reach and the file has more to give:
      // finding it is the unbounded walk, so a read-ahead declines
      if (noScan && bf.size - pos > MAX_LINE) return null;

      // enough bytes for the shifted row and no more (UTF-8 is at most
      // 4 bytes per character, so this cannot come up short)
      const want = (config.col + config.screenWidth + 1) * 4;
      const stop = Math.min(pos + want, bf.size);

      return {
        text: decodeContent(bf.readRange(pos, stop - pos)),
        next: newlineAfter(bf, pos),
        split: false,
      };
    }

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

  // less's forw_line under -s: a blank line skips down to the last
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

  // less's back_line under -s: when the current line is blank, the
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
 * The start of the last line of the file, like less's end-of-file seek
 * for G: a trailing newline belongs to the line before it.
 */
export function lastLineStart(bf: BlockFile): number {
  if (bf.size === 0) return 0;

  const lastByte = bf.readRange(bf.size - 1, 1)[0];
  const scanFrom = lastByte === 0x0A ? bf.size - 1 : bf.size;
  const nl = bf.findNewlineBack(scanFrom, MAX_LINE);

  return nl < 0 ? Math.max(scanFrom - MAX_LINE, 0) : nl + 1;
}
