import { maxSubRow, ringBell, bufferToNum } from "../helpers";

import { config, mode } from "../pagerConfig";

/**
 * Forwards lines.
 * 
 * @param content string content array.
 * @param offset lines to move forward.
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
 * Backwards lines.
 * 
 * @param content string content array.
 * @param offset lines to move backward.
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
 * Forwards one window.
 * - Forwards lines if given buffer is valid.
 * - If given buffer is invalid, forwards config.setWindow lines if set.
 * 
 * @param content string content array.
 * @param buffer lines to move forward.
 */
export function windowForward(content: string[], buffer: string): void {
  lineForward(
    content,
    bufferToNum(buffer) || config.setWindow || config.window - 1
  );
}

/**
 * Backwards one window.
 * - Backwards lines if given buffer is valid.
 * - If given buffer is invalid, backwards config.setWindow lines if set.
 * 
 * @param content string content array.
 * @param buffer lines to move backward.
 */
export function windowBackward(content: string[], buffer: string): void {
  lineBackward(
    content,
    bufferToNum(buffer) || config.setWindow || config.window - 1
  );
}

/**
 * Sets a custom window size using the provided buffer and moves forward.
 * - Updates `config.setWindow` if the buffer is valid.
 * - Uses the updated value or falls back to `config.window - 1`.
 * 
 * @param content string content array.
 * @param buffer lines to move forward.
 */
export function setWindowForward(content: string[], buffer: string): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;
  lineForward(content, config.setWindow || config.window - 1);
}

/**
 * Sets a custom window size using the provided buffer and moves backward.
 * - Updates `config.setWindow` if the buffer is valid.
 * - Uses the updated value or falls back to `config.window - 1`.
 * 
 * @param content string content array.
 * @param buffer lines to move backward.
 */
export function setWindowBackward(content: string[], buffer: string): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;
  lineBackward(content, config.setWindow || config.window - 1);
}
