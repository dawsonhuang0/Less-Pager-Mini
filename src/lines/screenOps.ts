import { config } from '../state/config';
import { chopLine } from '../options';

import { getLayout, rowEndFrom } from './lineLayout';

import { ScreenRow } from './screenTable';

/**
 * less's position.c operations on the screen table.
 *
 * The table is the screen: one entry per row, holding where that row
 * starts. `add_forw_pos` drops the front and appends at the bottom,
 * `add_back_pos` prepends at the top, `pos_clear` empties it so the
 * next paint regenerates from the top position alone.
 *
 * The entries a backward move prepends are the whole reason the table
 * exists rather than a top plus a wrapping rule: back_line re-wraps
 * from the LINE's start and stops the moment it reaches the row that
 * used to be on top ("if (new_pos >= curr_pos) break", input.c), so
 * the row it exposes is bounded by the old screen and the rows below
 * keep the extents they already had. A single (row, subRow) top can
 * only say where the screen begins, never that.
 */

/**
 * Where the row containing `offset` begins.
 *
 * less's back_line reads back to the LINE's start and re-wraps forward
 * from there (input.c:358), so it lands on the greatest row start
 * BELOW the position it was given. A top part-way into a row therefore
 * steps to the boundary it sits inside, and that IS one row - the same
 * move as any other, needing no special case of its own.
 */
export function rowStartBelow(line: string, offset: number): number {
  if (offset <= 0 || chopLine() || config.col) return 0;

  // The layout already HOLDS every row start (buildRowStarts), so the
  // answer is a lookup. Re-walking the line with rowEndFrom from 0
  // made this O(rows), and getLastRow calls it once per screen row -
  // on a 360 KB line wrapped at 80 columns that is ~4500 steps a call
  // and ~100k a keypress, which is what made scrolling it crawl.
  const starts = getLayout(line).rowStart;
  let lo = 0;
  let hi = starts.length - 1;
  let best = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;

    if (starts[mid] < offset) {
      best = starts[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

/** The offset of a line's last display row. */
export function lastRowStart(line: string): number {
  if (chopLine() || config.col) return 0;

  // the last entry of the same array, rather than stepping to it
  const starts = getLayout(line).rowStart;
  return starts[starts.length - 1] ?? 0;
}

/**
 * The next row's offset, or null when this row ends the line - one
 * forw_line step, taken from wherever the row actually starts.
 */
export function nextRowOffset(line: string, offset: number): number | null {
  if (chopLine() || config.col) return null;

  const layout = getLayout(line);
  const end = rowEndFrom(layout, offset);

  return end < layout.chars.length && end > offset ? end : null;
}

/** The offset a given wrap sub-row begins at. */
export function rowOffsetOf(line: string, subRow: number): number {
  if (chopLine() || config.col) return 0;
  return getLayout(line).rowStart[subRow] ?? 0;
}

/** The wrap sub-row an offset falls in, for the renderer's index. */
export function subRowAt(line: string, offset: number): number {
  if (chopLine() || config.col) return 0;

  // same array, same reason: the last row whose start is at or before
  // the offset, found rather than counted to
  const starts = getLayout(line).rowStart;
  let lo = 0;
  let hi = starts.length - 1;
  let sub = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;

    if (starts[mid] <= offset) {
      sub = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return sub;
}

/**
 * Puts the top at a place in a line, deriving the sub-row index and
 * remainder the renderer still asks for.
 *
 * Movement works in offsets, like less's table entries; nothing outside
 * this function may set the two halves independently, or they can
 * disagree about where the screen starts.
 */
export function setTopOffset(line: string, row: number, at: number): void {
  config.row = row;
  config.subRow = subRowAt(line, at);
  config.subShift = at - (getLayout(line).rowStart[config.subRow] ?? 0);
}

/** The row that follows a table entry, or null at end of content. */
function rowAfter(content: string[], cell: ScreenRow): ScreenRow | null {
  const layout = getLayout(content[cell.row] ?? '');

  if (cell.end < layout.chars.length) {
    return {
      row: cell.row,
      offset: cell.end,
      end: rowEndFrom(layout, cell.end),
    };
  }

  const row = cell.row + 1;
  if (row >= content.length) return null;

  const next = getLayout(content[row] ?? '');
  return { row, offset: 0, end: rowEndFrom(next, 0) };
}

/**
 * less's add_forw_pos (position.c:63), which forw() calls once per row
 * DRAWN: it shifts the whole table up and appends the new bottom row
 * in ONE operation, so the table stays sc_height long and the top
 * moves BECAUSE of the shift.
 *
 * We used to do only the dropping here and let buildScreen extend the
 * bottom separately. That was harmless while the table held just the
 * seam, but once it holds every row the two halves disagree about who
 * owns the bottom and a forward move lands on the wrong line.
 */
export function screenForward(content: string[], rows: number): number {
  const table = config.screen;
  if (!table.length || rows <= 0) return 0;

  // the table is only ever valid while its first entry IS the top;
  // anything that moved the top without going through it has already
  // invalidated it, which is pos_clear by another name
  const starts = getLayout(content[config.row] ?? '').rowStart;
  const top = (starts[config.subRow] ?? 0) + config.subShift;

  if (table[0].row !== config.row || table[0].offset !== top) {
    config.screen = [];
    return 0;
  }

  let used = 0;

  while (used < rows) {
    const next = rowAfter(content, table[table.length - 1]);
    if (next === null) break;

    table.shift();
    table.push(next);
    used++;
  }

  if (used > 0) {
    const first = table[0];
    setTopOffset(content[first.row] ?? '', first.row, first.offset);
  }

  return used;
}

/** The top's character offset in its line, in the layout's own space. */
export function topOffsetOf(content: string[]): number {
  const starts = getLayout(content[config.row] ?? '').rowStart;
  return (starts[config.subRow] ?? 0) + config.subShift;
}

/**
 * The entries from `top` forward until the row that reaches `bound`,
 * which is where the screen used to start.
 *
 * A source engine re-materializes its window on every paint, so the
 * indices a backward move would have recorded beforehand are gone by
 * the time the entries are needed. Walking forward from the new top
 * rebuilds exactly the same rows - back_line landed it on the absolute
 * grid, so the walk retraces its steps - and the last one is cut at
 * the bound, which is the seam.
 */
export function screenAhead(
  content: string[],
  top: { row: number, offset: number },
  bound: number
): ScreenRow[] {
  const rows: ScreenRow[] = [];
  const layout = getLayout(content[top.row] ?? '');

  let offset = top.offset;

  while (offset < bound && rows.length < 1000) {
    let end = rowEndFrom(layout, offset);
    if (end <= offset) break;

    if (end > bound) end = bound;
    rows.push({ row: top.row, offset, end });
    offset = end;
  }

  return rows;
}

/** The rows a backward step exposes, newest first, like back_line. */
export function screenBack(
  content: string[],
  rows: number,
  first: ScreenRow
): ScreenRow[] {
  const added: ScreenRow[] = [];

  let row = first.row;
  let bound = first.offset;

  for (let n = 0; n < rows; n++) {
    if (bound <= 0) {
      // step onto the previous line, at its last row
      if (row <= 0) break;
      row--;
      bound = getLayout(content[row] ?? '').chars.length;
    }

    // back_line re-wraps from the line's beginning and keeps the last
    // start that is still below the bound: that row then ENDS at the
    // bound, which is what leaves the short row at a scroll seam
    const layout = getLayout(content[row] ?? '');
    let start = 0;
    let next = rowEndFrom(layout, 0);

    while (next < bound) {
      start = next;
      next = rowEndFrom(layout, start);
      if (next <= start) break;
    }

    added.unshift({ row, offset: start, end: bound });
    bound = start;
  }

  return added;
}
