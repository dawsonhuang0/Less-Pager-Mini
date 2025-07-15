import { maxSubRow, ringBell, bufferToNum } from "../helpers";

import { config, mode } from "../pagerConfig";

/**
 * Moves the viewport forward by a given number of lines or sub-rows.
 *
 * - In chopped mode (`chopLongLines = true`), moves full logical lines up to
 *   the screen limit.
 * - In wrapped mode, moves by visual sub-rows, respecting wrapping boundaries.
 * - Prevents scrolling past the calculated end viewport to preserve the (END)
 *   marker.
 * - Rings a terminal bell if already at EOF and unable to scroll further.
 *
 * @param content - The array of full text lines in the buffer.
 * @param offset - The number of lines or sub-rows to move forward.
 */
export function lineForward(content: string[], offset: number): void {
  if (mode.EOF) {
    ringBell();
    return;
  }

  if (config.chopLongLines) {
    config.row = Math.min(
      config.row + offset,
      Math.max(content.length - config.window + 1, 0)
    );
    return;
  }

  const remaining = maxSubRow(content[config.row]) - config.subRow;

  if (remaining >= offset) {
    config.subRow += offset;
    return;
  }

  offset -= remaining + 1;
  config.subRow = 0;
  config.row++;

  const rowEnd = getEndPosition(content);
  const maxRow = Math.max(rowEnd.maxRow, 0) + 1;

  while (offset && config.row < maxRow) {
    config.subRow = Math.min(maxSubRow(content[config.row]), offset);
    offset -= config.subRow + 1;
    config.row++;
  }

  if (config.row === maxRow) {
    config.row = maxRow - 1;
    config.subRow = rowEnd.subRow;
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

  if (config.subRow >= offset) {
    config.subRow -= offset;
    return;
  }

  offset -= config.subRow + 1;
  config.row--;

  while (offset && config.row >= 0) {
    config.subRow = Math.max(maxSubRow(content[config.row]) - offset, 0);
    offset -= config.subRow + 1;
    config.row--;
  }

  if (config.row < 0) config.row = 0;
}

/**
 * Moves the view forward by one window.
 *
 * - If `buffer` is a valid number, uses it as the offset.
 * - Otherwise, uses `config.setWindow` if set, or defaults to
 *   `config.window - 1`.
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string representing the number of lines to scroll forward.
 */
export function windowForward(content: string[], buffer: string): void {
  lineForward(
    content,
    bufferToNum(buffer) || config.setWindow || config.window - 1
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
