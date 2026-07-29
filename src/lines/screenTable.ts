import { config } from '../state/config';

import { getLayout, rowEndFrom, emitRange } from './lineLayout';

import { withReset } from './helpers';

import { gutterOverflow } from '../helpers';

/**
 * og's position table (position.c): one entry per screen row, holding
 * where that row STARTS.
 *
 * og's screen is not a top plus a wrapping rule - it is this array.
 * `position(sindex)` reads it, `add_forw_pos` drops the front and
 * appends, `add_back_pos` prepends, `pos_clear` empties it. Because
 * every row carries its own start, rows above and below a scroll seam
 * can sit on different grids, a row can begin mid-boundary, and a
 * width change simply regenerates the extents from the same starts.
 * Our `(row, subRow)` top could express none of that, which is what
 * config.subShift and config.subAnchor were bolted on to fake.
 *
 * Offsets count DISPLAY CHARACTERS, the space the layout's rowStart
 * indexes - never string indices, which differ on any styled line
 * because the layout keeps its escape codes in a separate list.
 */
export interface ScreenRow {
  /** Index into the display content. */
  row: number;
  /** Display-character offset into that line where this row begins. */
  offset: number;
  /**
   * Where it ends. og reads this off the NEXT entry, but the bottom
   * row has no next one and a row the seam cut short must stay short
   * there too, so each entry carries its own.
   */
  end: number;
}

/**
 * Fills the table forward from the current top, like og's forw()
 * appending an entry per row it draws.
 *
 * @param lineAt - The line as it will be DRAWN (highlights spliced in),
 *   so an entry's offset means the same thing to the renderer.
 * @param count - How many content lines exist.
 * @param cap - How many rows the screen still has room for.
 */
export function buildScreen(
  lineAt: (row: number) => string,
  count: number,
  cap: number
): ScreenRow[] {
  let row = config.row;
  let line = row < count ? lineAt(row) : '';
  let offset = (getLayout(line).rowStart[config.subRow] ?? 0) +
    config.subShift;

  // og's table survives a scroll: the entries a backward move
  // prepended describe rows that cannot be re-derived, because
  // back_line bounded them at the row that used to be on top. It is
  // only ever valid while its first entry IS the top - anything that
  // moved the top without going through the table has invalidated it,
  // which is pos_clear by another name.
  const kept = config.screen;
  const valid = kept.length > 0 && kept[0].row === row &&
    kept[0].offset === offset && kept[kept.length - 1].row < count;

  const rows: ScreenRow[] = valid ? kept.slice(0, cap) : [];
  if (!valid && kept.length) config.screen = [];

  if (rows.length) {
    const last = rows[rows.length - 1];
    row = last.row;
    line = row < count ? lineAt(row) : '';
    offset = last.end;

    if (offset >= getLayout(line).chars.length) {
      row++;
      offset = 0;
      line = row < count ? lineAt(row) : '';
    }
  }

  while (rows.length < cap && row < count) {
    // a number wider than the -N field eats the line's text columns,
    // so the extent has to be measured under the width it is drawn with
    const shrink = gutterOverflow(row);
    config.screenWidth -= shrink;
    const end = rowEndFrom(getLayout(line), offset);
    config.screenWidth += shrink;

    rows.push({ row, offset, end });

    if (end >= getLayout(line).chars.length) {
      row++;
      offset = 0;
      line = row < count ? lineAt(row) : '';
    } else {
      offset = end;
    }
  }

  return rows;
}

/**
 * The drawn text of one table entry: from its own start to where the
 * NEXT entry starts, so a row the table cut short stays short.
 */
export function rowText(cell: ScreenRow, line: string): string {
  return withReset(emitRange(getLayout(line), cell.offset, cell.end));
}
