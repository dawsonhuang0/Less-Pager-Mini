import { ringBell, bufferToNum } from "../helpers";
import { maxSubRow, visualWidth } from "../lines/helpers";

import { config, mode } from "../state/config";

import {
  optShowAttn,
  optPastEof,
  optHeader,
  optStopOnFormFeed,
  optShiftCount,
  setShiftCount,
  optClearRepaint,
  chopLine,
  getSwindow,
  hook
} from "../options";

import { bottomRow, revealPipeEnd, files, pendingScroll } from "./files";

import { posRehead } from "./jumping";

import {
  screenBack,
  screenForward,
  rowStartBelow,
  lastRowStart,
  topOffsetOf,
  setTopOffset,
  nextRowOffset,
  rowOffsetOf,
} from "../lines/screenOps";

import { INVERSE_ON } from "../state/constants";

/**
 * Whether a display line is a form feed line, for --form-feed: the raw
 * `\f` (-r) or its caret rendering.
 */
export const isFormFeed = (line: string): boolean =>
  line.startsWith('\f') || line.startsWith(INVERSE_ON + '^L');

/**
 * A cursor over display rows, parked on the bottom row of the screen.
 *
 * less's two forward-looking commands both start at the bottom edge and
 * step on from there -- the form-feed cap looking for the first
 * incoming \f line, newlineForward counting rows that end a file line
 * -- so both the walk down to the bottom and the stepping itself were
 * written out twice.
 *
 * @param content - Full content lines.
 */
function bottomWalk(content: string[]): {
  row: number;
  subRow: number;
  advance(): boolean;
} {
  const walk = {
    row: config.row,
    subRow: config.subRow,

    advance(): boolean {
      if (walk.subRow < maxSubRow(content[walk.row])) {
        walk.subRow++;
        return true;
      }

      if (walk.row + 1 >= content.length) return false;
      walk.row++;
      walk.subRow = 0;
      return true;
    },
  };

  let steps = Math.max(config.window - 2 - config.blankTop, 0);
  while (steps > 0 && walk.advance()) steps--;

  return walk;
}

/**
 * Caps a forward scroll at less's --form-feed stop: forw() checks each
 * newly printed bottom line (forwback.c:366) and breaks with the \f
 * line as the LAST visible row on screen.
 */
export function ffCapForward(content: string[], offset: number): number {
  const walk = bottomWalk(content);

  // the first incoming row that STARTS a \f line caps the move there
  for (let k = 1; k <= offset; k++) {
    if (!walk.advance()) break;
    if (walk.subRow === 0 && isFormFeed(content[walk.row])) return k;
  }

  return offset;
}

/**
 * How far a backward move may go before a form feed stops it.
 *
 * less's back() prints each newly exposed line at the TOP and breaks
 * after one that starts with \f (forwback.c:444), so the form feed
 * ends up the first visible row. Jumps pass do_stop_on_form_feed
 * FALSE and never stop.
 *
 * @param content - Full content lines.
 * @param offset - Display rows the move wants.
 * @returns The rows it may actually take.
 */
export function ffCapBackward(content: string[], offset: number): number {
  let r = config.row;
  let s = config.subRow;

  const retreat = (): boolean => {
    if (s > 0) {
      s--;
      return true;
    }

    if (r <= 0) return false;
    r--;
    s = maxSubRow(content[r]);
    return true;
  };

  for (let k = 1; k <= offset; k++) {
    if (!retreat()) break;
    if (s === 0 && isFormFeed(content[r])) return k;
  }

  return offset;
}

/**
 * less's attnpos for -w/-W: every move command first clears the old
 * highlight (cmd_exec's clear_attn, command.c:126), then remembers
 * the first unread line under its own condition (command.c:1660+).
 * Forward marks the old bottompos - the first row below the screen.
 *
 * @param content - Full content lines.
 * @param cond - The less per-command show_attn condition.
 */
function setAttnForward(content: string[], cond: boolean): void {
  config.attnRow = -1;
  if (!cond) return;

  const next = bottomRow(content) + 1;
  config.attnRow = next < content.length ? next : -1;
}

/**
 * The backward counterpart (v693, command.c:1689): attn marks
 * toppos-1 - the line just above the old top, or the same line's
 * earlier part when the top sat mid-line - guarded off at BOF.
 *
 * @param cond - The less per-command show_attn condition.
 */
function setAttnBackward(cond: boolean): void {
  config.attnRow = -1;
  if (!cond) return;

  if (config.subRow > 0) {
    config.attnRow = config.row;
  } else if (config.row > 0 && config.blankTop === 0) {
    config.attnRow = config.row - 1;
  }
}

/**
 * Records a forward shortfall as less's blocked read: forw_line on a
 * live pipe waits for the missing lines instead of belling — the
 * owed rows go to pendingScroll and the pipe machinery advances the
 * view as data arrives.
 *
 * @param owed - Display rows the move still wants.
 * @param moved - True when this call already advanced the view
 *   (less's nlines > 0, suppressing the eof_bell).
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
/**
 * Display rows between the top and the EOF anchor, 0 once it is
 * reached — the count less's forward() would have let forw() draw.
 *
 * Walks with the same two primitives as the clamped loop below
 * (nextRowOffset within a line, row++ between them) rather than
 * counting whole-line rows, because a top part-way into a row makes
 * its line paint fewer rows than its boundary grid holds.
 */
function rowsToAnchor(content: string[]): number {
  const capRow = config.endRow;
  const capAt = rowOffsetOf(content[capRow] ?? '', config.endSubRow);

  let row = config.row;
  let at = topOffsetOf(content);
  let rows = 0;

  // -1 for a top already PAST the anchor, which is not the same as 0
  // ("standing on it"). Conflating them is what let the wheel walk
  // off the end: 0 has to clamp hard, while past-the-anchor means the
  // anchor tells us nothing — it is stale, or was never computed —
  // and clamping to it would freeze the move instead.
  if (row > capRow || (row === capRow && at > capAt)) return -1;

  while (row < content.length &&
         (row < capRow || (row === capRow && at < capAt))) {
    const next = nextRowOffset(content[row] ?? '', at);

    if (next !== null) {
      at = next;
    } else {
      row++;
      at = 0;
    }

    rows++;
  }

  return rows;
}

export function lineForward(
  content: string[],
  offset: number,
  ignoreEOF: boolean = false,
  attn: boolean = true
): void {
  // --past-eof lets every forward scroll continue past (END), like
  // less forcing forw()
  if (optPastEof()) ignoreEOF = true;

  // a stale EOF: blank rows pad the top while undisplayed lines sit
  // below the viewport (a fill abort followed by more pipe data) —
  // less's forw simply scrolls, consuming the blanks, so the EOF
  // branch must not run its bell or blocked wait
  if (config.blankTop && !fitsViewport(content)) mode.EOF = false;

  if (mode.EOF && !ignoreEOF) {
    // a live pipe never bells here: less's position(BOTTOM_PLUS_ONE)
    // is real on a full screen, so forw's read simply blocks for
    // more data (and -e stays off — eof_displayed needs ch_length)
    if (streamingWait(offset, false)) return;

    // -e/-E move to the next file (or quit) on a forward move at
    // end-of-file, like less's forward() checking get_quit_at_eof
    // before the eof bell
    if (eofForwardHook && eofForwardHook()) return;

    // less's forw still reads here: a completed pipe returns EOI and
    // only now learns its length, lighting up (END). A squished
    // screen stays squished: forward() bells and returns BEFORE
    // forw()'s squish_check when BOTTOM_PLUS_ONE is null (the short
    // screen's position table ends early) — verified against less's
    // bytes, which repaint nothing here
    revealPipeEnd();
    ringBell('eof');
    return;
  }

  // nothing to scroll (a -z window of zero or less): less's forw runs
  // zero iterations and rings the eof bell on nlines == 0
  if (offset <= 0) {
    ringBell('eof');
    return;
  }

  // j/J and the wheel mark attn only under -W with a count
  // (command.c:1702: OPT_ONPLUS && number > 1)
  if (attn) setAttnForward(content, optShowAttn() === 2 && offset > 1);

  // scrolling forward consumes blank rows padded above BOF first
  if (config.blankTop) {
    const consumed = Math.min(config.blankTop, offset);
    config.blankTop -= consumed;
    offset -= consumed;

    // revealing the whole tail latches (END) again, like less's forw
    // reaching end-of-input at the bottom line
    mode.EOF = fitsViewport(content);

    if (!offset) return;
  }

  // -c starts a new screen on a full-window (or bigger) forward move
  // before knowing whether EOF lands mid-screen ("not really
  // desirable ... but we don't yet know"), so the view runs over EOF
  // with null lines below, stopping once the last file line reaches
  // the top, like less's forw top_scroll branch forcing
  if (optClearRepaint() && offset >= config.window - 1) {
    ignoreEOF = true;
  }

  // less's forw checks each newly printed BOTTOM line (forwback.c:366):
  // the scroll stops with the \f line as the LAST visible row; jumps
  // pass do_stop_on_form_feed=FALSE and never stop
  if (optStopOnFormFeed()) offset = ffCapForward(content, offset);

  if (chopLine() || config.col) {
    const lastRow = Math.max(content.length - config.window + 1, 0);
    const startRow = config.row;
    const target = config.row + offset;

    config.row = Math.min(target, ignoreEOF ? content.length - 1 : lastRow);

    // a move asking for more rows than the input has reads past the
    // end, like less's forw hitting EOI on a partial screenful — or
    // blocking for the missing lines when the pipe still delivers
    if (config.row < target &&
        !streamingWait(target - config.row, config.row > startRow)) {
      revealPipeEnd();
    }

    // less's forw unsquishes as soon as it actually paints: a forced
    // (ESC-SPACE, --past-eof) advance on the squished short first
    // paint fills the screen with null-line tildes; only clamped
    // bells keep the squish (forwback.c first_time branch)
    if (mode.INIT && config.row !== startRow) mode.INIT = false;

    mode.EOF = config.row >= lastRow;
    return;
  }

  const maxRow = ignoreEOF ? content.length - 1 : config.endRow;
  const fromRow = config.row;

  // forw walks the entries a backward move prepended before the grid
  // below resumes: add_forw_pos drops table[0] each row (position.c)
  //
  // add_forw_pos is dumb in less too — it records a row that forw()
  // already DECIDED to draw, and forward() bells at EOF before forw()
  // ever runs (forwback.c:481). So the anchor is the caller's job:
  // screenForward walks until the CONTENT runs out, which slides the
  // top to the last line and reveals tildes. It only bites after a
  // backward move, since that is what leaves a table for it to
  // consume and what clears mode.EOF's early return above.
  //
  // The cap is exact, zero included. Letting a zero distance mean "no
  // cap" was the whole bug in another dress: a wheel sends ONE row
  // per press, screenForward consumed it, and `offset <= 0` returned
  // below before the clamp ran or mode.EOF was set — so every further
  // press walked one more row past the anchor.
  const toAnchor = ignoreEOF ? -1 : rowsToAnchor(content);

  offset -= screenForward(content,
    toAnchor < 0 ? offset : Math.min(offset, toAnchor));
  if (offset <= 0) {
    if (mode.INIT) mode.INIT = false;

    // the table walk can land exactly ON the anchor, and less's
    // eof_displayed answers from the position table the moment the
    // last line is on screen — without this the next press finds
    // mode.EOF still false and steps past it
    if (!ignoreEOF && rowsToAnchor(content) === 0) mode.EOF = true;

    return;
  }

  // the same single rule as back(), forward: forw_line reads from
  // wherever the row starts and the next row begins where it ended.
  // Adding to a sub-row INDEX instead assumed every row on the line is
  // the same width, which --wordwrap breaks and a top part-way into a
  // row breaks again.
  const fromOffset = topOffsetOf(content);
  let row = config.row;
  let at = fromOffset;

  while (offset > 0 && row < maxRow) {
    const next = nextRowOffset(content[row] ?? '', at);

    if (next !== null) {
      at = next;
    } else {
      row++;
      at = 0;
    }

    offset--;
  }

  if (row === maxRow && offset > 0) {
    const line = content[row] ?? '';
    const capAt = ignoreEOF
      ? lastRowStart(line)
      : rowOffsetOf(line, config.endSubRow);

    let moved = 0;

    while (moved < offset && at < capAt) {
      const next = nextRowOffset(line, at);
      if (next === null) break;
      at = next;
      moved++;
    }

    // a shifted row can step OVER the anchor, and then the last
    // screenful is still where it is - but only if this move actually
    // stepped. A top that was ALREADY past the anchor must stay put:
    // less's forward() bells and returns (forwback.c:481) and never
    // moves the top BACKWARD to meet the clamp.
    if (moved > 0 && at > capAt) at = capAt;

    // clamped short of the request: the forw read hit EOI — or
    // blocks for the missing lines when the pipe still delivers
    if (moved < offset && !streamingWait(offset - moved,
        row !== fromRow || at !== fromOffset)) {
      revealPipeEnd();
    }
  }

  setTopOffset(content[row] ?? '', row, at);

  // less's forw unsquishes when it actually paints (a forced advance
  // fills the screen with null-line tildes); clamped bells keep it
  if (mode.INIT && (row !== fromRow || at !== fromOffset)) {
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
export function lineBackward(
  content: string[],
  offset: number,
  attn: boolean = true
): number {
  // less's back() calls add_back_pos per row: back_line re-wraps from
  // the LINE's start and stops the moment it reaches the row that was
  // on top ("if (new_pos >= curr_pos) break", input.c), so the row it
  // exposes is bounded by the old screen while the rows below keep the
  // extents they already had. Prepending those entries IS that.
  const top = {
    row: config.row,
    offset: topOffsetOf(content),
    end: 0,
  };

  // lineBackwardFrom answers with what it could NOT move
  const left = lineBackwardFrom(content, offset, attn);
  const stepped = offset - left;

  if (stepped > 0) {
    const added = screenBack(content, stepped, top);

    // the table holds sc_height entries; what the prepends push past
    // the bottom is simply gone (position.c)
    config.screen = [...added, ...config.screen]
      .slice(0, Math.max(config.window - 1, 1));
  }

  return left;
}

function lineBackwardFrom(
  content: string[],
  offset: number,
  attn: boolean = true
): number {
  if (config.row === 0 && config.subRow === 0 && config.subShift === 0) {
    if (mode.INIT) mode.INIT = false;

    // --past-eof forces backward scrolls over BOF too, like less's
    // back() setting force on past_eof
    if (optPastEof() && offset > 0) {
      padBlankTop(content, offset);
      return 0;
    }

    ringBell('eof');
    return offset;
  }

  // less's back with nothing to scroll bells the same way (nlines == 0)
  if (offset <= 0) {
    ringBell('eof');
    return 0;
  }

  // k marks the line above the old top only under -W with a count
  // (v693, command.c:1715)
  if (attn) setAttnBackward(optShowAttn() === 2 && offset > 1);

  // less's back() clamps at the header start: each line is checked
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

  // less's back() is one rule repeated: back_line lands on the greatest
  // row start BELOW where it is, stepping onto the previous line's
  // last row when it is already at a line's beginning (input.c:358).
  // Walking it a row at a time is what makes a top part-way into a
  // row ordinary - it steps to the boundary it sits inside like any
  // other row - and it is also what --wordwrap needs, since its rows
  // are unequal and cannot be subtracted.
  let leftover = 0;
  let row = config.row;
  let at = topOffsetOf(content);

  while (offset > 0) {
    if (at > 0) {
      at = rowStartBelow(content[row] ?? '', at);
      offset--;
      continue;
    }

    if (row <= floor) {
      leftover = offset;
      break;
    }

    row--;
    at = lastRowStart(content[row] ?? '');
    offset--;

    if (optStopOnFormFeed() && isFormFeed(content[row])) {
      at = 0;
      break;
    }
  }

  setTopOffset(content[row] ?? '', row, at);

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
export function forceLineBackward(
  content: string[],
  offset: number,
  screenful: boolean = false
): void {
  if (mode.INIT) mode.INIT = false;

  // K needs -W and a count (A_BF_LINE); ESC-b marks under -W alone
  // (A_BF_SCREEN, command.c:1790)
  setAttnBackward(optShowAttn() === 2 && (screenful || offset > 1));

  let leftover = offset;

  if (config.row !== 0 || config.subRow !== 0) {
    leftover = lineBackward(content, offset, false);
  }

  if (leftover > 0) padBlankTop(content, leftover);
}

/**
 * Accumulates less's over-BOF null rows for a forced back.
 */
function padBlankTop(content: string[], leftover: number): void {
  const cap = Math.max(config.window - 2, 0);

  // less's back bells when it cannot add a single line (nlines == 0):
  // the first file line has reached the bottom of the screen
  if (config.blankTop >= cap) {
    ringBell('eof');
    return;
  }

  // null rows accumulate above BOF, one short of an empty screen
  config.blankTop = Math.min(config.blankTop + leftover, cap);

  // (END) stays displayed while the rows past the tail are still
  // on screen, and clears once the tail slides below the bottom
  // line, like less's eof_displayed checking the bottom position
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
 * Scrolls forward by whole file lines (ESC-j), like less's to_newline
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

  // ESC-j shares A_F_NEWLINE's -W-with-count condition
  setAttnForward(content, optShowAttn() === 2 && offset > 1);

  // less's to_newline counts at the BOTTOM edge (forwback.c:302): rows
  // reveal from BOTTOM_PLUS_ONE and only ones ending their file line
  // decrement the count — wrap continuations ride free — so convert
  // the file-line count into the screen rows forw() would scroll
  const walk = bottomWalk(content);

  let rows = 0;

  for (let n = offset; n > 0; ) {
    if (!walk.advance()) {
      // a forced move keeps revealing a null row per remaining line
      if (optPastEof()) rows += n;
      break;
    }
    rows++;
    if (walk.subRow === maxSubRow(content[walk.row])) n--;
  }

  if (rows) lineForward(content, rows);
  else ringBell('eof');
}

/**
 * Scrolls backward by whole file lines (ESC-k), like less's to_newline
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

  // ESC-k shares A_B_NEWLINE's -W-with-count condition
  setAttnBackward(optShowAttn() === 2 && offset > 1);

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

// the -e forward-at-EOF handler, like less's forward() top: returns
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
 * - Falls back to the -z scroll window (less's get_swindow) if `buffer`
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
  // f marks under any -w state (command.c:1670); ESC-SPACE
  // (A_FF_SCREEN) needs -W (command.c:1803)
  setAttnForward(content,
    ignoreEOF ? optShowAttn() === 2 : optShowAttn() > 0);

  lineForward(
    content,
    bufferToNum(buffer) || getSwindow(),
    ignoreEOF,
    false
  );
}

/**
 * Moves the view backward by one window.
 *
 * - If `buffer` is a valid number, uses it as the offset.
 * - Otherwise, uses the -z scroll window (less's get_swindow).
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function windowBackward(content: string[], buffer: string[]): void {
  // b marks the line above the old top under any -w state (v693,
  // command.c:1689)
  setAttnBackward(optShowAttn() > 0);

  lineBackward(
    content,
    bufferToNum(buffer) || getSwindow(),
    false
  );
}

/**
 * Sets a custom window size using the given `buffer`, and scrolls forward.
 *
 * - If `buffer` is a valid number, updates `config.setWindow` with it.
 * - Then scrolls forward by the -z scroll window (less's get_swindow).
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setWindowForward(content: string[], buffer: string[]): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;

  // z is A_F_WINDOW: the f condition (command.c:1670)
  setAttnForward(content, optShowAttn() > 0);
  lineForward(content, getSwindow(), false, false);
}

/**
 * Sets a custom window size using the given `buffer`, and scrolls backward.
 *
 * - If `buffer` is a valid number, updates `config.setWindow` with it.
 * - Then scrolls backward by the -z scroll window (less's get_swindow).
 *
 * @param content - The full content as an array of lines.
 * @param buffer - A string array that represents the number of lines to scroll.
 */
export function setWindowBackward(content: string[], buffer: string[]): void {
  config.setWindow = bufferToNum(buffer) || config.setWindow;

  // w is A_B_WINDOW: the b condition (command.c:1689)
  setAttnBackward(optShowAttn() > 0);
  lineBackward(content, getSwindow(), false);
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

  // d is A_F_SCROLL: -W only (command.c:1829)
  setAttnForward(content, optShowAttn() === 2);
  lineForward(content, config.setHalfWindow || config.halfWindow,
    false, false);
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

  // u is A_B_SCROLL: -W only, marking above the old top
  setAttnBackward(optShowAttn() === 2);
  lineBackward(content, config.setHalfWindow || config.halfWindow,
    false);
}

/**
 * Scrolls right by buffer value or half screen width.
 *
 * @param buffer - Buffer containing scroll offset.
 */
/**
 * less's horizontal shifts all end in screen_trashed(), so the next
 * make_display repaints and eof_displayed re-reads
 * position(BOTTOM_PLUS_ONE) from the rebuilt table. That matters
 * because a shift CHANGES how many rows a line occupies: forw_line is
 * called with `chop_line() || hshift > 0` (input.c:348), so any
 * hshift reads lines CHOPPED, one screen row each.
 *
 * A source engine derives mode.EOF in its own sync(), and posRehead()
 * returns early when the top is already at a line start - so without
 * this the flag kept the value it had while the line was still
 * folded, and a one-line file read ":" where less says "(END)".
 */
function shifted(): void {
  hook.rebuildContent();
}

export function setHalfScreenRight(buffer: string[]): void {
  if (mode.INIT) mode.INIT = false;

  // less shifts only whole lines: pos_rehead first (command.c)
  posRehead();

  const count = bufferToNum(buffer);
  if (count) setShiftCount(count);

  config.col += optShiftCount() || config.halfScreenWidth;
  shifted();
}

/**
 * Scrolls left by buffer value or half screen width.
 *
 * @param buffer - Buffer containing scroll offset.
 */
export function setHalfScreenLeft(buffer: string[]): void {
  if (mode.INIT) mode.INIT = false;

  // less shifts only whole lines: pos_rehead first (command.c)
  posRehead();

  const count = bufferToNum(buffer);
  if (count) setShiftCount(count);

  config.col -= optShiftCount() || config.halfScreenWidth;
  if (config.col < 0) config.col = 0;
  shifted();
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

  // less's A_RRSHIFT calls pos_rehead too (command.c:2493)
  posRehead();

  let maxWidth = 0;

  const end = Math.min(config.row + config.window - 1, content.length);
  for (let row = config.row; row < end; row++) {
    maxWidth = Math.max(maxWidth, visualWidth(content[row]));
  }

  config.col = Math.max(maxWidth - config.screenWidth, 0);
  shifted();
}

/**
 * Scrolls left to the first column.
 */
export function firstCol(): void {
  posRehead();
  config.col = 0;
  shifted();
}
