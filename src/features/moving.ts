import { maxSubRow, ringBell, bufferToNum, visualWidth } from "../helpers";

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
  if (mode.EOF && !ignoreEOF) {
    ringBell();
    return;
  }

  // scrolling forward consumes blank rows padded above BOF first
  if (config.blankTop) {
    const consumed = Math.min(config.blankTop, offset);
    config.blankTop -= consumed;
    offset -= consumed;
    if (!offset) return;
  }

  if (config.chopLongLines || config.col) {
    const lastRow = Math.max(content.length - config.window + 1, 0);

    config.row = Math.min(
      config.row + offset,
      ignoreEOF ? content.length - 1 : lastRow
    );

    mode.EOF = config.row >= lastRow;
    return;
  }

  const maxRow = ignoreEOF ? content.length - 1 : config.endRow;

  while (offset > 0 && config.row < maxRow) {
    const currMaxSubRow = maxSubRow(content[config.row]);

    if (config.subRow + offset <= currMaxSubRow) {
      config.subRow += offset;
      break;
    }

    offset -= currMaxSubRow - config.subRow + 1;

    config.row++;
    config.subRow = 0;
  }

  if (config.row === maxRow) {
    config.subRow = Math.min(
      config.subRow + offset,
      ignoreEOF ? maxSubRow(content[config.row]) : config.endSubRow
    );
  }

  mode.EOF = config.row > config.endRow || (
    config.row === config.endRow && config.subRow >= config.endSubRow
  );
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
  if (config.row === 0 && config.subRow === 0) {
    if (mode.INIT) mode.INIT = false;
    ringBell();
    return;
  }

  if (config.chopLongLines || config.col) {
    config.row = Math.max(config.row - offset, 0);

    if (
      mode.EOF &&
      config.row < Math.max(content.length - config.window + 1, 0)
    ) {
      mode.EOF = false;
    }

    return;
  }

  while (offset > 0 && config.row >= 0) {
    if (config.subRow >= offset) {
      config.subRow -= offset;
      break;
    }

    if (config.row === 0) {
      config.subRow = 0;
      break;
    }

    offset -= config.subRow + 1;

    config.row--;
    config.subRow = maxSubRow(content[config.row]);
  }

  if (
    mode.EOF && (
      config.row < config.endRow ||
      (config.row === config.endRow && config.subRow < config.endSubRow)
    )
  ) {
    mode.EOF = false;
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
 * Scrolls right to the last column displayed.
 *
 * - Shifts the view so the longest currently displayed line ends at the
 *   right edge of the screen.
 *
 * @param content - Full content lines.
 */
export function lastCol(content: string[]): void {
  if (mode.INIT) mode.INIT = false;

  let maxWidth = 0;

  const end = Math.min(config.row + config.window - 1, content.length);
  for (let row = config.row; row < end; row++) {
    maxWidth = Math.max(maxWidth, visualWidth(content[row]));
  }

  config.col = Math.max(maxWidth - config.screenWidth, 0);
}

/**
 * Scrolls left to the first column.
 */
export function firstCol(): void {
  config.col = 0;
}
