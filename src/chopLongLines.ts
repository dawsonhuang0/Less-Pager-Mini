import { strWidth } from 'char-width';

import { config } from "./config";

import { isStyled, isAscii, splitChars, withReset } from "./helpers";

import {
  INVERSE_ON,
  INVERSE_OFF,
  STYLE_REGEX_G,
  STYLE_RESET
} from "./constants";

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
 */
function chop(lines: string[], longLine: string): void {
  if (isStyled(longLine)) {
    if (isAscii(longLine)) {
      chopStyledAsciiLine(lines, longLine);
    } else {
      chopStyledLine(lines, longLine);
    }
  } else if (isAscii(longLine)) {
    chopAsciiLine(lines, longLine);
  } else {
    chopLine(lines, longLine);
  }
}

/**
 * Chops a styled ASCII line to fit screen width.
 *
 * - Preserves ANSI codes while respecting col/screen boundaries.
 * - Appends overflow marker when content exceeds screen width.
 *
 * @param lines - Output array to append chopped line to.
 * @param styledLine - The ANSI-styled ASCII line to chop.
 */
function chopStyledAsciiLine(lines: string[], styledLine: string): void {
  let i = 0, length = 0;
  let line: string[] = [];

  STYLE_REGEX_G.lastIndex = 0;
  let ansi: RegExpExecArray | null;

  while (
    (ansi = STYLE_REGEX_G.exec(styledLine)) !== null &&
    length + ansi.index - i < config.col
  ) {
    if (ansi[0] === STYLE_RESET) {
      line = [];
    } else {
      line.push(ansi[0]);
    }

    length += ansi.index - i;
    i = STYLE_REGEX_G.lastIndex;
  }

  i += config.col - length;
  length = 0;

  if (ansi !== null) do {
    if (length + ansi.index - i < config.screenWidth) {
      line.push(styledLine.slice(i, STYLE_REGEX_G.lastIndex));
      length += ansi.index - i;
      i = STYLE_REGEX_G.lastIndex;
    } else {
      let overflow = length + ansi.index - i > config.screenWidth;
      let lastIndex = STYLE_REGEX_G.lastIndex;

      while (!overflow && (ansi = STYLE_REGEX_G.exec(styledLine)) !== null) {
        overflow = lastIndex !== ansi.index;
        lastIndex = STYLE_REGEX_G.lastIndex;
      }

      push(overflow || lastIndex !== styledLine.length);
      return;
    }
  } while ((ansi = STYLE_REGEX_G.exec(styledLine)) !== null);

  push(length + styledLine.length - i > config.screenWidth);

  // helper
  function push(overflow: boolean): void {
    if (overflow) {
      lines.push(
        withReset(
          line.join('') +
          styledLine.slice(i, i + config.screenWidth - length - 1)
        ) + getMoreIndicator(1)
      );
    } else {
      lines.push(withReset(line.join('') + styledLine.slice(i)));
    }
  }
}

/**
 * Chops a styled non-ASCII line to fit screen width.
 *
 * - Uses charWidth for Unicode character width calculation.
 * - Adds filling space for wide characters crossing boundaries.
 *
 * @param lines - Output array to append chopped line to.
 * @param styledLine - The ANSI-styled line with Unicode characters to chop.
 */
function chopStyledLine(lines: string[], styledLine: string): void {
  const endCol = config.col + config.screenWidth;

  let i = 0, length = 0;
  let line: string[] = [''];

  STYLE_REGEX_G.lastIndex = 0;
  let ansi: RegExpExecArray | null;

  while ((ansi = STYLE_REGEX_G.exec(styledLine)) !== null) {
    if (!join(splitChars(styledLine.slice(i, ansi.index)))) return;

    if (length < config.col && ansi[0] === STYLE_RESET) {
      line = [''];
    } else {
      line.push(ansi[0]);
    }

    i = STYLE_REGEX_G.lastIndex;
  }

  if (join(splitChars(styledLine.slice(i)))) {
    lines.push(withReset(line.join('')));
  }

  // helper
  function join(chars: string[]): boolean {
    for (let c = 0; c < chars.length; c++) {
      const width = strWidth(chars[c]);

      if (length + width < endCol) {
        if (length >= config.col) {
          line.push(chars[c]);
        } else if (length + width >= config.col) {
          line[0] = getFillingSpace(length + width - config.col);
        }

        length += width;
        continue;
      }

      const overflow = length + width > endCol || c !== chars.length - 1;
      let lastIndex = styledLine.length;

      while (!overflow && ansi !== null) {
        lastIndex = STYLE_REGEX_G.lastIndex;
        ansi = STYLE_REGEX_G.exec(styledLine);
      }

      if (overflow || lastIndex !== styledLine.length) {
        lines.push(
          withReset(line.join('')) + getMoreIndicator(endCol - length)
        );
      } else {
        lines.push(withReset(line.join('') + chars[c]));
      }

      return false;
    }

    return true;
  }
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

/**
 * Chops a non-ASCII line to fit screen width and appends to output.
 *
 * - Uses charWidth for multi-byte character width calculation.
 * - Adds filling space and overflow marker as needed.
 *
 * @param lines - Output array to append chopped line to.
 * @param longLine - The line with multi-byte characters to chop.
 */
function chopLine(lines: string[], longLine: string): void {
  const chars = splitChars(longLine);

  let start = 0, length = 0;

  for (; start < chars.length && length < config.col; start++) {
    length += strWidth(chars[start]);
  }

  length -= config.col;
  const fillingSpace = getFillingSpace(Math.max(length, 0));

  if (start === chars.length) {
    lines.push(fillingSpace);
    return;
  }

  for (let end = start; end < chars.length; end++) {
    const width = strWidth(chars[end]);

    if (
      length + width > config.screenWidth ||
      (length + width === config.screenWidth && end !== chars.length - 1)
    ) {
      lines.push(
        fillingSpace + chars.slice(start, end).join('') +
        getMoreIndicator(config.screenWidth - length)
      );
      return;
    }

    length += width;
  }

  lines.push(fillingSpace + chars.slice(start).join(''));
}
