import wcwidth from 'wcwidth-o1';

import { config } from "./config";

import { isStyled, isAscii } from "./helpers";

import {
  INVERSE_ON,
  INVERSE_OFF,
  STYLE_REGEX_G,
  STYLE_RESET
} from "./constants";

const getFillingSpace = (length: number): string =>
  INVERSE_ON + ' '.repeat(length) + INVERSE_OFF;

/**
 * Creates a "more content" indicator with inverse ansi styling.
 * 
 * @param length - Width in columns
 * @returns Inverse video string: '>' (width 1) or ' >' (width 2)
 */
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
    chop(lines, content[row]);
  }
}

/**
 * Dispatches to appropriate chopping function based on line properties.
 *
 * - Routes styled lines to chopStyledAsciiLine or chopStyledLine.
 * - Routes unstyled lines to chopAsciiLine or chopLine.
 *
 * @param lines - Output array to append chopped line to.
 * @param longLine - The line to chop.
 * @param styles - ANSI style codes to prepend (defaults to '').
 */
function chop(lines: string[], longLine: string, styles: string = ''): void {
  if (isStyled(longLine)) {
    isAscii(longLine)
      ? chopStyledAsciiLine(longLine)
      : chopStyledLine(longLine);
  } else {
    isAscii(longLine)
      ? chopAsciiLine(lines, longLine, styles)
      : chopLine(lines, longLine, styles);
  }
}

/**
 * Chop a styled ascii line to screen width.
 * 
 * - Keeps ANSI styles in place.
 * - Adds '>' if chopped.
 * 
 * @param styledLine Line with ANSI codes.
 * @returns Chopped line with styles.
 */
function chopStyledAsciiLine(styledLine: string): string {
  const line: string[] = [];

  let visualLength = styledLine.length;

  const ansis: { ansi: string, start: number, end: number }[] = [];
  STYLE_REGEX_G.lastIndex = 0;
  let ansi, char = 0, i = 0;

  while ((ansi = STYLE_REGEX_G.exec(styledLine)) !== null) {
    const lastIndex = STYLE_REGEX_G.lastIndex;
    const nextChar = char + ansi.index - i;

    if (nextChar <= config.col) {
      line.push(ansi[0]);
      char = nextChar;
      i = lastIndex;
    } else {
      ansis.push({
        ansi: ansi[0],
        start: ansi.index,
        end: lastIndex
      });
    }

    visualLength -= lastIndex - ansi.index;
  }

  if (visualLength <= config.col) return line.join('');

  if (char < config.col) {
    i += config.col - char;
    char = config.col;
  }

  let length = 0, curr = 0;

  while (length < config.screenWidth && i < styledLine.length) {
    if (curr < ansis.length && i === ansis[curr].start) {
      line.push(ansis[curr].ansi);
      i = ansis[curr].end;
      curr++;
    } else {
      if (length < config.screenWidth - 1) {
        line.push(styledLine[i]);
      } else {
        const overflow = char !== visualLength - 1;

        if (!overflow) line.push(styledLine[i]);
        while (curr < ansis.length) line.push(ansis[curr++].ansi);
        if (overflow) line.push(MORE_INDICATOR);
      }

      length++;
      char++;
      i++;
    }
  }

  return line.join('');
}

/**
 * Chops a styled non-ascii line to fit screen width.
 *
 * - Preserves ANSI codes while respecting col/screen boundaries.
 * - Appends overflow marker when line exceeds screen width.
 *
 * @param styledLine - The ANSI-styled line to chop.
 * @returns Chopped line with styles and marker if needed.
 */
function chopStyledLine(styledLine: string): string {
  const line: string[] = [];

  const segments = Array.from(styledLine.replace(STYLE_REGEX_G, ''));

  const segmentWidths = [];
  let visualLength = 0;

  for (let i = 0; i < segments.length; i++) {
    const segmentWidth = wcwidth(segments[i]);
    segmentWidths.push(segmentWidth);
    visualLength += segmentWidth;
  }

  const ansis: { ansi: string, start: number, end: number }[] = [];
  STYLE_REGEX_G.lastIndex = 0;
  let ansi, char = 0, i = 0, s = 0;

  while ((ansi = STYLE_REGEX_G.exec(styledLine)) !== null) {
    const nextChar = char + ansi.index - i;

    if (nextChar <= config.col) {
      line.push(ansi[0]);
      char = nextChar;
      s += Array.from(styledLine.slice(i, ansi.index)).length;
      i = STYLE_REGEX_G.lastIndex;
    } else {
      ansis.push({
        ansi: ansi[0],
        start: ansi.index,
        end: STYLE_REGEX_G.lastIndex
      });
    }
  }

  if (visualLength <= config.col) return line.join('');

  let length = 0;

  while (char < config.col && s < segments.length) {
    const nextChar = char + segmentWidths[s];

    if (nextChar > config.col) {
      const excess = nextChar - config.col;
      line.push(INVERSE_ON + ' '.repeat(excess) + INVERSE_OFF);
      length = excess;
    }

    char = nextChar;
    i += segments[s].length;
    s++;
  }

  let curr = 0;

  while (length < config.screenWidth && s < segments.length) {
    if (curr < ansis.length && i === ansis[curr].start) {
      line.push(ansis[curr].ansi);
      i = ansis[curr].end;
      curr++;
      continue;
    }

    const concatLength = length + segmentWidths[s];

    if (concatLength < config.screenWidth) {
      line.push(segments[s]);
    } else {
      const overflow = (
        s !== segments.length - 1 || concatLength !== config.screenWidth
      );

      if (!overflow) line.push(segments[s]);
      while (curr < ansis.length) line.push(ansis[curr++].ansi);
      if (overflow) {
        const remaining = config.screenWidth - length;
        line.push(`${INVERSE_ON}${' '.repeat(remaining - 1)}>${INVERSE_OFF}`);
      }
    }

    length = concatLength;
    i += segments[s].length;
    s++;
  }

  return line.join('');
}

/**
 * Chops an ASCII line to fit screen width and appends to output.
 *
 * - Slices from col to screenWidth boundary.
 * - Adds '>' indicator if content overflows.
 *
 * @param lines - Output array to append chopped line to.
 * @param longLine - The ASCII line to chop.
 * @param styles - ANSI style codes to prepend to output.
 */
function chopAsciiLine(
  lines: string[],
  longLine: string,
  styles: string
): void {
  const start = config.col;
  const end = start + config.screenWidth;

  if (start >= longLine.length) {
    lines.push('');
  } else if (longLine.length > end) {
    lines.push(
      styles + longLine.slice(start, end - 1) + STYLE_RESET +
      getMoreIndicator(1)
    );
  } else {
    lines.push(styles + longLine.slice(start));
  }
}

/**
 * Chops a non-ASCII line to fit screen width and appends to output.
 *
 * - Uses wcwidth for multi-byte character width calculation.
 * - Adds filling space and overflow marker as needed.
 *
 * @param lines - Output array to append chopped line to.
 * @param longLine - The line with multi-byte characters to chop.
 * @param styles - ANSI style codes to prepend.
 */
function chopLine(
  lines: string[],
  longLine: string,
  styles: string
): void {
  const chars = Array.from(longLine);

  let start = 0, length = 0;

  for (; start < chars.length && length < config.col; start++) {
    length += wcwidth(chars[start]);
  }

  length -= config.col;

  if (start === chars.length) {
    lines.push(length > 0 ? STYLE_RESET + getFillingSpace(length) : '');
    return;
  }

  styles = STYLE_RESET + (length > 0 ? getFillingSpace(length) : '') + styles;
  let end = start;

  for (; end < chars.length; end++) {
    const charWidth = wcwidth(chars[end]);

    if (end === chars.length - 1 && length + charWidth <= config.screenWidth) {
      lines.push(styles + chars.slice(start).join(''));
      return;
    }

    if (length + charWidth >= config.screenWidth) break;
    length += charWidth;
  }

  lines.push(
    styles + chars.slice(start, end).join('') + STYLE_RESET +
    getMoreIndicator(config.screenWidth - length)
  );
}
