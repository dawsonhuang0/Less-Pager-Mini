import { config, mode } from './config';

import { visualWidth } from './helpers';

/**
 * Wraps lines into subrows to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of wrapped lines.
 */
export function wrapLongLines(content: string[], lines: string[]): void {
  const maxRow = content.length - config.row;

  let row = 0;
  let isCompleteLine = true;
  let line = content[config.row];

  if (config.subRow) {
    isCompleteLine = partitionLine(lines, line, config.subRow);
    row++;
  }

  while (lines.length < config.window - 1 && row < maxRow) {
    line = content[config.row + row];

    if (visualWidth(line) > config.screenWidth) {
      isCompleteLine = partitionLine(lines, line, 0);
    } else {
      lines.push(line);
    }

    row++;
  }

  mode.EOF = isCompleteLine && row === maxRow;
}

/**
 * Wraps a long line into subrows and appends them to `lines`.
 *
 * - Starts from `subRowStart` for partial line display.
 * - Stops early if window limit is reached.
 *
 * @param lines - Output array for wrapped segments.
 * @param longLine - The line to split and wrap.
 * @param subRowStart - Starting subrow index (default 0).
 * @returns `true` if the line is fully wrapped, `false` if truncated.
 */
function partitionLine(
  lines: string[],
  longLine: string,
  subRowStart: number
): boolean {
  let line: string[] = [];

  const segments = Array.from(longLine);
  let length = 0;
  let subRow = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentWidth = visualWidth(segment);
    const concatLength = length + segmentWidth;

    if (concatLength < config.screenWidth) {
      line.push(segment);
      length = concatLength;
      continue;
    }

    const overflow = concatLength > config.screenWidth;

    if (subRow >= subRowStart) {
      if (lines.length === config.window - 1) return false;

      if (!overflow) line.push(segment);
      lines.push(line.join(''));
    }

    line = overflow ? [segment] : [];
    length = overflow ? segmentWidth : 0;

    subRow++;
  }

  if (line.length && subRow >= subRowStart) {
    if (lines.length === config.window - 1) return false;
    lines.push(line.join(''));
  }

  return true;
}