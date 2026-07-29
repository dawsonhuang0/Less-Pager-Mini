import { config } from '../state/config';

import { getLayout, rowEndFrom } from './lineLayout';

import { ScreenRow } from './screenTable';

/**
 * og's position.c operations on the screen table.
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

/** og's pos_clear: the table is empty and the paint rebuilds it. */
export function screenClear(): void {
  config.screen = [];
}

/**
 * og's add_forw_pos dropping table[0] per row drawn: the entries a
 * backward move prepended are walked off the top before the grid below
 * resumes. Returns how many rows it consumed, and leaves the top on
 * the first entry that remains.
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

  const used = Math.min(rows, table.length);
  const rest = table.slice(used);
  config.screen = rest;

  // the top is the first entry left, or - once they are all walked
  // off - wherever the last one ended, which is where the grid below
  // the seam resumes
  const last = table[used - 1];
  let row = rest.length ? rest[0].row : last.row;
  let offset = rest.length ? rest[0].offset : last.end;

  if (offset >= getLayout(content[row] ?? '').chars.length) {
    row++;
    offset = 0;
  }

  config.row = row;

  const at = getLayout(content[row] ?? '').rowStart;
  let sub = 0;
  while (sub + 1 < at.length && at[sub + 1] <= offset) sub++;

  config.subRow = sub;
  config.subShift = offset - (at[sub] ?? 0);

  return used;
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
