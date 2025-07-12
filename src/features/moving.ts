import { maxSubRow, ringBell } from "../helpers";

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
