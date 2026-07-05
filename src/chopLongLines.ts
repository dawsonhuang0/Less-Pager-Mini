import { config } from "./config";

import { isStyled, isAscii, withReset } from "./helpers";

import { getLayout } from "./lineLayout";

import { highlightLine } from "./features/searching";

import { INVERSE_ON, INVERSE_OFF, STYLE_RESET } from "./constants";

const getFillingSpace = (length: number): string =>
  length > 0 ? INVERSE_ON + ' '.repeat(length) + INVERSE_OFF : '';

const getMoreIndicator = (length: number): string =>
  INVERSE_ON + ' '.repeat(length - 1) + '>' + INVERSE_OFF;

/**
 * Chops long lines to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of chopped lines.
 */
export function chopLongLines(content: string[], lines: string[]): void {
  for (
    let row = config.row;
    row < content.length && lines.length < config.window - 1;
    row++
  ) {
    chop(lines, highlightLine(content[row]));
  }
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
 */
function chop(lines: string[], longLine: string): void {
  if (!isStyled(longLine) && isAscii(longLine)) {
    chopAsciiLine(lines, longLine);
    return;
  }

  const layout = getLayout(longLine);
  const { chars, widths, prefix, codeIdx, codes } = layout;
  const endCol = config.col + config.screenWidth;

  // first cluster at or beyond the left edge
  const start = Math.min(lowerBound(prefix, config.col), chars.length);

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

  const parts: string[] = [getFillingSpace(prefix[start] - config.col)];
  parts.push(...active);

  let pos = prefix[start];

  for (let c = start; c < chars.length; c++) {
    while (k < codeIdx.length && codeIdx[k] <= c) {
      parts.push(codes[k]);
      k++;
    }

    const width = widths[c];
    const fits = pos + width < endCol ||
      (pos + width === endCol && c === chars.length - 1);

    if (!fits) {
      lines.push(withReset(parts.join('')) + getMoreIndicator(endCol - pos));
      return;
    }

    parts.push(chars[c]);
    pos += width;
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
 */
function chopAsciiLine(lines: string[], longLine: string): void {
  const start = config.col;
  const end = start + config.screenWidth;

  lines.push(
    longLine.length > end
      ? longLine.slice(start, end - 1) + getMoreIndicator(1)
      : longLine.slice(start)
  );
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
