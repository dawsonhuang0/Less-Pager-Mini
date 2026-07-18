import { config } from '../config';

import { gutterFor, gutterOverflow, decoratedRows, highlightRow }
  from '../helpers';
import { isStyled, isAscii, withReset } from './helpers';

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
function wrap(lines: string[], longLine: string): void {
  const startRow = lines.length ? 0 : config.subRow;

  // --wordwrap boundaries live in the layout, even for plain lines
  if (!optWordwrap() && !isStyled(longLine) && isAscii(longLine)) {
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
