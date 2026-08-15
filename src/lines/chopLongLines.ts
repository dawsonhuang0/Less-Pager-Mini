import { config } from "../state/config";

import { gutterFor, gutterOverflow, decoratedRows, highlightRow }
  from "../helpers";
import { isStyled, isAscii, withReset, visualWidth, ansiRunEnd,
  openStyleAt } from "./helpers";

import { getLayout } from "./lineLayout";

import { highlightLine } from "../features/searching";

import { optRscroll, optRscrollAttr, optHeader, optCtldisp }
  from "../options";

import { colored } from "../features/color";

import { STYLE_RESET } from "../state/constants";

/**
 * The "half char" og leaves at the left edge when the shift cuts a
 * wide character: add_linebuf(' ', rscroll_attr|AT_PLACEHOLDER)
 * (line.c:1002), so it wears the --rscroll attribute, standout by
 * default - the same attribute as the > marker at the other edge.
 *
 * @param seam - The style the orphaned cell inherits at a seam that is
 *   not the screen's left edge, where og adds no placeholder at all.
 *   There it paints the body shifted and then OVERLAYS the --header
 *   columns (forwback.c:184), so the wide char straddling the seam is
 *   half overwritten by the header's last cell - and the cell the
 *   terminal orphans keeps the attribute that write was made under,
 *   which is the header's own last attribute, not nothing. Measured:
 *   a match ending the header columns leaves the orphan standing out.
 */
const getFillingSpace = (
  length: number,
  placeholder = true,
  seam = ''
): string => {
  if (length <= 0) return '';

  if (!placeholder) {
    return seam ? seam + ' '.repeat(length) + STYLE_RESET
      : ' '.repeat(length);
  }

  const attr = optRscrollAttr();
  return colored('rscroll', ' '.repeat(length), attr.on, attr.off);
};

/**
 * The style the last visible cell of a rendered row was written under,
 * which is what og's overlay leaves on the cell it orphans.
 */
function trailingCellStyle(row: string): string {
  let last = -1;

  for (let i = 0; i < row.length; ) {
    if (row[i] === '\x1b') {
      i = ansiRunEnd(row, i);
      continue;
    }

    last = i;
    i++;
  }

  return last < 0 ? '' : openStyleAt(row, last);
}

// og pads with normal spaces and attributes only the rscroll char
// (standout by default, or the --rscroll "*x" attribute)
const getMoreIndicator = (length: number): string => {
  const attr = optRscrollAttr();
  return ' '.repeat(length - 1) +
    colored('rscroll', optRscroll(), attr.on, attr.off);
};

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

    // a number wider than the -N field eats the line's text columns
    const shrink = gutterOverflow(row);
    config.screenWidth -= shrink;

    if (pfxCols > 0) {
      lines.push(chopWithPrefix(line, pfxCols));
    } else {
      chop(lines, line);
    }

    config.screenWidth += shrink;

    if (decorated) {
      // -w and --status-line highlight the row in standout
      lines[before] = gutterFor(content, row) +
        highlightRow(lines[before], row, before);
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
  chop(parts, line, config.col + pfxCols, config.screenWidth - pfxCols,
    true, false, trailingCellStyle(parts[0]));

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
  marker: boolean = true,
  placeholder: boolean = true,
  seam: string = ''
): void {
  // og chops inside `if (backchars > 0)` - the branch pappend enters
  // only when a char DOES NOT FIT (input.c:231) - and under -r
  // fits_on_screen answers TRUE for everything, so nothing ever fails
  // to fit. The horizontal shift still applies, since store_char skips
  // while cshift < hshift whatever ctldisp says, but nothing is cut
  // off - and with nothing cut off there is no rscroll marker
  if (optCtldisp() === 1) {
    width = Number.MAX_SAFE_INTEGER;
    marker = false;
  }

  // --rscroll=- disables the marker: the text keeps the last column
  marker = marker && optRscroll() !== '';

  if (!isStyled(longLine) && isAscii(longLine) &&
      !longLine.includes('\x08')) {
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

  const parts: string[] = [
    getFillingSpace(prefix[start] - col, placeholder, seam),
  ];
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

  // og's pdone closes every line the same way whatever is in it, and
  // under -R that is three literal bytes rather than nothing - so even
  // a line with no style of its own goes through withReset. The
  // rscroll marker follows the close, like add_attr_normal running
  // before pdone paints it (line.c:1482)
  if (longLine.length <= end) {
    lines.push(withReset(longLine.slice(start)));
  } else if (marker) {
    lines.push(withReset(longLine.slice(start, end - 1)) +
      getMoreIndicator(1));
  } else {
    lines.push(withReset(longLine.slice(start, end)));
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
