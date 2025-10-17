import { maxSubRow, ringBell, bufferToNum } from "../helpers";

import { config, mode } from "../config";

/**
 * Moves forward by a given offset through content lines or subrows.
 *
 * @param content - Full content lines.
 * @param offset - Number of lines/subrows to move forward.
 * @param ignoreEOF - If true, ignores EOF clamp (optional).
 */
export function lineForward(
  content: string[],
  offset: number,
  ignoreEOF: boolean = false
): void {
  let currMaxSubRow = maxSubRow(content[config.row]);

  if (isEOF(ignoreEOF, content.length, currMaxSubRow)) {
    ringBell();
    return;
  }

  if (config.chopLongLines || config.col) {
    const maxRow = ignoreEOF
      ? content.length - 1
      : Math.max(content.length - config.window + 1, 0);

    config.row = Math.min(config.row + offset, maxRow);
    return;
  }

  const EOF = ignoreEOF ? null : getEOF(content);
  const maxRow = EOF ? EOF.maxRow : content.length - 1;

  while (offset > 0 && config.row <= maxRow) {
    currMaxSubRow = config.row === maxRow && EOF
      ? EOF.subRow
      : maxSubRow(content[config.row]);

    if (config.subRow + offset <= currMaxSubRow) {
      config.subRow += offset;
      return;
    }

    offset -= currMaxSubRow - config.subRow + 1;

    config.row++;
    config.subRow = 0;
  }

  if (EOF && config.row > EOF.maxRow) {
    config.row = EOF.maxRow;
    config.subRow = EOF.subRow;
  } else if (config.row === content.length) {
    config.row = content.length - 1;
    config.subRow = currMaxSubRow;
  }
}

/**
 * Scroll backward by the given offset.
 *
 * - Stops and rings bell at BOF, also disables `mode.INIT`.
 * - In chopped mode, moves by whole lines.
 * - In wrapped mode, moves by sub-rows within a line.
 *
 * @param content - Full content lines.
 * @param offset - Lines or sub-rows to scroll backward.
 */
export function lineBackward(content: string[], offset: number): void {
  if (!config.row && !config.subRow) {
    if (mode.INIT) mode.INIT = false;
    ringBell();
    return;
  }

  if (config.chopLongLines || config.col) {
    config.row = Math.max(config.row - offset, 0);
    return;
  }

  while (offset > 0 && config.row >= 0) {
    if (config.subRow >= offset) {
      config.subRow -= offset;
      return;
    }

    if (config.row === 0) {
      config.subRow = 0;
      return;
    }

    offset -= config.subRow + 1;

    config.row--;
    config.subRow = maxSubRow(content[config.row]);
  }
}

/**
 * Scrolls the view forward by a window size.
 *
 * - If `buffer` is a valid number, it overrides the default window size.
 * - Falls back to `config.setWindow` or `config.window - 1` if `buffer` is
 *   invalid.
 * - If `ignoreEOF` is `true`, allows scrolling beyond (END) without clamping.
 *
 * @param content - The full content to paginate.
 * @param buffer - A string array that represents the number of lines to scroll.
 * @param ignoreEOF - Whether to bypass EOF constraints during scrolling.
 */
export function windowForward(
  content: string[],
  buffer: string[],
  ignoreEOF: boolean = false
): void {
  lineForward(
    content,
    bufferToNum(buffer) || config.setWindow || config.window - 1,
    ignoreEOF
  );
}

/**
 * Moves the view backward by one window.
 *
 * - If `buffer` is a valid number, uses it as the offset.
 * - Otherwise, uses `config.setWindow` if set, or defaults to
 *   `config.window - 1`.
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function windowBackward(content: string[], buffer: string[]): void {
  lineBackward(
    content,
    bufferToNum(buffer) || config.setWindow || config.window - 1
  );
}

/**
 * Sets a custom window size using the given `buffer`, and scrolls forward.
 *
 * - If `buffer` is a valid number, updates `config.setWindow` with it.
 * - Then scrolls forward by `config.setWindow` or falls back to
 *   `config.window - 1`.
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setWindowForward(content: string[], buffer: string[]): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;
  lineForward(content, config.setWindow || config.window - 1);
}

/**
 * Sets a custom window size using the given `buffer`, and scrolls backward.
 *
 * - If `buffer` is a valid number, updates `config.setWindow` with it.
 * - Then scrolls backward by `config.setWindow` or falls back to
 *   `config.window - 1`.
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setWindowBackward(content: string[], buffer: string[]): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;
  lineBackward(content, config.setWindow || config.window - 1);
}

/**
 * Sets a custom half-window size using the given `buffer`, and scrolls forward.
 *
 * - If `buffer` is a valid number, updates `config.setHalfWindow` with it.
 * - Then scrolls forward by `config.setHalfWindow` or falls back to
 *   `config.halfWindow`.
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setHalfWindowForward(
  content: string[],
  buffer: string[]
): void {
  config.setHalfWindow = bufferToNum(buffer) || config.setHalfWindow;
  lineForward(content, config.setHalfWindow || config.halfWindow);
}

/**
 * Sets a custom half-window size using the given `buffer`, and scrolls
 * backward.
 *
 * - If `buffer` is a valid number, updates `config.setHalfWindow` with it.
 * - Then scrolls backward by `config.setHalfWindow` or falls back to
 *   `config.halfWindow`.
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setHalfWindowBackward(
  content: string[],
  buffer: string[]
): void {
  config.setHalfWindow = bufferToNum(buffer) || config.setHalfWindow;
  lineBackward(content, config.setHalfWindow || config.halfWindow);
}

/**
 * Scrolls right by buffer value or half screen width.
 *
 * @param buffer - Buffer containing scroll offset.
 */
export function setHalfScreenRight(buffer: string[]): void {
  if (mode.INIT) mode.INIT = false;
  config.setCol = bufferToNum(buffer) || config.setCol;
  config.col += config.setCol || config.halfScreenWidth;
}

/**
 * Scrolls left by buffer value or half screen width.
 *
 * @param buffer - Buffer containing scroll offset.
 */
export function setHalfScreenLeft(buffer: string[]): void {
  if (mode.INIT) mode.INIT = false;
  config.setCol = bufferToNum(buffer) || config.setCol;
  config.col -= config.setCol || config.halfScreenWidth;
  if (config.col < 0) config.col = 0;
}

/**
 * Determines whether the current viewport position is at the end of the
 * content.
 *
 * This check accounts for both EOF mode and the final row/subRow position
 * based on whether EOF should be ignored.
 *
 * @param ignoreEOF - If `true`, skips EOF check and only uses position
 *                    comparison.
 * @param contentLength - Total number of content rows.
 * @param currMaxSubRow - The final sub-row index to compare against.
 * @returns `true` if the current position is at the end; otherwise, `false`.
 */
function isEOF(
  ignoreEOF: boolean,
  contentLength: number,
  currMaxSubRow: number
): boolean {
  return (
    (!ignoreEOF && mode.EOF) ||
    (config.row === contentLength - 1 && config.subRow === currMaxSubRow)
  );
}

/**
 * Calculates the last visible row and subrow for window clamping.
 *
 * @param content - Full content lines.
 * @returns Object with `maxRow` and `subRow` for the end position.
 */
function getEOF(content: string[]): {
  maxRow: number,
  subRow: number
} {
  let maxRow = content.length - 1;
  let subRow = 0;
  let rows = 0;

  while (maxRow >= 0) {
    const currMaxSubRow = maxSubRow(content[maxRow]);
    rows += currMaxSubRow + 1;

    if (rows >= config.window - 1) {
      subRow = rows - config.window + 1;
      return { maxRow, subRow };
    }

    maxRow--;
  }

  return { maxRow: 0, subRow: 0 };
}
