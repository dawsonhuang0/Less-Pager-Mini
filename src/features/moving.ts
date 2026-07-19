import { ringBell, bufferToNum } from "../helpers";
import { maxSubRow, visualWidth } from "../lines/helpers";

import { config, mode } from "../config";

import {
  optShowAttn,
  optPastEof,
  optHeader,
  optStopOnFormFeed,
  optShiftCount,
  setShiftCount,
  optClearRepaint,
  chopLine,
  getSwindow
} from "../options";

import { bottomRow, revealPipeEnd, files, pendingScroll } from "./files";

import { INVERSE_ON } from "../constants";

/**
 * Whether a display line is a form feed line, for --form-feed: the raw
 * `\f` (-r) or its caret rendering.
 */
const isFormFeed = (line: string): boolean =>
  line.startsWith('\f') || line.startsWith(INVERSE_ON + '^L');

/**
 * Caps a forward scroll at og's --form-feed stop: forw() checks each
 * newly printed bottom line (forwback.c:366) and breaks with the \f
 * line as the LAST visible row on screen.
 */
function ffCapForward(content: string[], offset: number): number {
  let r = config.row;
  let s = config.subRow;
  let steps = Math.max(config.window - 2 - config.blankTop, 0);

  const advance = (): boolean => {
    if (s < maxSubRow(content[r])) {
      s++;
      return true;
    }

    if (r + 1 >= content.length) return false;
    r++;
    s = 0;
    return true;
  };

  // find the current bottom display row
  while (steps > 0 && advance()) steps--;

  // the first incoming row that STARTS a  line caps the move there
  for (let k = 1; k <= offset; k++) {
    if (!advance()) break;
    if (s === 0 && isFormFeed(content[r])) return k;
  }

  return offset;
}

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
 * Records a forward shortfall as og's blocked read: forw_line on a
 * live pipe waits for the missing lines instead of belling — the
 * owed rows go to pendingScroll and the pipe machinery advances the
 * view as data arrives.
 *
 * @param owed - Display rows the move still wants.
 * @param moved - True when this call already advanced the view
 *   (og's nlines > 0, suppressing the eof_bell).
 * @returns True when the wait was recorded (live pipe).
 */
function streamingWait(owed: number, moved: boolean): boolean {
  if (mode.HELP || !files.list[files.index]?.streaming) return false;

  pendingScroll.rows = owed;
  if (moved) pendingScroll.moved = true;
  return true;
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

  // a stale EOF: blank rows pad the top while undisplayed lines sit
  // below the viewport (a fill abort followed by more pipe data) —
  // og's forw simply scrolls, consuming the blanks, so the EOF
  // branch must not run its bell or blocked wait
  if (config.blankTop && !fitsViewport(content)) mode.EOF = false;

  if (mode.EOF && !ignoreEOF) {
    // a live pipe never bells here: og's position(BOTTOM_PLUS_ONE)
    // is real on a full screen, so forw's read simply blocks for
    // more data (and -e stays off — eof_displayed needs ch_length)
    if (streamingWait(offset, false)) return;

    // -e/-E move to the next file (or quit) on a forward move at
    // end-of-file, like og's forward() checking get_quit_at_eof
    // before the eof bell
    if (eofForwardHook && eofForwardHook()) return;

    // og's forw still reads here: a completed pipe returns EOI and
    // only now learns its length, lighting up (END). A squished
    // screen stays squished: forward() bells and returns BEFORE
    // forw()'s squish_check when BOTTOM_PLUS_ONE is null (the short
    // screen's position table ends early) — verified against og's
    // bytes, which repaint nothing here
    revealPipeEnd();
    ringBell('eof');
    return;
  }

  // nothing to scroll (a -z window of zero or less): og's forw runs
  // zero iterations and rings the eof bell on nlines == 0
  if (offset <= 0) {
    ringBell('eof');
    return;
  }

  setAttn(content, false);

  // scrolling forward consumes blank rows padded above BOF first
  if (config.blankTop) {
    const consumed = Math.min(config.blankTop, offset);
    config.blankTop -= consumed;
    offset -= consumed;

    // revealing the whole tail latches (END) again, like og's forw
    // reaching end-of-input at the bottom line
    mode.EOF = fitsViewport(content);

    if (!offset) return;
  }

  // -c starts a new screen on a full-window (or bigger) forward move
  // before knowing whether EOF lands mid-screen ("not really
  // desirable ... but we don't yet know"), so the view runs over EOF
  // with null lines below, stopping once the last file line reaches
  // the top, like og's forw top_scroll branch forcing
  if (optClearRepaint() && offset >= config.window - 1) {
    ignoreEOF = true;
  }

  // og's forw checks each newly printed BOTTOM line (forwback.c:366):
  // the scroll stops with the \f line as the LAST visible row; jumps
  // pass do_stop_on_form_feed=FALSE and never stop
  if (optStopOnFormFeed()) offset = ffCapForward(content, offset);

  if (chopLine() || config.col) {
    const lastRow = Math.max(content.length - config.window + 1, 0);
    const startRow = config.row;
    const target = config.row + offset;

    config.row = Math.min(target, ignoreEOF ? content.length - 1 : lastRow);

    // a move asking for more rows than the input has reads past the
    // end, like og's forw hitting EOI on a partial screenful — or
    // blocking for the missing lines when the pipe still delivers
    if (config.row < target &&
        !streamingWait(target - config.row, config.row > startRow)) {
      revealPipeEnd();
    }

    // og's forw unsquishes as soon as it actually paints: a forced
    // (ESC-SPACE, --past-eof) advance on the squished short first
    // paint fills the screen with null-line tildes; only clamped
    // bells keep the squish (forwback.c first_time branch)
    if (mode.INIT && config.row !== startRow) mode.INIT = false;

    mode.EOF = config.row >= lastRow;
    return;
  }

  const maxRow = ignoreEOF ? content.length - 1 : config.endRow;
  const fromRow = config.row;
  const fromSub = config.subRow;

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
    const cap = ignoreEOF ? maxSubRow(content[config.row]) : config.endSubRow;
    const want = config.subRow + offset;

    config.subRow = Math.min(want, cap);

    // clamped short of the request: the forw read hit EOI — or
    // blocks for the missing lines when the pipe still delivers
    if (want > cap && !streamingWait(want - cap,
        config.row !== fromRow || config.subRow !== fromSub)) {
      revealPipeEnd();
    }
  }

  // og's forw unsquishes when it actually paints (a forced advance
  // fills the screen with null-line tildes); clamped bells keep it
  if (mode.INIT &&
      (config.row !== fromRow || config.subRow !== fromSub)) {
    mode.INIT = false;
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

    // --past-eof forces backward scrolls over BOF too, like og's
    // back() setting force on past_eof
    if (optPastEof() && offset > 0) {
      padBlankTop(content, offset);
      return 0;
    }

    ringBell('eof');
    return offset;
  }

  // og's back with nothing to scroll bells the same way (nlines == 0)
  if (offset <= 0) {
    ringBell('eof');
    return 0;
  }

  // backward movement forgets the -w unread highlight, like less
  config.attnRow = -1;

  // og's back() clamps at the header start: each line is checked
  // through after_header_pos (forwback.c:426), so rows above the
  // header are unreachable by backward scrolls
  const floor = optHeader().lines > 0 ? optHeader().start : 0;

  if (chopLine() || config.col) {
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
    config.row = Math.max(config.row - offset, floor);

    if (
      mode.EOF &&
      config.row < Math.max(content.length - config.window + 1, 0)
    ) {
      mode.EOF = false;
    }

    const leftover = Math.max(offset - (startRow - floor), 0);

    if (leftover > 0 && optPastEof()) {
      padBlankTop(content, leftover);
      return 0;
    }

    return leftover;
  }

  let leftover = 0;

  while (offset > 0 && config.row >= floor) {
    if (config.subRow >= offset) {
      config.subRow -= offset;
      break;
    }

    if (config.row === floor) {
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

  if (leftover > 0 && optPastEof()) {
    padBlankTop(content, leftover);
    return 0;
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

  if (leftover > 0) padBlankTop(content, leftover);
}

/**
 * Accumulates og's over-BOF null rows for a forced back.
 */
function padBlankTop(content: string[], leftover: number): void {
  const cap = Math.max(config.window - 2, 0);

  // og's back bells when it cannot add a single line (nlines == 0):
  // the first file line has reached the bottom of the screen
  if (config.blankTop >= cap) {
    ringBell('eof');
    return;
  }

  // null rows accumulate above BOF, one short of an empty screen
  config.blankTop = Math.min(config.blankTop + leftover, cap);

  // (END) stays displayed while the rows past the tail are still
  // on screen, and clears once the tail slides below the bottom
  // line, like og's eof_displayed checking the bottom position
  mode.EOF = fitsViewport(content);
}

/**
 * True when the whole content fits above the prompt with the current
 * blank top, i.e. the end of the file is on screen.
 */
function fitsViewport(content: string[]): boolean {
  const capacity = config.window - 1 - config.blankTop;
  return displayRows(content, capacity) <= capacity;
}

/** Display rows of the content, stopping once past `cap`. */
function displayRows(content: string[], cap: number): number {
  let total = 0;

  for (const line of content) {
    total += maxSubRow(line) + 1;
    if (total > cap) break;
  }

  return total;
}

/**
 * Scrolls forward by whole file lines (ESC-j), like og's to_newline
 * forw: wrapped sub-rows always land on a line boundary.
 *
 * @param content - Full content lines.
 * @param offset - File lines to move forward.
 */
export function newlineForward(content: string[], offset: number): void {
  if (chopLine() || config.col) {
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
  if (chopLine() || config.col) {
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

// the -e forward-at-EOF handler, like og's forward() top: returns
// true when it consumed the move (next file edited, or quitting)
let eofForwardHook: (() => boolean) | null = null;

/** Registers (or clears) the -e forward-at-EOF handler. */
export function onEofForward(fn: (() => boolean) | null): void {
  eofForwardHook = fn;
}

/**
 * Scrolls the view forward by a window size.
 *
 * - If `buffer` is a valid number, it overrides the default window size.
 * - Falls back to the -z scroll window (og's get_swindow) if `buffer`
 *   is invalid.
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
    bufferToNum(buffer) || getSwindow(),
    ignoreEOF
  );
}

/**
 * Moves the view backward by one window.
 *
 * - If `buffer` is a valid number, uses it as the offset.
 * - Otherwise, uses the -z scroll window (og's get_swindow).
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function windowBackward(content: string[], buffer: string[]): void {
  lineBackward(
    content,
    bufferToNum(buffer) || getSwindow()
  );
}

/**
 * Sets a custom window size using the given `buffer`, and scrolls forward.
 *
 * - If `buffer` is a valid number, updates `config.setWindow` with it.
 * - Then scrolls forward by the -z scroll window (og's get_swindow).
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setWindowForward(content: string[], buffer: string[]): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;
  lineForward(content, getSwindow());
}

/**
 * Sets a custom window size using the given `buffer`, and scrolls backward.
 *
 * - If `buffer` is a valid number, updates `config.setWindow` with it.
 * - Then scrolls backward by the -z scroll window (og's get_swindow).
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setWindowBackward(content: string[], buffer: string[]): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;
  lineBackward(content, getSwindow());
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
