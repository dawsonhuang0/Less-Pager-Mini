import wcwidth from 'wcwidth-o1';

import { config, mode } from "./config";

import { visualWidth, isStyled, isAscii } from "./helpers";

import { INVERSE_ON, INVERSE_OFF, STYLE_REGEX_G } from "./constants";

const MORE_INDICATOR = INVERSE_ON + '>' + INVERSE_OFF;

/**
 * Chops long lines to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of chopped lines.
 */
export function chopLongLines(content: string[], lines: string[]): void {
  const maxRow = content.length - config.row;
  const maxCol = config.screenWidth + config.col;

  while (lines.length < config.window - 1 && lines.length < maxRow) {
    const line = content[config.row + lines.length];
    lines.push(chop(line, maxCol));
  }

  mode.EOF = lines.length === maxRow;
}

/**
 * Chooses the appropriate chopping strategy for a line.
 *
 * - Routes to styled/ascii/non-ascii handlers based on content type.
 * - Adds `MORE_INDICATOR` if ASCII line exceeds screen width.
 *
 * @param line - The line of text to chop.
 * @param maxCol - The maximum column position allowed.
 * @returns The chopped line as a string.
 */
function chop(line: string, maxCol: number): string {
  if (isStyled(line)) {
    return isAscii(line)
      ? chopStyledAsciiLine(line)
      : chopStyledLine(line);
  }
  
  if (isAscii(line)) {
    return line.length > maxCol
      ? line.slice(config.col, maxCol - 1) + MORE_INDICATOR
      : line.slice(config.col);
  }
  
  return chopLine(line);
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

  while (ansi = STYLE_REGEX_G.exec(styledLine)) {
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

  while (ansi = STYLE_REGEX_G.exec(styledLine)) {
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
 * Truncates a long line to screen width and appends a `>` marker.
 *
 * @param longLine - The line to chop.
 * @returns The chopped line with marker.
 */
function chopLine(longLine: string): string {
  const line: string[] = [];

  const segments = Array.from(longLine);
  let length = 0;
  let i = 0;

  let segmentWidth = 0;
  let concatLength = 0;

  while (i < segments.length) {
    segmentWidth = visualWidth(segments[i]);
    concatLength = length + segmentWidth;

    if (concatLength > config.col) break;

    length = concatLength;
    i++;
  }

  if (i === segments.length) return '';

  const remaining = config.col - length;
  const excess = segmentWidth - remaining;

  if (isAscii(segments[i])) {
    line.push(segments[i].slice(remaining));
  } else {
    line.push(
      remaining
        ? INVERSE_ON + ' '.repeat(excess) + INVERSE_OFF
        : segments[i]
    );
  }

  length = excess;
  i++;

  while (length < config.screenWidth && i < segments.length) {
    concatLength = length + visualWidth(segments[i]);

    if (
      concatLength > config.screenWidth ||
      (concatLength === config.screenWidth && i !== segments.length - 1)
    ) {
      const remaining = config.screenWidth - length - 1;

      if (isAscii(segments[i])) {
        line.push(segments[i].slice(0, remaining) + MORE_INDICATOR);
      } else {
        line.push(`${INVERSE_ON}${' '.repeat(remaining)}>${INVERSE_OFF}`);
      }
    } else {
      line.push(segments[i]);
    }

    length = concatLength;
    i++;
  }

  return line.join('');
}
