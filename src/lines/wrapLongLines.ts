import { config } from '../config';

import { isStyled, isAscii, withReset } from '../helpers';

import { getLayout, emitRow } from './lineLayout';

import { highlightLine } from '../features/searching';

/**
 * Wraps lines into subrows to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of wrapped lines.
 */
export function wrapLongLines(content: string[], lines: string[]): void {
  for (
    let row = config.row;
    row < content.length && lines.length < config.window - 1;
    row++
  ) {
    wrap(lines, highlightLine(content[row]));
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

  if (!isStyled(longLine) && isAscii(longLine)) {
    wrapAsciiLine(lines, longLine, startRow);
    return;
  }

  const layout = getLayout(longLine);
  const rows = layout.rowStart.length;

  for (let r = Math.min(startRow, rows - 1); r < rows; r++) {
    let line = emitRow(layout, r);

    // re-emit active styles when entering a line mid-way
    if (r === startRow && r > 0) line = layout.rowStyle[r] + line;

    const last = r === rows - 1;
    const windowFull = lines.length === config.window - 2;

    lines.push(last || windowFull ? withReset(line) : line);

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
