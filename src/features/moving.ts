import { maxSubRow, ringBell, bufferToNum } from "../helpers";

import { config, mode } from "../pagerConfig";

/**
 * Moves the view forward by a number of visual lines or sub-rows.
 *
 * - Handles both chopped and wrapped line modes.
 * - Respects EOF unless `ignoreEOF` is `true`.
 * - In chopped mode, scrolls by full rows only.
 * - In wrapped mode, scrolls sub-rows with smart bounds.
 *
 * @param content - The full content as an array of lines.
 * @param offset - Number of lines or sub-rows to move forward.
 * @param ignoreEOF - Whether to ignore (END) and allow overflowing the
 *                    viewport.
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
  const maxRow = rowEnd ? rowEnd.maxRow : content.length;

  while (offset > 0 && config.row < maxRow) {
    currSubRowMax = maxSubRow(content[config.row]);

    if (config.subRow + offset <= currSubRowMax) {
      config.subRow += offset;
      return;
    }

    offset -= currSubRowMax - config.subRow + 1;

    config.row++;
    config.subRow = 0;
  }

  if (config.row === content.length) {
    config.row = content.length - 1;
    config.subRow = currSubRowMax;
  } else if (rowEnd && config.row >= rowEnd.maxRow) {
    config.row = rowEnd.maxRow;
    if (config.subRow > rowEnd.subRow) config.subRow = rowEnd.subRow;
  }
}

/**
 * Moves the view backward by a given number of lines.
 *
 * - If `chopLongLines` is enabled, steps back full rows.
 * - Otherwise, steps back sub-rows (wrapped lines) accordingly.
 * - Rings the terminal bell if already at the top.
 *
 * @param content - The full content as an array of lines.
 * @param offset - The number of lines or sub-rows to move backward.
 */
export function lineBackward(content: string[], offset: number): void {
  if (!config.row && !config.subRow) {
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

    offset -= config.subRow + 1;
    config.row--;
    if (config.row >= 0) config.subRow = maxSubRow(content[config.row]);
  }

  if (config.row < 0) {
    config.row = 0;
    config.subRow = 0;
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
 * @param currSubRow - The final sub-row index to compare against.
 * @returns `true` if the current position is at the end; otherwise, `false`.
 */
function isEndPosition(
  ignoreEOF: boolean,
  contentLength: number,
  currSubRow: number
): boolean {
  return (
    (!ignoreEOF && mode.EOF) ||
    (config.row === contentLength - 1 && config.subRow === currSubRow)
  );
}

/**
 * Calculates the last visible row and sub-row that can fit within the current
 * window height.
 *
 * This is used in wrapped mode to determine the correct position for `(END)`,
 * ensuring the viewport is filled without exceeding the screen height.
 *
 * @param content - The array of text lines.
 * @returns An object containing:
 *            - `maxRow`: the last visible row index,
 *            - `subRow`: the starting sub-row to fit the viewport.
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

  return { maxRow, subRow };
}
