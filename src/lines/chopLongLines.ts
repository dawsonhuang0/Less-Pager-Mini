import { config } from "../config";

import { isStyled, isAscii, withReset, gutterFor, decoratedRows,
  highlightRow, visualWidth } from "../helpers";

import { getLayout } from "./lineLayout";

import { highlightLine } from "../features/searching";

import { optRscroll, optHeader } from "../options";

import { colored } from "../features/color";

import { INVERSE_ON, INVERSE_OFF, STYLE_RESET } from "../constants";

const getFillingSpace = (length: number): string =>
  length > 0 ? INVERSE_ON + ' '.repeat(length) + INVERSE_OFF : '';

const getMoreIndicator = (length: number): string =>
  colored('rscroll', ' '.repeat(length - 1) + optRscroll(),
    INVERSE_ON, INVERSE_OFF);

/**
 * Chops long lines to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of chopped lines.
 */
export function chopLongLines(content: string[], lines: string[]): void {
  const decorated = decoratedRows();

  // the --header columns stay visible at the left while horizontally
  // shifted, like less's overlay_header drawing each line's prefix
  const pfxCols = config.col > 0
    ? Math.min(optHeader().cols, config.screenWidth - 1)
    : 0;

  for (
    let row = config.row;
    row < content.length && lines.length < config.window - 1;
    row++
  ) {
    const before = lines.length;
    const line = highlightLine(content[row], row);

    if (pfxCols > 0) {
      lines.push(chopWithPrefix(line, pfxCols));
    } else {
      chop(lines, line);
    }

    if (decorated) {
      // -w and --status-line highlight the row in standout
      lines[before] = gutterFor(content, row, true) +
        highlightRow(lines[before], row);
    }
  }
}

/**
 * Composes a horizontally shifted row that keeps the --header columns:
 * the line's first columns, padded to the prefix width, followed by the
 * remainder chopped past both the shift and the prefix.
 */
function chopWithPrefix(line: string, pfxCols: number): string {
  const parts: string[] = [];

  chop(parts, line, 0, pfxCols, false);
  chop(parts, line, config.col + pfxCols, config.screenWidth - pfxCols);

  const pad = pfxCols - visualWidth(parts[0]);
  return parts[0] + (pad > 0 ? ' '.repeat(pad) : '') + parts[1];
}

/**
 * Chops a single line to the visible column range.
 *
 * - Plain ASCII lines take a slicing fast path.
 * - Styled or Unicode lines are emitted from their cached layout: skipped
 *   styles are re-emitted, wide characters straddling the left edge are
 *   padded, and overflow ends with a `>` indicator.
 *
 * @param lines - Output array to append the chopped line to.
 * @param longLine - The line to chop.
 * @param col - Left column, defaulting to the horizontal shift.
 * @param width - Column count, defaulting to the screen width.
 * @param marker - Whether overflow ends with the `>` indicator.
 */
function chop(
  lines: string[],
  longLine: string,
  col: number = config.col,
  width: number = config.screenWidth,
  marker: boolean = true
): void {
  if (!isStyled(longLine) && isAscii(longLine)) {
    chopAsciiLine(lines, longLine, col, width, marker);
    return;
  }

  const layout = getLayout(longLine);
  const { chars, widths, prefix, codeIdx, codes } = layout;
  const endCol = col + width;

  // first cluster at or beyond the left edge
  const start = Math.min(lowerBound(prefix, col), chars.length);

  // styles opened in the skipped region (reset clears)
  let active: string[] = [];
  let k = 0;

  while (k < codeIdx.length && codeIdx[k] <= start) {
    if (codes[k] === STYLE_RESET) {
      active = [];
    } else {
      active.push(codes[k]);
    }

    k++;
  }

  const parts: string[] = [getFillingSpace(prefix[start] - col)];
  parts.push(...active);

  let pos = prefix[start];

  for (let c = start; c < chars.length; c++) {
    while (k < codeIdx.length && codeIdx[k] <= c) {
      parts.push(codes[k]);
      k++;
    }

    const charWidth = widths[c];
    const fits = marker
      ? pos + charWidth < endCol ||
        (pos + charWidth === endCol && c === chars.length - 1)
      : pos + charWidth <= endCol;

    if (!fits) {
      lines.push(withReset(parts.join('')) +
        (marker ? getMoreIndicator(endCol - pos) : ''));
      return;
    }

    parts.push(chars[c]);
    pos += charWidth;
  }

  while (k < codeIdx.length) parts.push(codes[k++]);

  lines.push(withReset(parts.join('')));
}

/**
 * Chops an ASCII line to fit screen width and appends to output.
 *
 * - Slices from col to screenWidth boundary.
 * - Adds '>' indicator if content overflows.
 *
 * @param lines - Output array to append chopped line to.
 * @param longLine - The ASCII line to chop.
 * @param start - Left column of the visible range.
 * @param width - Column count of the visible range.
 * @param marker - Whether overflow ends with the `>` indicator.
 */
function chopAsciiLine(
  lines: string[],
  longLine: string,
  start: number,
  width: number,
  marker: boolean
): void {
  const end = start + width;

  if (longLine.length <= end) {
    lines.push(longLine.slice(start));
  } else if (marker) {
    lines.push(longLine.slice(start, end - 1) + getMoreIndicator(1));
  } else {
    lines.push(longLine.slice(start, end));
  }
}

function lowerBound(sorted: number[], target: number): number {
  let lo = 0, hi = sorted.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (sorted[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}
