import wcwidth from 'wcwidth-o1';

import { config, mode } from './config';

import { isStyled, isAscii } from './helpers';

import { STYLE_REGEX_G } from './constants';

/**
 * Wraps lines into subrows to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of wrapped lines.
 */
export function wrapLongLines(content: string[], lines: string[]): void {
  const maxRow = content.length - config.row;

  let isCompleteWrap = true;
  let row = 0;

  while (lines.length < config.window - 1 && row < maxRow) {
    const line = content[config.row + row];
    isCompleteWrap = wrap(lines, line);
    row++;
  }

  mode.EOF = isCompleteWrap && row === maxRow;
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
function wrap(lines: string[], longLine: string): boolean {
  if (isStyled(longLine)) {
    return isAscii(longLine)
      ? wrapStyledAsciiLine(lines, longLine)
      : wrapStyledLine(lines, longLine);
  }

  return isAscii(longLine)
    ? wrapAsciiLine(lines, longLine)
    : wrapLine(lines, longLine);
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
function wrapStyledAsciiLine(lines: string[], styledLine: string): boolean {
  const startRow = lines.length ? 0 : config.subRow;

  let line: string[] = [];

  STYLE_REGEX_G.lastIndex = 0;
  let ansi, row = 0, length = 0, i = 0, nextIndex = 0;

  while (ansi = STYLE_REGEX_G.exec(styledLine)) {
    const nextLength = length + ansi.index - i;

    if (nextLength <= config.screenWidth) {
      if (row >= startRow) line.push(styledLine.slice(i, ansi.index));
      length = nextLength;
    } else {
      nextIndex = i + config.screenWidth - length;

      if (!pushLine()) return false;

      while (nextIndex < ansi.index) {
        if (!pushLine()) return false;
      }

      if (i === ansi.index) {
        length = 0;
      } else {
        if (row >= startRow) line.push(styledLine.slice(i, ansi.index));
        length = ansi.index - i;
      }
    }

    line.push(ansi[0]);
    i = STYLE_REGEX_G.lastIndex;
  }

  nextIndex = i + config.screenWidth - length;

  while (nextIndex < styledLine.length) {
    if (!pushLine()) return false;
  }

  if (row >= startRow) line.push(styledLine.slice(i));
  lines.push(line.join(''));

  return true;

  // helpers

  /**
   * Pushes current line segment and advances to next line position.
   * 
   * - Stops processing if window limit reached.
   * - Collects remaining ANSI codes on early exit.
   * 
   * @returns `false` to stop processing, `true` to continue.
   */
  function pushLine(): boolean {
    if (row >= startRow) {
      line.push(styledLine.slice(i, nextIndex));
      if (!push()) return false;
    }
    row++;

    i = nextIndex;
    nextIndex += config.screenWidth;
    return true;
  }

  /**
   * Pushes current line to output and checks window limit.
   *
   * - Collects remaining ANSI codes if window limit reached.
   * - Resets line buffer for next line if continuing.
   *
   * @returns `true` if can continue wrapping, `false` if window full.
   */
  function push(): boolean {
    if (lines.length + 1 === config.window - 1) {
      while (ansi = STYLE_REGEX_G.exec(styledLine)) line.push(ansi[0]);
      lines.push(line.join(''));
      return false;
    }

    lines.push(line.join(''));
    line = [];

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
function wrapStyledLine(lines: string[], styledLine: string): boolean {
  const startRow = lines.length ? 0 : config.subRow;
  const segments = Array.from(styledLine.replace(STYLE_REGEX_G, ''));

  let line: string[] = [];

  STYLE_REGEX_G.lastIndex = 0;
  let ansi, row = 0, length = 0, i = 0, s = 0;

  while (ansi = STYLE_REGEX_G.exec(styledLine)) {
    while (i < ansi.index) {
      const charCount = segments[s].length;
      if (!pushLine()) return false;
      i += charCount;
    }

    line.push(ansi[0]);
    i = STYLE_REGEX_G.lastIndex;
  }

  while (s < segments.length) {
    if (!pushLine()) return false;
  }

  if (line.length) lines.push(line.join(''));

  return true;

  // helpers

  /**
   * Processes one Unicode segment and handles line wrapping.
   *
   * - Calculates visual width and wraps if exceeding screen width.
   * - Moves overflowing wide characters to next line.
   *
   * @returns `true` if can continue, `false` if window limit reached.
   */
  function pushLine(): boolean {
    const segmentWidth = wcwidth(segments[s]);
    const nextLength = length + segmentWidth;

    if (nextLength <= config.screenWidth) {
      if (row >= startRow) line.push(segments[s]);
      length = nextLength;
    } else {
      if (row >= startRow) {
        if (nextLength === config.screenWidth) line.push(segments[s]);
        if (!push()) return false;
      }
      row++;

      if (nextLength === config.screenWidth) {
        length = 0;
      } else {
        if (row >= startRow) line.push(segments[s]);
        length = segmentWidth;
      }
    }

    s++;
    return true;
  }

  /**
   * Pushes current line to output and checks window limit.
   *
   * - Collects remaining ANSI codes if window limit reached.
   * - Resets line buffer for next line if continuing.
   *
   * @returns `true` if can continue wrapping, `false` if window full.
   */
  function push(): boolean {
    if (lines.length + 1 === config.window - 1) {
      while (ansi = STYLE_REGEX_G.exec(styledLine)) line.push(ansi[0]);
      lines.push(line.join(''));
      return false;
    }

    lines.push(line.join(''));
    line = [];

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
 * @returns `true` if fully processed, `false` if stopped at window limit.
 */
function wrapAsciiLine(lines: string[], longLine: string): boolean {
  const startRow = lines.length ? 0 : config.subRow;
  let rows = 0;

  if (longLine.length <= config.screenWidth) {
    if (rows >= startRow) lines.push(longLine);
    return true;
  }

  let start = 0;
  let end = config.screenWidth;

  while (lines.length < config.window - 1 && end < longLine.length) {
    if (rows >= startRow) lines.push(longLine.slice(start, end));
    rows++;

    start = end;
    end += config.screenWidth;
  }

  if (lines.length < config.window - 1) {
    if (rows >= startRow) lines.push(longLine.slice(start));
    return true;
  }

  return false;
}

/**
 * Wraps a line containing Unicode characters at visual column boundaries.
 *
 * - Uses wcwidth for CJK/emoji display width calculation.
 * - Moves overflowing wide characters to next line.
 *
 * @param lines - Array to append wrapped lines to.
 * @param longLine - Unicode text line to wrap.
 * @returns `true` if fully processed, `false` if stopped at window limit.
 */
function wrapLine(lines: string[], longLine: string): boolean {
  const startRow = lines.length ? 0 : config.subRow;
  const chars = Array.from(longLine);

  let line: string[] = [];
  let length = 0, row = 0, c = 0;

  while (lines.length < config.window - 1 && c < chars.length) {
    const charWidth = wcwidth(chars[c]);
    const nextLength = length + charWidth;

    if (nextLength <= config.screenWidth) {
      line.push(chars[c]);
    }

    if (nextLength >= config.screenWidth) {
      if (row >= startRow) lines.push(line.join(''));
      row++;

      if (nextLength > config.screenWidth) {
        line = [chars[c]];
        length = charWidth;
      } else {
        line = [];
        length = 0;
      }
    } else {
      length = nextLength;
    }

    c++;
  }

  if (c === chars.length) {
    if (line.length) lines.push(line.join(''));
    return true;
  }

  return false;
}
