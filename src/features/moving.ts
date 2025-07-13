import { maxSubRow, ringBell, bufferToNum } from "../helpers";

import { config, mode } from "../pagerConfig";

/**
 * Moves the view forward by a given number of lines.
 *
 * - If `chopLongLines` is enabled, advances full rows.
 * - Otherwise, advances sub-rows (wrapped lines) accordingly.
 * - If EOF is reached, rings the terminal bell and halts.
 *
 * @param content - The full content as an array of lines.
 * @param offset - The number of lines or sub-rows to move forward.
 */
export function lineForward(content: string[], offset: number): void {
  if (mode.EOF) {
    ringBell();
    return;
  }

  if (config.chopLongLines) {
    config.row = Math.min(config.row + offset, content.length - 1);
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

  while (offset && config.row < content.length) {
    config.subRow = Math.min(maxSubRow(content[config.row]), offset);
    offset -= config.subRow + 1;
    config.row++;
  }

  if (config.row === content.length) config.row = content.length - 1;
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
