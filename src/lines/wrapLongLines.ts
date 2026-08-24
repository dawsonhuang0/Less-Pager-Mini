import { config } from '../state/config';

import { gutterFor, gutterOverflow, decoratedRows, highlightRow }
  from '../helpers';
import { buildScreen, rowText } from './screenTable';
import { setRowEnd } from './rowEnds';
import { getLayout } from './lineLayout';

import { highlightLine } from '../features/searching';


/**
 * Wraps lines into subrows to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of wrapped lines.
 */
export function wrapLongLines(content: string[], lines: string[]): void {
  const decorated = decoratedRows();

  // the line as it will be DRAWN, so the table's offsets and the
  // renderer's slices mean the same thing
  const drawn = new Map<number, string>();
  const lineAt = (row: number): string => {
    let hl = drawn.get(row);
    if (hl === undefined) {
      hl = highlightLine(content[row] ?? '', row);
      drawn.set(row, hl);
    }
    return hl;
  };

  const table = buildScreen(
    lineAt, content.length, config.window - 1 - lines.length);

  for (const cell of table) {
    if (lines.length >= config.window - 1) break;

    const at = lines.length;

    // a number wider than the -N field eats the line's text columns
    const shrink = gutterOverflow(cell.row);
    config.screenWidth -= shrink;
    const text = rowText(cell, lineAt(cell.row));
    config.screenWidth += shrink;

    // less's forw_line_seg reports whether the newline or the screen
    // width ended this segment, and pdone terminates the row on that
    // answer (input.c:279) - so the table's own "did I reach the end
    // of the line" test is what the painters need to be told
    setRowEnd(at, cell.end >= getLayout(lineAt(cell.row)).chars.length);

    // every emitted row of the line gets the same gutter, like less's
    // per-row plinestart from base_pos; -w and --status-line
    // highlight the row in standout
    lines.push(decorated
      ? gutterFor(content, cell.row, cell.offset, cell.end) +
        highlightRow(text, cell.row, at)
      : text);
  }
}
