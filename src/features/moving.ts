import { maxSubRow, ringBell, bufferToNum, visualWidth } from "../helpers";

import { config, mode } from "../config";

import {
  optShowAttn,
  optPastEof,
  optStopOnFormFeed,
  optShiftCount,
  setShiftCount
} from "../options";

import { bottomRow } from "./files";

import { INVERSE_ON } from "../constants";

/**
 * Whether a display line is a form feed line, for --form-feed: the raw
 * `\f` (-r) or its caret rendering.
 */
const isFormFeed = (line: string): boolean =>
  line.startsWith('\f') || line.startsWith(INVERSE_ON + '^L');

/**
 * Remembers the first unread line before a forward movement, like less
 * setting attnpos for -w/-W: `-W` marks any forward movement, `-w`
 * only full screens.
 *
 * @param content - Full content lines.
 * @param screenful - True when moving by a whole window.
 */
function setAttn(content: string[], screenful: boolean): void {
  const attn = optShowAttn();
  if (!attn || (attn === 1 && !screenful)) return;

  const next = bottomRow(content) + 1;
  config.attnRow = next < content.length ? next : -1;
}

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
  // --past-eof lets every forward scroll continue past (END), like
  // less forcing forw()
  if (optPastEof()) ignoreEOF = true;

  if (mode.EOF && !ignoreEOF) {
    ringBell('eof');
    return;
  }

  setAttn(content, false);

  // scrolling forward consumes blank rows padded above BOF first
  if (config.blankTop) {
    const consumed = Math.min(config.blankTop, offset);
    config.blankTop -= consumed;
    offset -= consumed;
    if (!offset) return;
  }

  if (config.chopLongLines || config.col) {
    // --form-feed stops the scroll with a \f line at the top
    if (optStopOnFormFeed()) {
      const limit = Math.min(config.row + offset, content.length - 1);

      for (let row = config.row + 1; row <= limit; row++) {
        if (isFormFeed(content[row])) {
          offset = row - config.row;
          break;
        }
      }
    }

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

    if (optStopOnFormFeed() && isFormFeed(content[config.row])) {
      offset = 0;
      break;
    }
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
export function lineBackward(content: string[], offset: number): number {
  if (config.row === 0 && config.subRow === 0) {
    if (mode.INIT) mode.INIT = false;
    ringBell('eof');
    return offset;
  }

  // backward movement forgets the -w unread highlight, like less
  config.attnRow = -1;

  if (config.chopLongLines || config.col) {
    // --form-feed also stops backward scrolls at a \f line
    if (optStopOnFormFeed()) {
      const limit = Math.max(config.row - offset, 0);

      for (let row = config.row - 1; row >= limit; row--) {
        if (isFormFeed(content[row])) {
          offset = config.row - row;
          break;
        }
      }
    }

    const startRow = config.row;
    config.row = Math.max(config.row - offset, 0);

    if (
      mode.EOF &&
      config.row < Math.max(content.length - config.window + 1, 0)
    ) {
      mode.EOF = false;
    }

    return Math.max(offset - startRow, 0);
  }

  let leftover = 0;

  while (offset > 0 && config.row >= 0) {
    if (config.subRow >= offset) {
      config.subRow -= offset;
      break;
    }

    if (config.row === 0) {
      leftover = offset - config.subRow;
      config.subRow = 0;
      break;
    }

    offset -= config.subRow + 1;

    config.row--;
    config.subRow = maxSubRow(content[config.row]);

    if (optStopOnFormFeed() && isFormFeed(content[config.row])) {
      config.subRow = 0;
      break;
    }
  }

  if (
    mode.EOF && (
      config.row < config.endRow ||
      (config.row === config.endRow && config.subRow < config.endSubRow)
    )
  ) {
    mode.EOF = false;
  }

  return leftover;
}

/**
 * Scrolls backward past the beginning of the file (K, Y, ESC-b), like
 * less's forced back() padding blank lines above the first line.
 *
 * @param content - Full content lines.
 * @param offset - Lines or sub-rows to scroll backward.
 */
export function forceLineBackward(content: string[], offset: number): void {
  if (mode.INIT) mode.INIT = false;
  config.attnRow = -1;

  let leftover = offset;

  if (config.row !== 0 || config.subRow !== 0) {
    leftover = lineBackward(content, offset);
  }

  if (leftover > 0) {
    // blanks accumulate above BOF, one short of an empty screen
    config.blankTop = Math.min(
      config.blankTop + leftover,
      Math.max(config.window - 2, 0)
    );

    if (mode.EOF) mode.EOF = false;
  }
}

/**
 * Scrolls forward by whole file lines (ESC-j), like og's to_newline
 * forw: wrapped sub-rows always land on a line boundary.
 *
 * @param content - Full content lines.
 * @param offset - File lines to move forward.
 */
export function newlineForward(content: string[], offset: number): void {
  if (config.chopLongLines || config.col) {
    lineForward(content, offset);
    return;
  }

  if (mode.EOF && !optPastEof()) {
    ringBell('eof');
    return;
  }

  setAttn(content, false);

  // land on the next line boundary, but never past the EOF anchor
  const target = config.row + offset;

  if (target > config.endRow) {
    config.row = config.endRow;
    config.subRow = config.endSubRow;
  } else {
    config.row = target;
    config.subRow = 0;
  }

  mode.EOF = config.row > config.endRow || (
    config.row === config.endRow && config.subRow >= config.endSubRow
  );
}

/**
 * Scrolls backward by whole file lines (ESC-k), like og's to_newline
 * back.
 *
 * @param content - Full content lines.
 * @param offset - File lines to move backward.
 */
export function newlineBackward(content: string[], offset: number): void {
  if (config.chopLongLines || config.col) {
    lineBackward(content, offset);
    return;
  }

  if (config.row === 0 && config.subRow === 0) {
    if (mode.INIT) mode.INIT = false;
    ringBell('eof');
    return;
  }

  config.attnRow = -1;

  // a mid-line top first snaps back to its line start
  if (config.subRow > 0) {
    config.subRow = 0;
    offset--;
  }

  config.row = Math.max(config.row - offset, 0);

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
  if (!mode.EOF || ignoreEOF) setAttn(content, true);

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

  const count = bufferToNum(buffer);
  if (count) setShiftCount(count);

  config.col += optShiftCount() || config.halfScreenWidth;
}

/**
 * Scrolls left by buffer value or half screen width.
 *
 * @param buffer - Buffer containing scroll offset.
 */
export function setHalfScreenLeft(buffer: string[]): void {
  if (mode.INIT) mode.INIT = false;

  const count = bufferToNum(buffer);
  if (count) setShiftCount(count);

  config.col -= optShiftCount() || config.halfScreenWidth;
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
