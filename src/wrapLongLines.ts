import wcwidth from 'wcwidth-o1';

import { config } from './config';

import { isStyled, isAscii } from './helpers';

import { STYLE_REGEX_G, STYLE_RESET } from './constants';

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
    wrap(lines, content[row]);
  }
}

/**
 * Wraps a line by routing to the appropriate handler based on content type.
 *
 * - Routes to styled/ascii/unicode handlers for optimal performance.
 * - Detects ANSI codes and character type to choose strategy.
 *
 * @param lines - Array to append wrapped lines to.
 * @param longLine - Text line to wrap (may contain ANSI/Unicode).
 * @returns `true` if fully processed, `false` if stopped at window limit.
 */
function wrap(lines: string[], longLine: string): void {
  if (isStyled(longLine)) {
    return isAscii(longLine)
      ? wrapStyledAsciiLine(lines, longLine)
      : wrapStyledLine(lines, longLine);
  } else {
    return isAscii(longLine)
      ? wrapAsciiLine(lines, longLine)
      : wrapLine(lines, longLine);
  }
}

/**
 * Wraps a line with ANSI codes containing only ASCII characters.
 *
 * - Preserves ANSI escape sequences across line breaks.
 * - Optimized for ASCII (no wcwidth calculation needed).
 *
 * @param lines - Array to append wrapped lines to.
 * @param styledLine - ASCII text with ANSI codes.
 * @returns `true` if fully processed, `false` if stopped at window limit.
 */
function wrapStyledAsciiLine(lines: string[], styledLine: string): void {
  const startRow = lines.length ? 0 : config.subRow;

  let rows = 0, length = 0, i = 0;
  let line: string[] = [];

  STYLE_REGEX_G.lastIndex = 0;
  let ansi: RegExpExecArray | null;

  while ((ansi = STYLE_REGEX_G.exec(styledLine)) !== null) {
    while (length + ansi.index - i > config.screenWidth) {
      if (!push()) return;
    }

    if (rows >= startRow) {
      line.push(styledLine.slice(i, ansi.index));
    }

    if (rows < startRow && ansi[0] === STYLE_RESET) {
      line = [];
    } else {
      line.push(ansi[0]);
    }

    length += ansi.index - i;
    i = STYLE_REGEX_G.lastIndex;
  }

  while (i + config.screenWidth - length < styledLine.length) {
    if (!push()) return;
  }

  if (line.length) {
    if (i !== styledLine.length) line.push(styledLine.slice(i));
    lines.push(line.join(''));
  } else {
    lines.push(styledLine.slice(i));
  }

  // helper
  
  /**
   * Pushes current line segment and advances position.
   *
   * - Appends wrapped text to output if past startRow.
   * - Checks window limit and stops if reached.
   *
   * @returns `true` if can continue wrapping, `false` if window full.
   */
  function push(): boolean {
    if (rows >= startRow) {
      if (line.length) {
        line.push(styledLine.slice(i, i + config.screenWidth - length));
        lines.push(line.join(''));
        line = [];
      } else {
        lines.push(styledLine.slice(i, i + config.screenWidth));
      }

      if (lines.length === config.window - 1) return false;
    }

    rows++;
    i += config.screenWidth - length;
    length = 0;

    return true;
  }
}

/**
 * Wraps a line with ANSI codes and Unicode characters.
 *
 * - Preserves ANSI escape sequences across line breaks.
 * - Uses wcwidth for proper CJK/emoji display width.
 *
 * @param lines - Array to append wrapped lines to.
 * @param styledLine - Text with ANSI codes and Unicode characters.
 * @returns `true` if fully processed, `false` if stopped at window limit.
 */
function wrapStyledLine(lines: string[], styledLine: string): void {
  const startRow = lines.length ? 0 : config.subRow;

  let rows = 0, length = 0, i = 0;
  let line: string[] = [];

  STYLE_REGEX_G.lastIndex = 0;
  let ansi: RegExpExecArray | null;

  while ((ansi = STYLE_REGEX_G.exec(styledLine)) !== null) {
    if (!join(Array.from(styledLine.slice(i, ansi.index)))) return;

    if (rows < startRow && ansi[0] === STYLE_RESET) {
      line = [];
    } else {
      line.push(ansi[0]);
    }

    i = STYLE_REGEX_G.lastIndex;
  }

  if (!join(Array.from(styledLine.slice(i)))) return;

  if (line.length) lines.push(line.join(''));

  // helper

  /**
   * Joins Unicode segments into wrapped lines.
   *
   * - Calculates visual width and wraps at screen boundary.
   * - Respects startRow for partial rendering.
   *
   * @param segments - Array of Unicode characters to process.
   * @returns `true` if can continue, `false` if window limit reached.
   */
  function join(segments: string[]): boolean {
    for (let s = 0; s < segments.length; s++) {
      const charWidth = wcwidth(segments[s]);

      if (length + charWidth > config.screenWidth) {
        if (rows >= startRow) {
          lines.push(line.join(''));
          if (lines.length === config.window - 1) return false;
          line = [];
        }

        length = 0;
        rows++;
      }

      if (rows >= startRow) line.push(segments[s]);
      length += charWidth;
    }

    return true;
  }
}

/**
 * Wraps a line containing only ASCII characters at screen width boundaries.
 *
 * - Optimized for pure ASCII (no wcwidth calculation needed).
 * - Slices text at exact character positions (1 char = 1 column).
 *
 * @param lines - Array to append wrapped lines to.
 * @param longLine - ASCII text line to wrap.
 */
function wrapAsciiLine(lines: string[], longLine: string): void {
  const startRow = lines.length ? 0 : config.subRow;

  if (longLine.length <= config.screenWidth) {
    if (startRow === 0) lines.push(longLine);
    return;
  }

  let rows = 0;
  let start = 0, end = config.screenWidth;

  while (lines.length < config.window - 1 && end < longLine.length) {
    if (rows >= startRow) lines.push(longLine.slice(start, end));
    rows++;

    start = end;
    end += config.screenWidth;
  }

  if (lines.length < config.window - 1 && rows >= startRow) {
    lines.push(longLine.slice(start));
  }
}

/**
 * Wraps a line containing Unicode characters at visual column boundaries.
 *
 * - Uses wcwidth for CJK/emoji display width calculation.
 * - Moves overflowing wide characters to next line.
 *
 * @param lines - Array to append wrapped lines to.
 * @param longLine - Unicode text line to wrap.
 */
function wrapLine(lines: string[], longLine: string): void {
  const startRow = lines.length ? 0 : config.subRow;
  const chars = Array.from(longLine);

  let rows = 0;
  let length = 0;
  let start = 0, end = 0;

  while (lines.length < config.window - 1 && end < chars.length) {
    const charWidth = wcwidth(chars[end]);

    if (length + charWidth > config.screenWidth) {
      if (rows >= startRow) lines.push(chars.slice(start, end).join(''));
      rows++;

      length = 0;
      start = end;
    }

    length += charWidth;
    end++;
  }

  if (lines.length < config.window - 1 && rows >= startRow) {
    lines.push(chars.slice(start).join(''));
  }
}
