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
  let currSubRowMax = maxSubRow(content[config.row]);

  if (isEndPosition(ignoreEOF, content.length, currSubRowMax)) {
    ringBell();
    return;
  }

  if (config.chopLongLines) {
    const maxRow = ignoreEOF
      ? content.length - 1
      : Math.max(content.length - config.window + 1, 0);

    config.row = Math.min(config.row + offset, maxRow);
    return;
  }

  const rowEnd = ignoreEOF ? null : getEndPosition(content);
  const maxRow = rowEnd ? rowEnd.maxRow : content.length - 1;

  while (offset > 0 && config.row <= maxRow) {
    currSubRowMax = maxSubRow(content[config.row]);
    if (config.row === maxRow && rowEnd) currSubRowMax = rowEnd.subRow;

    if (config.subRow + offset <= currSubRowMax) {
      config.subRow += offset;
      return;
    }

    offset -= currSubRowMax - config.subRow + 1;

    config.row++;
    config.subRow = 0;
  }

  if (rowEnd && config.row > rowEnd.maxRow) {
    config.row = rowEnd.maxRow;
    config.subRow = rowEnd.subRow;
  } else if (config.row === content.length) {
    config.row = content.length - 1;
    config.subRow = currSubRowMax;
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

  if (config.chopLongLines) {
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
 * @param buffer - A string that may represent the number of lines to scroll.
 * @param ignoreEOF - Whether to bypass EOF constraints during scrolling.
 */
export function windowForward(
  content: string[],
  buffer: string,
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
 * @param buffer - A string representing the number of lines to scroll backward.
 */
export function windowBackward(content: string[], buffer: string): void {
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
 * @param buffer - A string representing the custom number of lines to scroll
 *                 forward.
 */
export function setWindowForward(content: string[], buffer: string): void {
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
 * @param buffer - A string representing the custom number of lines to scroll
 *                 backward.
 */
export function setWindowBackward(content: string[], buffer: string): void {
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
 * @param buffer - A string representing the custom number of lines to scroll
 *                 forward.
 */
export function setHalfWindowForward(content: string[], buffer: string): void {
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
 * @param buffer - A string representing the custom number of lines to scroll
 *                 backward.
 */
export function setHalfWindowBackward(content: string[], buffer: string): void {
  config.setHalfWindow = bufferToNum(buffer) || config.setHalfWindow;
  lineBackward(content, config.setHalfWindow || config.halfWindow);
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
 * @param currSubRowMax - The final sub-row index to compare against.
 * @returns `true` if the current position is at the end; otherwise, `false`.
 */
function isEndPosition(
  ignoreEOF: boolean,
  contentLength: number,
  currSubRowMax: number
): boolean {
  return (
    (!ignoreEOF && mode.EOF) ||
    (config.row === contentLength - 1 && config.subRow === currSubRowMax)
  );
}

/**
 * Calculates the last visible row and subrow for window clamping.
 *
 * @param content - Full content lines.
 * @returns Object with `maxRow` and `subRow` for the end position.
 */
function getEndPosition(content: string[]): {
  maxRow: number,
  subRow: number
} {
  let maxRow = content.length - 1;
  let subRow = 0;
  let rowCount = 0;

  while (maxRow >= 0) {
    const subRows = maxSubRow(content[maxRow]) + 1;
    const rowSum = rowCount + subRows;
  
    if (rowSum >= config.window - 1) {
      subRow = rowSum - config.window + 1;
      break;
    }
  
    rowCount = rowSum;
    maxRow--;
  }

  if (maxRow < 0) {
    maxRow = 0;
    subRow = 0;
  }

  return { maxRow, subRow };
}
