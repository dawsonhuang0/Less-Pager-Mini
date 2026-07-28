import { config } from '../state/config';

import { gutterFor, gutterOverflow, decoratedRows, highlightRow }
  from '../helpers';
import { isStyled, isAscii, withReset, openStyleAt } from './helpers';

import { subRowStart } from '../features/jumping';

import { getLayout, emitRow } from './lineLayout';

import { highlightLine } from '../features/searching';

import { optWordwrap } from '../options';


/**
 * Wraps lines into subrows to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of wrapped lines.
 */
export function wrapLongLines(content: string[], lines: string[]): void {
  const decorated = decoratedRows();

  for (
    let row = config.row;
    row < content.length && lines.length < config.window - 1;
    row++
  ) {
    const before = lines.length;

    // a number wider than the -N field eats the line's text columns
    const shrink = gutterOverflow(row);
    config.screenWidth -= shrink;
    wrap(lines, highlightLine(content[row], row));
    config.screenWidth += shrink;

    if (decorated) {
      // every emitted row of the line gets the same gutter, like
      // og's per-row plinestart from base_pos
      for (let i = before; i < lines.length; i++) {
        // -w and --status-line highlight the row in standout
        lines[i] = gutterFor(content, row) + highlightRow(lines[i], row, i);
      }
    }
  }
}

/**
 * Wraps a single line into rows.
 *
 * - Plain ASCII lines take a slicing fast path.
 * - Styled or Unicode lines are emitted from their cached layout, so ANSI
 *   codes and grapheme clusters never split at row boundaries.
 *
 * @param lines - Array to append wrapped rows to.
 * @param longLine - Text line to wrap (may contain ANSI/Unicode).
 */
function wrap(lines: string[], longLine: string, shifted = false): void {
  const first = lines.length === 0 && !shifted;
  const startRow = first ? config.subRow : 0;

  // og reads the top row from wherever table[TOP] points, so after a
  // width change it starts mid-boundary and every row of that line
  // wraps from there. Emitting the remainder as its own line is the
  // same thing: the grid is anchored at the top, not at column 0.
  if (first && (config.subShift > 0 || config.subAnchor > 0)) {
    const from = subRowStart(longLine, config.subRow) + config.subShift;

    // og's back_line stops the exposed row at the old top (input.c),
    // and the rows below keep the grid they already had. So the line
    // splits in two at that anchor: what the backward moves uncovered
    // wraps on its own - its last row ending short - and the rest
    // resumes the grid the anchor sits on.
    if (config.subAnchor > from) {
      wrap(lines, openStyleAt(longLine, from) +
        longLine.slice(from, config.subAnchor), true);

      // the uncovered span can fill the screen on its own once enough
      // backward moves have piled up; the grid below it is simply not
      // reached, exactly as og stops filling the position table
      if (lines.length < config.window - 1) {
        wrap(lines, openStyleAt(longLine, config.subAnchor) +
          longLine.slice(config.subAnchor), true);
      }

      return;
    }

    wrap(lines, openStyleAt(longLine, from) + longLine.slice(from), true);
    return;
  }

  // --wordwrap boundaries live in the layout, even for plain lines
  if (!optWordwrap() && !isStyled(longLine) && isAscii(longLine) &&
      !longLine.includes('\x08')) {
    wrapAsciiLine(lines, longLine, startRow);
    return;
  }

  const layout = getLayout(longLine);
  const rows = layout.rowStart.length;

  for (let r = Math.min(startRow, rows - 1); r < rows; r++) {
    let line = emitRow(layout, r);

    // og's rows are self-contained (at_switch per row): a style
    // spanning the wrap closes at the row's end and reopens on the
    // continuation, so the gutter and the next row never inherit it
    if (r > 0 && layout.rowStyle[r]) line = layout.rowStyle[r] + line;

    const last = r === rows - 1;
    const windowFull = lines.length === config.window - 2;
    const openAfter = !last && !!layout.rowStyle[r + 1];

    lines.push(last || windowFull || openAfter ? withReset(line) : line);

    if (windowFull) return;
  }
}

/**
 * Wraps a line containing only ASCII characters at screen width boundaries.
 *
 * - Optimized for pure ASCII (1 char = 1 column, no layout needed).
 *
 * @param lines - Array to append wrapped rows to.
 * @param longLine - ASCII text line to wrap.
 * @param startRow - First sub-row to emit.
 */
function wrapAsciiLine(
  lines: string[],
  longLine: string,
  startRow: number
): void {
  if (longLine.length <= config.screenWidth) {
    lines.push(longLine);
    return;
  }

  let rows = 0, start = 0;

  for (
    let end = config.screenWidth;
    end < longLine.length;
    end += config.screenWidth
  ) {
    if (rows >= startRow) {
      lines.push(longLine.slice(start, end));
      if (lines.length === config.window - 1) return;
    }

    rows++;
    start = end;
  }

  lines.push(longLine.slice(start));
}
