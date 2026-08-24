import fs from 'fs';
import { putstr } from './tty/output';

import { hasUngot, abortSigs } from './tty/keyboard';

import { terminalCapability } from './tty/terminal';

import { config, fullScreen, mode } from './state/config';

import { sawSourceRead } from './state/reads';

import { chopLongLines } from './lines/chopLongLines';
import { wrapLongLines } from './lines/wrapLongLines';

import { maxSubRow, visualWidth, isStyled, transformPrompt, promptHasAnsi }
  from './lines/helpers';

import { beginGuardedRun, endGuardedRun } from './features/jsRegexGuard';

import { duringRepaint } from './features/searching';

import { search, searchPrompt, statusColChar, setHiliteHidden, posixRetry}
  from './features/searching';

import {
  option,
  optQuiet,
  optNoVbell,
  optNoInit,
  optOldBot,
  optClearRepaint,
  optTildes,
  displayPrType,
  optLinenums,
  optCtldisp,
  optLinenumWidth,
  optStatusCol,
  optStatusColWidth,
  optBackScroll,
  optForwScroll,
  optHeader,
  vlinenum,
  optStatusLine,
  optHiliteTarget,
  jumpSindex,
  optIntrChar,
  prChar,
  optEndPrompt,
  gutterWidth,
  fullScreenWidth,
  chopLine,
  hook
} from './options';

import { prExpand, prProto, hProto, wProto } from './features/prompt';

import { colored } from './features/color';

import { cmd, cmdCol, cmdDisplay, cmdText } from './features/cmdbuf';

import { follow } from './features/follow';

import { brackets, marks, markAtRow } from './features/jumping';

import { rowStartBelow, lastRowStart, subRowAt } from './lines/screenOps';

import { files, examine, binaryConfirm, pipeDraining, pendingScroll,
  sizeIsKnown }
  from './features/files';

import { session } from './state/session';

import { miscInput, pipeMark, overwrite,
  miscPromptLabel
} from './features/misc';

import {
  STYLE_REGEX_G,
  STYLE_RESET,
  INVERSE_ON,
  INVERSE_OFF,
  BOLD_ON,
  BOLD_OFF,
  UNDERLINE_ON,
  UNDERLINE_OFF,
  CURSOR_HOME,
  CLEAR_LINE,
  AUTO_WRAP,
  DEFER_WRAP,
  CLEAR_BELOW,
  CLEAR_SCREEN,
  REVERSE_INDEX,
  TERMINAL_SUSPEND,
  TERMINAL_RESUME,
  VISUAL_BELL,
  CURSOR_TO,
  ON_ALTERNATE_SCREEN
} from './state/constants';

/**
 * Converts a buffer string to a number.
 *
 * - Parses the string as a base-10 integer.
 * - Returns 0 if the input is not a valid number or equals 0.
 *
 * @param buffer - The string array to convert.
 * @returns Parsed numeric value, or 0 if invalid.
 */
export function bufferToNum(buffer: string[]): number {
  const n = parseInt(buffer.join(''), 10);
  return n ? n : 0;
}

/**
 * Normalizes unknown input into an array of valid file paths.
 *
 * - Accepts a string, an array, or nested arrays containing strings.
 * - Filters out non-string values and paths that do not exist on the
 *   filesystem.
 *
 * @param input - A potential file path, array of paths, or nested arrays.
 * @returns An array of existing file paths.
 */
/**
 * Flattens input into file paths WITHOUT dropping missing ones: less's
 * main passes every name to edit, which errors per file ("b: No such
 * file or directory") and quits with an error when none opened.
 */
export function inputToRawPaths(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.flat(Infinity).filter(p => typeof p === 'string');
  }

  return typeof input === 'string' ? [input] : [];
}

export function inputToFilePaths(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .flat(Infinity)
      .filter(path => typeof path === 'string' && fs.existsSync(path));
  }

  if (typeof input === 'string' && fs.existsSync(input)) {
    return [ input ];
  }

  return [];
}

/**
 * Converts any input to a string array.
 * 
 * - Strings and primitives are split by newline.
 * - Objects are stringified with optional formatting.
 * 
 * @param input - Value to convert.
 * @param tabObject - Whether objects indent, one tab per level.
 * @returns - Array of strings representing the input.
 */
export function inputToString(
  input: unknown,
  tabObject: boolean
): string[] {
  switch (typeof input) {
    case 'string':
      // a trailing newline ends the last line, it does not add an
      // empty one, like less reading a pipe
      return (input.endsWith('\n') ? input.slice(0, -1) : input)
        .split('\n');

    case 'undefined':
      return ['undefined'];

    case 'number':
    case 'bigint':
    case 'boolean':
    case 'function':
      return input.toString().split('\n');
    
    case 'object':
      // the indent is a tab, so the rendered nesting is whatever the
      // -x tab stops say — no option scan needed here
      return JSON
        .stringify(input, null, tabObject ? config.tabObjectIndent : 0)
        .split('\n');
  }

  return [];
}

/**
 * Builds the left gutter for a display row: the -J status column and
 * the -N line number field, identical on a wrapped line's every row
 * (less's per-row plinestart from the line's base_pos). Empty when
 * neither option is on.
 *
 * @param content - Display lines.
 * @param row - The content row of this display row.
 * @param from - Cluster index where this screen row starts in the line.
 * @param to - Where it ends. less's status column asks whether a match
 *   falls in THIS row's range, so a wrapped line's rows differ.
 */
export function gutterFor(
  content: string[],
  row: number,
  from?: number,
  to?: number
): string {
  let gutter = '';

  if (optStatusCol()) {
    let char = ' ';
    let kind: 'mark' | 'attn' | 'search' | '' = '';

    // less builds EVERY row's prefix from the line's start position
    // (forw_line_seg walking to base_pos before plinestart,
    // input.c:149), so a wrapped line's continuation rows repeat
    // the mark letter and the number alike
    {
      // less's plinestart: the mark letter in the M color, else an
      // attn-colored cell for the -w line
      const mark = markAtRow(row);

      if (mark) {
        char = mark;
        kind = 'mark';
      } else if (row === config.attnRow) {
        kind = 'attn';
      }

      // a search match overrides, like set_status_col after
      // plinestart: '*' visible, '<'/'>' chopped away, '=' both
      const match = statusColChar(content[row], row, from, to);

      if (match) {
        char = match;
        kind = 'search';
      }
    }

    // less attributes only the status char; the padding stays normal
    gutter += (kind
      ? colored(kind, char, INVERSE_ON, INVERSE_OFF)
      : char) + ' '.repeat(Math.max(optStatusColWidth() - 1, 0));
  }

  if (optLinenums() === 2) {
    // --no-number-headers blanks the header lines' numbers (0);
    // continuation rows carry the same number as the line start
    const num = vlinenum(row + 1);
    const digits = String(num);

    // less pads AT_NORMAL only up to --line-num-width and prints the
    // digits AT_BOLD (line.c:446-449): numbers wider than the
    // option stick to the left edge unpadded, less's ragged field —
    // the RESERVE uses the effective width so rows still fit
    gutter += num
      ? ' '.repeat(Math.max(optLinenumWidth() - digits.length, 0)) +
        colored('linenum', digits, BOLD_ON, BOLD_OFF) + ' '
      : ' '.repeat(optLinenumWidth() + 1);
  }

  return gutter;
}

/**
 * Columns a line's -N number overflows the nominal field by: less pads
 * only to linenum_width and the wider digits eat into the LINE's
 * text area — the line buffer holds the actual prefix and fills the
 * rest to sc_width (line.c:446, the ragged field its :457 comment
 * admits). The line's layout width shrinks by this much.
 */
export function gutterOverflow(row: number): number {
  if (optLinenums() !== 2) return 0;

  const digits = String(vlinenum(row + 1) || 0).length;
  return Math.max(digits - optLinenumWidth(), 0);
}

/** True when display rows carry a gutter or the -w attn highlight. */
export const decoratedRows = (): boolean =>
  gutterWidth() > 0 || config.attnRow >= 0 || optStatusLine() ||
    optHiliteTarget();

/**
 * Applies the row highlight for -w attn, --hilite-target and
 * --status-line marks: with --status-line the standout spans the
 * entire screen width, like less.
 *
 * @param text - The formatted row text.
 * @param row - The content row.
 * @param sindex - The 0-based screen line the row is displayed on.
 * @returns The row, highlighted when it is the attn, target or a
 *          marked line.
 */
export function highlightRow(
  text: string,
  row: number,
  sindex?: number
): string {
  // --hilite-target keeps the -j target screen line highlighted, like
  // less's command loop calling draw_target_attn on every display
  const target = optHiliteTarget() && sindex !== undefined &&
    sindex === jumpSindex();
  const marked = optStatusLine() && markAtRow(row) !== '';

  // with -J the attn line marks in the status column instead of
  // standing out, like less's is_hilited_attr checking !status_col
  // (--status-line still colors the whole line)
  const attn = row === config.attnRow &&
    (!optStatusCol() || optStatusLine());

  if (!target && !attn && !marked) return text;

  if (optStatusLine()) {
    const pad = config.screenWidth - visualWidth(text);
    if (pad > 0) text += ' '.repeat(pad);
  }

  // an empty target line carries a space, like put_line_hilite
  if (target && !text) text = ' ';

  // --hilite-target rows take the J color, marked rows M, -w attn W
  const kind = target
    ? 'target'
    : attn ? 'attn' : 'mark';

  // less underlines the target line without color; attn and marks
  // stand out
  return kind === 'target'
    ? colored(kind, text, UNDERLINE_ON, UNDERLINE_OFF)
    : colored(kind, text, INVERSE_ON, INVERSE_OFF);
}

// the second of the last eof/bof bell, like less rate limiting eof_bell
let lastEofBell = 0;

/** Forgets the eof bell rate limit, like a fresh less process. */
export function resetBellTimer(): void {
  lastEofBell = 0;
}

/**
 * Rings the terminal bell.
 *
 * - Like less's lbell/eof_bell: `-q` replaces eof/bof bells with the
 *   visual bell, `-Q` replaces every bell, and --no-vbell suppresses
 *   the flash. Eof/bof bells ring at most once per second.
 *
 * @param kind - `eof` for end/beginning-of-file bells, `error` otherwise.
 */
export function ringBell(kind: 'error' | 'eof' = 'error'): void {
  const quiet = optQuiet();

  // This is less's `nlines == 0` (forwback.c:335, :372): forw()/back()
  // broke out before moving a single line, so no line was read, so
  // check_poll never ran and nothing was ungot - and prompt() then
  // writes ":" or "(END)" normally, however many keys are still
  // queued behind it. The hold exists because of that unget; where less
  // cannot have one, we must not have one either.
  //
  // Not gated on the one-per-second rate limit below: that silences
  // the BELL, never the prompt.
  //
  // ARRIVING at the edge, as against already sitting on it. less cannot
  // tell these apart and does not try: it grinds every queued no-op
  // command and the gate below collapses them into one bell per
  // second, which is right when the user is leaning on the key.
  //
  // But we DISCARD that queue, so a burst that hits the bottom is a
  // single command where less had hundreds - and if the last bell was
  // under a second ago (scrolled off the edge and straight back onto
  // it, which is exactly the down-then-up burst) the gate eats the
  // only one we were going to ring. A fresh arrival therefore rings
  // unconditionally; leaning on the key still rings once a second.
  // `stalled` as well as `edgeHeld`: edgeHeld is maintained by
  // armStall at the top of each command, so on its own it would let
  // any caller that rings twice without a command in between - a
  // direct call, a path that does not go through the key loop - claim
  // a fresh arrival each time and ring straight past less's gate.
  // Already being stalled IS already being at the edge.
  const freshEdge = kind === 'eof' && !edgeHeld && !stalled;
  if (kind === 'eof') markStalled();

  // less's clear_bot before a bell comes from cmd_exec, which runs when
  // a COMMAND executes (command.c:124), so it goes out whether or not
  // eof_bell's one-per-second gate then lets the bell through: the
  // gate silences the bell, never the clear. A bell raised while the
  // command line is still being edited (an invalid mark letter, a
  // completion with no match) is lbell alone -- no command ran.
  // less's clear_bot comes from cmd_exec, so a bell that a COMMAND
  // raised carries one and a bell raised while the command line is
  // still being edited does not. A completed two-key command has
  // already left cmd_exec's clear waiting as the frame's opening -
  // there is no frame after this bell, so it goes out here
  const carried = scrollPrefix;
  if (carried !== null) scrollPrefix = null;

  const prefix = eprPrefix() +
    (carried ?? (kind === 'eof' ? clearBot() : ''));

  if (prefix) {
    putstr(prefix);

    // the clear wiped the prompt row without going through a frame,
    // so the next paint must write it again rather than dedupe it --
    // less's prompt() runs every command loop, after cmd_exec cleared
    dirtyBottomRow();
  }

  if (kind === 'eof') {
    // less's `if (now == last_eof_bell) return;` (forwback.c:56), with
    // the fresh-arrival exception above
    const now = Math.floor(Date.now() / 1000);
    if (now === lastEofBell && !freshEdge) return;
    lastEofBell = now;

    if (quiet !== 0) {
      visualBell();
      return;
    }
  }

  if (quiet === 2) {
    visualBell();
    return;
  }

  putstr('\x07');
}

/**
 * Flashes the screen with ~100ms of reverse video, like less's vbell
 * writing the terminfo flash capability.
 */
function visualBell(): void {
  // a dumb terminal has no flash capability, like less's empty vb
  if (optNoVbell() || mode.DUMB) return;

  // cmd_exec's clear_bot precedes the flash too when a marker fires
  const epr = eprPrefix();
  if (VISUAL_BELL !== null) {
    putstr((epr ? epr + clearBot() : '') + VISUAL_BELL);
    return;
  }
  // less's flash is the terminfo capability run through tputs, and it
  // passes setupterm(term, -1, NULL) so ospeed is 0 and the padding
  // in "\E[?5h$<100/>\E[?5l" emits nothing: less's bytes are the two
  // halves back to back. Deferring the second half by a timer also
  // meant a pager that quit first never sent it, leaving the terminal
  // in reverse video.
  putstr((epr ? epr + clearBot() : '') + '\x1B[?5h\x1B[?5l');
}

/**
 * Formats content for display based on line wrapping configuration.
 *
 * - Chooses between chopping or wrapping long lines.
 * - Appends ANSI reset code to prevent style bleeding.
 *
 * @param content - The full array of content lines to format.
 * @returns A formatted string array ready for rendering.
 */
/**
 * less's empty_screen(): the position table holds nothing, because forw
 * never drew a line. A file with no lines is always in that state, and
 * our content array still carries one synthetic empty line for it.
 */
function noContentDrawn(content: string[]): boolean {
  return content.length <= 1 && !content[0] &&
    (files.list[files.index]?.size ?? 0) <= 0;
}

export function formatContent(content: string[]): string[] {
  const lines: string[] = [];

  // a file with no lines draws none: less's forw_line EOFs at once, so
  // the whole screen below is null lines (tildes), not one blank row
  // and then tildes
  if (noContentDrawn(content)) {
    padToEOF(lines);
    return lines;
  }

  // rows above BOF from a forced back or a bracket jump are less's null
  // lines: gline draws them as "~" or "" by the twiddle flag, just
  // like the ones past EOF; only ever set with the top at (0,0), so
  // pre-seeding does not disturb sub-row emission
  for (let i = 0; i < config.blankTop; i++) {
    lines.push(optTildes() ? colored('tilde', '~', BOLD_ON, BOLD_OFF) : '');
  }

  if (chopLine() || config.col) {
    chopLongLines(content, lines);
  } else {
    wrapLongLines(content, lines);
  }

  // less's put_line_hilite opens with `if (ABORT_SIGS()) return;` - it
  // draws NOTHING while an interrupt is pending (output.c:64), and
  // forw()'s loop breaks on the same test (forwback.c:312). So a ^C
  // stops the paint where it stands rather than at the next command
  // boundary. This is that check, on the rows this frame would draw.
  if (abortSigs()) return lines;

  padToEOF(lines);
  return overlayHeaderLines(content, lines);
}

/**
 * Replaces the top screen rows with the --header lines, like less's
 * overlay_header: rendered from the header start row WITH the live
 * horizontal shift (less's forw_line honors hshift; --header's column
 * count freezes the left cols via the chop prefix), the last one
 * underlined unless the screen top sits exactly at the header start
 * (no gap below it).
 *
 * @param content - Full content lines.
 * @param lines - The formatted screen lines.
 * @returns The screen lines with the header rows in place.
 */
function overlayHeaderLines(content: string[], lines: string[]): string[] {
  const header = optHeader();
  // less keeps the header machinery live on the help file too: its own
  // top lines pin and underline while help scrolls (probed v707,
  // --header=2 + h + j: \e[4m SUMMARY stays at the top)
  if (header.lines <= 0) return lines;
  const headerRow = hook.sourceHeaderRow?.() ?? header.start;

  const saved = {
    row: config.row,
    subRow: config.subRow,
    col: config.col,
    blankTop: config.blankTop,
    window: config.window,
  };

  config.row = headerRow;
  config.subRow = 0;
  config.blankTop = 0;
  config.window = header.lines + 1;

  const rows: string[] = [];

  if (chopLine()) {
    chopLongLines(content, rows);
  } else {
    wrapLongLines(content, rows);
  }

  config.row = saved.row;
  config.subRow = saved.subRow;
  config.col = saved.col;
  config.blankTop = saved.blankTop;
  config.window = saved.window;

  // the tilde padding block holds several rows in one entry
  const flat = lines.join('\n').split('\n');

  const seamless = saved.row === headerRow && saved.subRow === 0 &&
    saved.blankTop === 0;

  for (let i = 0; i < header.lines && i < flat.length; i++) {
    const raw = rows[i] ?? '';

    // less keeps plinestart's -J/-N prefix in a separate buffer.
    // set_attr_line starts at linebuf.print, so header color and the
    // boundary underline apply only to the file text, never its gutter.
    // A configured header forces chopped rows, making each overlay row
    // correspond to exactly one content row here.
    const gutter = gutterFor(content, headerRow + i);
    const prefix = gutter && raw.startsWith(gutter) ? gutter : '';
    let body = colored('header', raw.slice(prefix.length));

    if (i === header.lines - 1 && !seamless) {
      // inner resets would drop the underline for the rest of the row
      body = UNDERLINE_ON +
        body.split(STYLE_RESET).join(STYLE_RESET + UNDERLINE_ON) +
        UNDERLINE_OFF;
    }

    flat[i] = prefix + body;
  }

  return flat;
}

/**
 * Adds a character to the input buffer.
 *
 * - Increments buffer offset if visible width limit is reached.
 *
 * @param buffer - Current input buffer array.
 * @param key - Character to append.
 */
export function addBufferChar(buffer: string[], key: string): void {
  // the digit prompt is the BOTTOM row, so it measures against less's
  // sc_width like the rest of cmdbuf - never the gutter-reduced
  // config.screenWidth, which shifted it a whole gutter early
  if (visibleBufferLength(buffer.length) + 1 === fullScreenWidth() - 1) {
    config.bufferOffset++;
  }

  buffer.push(key);
  mode.BUFFERING = true;
}

/**
 * Removes the last character from the input buffer.
 *
 * - Decrements buffer offset if no visible characters remain.
 *
 * @param buffer - Current input buffer array.
 */
export function delBufferChar(buffer: string[]): void {
  if (buffer.length === 0) return;

  if (visibleBufferLength(buffer.length) === 0) {
    config.bufferOffset--;
  }

  buffer.pop();
  if (buffer.length === 0) mode.BUFFERING = false;
}

let prevRows: string[] | null = null;

/**
 * Forgets the previously rendered frame, forcing the next render to redraw
 * the whole screen. Call when entering a fresh screen (session start).
 *
 * @param keepPainted - keep the "something has been drawn" flag, less's
 *   !first_time. less clears the position table on every content swap
 *   (pos_clear) but sets first_time only at STARTUP and for
 *   redraw_on_quit (main.c:592) — swapping in the help file is an
 *   ordinary edit(), so the "...skipping..." marker still prints
 *   (forwback.c:272). Clearing it here suppressed that marker.
 */
export function resetRender(keepPainted = false): void {
  prevRows = null;
  if (!keepPainted) contentPainted = false;
  prevCursorCol = -1;
  prevTopRow = -1;
  prevTopKnown = false;
  prevBottomEcho = false;
  shownBottomEcho = false;
  fullRepaintPending = false;
  hiliteRepaintPending_ = false;
  hiliteErasePending_ = false;
  prevTopSub = 0;
  scrollOpen = false;
  scrollPrefix = null;
  forwPrompt = false;
  keepPrevRows = false;
  prevMca = '';
  promptAtBottom = false;
  posClearPending = false;
  backPaintPending = false;

  // the frame's own carried state: a freeze, a collapse drift or a
  // stale prevInit left behind by the PREVIOUS session would decide
  // this one's first paint
  frozenFrame = false;
  frozenHome = false;
  dumbHomePending = false;
  nulCollapsed = 0;
  prevInit = false;
  prevInitAlt = false;
  promptPainted = false;
  lastEofBell = 0;
}

/** Forgets an owed --end-prompt marker: a NEW session only — less's
 *  prompting flag survives edits (help entry included) and clears
 *  solely by firing. */
export function resetPrompting(): void {
  prompting = false;
  promptedInHelp = false;
}

/** The most recently rendered screen rows, for --redraw-on-quit. */
export function lastScreen(): string[] | null {
  return prevRows;
}

/**
 * Renders the given content to the terminal.
 *
 * - When the new frame is the previous one scrolled by k rows, emits a
 *   terminal scroll and redraws only the exposed rows, like less.
 * - Otherwise overwrites all rows in place; the screen is never cleared,
 *   so there is no blank frame to flicker.
 * - Each frame is a single write, wrapped in synchronized output markers
 *   for terminals that support atomic rendering.
 *
 * @param rawContent - The string content to display in the terminal.
 * @param buffer - Array of buffer characters.
 */
// the parked cursor column of the last frame, so pure cursor
// movement at a prompt still repositions it on unchanged screens
let prevCursorCol = -1;

// set when frames must keep the old content rows and update only the
// bottom line, like less's error() drawing the message over the
// untouched screen: get_return ungets the dismissing key, so the mca
// it starts never reaches the prompt()/make_display that repaints the
// trashed screen — repeated toggles keep the stale rows until a
// render with no message and no option prompt open finally repaints
let frozenFrame = false;

// whether any real (unfrozen) paint has happened
let contentPainted = false;

// less's first_time: set while the FIRST screen of output is printing
// and cleared at the end of forw(). It gates the skipping marker,
// which less never shows on the screen it is drawing first.
let firstOutput = true;

// the unlatching repaint is less's make_display with top_scroll forced,
// which a dumb terminal shows as clear+home instead of "...skipping"
let frozenHome = false;
let dumbHomePending = false;

/** Arms less's post-toggle repaint(), run at the next true prompt. */
export function markFullRepaint(): void {
  fullRepaintPending = true;
}

/**
 * less's O_HL_REPAINT: toggle_option calls chg_hilite BEFORE it prints
 * the option's message (option.c:463), and chg_hilite re-highlights
 * the screen through repaint_hilite, which redraws every row
 * (search.c:1119). So the new rendering is on screen UNDER the
 * message, not after it - unlike plain O_REPAINT, whose screen_trashed
 * waits for the next make_display.
 */
export function markHiliteRepaint(): void {
  hiliteRepaintPending_ = true;
}

/**
 * The same, for the O_HL_REPAINT options whose message the ofunc
 * prints ITSELF - the three --no-search-header* ones, the only
 * O_HL_REPAINT entries with a NULL ovar (opttbl.c:697, :703, :709).
 *
 * toggle_option erases the highlights first (repaint_hilite(FALSE),
 * option.c:365) and calls chg_hilite only at :464, AFTER the ofunc.
 * For these three the ofunc's own error() blocks in get_return before
 * that, so the message lands over the erased screen and the
 * highlights come back on the next command, recomputed under the new
 * setting. Every other O_HL_REPAINT option has toggle_option print
 * the message at :480 - after chg_hilite - so its frame keeps them.
 *
 * Measured on the live binary: --no-search-headers emits one SGR 7,
 * the message's own; --proc-backspace emits the highlights too.
 */
export function markHiliteErase(): void {
  hiliteRepaintPending_ = true;
  hiliteErasePending_ = true;
}

/** True while such a repaint is still owed. */
export const hiliteRepaintPending = (): boolean => hiliteRepaintPending_;

/** Whether a repaint is armed and waiting for a true prompt. */
export const fullRepaintArmed = (): boolean => fullRepaintPending;

export function freezeFrame(homeOnUnfreeze: boolean = false): void {
  frozenFrame = true;
  frozenHome = homeOnUnfreeze;
}

// --incsearch repaints while the pattern is typed (less's mca_search
// jumping to the match), which clears the pending trash
export function unfreezeFrame(): void {
  frozenFrame = false;
}

/**
 * Seeds the previous frame as a blank screen, so frozen frames show
 * less's unpainted display while startup ungot commands (the errmsgs
 * gate key, +cmds) collect input before the first make_display.
 */
export function seedBlankFrame(): void {
  prevRows = new Array(config.window).fill('');
  prevCursorCol = -1;
}

/**
 * Seeds the previous frame with rows painted OUTSIDE the renderer
 * (a raw squish repaint at a blocking gate), so a following frozen
 * render preserves exactly what is on screen.
 */
export function seedFrameRows(rows: string[]): void {
  prevRows = rows;
  prevCursorCol = -1;
}

/**
 * Marks the bottom line as clobbered by a raw writeSync (a mid-scan
 * ierror like "Calculating line numbers..."): the next render must
 * repaint the prompt row instead of deduping it, less's prompt()
 * rewriting the cleared bottom line at every command loop.
 */
export function dirtyBottomRow(): void {
  if (prevRows?.length) prevRows[prevRows.length - 1] = '\0';
  prevCursorCol = -1;
}

// rows this frame lost to a NUL collapse, so the cursor still parks
// on the prompt row rather than the blank filler below it
let nulCollapsed = 0;

/**
 * Applies less's put_line truncation to a built frame (output.c:72):
 * the loop writing a line stops at the first NUL, and since the
 * newline ending the line lives in the same buffer, NOTHING after
 * the NUL reaches the terminal — not the rest of the text, not the
 * line break. The next row therefore continues on the same physical
 * row, and every row below drifts up one.
 *
 * Only -r can put a raw NUL on screen: the caret and binary modes
 * rewrite it as ^@ or <00> long before the line buffer, so every
 * ordinary frame takes the untouched fast path.
 *
 * @param rows - The frame's logical rows, top to bottom.
 * @returns The physical rows the terminal actually shows.
 */
function collapseNulRows(rows: string[]): string[] {
  if (!rows.some(row => row.includes('\0'))) return rows;

  const out: string[] = [];
  let carry = '';

  for (const row of rows) {
    const nul = row.indexOf('\0');

    if (nul < 0) {
      out.push(carry + row);
      carry = '';
      continue;
    }

    // less wrote the text before the NUL and left the cursor there
    carry += row.slice(0, nul);
  }

  if (carry) out.push(carry);

  return out;
}

/**
 * less's squish_check (forwback.c:88), which error() calls before it
 * writes anything: a squished first paint - a short file stuck to the
 * bottom of the screen with nothing above it - is un-squished and
 * repainted, so the message lands over a normal screen with the text
 * at the top and tildes below it.
 *
 * render() does this itself for a message it is about to draw; this is
 * for the gated messages, which write straight to the terminal and
 * would otherwise leave the squished frame underneath.
 */
export function squishCheck(): void {
  if (!mode.INIT || optOldBot()) return;

  mode.INIT = false;

  // less's squish_check IS repaint() and nothing else (forwback.c:121),
  // and repaint -> jump_loc -> forw paints ROWS: it writes no prompt,
  // because prompt() runs at the top of the command loop and error()
  // is about to clear_bot and put its message on that line anyway
  // (output.c:719-722). Painting our prompt row here put an "(END)"
  // on the wire that less never sends.
  //
  // It brings no clear_bot of its own either: cmd_exec already sent
  // one for the command that got here, and error() sends the next.
  scrollPrefix = '';

  renderBare(session.content, session.buffer);

  // that repaint went through forw(), which sets forw_prompt after
  // every line it puts (forwback.c:368), so the prompt that follows
  // needs no clear_bot of its own
  forwPrompt = true;
}

// less's `first_time` (forwback.c): TRUE until the first forw() has
// painted, and never set again for the life of the session
let firstPaintDone = false;

/** Arms less's first_time for a new session. */
export function resetFirstPaint(): void {
  firstPaintDone = false;
}

// less's forw()/back() paint their rows and return; currline(BOTTOM)
// and then prompt() come after, so the command line is BLANK for the
// whole line-number walk and the prompt is written once, at the end.
// A caller that has to paint before that walk asks for the bare frame
// rather than painting a prompt it is about to erase.
let bareFrame = false;
let cmdExecOpened = false;

/**
 * The two halves of the ":" problem have ONE cause and take two
 * different fixes, which is why every single-knob attempt traded one
 * for the other.
 *
 * less's cmd_exec (command.c:124) blanks the command line, runs the
 * command, and prompt() writes the ":" back, so the line is blank for
 * exactly the duration of the work. On top of that, a read that goes
 * to disk with a key waiting ungets the key (check_poll, os.c:164) and
 * the NEXT prompt() returns early on `ungot != NULL` (command.c:924) -
 * so during a burst on a real file the ":" stays gone across command
 * after command. The help file is CH_HELPFILE, answered out of memory
 * (ch.c:616): it is never polled, nothing is ever ungot for it, and
 * its prompt is written at the end of every single command.
 *
 * So less's help prompt is steady because it is REWRITTEN every time and
 * the gap in between is microseconds. Ours is milliseconds, so writing
 * it every time is exactly what made it blink. Two fixes:
 *
 *   1. The gap. Our output is buffered, so an unflushed clear_bot is
 *      overwritten by the frame that follows and the pair reaches the
 *      terminal as ONE write, with no blank state in between - less's
 *      microsecond gap, for free. cmd_exec therefore flushes its clear
 *      only when we mean the blank to be seen (core.ts).
 *   2. The burst. Behind the keyboard on a real file is our version of
 *      less's poll-and-unget, and it holds the prompt off for as long as
 *      it lasts.
 *
 * Neither applies to help: (1) leaves its prompt rewritten inside one
 * atomic frame, and (2) is declined for it outright, as less's ch does.
 */
let promptHold = false;

/** less's `nlines == 0`: the last command moved nothing, so it read
 *  nothing, so there is nothing to suppress the prompt. */
let stalled = false;

/** Whether the key loop is BEHIND: keys have been waiting, unbroken,
 *  for longer than a person can type them. Set by the key queue. */
let heavyWork = false;

/** Whether the command BEFORE this one was also stalled - i.e. the
 *  screen was already sitting at the edge rather than arriving. */
let edgeHeld = false;

/**
 * How long the keyboard must stay quiet before the ":" comes back.
 *
 * Without it the ":" blinks through a burst's tail: macOS auto-repeat
 * spaces its last keys further and further apart, so each one finds an
 * empty queue and looks like the end of the scroll.
 */
export const PROMPT_SETTLE_MS = 150;

/** A command slower than this leaves a gap the eye catches. */
const SLOW_MS = 40;

/** Whether THIS frame is withholding its prompt line. */
let heldPrompt = false;

/**
 * Tells the paint we are BEHIND the keyboard - another key was already
 * waiting when this one started.
 *
 * That is the state less is in whenever it polls mid-read and ungets,
 * and it is the honest signal for "the user is scrolling faster than
 * the screen can follow", which is when the ":" must stay out of the
 * way. The help file declines it: less's ch never polls CH_HELPFILE, so
 * no help command ever finds its prompt suppressed.
 */
export function markBurst(burst: boolean): void {
  if (burst && !mode.HELP && !stalled) promptHold = true;
}

/**
 * A command that took long enough to stall the key loop - our own
 * version of less going to disk.
 */
export function markCommandTime(took: number): void {
  if (took >= SLOW_MS && !mode.HELP && !stalled) heavyWork = true;
}

/**
 * The key queue reporting that it has not drained for a while - the
 * listener is stalled, which is the thing the user actually sees.
 */
export function markBehind(): void {
  if (!mode.HELP && !stalled) heavyWork = true;
}

/**
 * Whether the ":" should be out of the way: keys are waiting AND we
 * are too busy to keep up with them.
 *
 * A key waiting is only half. Terminals deliver a burst in CHUNKS, so
 * several keys sit in the queue for a few milliseconds even when we
 * are comfortably ahead - which is why hiding on the backlog alone
 * took the ":" off a one-screen file where less's stays put all day.
 *
 * The other half is being BEHIND, and it has two sources:
 *
 *   - sawSourceRead(), less's literal one. check_poll runs before an
 *     iread and nowhere else (os.c:303), so a file already in ch's
 *     pool is never polled however hard the keyboard bursts. Kept for
 *     parity: less suppresses on the read whether or not it was slow.
 *   - heavyWork, ours. less's read IS less's slow path - that is what
 *     check_poll exists for - but ours is not the only one. A file of
 *     enormous lines is served entirely from the line memo, so not one
 *     block is read while each command still costs enough to stall the
 *     key loop. On that file the read gate says "no poll" while the
 *     pager is visibly unresponsive, ":" and all.
 *
 * So: the cause is not the burst, it is the work the burst provokes -
 * but a burst there must be. less suppresses by ungetting a key that was
 * WAITING (os.c:164); with nothing waiting there is nothing to unget
 * and prompt() writes as usual, however long the command took. Letting
 * slow work hold on its own hid the prompt after a single G on a big
 * file - no keys queued, nobody to be behind - and made the -M prompt
 * come and go with how loaded the machine was.
 */
const pollWouldFire = (): boolean =>
  promptHold && (sawSourceRead() || heavyWork);

/**
 * less's `nlines == 0` (forwback.c:335, :372): THIS command broke out
 * before moving a line, so it read nothing and ungot nothing.
 *
 * Raised by eof_bell, which less calls at exactly those points, and
 * cleared at the start of the next command (armStall) - so it always
 * describes the command that just ran and nothing older.
 */
export function markStalled(): void {
  stalled = true;
  promptHold = false;
  // an edge does no work, so nothing is behind any more
  heavyWork = false;
}

/**
 * Assumes the command about to run WILL move, until its eof_bell says
 * otherwise.
 *
 * This used to be a latch cleared by comparing painted rows, on the
 * theory that changed content is less's `nlines > 0`. It is - but only
 * where a comparable frame exists: a frozen frame, an mca holding the
 * screen, or any path that does not repaint leaves the flag standing,
 * and a stale flag means the collapse below starts eating keys while
 * the screen is genuinely moving. Asking each command afresh cannot
 * go stale.
 */
export function armStall(): void {
  edgeHeld = stalled;
  stalled = false;
}

/** Whether the command just run moved nothing - so an identical key
 *  behind it will do nothing either (core.ts collapses those). */
export const isStalled = (): boolean => stalled;

/**
 * Whether the ":" is being held off - so cmd_exec flushes its clear
 * like less, and the frame leaves the row alone.
 */
export const promptHolding = (): boolean => pollWouldFire();

/** Ends the hold once the keyboard has settled and the ":" can return. */
export function endPromptHold(): void {
  promptHold = false;
  heavyWork = false;
}



/** Paints the content with no prompt row, like less mid-command. */
export function renderBare(rawContent: string[], buffer: string[]): void {
  bareFrame = true;

  try {
    render(rawContent, buffer);
  } finally {
    bareFrame = false;
  }
}

/**
 * less's repaint_hilite (search.c:276): every row redrawn IN PLACE -
 * goto_line, clear_eol, put_line - and then lower_left. It addresses
 * each row rather than homing once, which matters when a row is wider
 * than the screen: the terminal wraps it and the following addressed
 * rows land INSIDE the wrapped text, which is exactly the interleaving
 * less produces under -r.
 */
export function renderHiliteRepaint(
  rawContent: string[],
  buffer: string[]
): void {
  const rows = screenRows(rawContent, buffer);
  let out = '';

  // `if (pos == NULL_POSITION) continue;` - less redraws only the rows
  // that HAVE a position. A tilde past the end of the file and a blank
  // above the beginning have none, so it never touches them: whatever
  // the terminal is showing there stays. That is not cosmetic under
  // -r, where the row above wrapped over them - less leaves the wrapped
  // remnants alone and we were wiping them with tildes
  const first = config.blankTop;

  // one row PAST the content still has an entry: forw() closes with
  // `add_forw_pos(pos, FALSE)`, so the position table always carries
  // the spot after the last line drawn (less's BOTTOM_PLUS_ONE). Its
  // forw_line returns NULL, so repaint_hilite draws it as a null line
  // - one tilde, and only one, however many the screen shows
  const last = Math.min(rows.length - 1 - padRows + 1, rows.length - 1);

  for (let i = first; i < last; i++) {
    out += CURSOR_TO(i + 1, 1) + CLEAR_LINE + rows[i] + '\n';
  }

  out += CURSOR_TO(rows.length, 1);

  // repaint_hilite closes with lower_left() (search.c:311) and does
  // NOT touch forw_prompt: whatever the paint before it left stands,
  // and prompt() reads that to decide on clear_bot (command.c:993).

  putstr(out);

  // these rows ARE what the screen now shows, so the next paint may
  // diff against them - less's own table is equally unbothered that the
  // terminal wrapped a row, and a reset here would cost a full repaint
  // less never makes
  prevRows = rows;
  prevCursorCol = -1;

  // the loop stops one row short of the bottom: less's repaint_hilite
  // never touches the prompt line, which prompt() writes afterwards.
  // Claiming we painted it would make the next frame skip it
  dirtyBottomRow();
}

export function render(rawContent: string[], buffer: string[]): void {
  // everything this frame matches is matched FOR the frame: any
  // key ends it, and giving up on it costs highlighting rather
  // than raising a question about a search nobody ran
  try {
    duringRepaint(() => renderFrame(rawContent, buffer));
  } finally {
    endGuardedRun();
  }
}

function renderFrame(rawContent: string[], buffer: string[]): void {
  // one frame is one run to whoever is watching it, however many
  // lines it highlights: what it says about taking a while, and what
  // giving up on it means, both belong to the frame and not to its
  // twelfth line
  beginGuardedRun();

  // less's error() runs squish_check first (unless --old-bot): a
  // message over a squished short first paint repaints the whole
  // screen, tildes and all, before showing (output.c:719)
  const squishMessage = mode.INIT && !!search.message && !optOldBot();

  if (squishMessage) mode.INIT = false;

  // a still-filling first screen of a pipe paints its lines bare,
  // like less's initial forw: the prompt appears only with the
  // screenful or the learned length — or as the wait message when
  // the read stalls (pipeFilling(), inlined: importing
  // features/pipe here would run its module body too early)
  const pipeFill = session.pipeStream !== null &&
    session.pipeFirstFill && !session.pipeProbing && !sizeIsKnown() &&
    !session.pipeWaiting;

  // Both shapes omit the prompt row, so both build their rows the
  // same way -- but only the PIPE one appends, and scrollFrame's
  // "open" means append-only. A bare frame is an ordinary paint that
  // happens to carry no prompt, and passing it as open sent every
  // seekable scroll down the append path, which then repainted the
  // whole screen when the rows did not append.
  const filling = bareFrame || pipeFill;

  // getPrompt below re-arms this when the frame bottoms in the true
  // prompt; a fill frame (no prompt row at all) must not inherit it
  promptPainted = false;

  // what the screen shows RIGHT NOW versus what this frame will leave:
  // the early-return shortcuts below repaint only the bottom line, so
  // the hand-off has to happen before them
  shownBottomEcho = prevBottomEcho;
  prevBottomEcho = !!option.pending || cmd.active || !!config.keyPrefix;

  // the armed repaint waits for a frame back at the true prompt, like
  // less's toggle_option resuming after error() returns. Without a full
  // screen EVERY prompt repaints: less's make_display takes the same
  // branch as a trashed screen (command.c:863), because a scroll would
  // print into the rows below the window that are not ours
  const trashedRepaint = (fullRepaintPending || !fullScreen()) &&
    !search.message &&
    !option.pending && !search.input && !examine.pending &&
    !miscInput.pending && !brackets.pending && !marks.pending &&
    !mode.BUFFERING && !config.keyPrefix;

  const forceFull = hiliteRepaintPending_ || trashedRepaint;

  const hideHilite = hiliteErasePending_;

  if (forceFull) {
    fullRepaintPending = false;
    hiliteRepaintPending_ = false;
    hiliteErasePending_ = false;
  }

  // less answers a trashed screen with repaint(), and repaint pos_clears
  // (jump.c) - so the rows a backward move exposed go with it. The
  // command runs FIRST, because error()'s get_return ungets the key
  // that dismissed the toggle's message (output.c:687) and only the
  // NEXT make_display repaints: a k typed at "(press RETURN)" moves
  // the top and has its short row wiped in the same frame. The hilite
  // repaint is not this - chg_hilite redraws every row through the
  // position table it already has (search.c), touching no entries.
  if (trashedRepaint) {
    config.screen = [];
  }

  if (hideHilite) setHiliteHidden(true);
  // less's make_display repaints whenever the position table is EMPTY:
  // `if (empty_screen()) jump_loc(...)` runs before EVERY prompt
  // (command.c), and for a file with no lines the table is always
  // empty. The FIRST paint squishes those null rows away (first_time);
  // from the second prompt on they are drawn, so an empty file that
  // showed blank rows shows tildes once any command has run
  // ...but make_display is called from prompt(), so it only runs when
  // a TRUE command prompt is being drawn: a search or option prompt
  // is an MCA loop that never reaches it, and less's screen stays as it
  // was until the prompt closes
  if (firstPaintDone && mode.INIT && noContentDrawn(rawContent) &&
      !search.message && !option.pending && !search.input &&
      !examine.pending && !miscInput.pending && !brackets.pending &&
      !marks.pending && !mode.BUFFERING && !config.keyPrefix) {
    mode.INIT = false;
  }

  // less reached this paint but not prompt(): the read it needed polled
  // the tty, found a key and ungot it, so prompt() returned early.
  //
  // Held for the whole burst, not just while a key happens to be
  // queued: macOS auto-repeat spaces a burst's tail out until the
  // queue keeps running dry, and every one of those keys then looked
  // like the end of the scroll and blinked the ":" back in. The settle
  // timer ends the hold instead, on the clock rather than on the queue.
  // ...but never over the question. The hold keeps the ":" from
  // blinking through a burst, and it ends when the key loop next
  // turns - which, after a search the watcher interrupted, it does
  // not: the interrupt is taken off the terminal and dropped where less
  // drops it (getcc_clear), so no key arrives to settle anything. The
  // question then sat behind a blank row until the user pressed
  // something, and what they pressed was aimed at a question they
  // could not see.
  //
  // Nothing of less's is at stake: less has no hold, and this question is
  // not less's prompt but a query, which less writes and flushes on the
  // spot (query/error, output.c)
  const promptHeld = !filling && pollWouldFire() && !posixRetry.pending;

  // a command that already wrote less's cmd_exec clear_bot itself
  // (execSearch, ahead of a walk that may be long) has supplied this
  // frame's opening; error() then adds its own and the pair matches
  // less. Consumed HERE, not inside scrollFrame: the early returns
  // there would strand it and suppress a later frame's opening.
  // NOT consumed here: a single key can render more than once (a bare
  // fill frame, then the real one), and whichever ran first used to
  // eat the flag - so the second frame wrote a SECOND clear_bot where
  // less spends one per command. It stays up for the whole command and
  // act() clears it when the next one starts.
  cmdExecOpened = search.cmdExecOpened;

  // a mid-scan note went straight to the terminal, so what we think
  // is on the bottom line is stale
  if (search.bottomClobbered) {
    search.bottomClobbered = false;
    dirtyBottomRow();
  }

  let rows = screenRows(rawContent, buffer, filling);

  // less's start_mca never runs make_display: while a multichar command
  // is collecting, prompt() is not reached at all - A_OPT_TOGGLE is
  // `start_mca(...); c = getcc(); goto again;` (command.c:2499) - and
  // less's prompt() would return early anyway while the ungotten
  // dismissing key is pending (command.c:924). So the CONTENT rows
  // stay exactly as the last real paint left them and only the bottom
  // line moves.
  //
  // Ours rebuilt session.content the moment -S toggled, so the newly
  // chopped rows reached the screen while the "-" prompt was open -
  // less still shows the OLD wrapped screen there and repaints only
  // once the mca closes and the owed screen_trashed is honoured.
  //
  // The same holds the moment the option's MESSAGE goes up: less's
  // error() is squish_check + clear_bot + the text (output.c:705) and
  // touches no content row, while the screen_trashed toggle_option
  // owes is honoured only by a later make_display. `fullRepaintPending
  // && !trashedRepaint` IS that owed-but-deferred state - which is why
  // -S showed its chopped rows under the message where less still shows
  // the old wrapped ones.
  //
  // A command that paints for itself (a search's jump_loc, a scroll)
  // never sets fullRepaintPending, so its rows keep flowing.
  const mcaHoldsScreen = !!option.pending || !!config.keyPrefix ||
    (fullRepaintPending && !trashedRepaint);

  if (mcaHoldsScreen && prevRows && prevRows.length === rows.length &&
      rows.length > 0) {
    const bottom = rows[rows.length - 1];
    rows = prevRows.slice();
    rows[rows.length - 1] = bottom;
  }

  // the withheld line still has to BE something, and what it is is
  // BLANK: cmd_exec cleared it and flushed that clear (core.ts), and
  // no prompt() has written over it since. That is less's state exactly
  // - the command line between clear_bot and the prompt.
  //
  // It used to be pinned to the previous frame's bottom row instead,
  // which is the same thing only while the recorded row happens to be
  // right. dirtyBottomRow leaves a NUL there to force a repaint, and
  // that NUL then reached the frame builders as the row's text: a
  // truthy row that writes nothing and, through less's put_line
  // truncation, swallows the rest of the frame with it.
  if (promptHeld && rows.length > 0) {
    rows = rows.slice();
    rows[rows.length - 1] = '';
  }

  heldPrompt = promptHeld;
  if (hideHilite) setHiliteHidden(false);

  // that squish_check repaint OUTRANKS the freeze: less paints the
  // whole screen (marker, tildes and all) and only then writes the
  // message over the bottom line, so the stale squished rows the
  // freeze would restore must not come back
  // less's position table stays empty until make_display paints; a
  // frozen frame is prompt() returning early, which paints nothing.
  // The blank seed under an ungot startup key is exactly that, so it
  // must not count as a paint.
  firstOutput = !contentPainted;
  if (!frozenFrame) contentPainted = true;

  if (frozenFrame && squishMessage) {
    frozenFrame = false;
    frozenHome = false;
  }

  if (frozenFrame) {
    // less's prompt() returns early on ungot input and MCA_MORE loops
    // without reaching it, so the stale rows survive any message,
    // prompt or echo on the bottom line; only a render back at the
    // true prompt - with NO ungot command pending - runs
    // make_display's repaint
    const atPrompt = !search.message && !option.pending && !search.input &&
      !examine.pending && !miscInput.pending && !brackets.pending &&
      !marks.pending && !mode.BUFFERING && !config.keyPrefix &&
      !hasUngot();

    if (atPrompt) {
      frozenFrame = false;
      if (frozenHome) dumbHomePending = true;
      frozenHome = false;
    } else if (prevRows) {
      rows = [...prevRows.slice(0, -1), rows[rows.length - 1]];
    }
  }

  // less (v618+) starts at the lower left of the alt screen and lets
  // the first paint scroll upward: a short first screen sits just
  // above the bottom prompt, its blank rows on top; -X never homes,
  // so a short first screen prints in place (less's squished screen).
  // Rows a NUL will collapse take no space, so the fill counts the
  // PHYSICAL rows less's scroll-up actually produces.
  //
  // The lower_left that causes it is less's alt-screen guard, not the
  // -X one: term_init homes only when BOTH "ti" and "te" exist and
  // "NR" does not deny the switch (screen.c:2061), so on a terminal
  // that cannot switch, a short first screen prints at the top.
  // less's FIRST paint on the alternate screen is always sequential,
  // whether or not the file fills it: term_init has parked the cursor
  // on the bottom line and forw() just writes lines, each newline
  // scrolling the last screenful up. A short file ends up with blank
  // rows above it - less's "squished" screen - but that is a
  // consequence of the same paint, not a different one.
  const onAlt = !mode.DUMB && !optNoInit() && ON_ALTERNATE_SCREEN;

  // less's `first_time`, not "the previous frame is gone": a repaint
  // mid-session (R, a shell's return, a message wider than the
  // screen) also starts from no known screen, but less gets there
  // through repaint() -> forw(), which prints "...skipping..." and
  // does NOT re-park at the bottom. Only the session's very first
  // paint follows term_init's lower_left
  const firstPaint = !firstPaintDone && onAlt;
  let squishBlanks = 0;

  // the pad is the SCREEN MODEL, so it lasts as long as the screen is
  // squished (less's `squished` flag), not just for the paint that
  // produced it: the next frame has to diff against the same rows the
  // terminal is showing
  if (mode.INIT && onAlt && rows.length < config.window) {
    squishBlanks = config.window - collapseNulRows(rows).length;
    rows.unshift(...Array(squishBlanks).fill(''));
  }

  // less's G repaints through its pos_clear even when nothing moved
  // visibly, so the identical-rows shortcut below must not eat it
  const posClear = posClearPending;
  posClearPending = false;
  const backPaint = backPaintPending;
  backPaintPending = false;


  // nothing changed (e.g. scrolling against BOF/EOF): leave the screen
  // and the parked cursor untouched, like less — but arrow movement
  // inside the command buffer must still move the cursor
  if (!forceFull && !posClear && prevRows && sameRows(prevRows, rows)) {
    // less reprints clear_bot + the prompt after every command — an
    // identical reprint we normally compress away. A configured
    // --end-prompt makes it matter: the marker precedes the reprint
    // (putchr), and an SGR marker visibly recolors it, so paint it
    // for real; end_pr_string skips the help file
    if (promptPainted && !mode.HELP && optEndPrompt() !== null) {
      const bot = rows[rows.length - 1];
      putstr(eprPrefix() + (scrollMode()
        ? clearBot() + bot + tailClear(bot) + scrollPark(rows)
        : CURSOR_TO(promptRow(rows), 1) + CLEAR_LINE + bot +
          parkCursor(rows)));
      prompting = promptPainted;
    promptedInHelp = mode.HELP;
      return;
    }

    // less reprints the prompt through clear_bot on every command;
    // with --old-bot the first reprint after a forw_prompt visibly
    // jumps it from mid-screen to the bottom row, stale copy behind
    if (scrollMode() && optOldBot() && !promptAtBottom && !filling) {
      putstr(eprPrefix() +
        clearBot() + rows[rows.length - 1] +
          tailClear(rows[rows.length - 1]) + scrollPark(rows)
      );
      return;
    }

    const col = cmd.active && !mode.DUMB ? cursorCol(rows) : -1;

    if (col >= 0 && col !== prevCursorCol) {
      prevCursorCol = col;
      // -X owns no absolute rows: rewrite the prompt line in place
      // and backspace to the editing position, like less's cmdbuf
      putstr(eprPrefix() + (scrollMode()
        ? '\r' + CLEAR_LINE + rows[rows.length - 1] + scrollPark(rows)
        : CURSOR_TO(promptRow(rows), col)));
    }

    return;
  }

  if (mode.DUMB) {
    // the collapse is implemented for the addressable paints only
    nulCollapsed = 0;
    const frame = dumbFrame(prevRows, rows, buffer, posClear);
    prevRows = rows;
    putstr(eprPrefix() + frame);
    prompting = promptPainted;
    promptedInHelp = mode.HELP;
    return;
  }

  // -X stays on the main screen, where less's real paint model shows
  if (scrollMode()) {
    nulCollapsed = 0;
    const frame =
      scrollFrame(prevRows, rows, pipeFill, rawContent, posClear, buffer,
        backPaint);
    if (!keepPrevRows) prevRows = rows;
    keepPrevRows = false;
    prevCursorCol = cmd.active ? cursorCol(rows) : -1;
    putstr(eprPrefix() + frame);
    prompting = promptPainted;
    promptedInHelp = mode.HELP;
    return;
  }

  // only the bottom (prompt) line changed — a command prompt
  // opening, its per-key echo, a message: less's cmd_startup writes
  // clear_bot + the command line ALONE (cmdbuf.c), never touching
  // the content rows (whose painted colors survive, visibly so
  // under a leaked --end-prompt SGR)
  if (!forceFull &&
      prevRows && prevRows.length === rows.length && rows.length >= 2 &&
      prevRows[rows.length - 1] !== rows[rows.length - 1] &&
      prefixEqual(prevRows.slice(0, -1), rows)) {
    prevInitAlt = mode.INIT;
    prevRows = rows;
    prevCursorCol = cmd.active ? cursorCol(rows) : -1;

    // less's clear_bot uses line_left() - a bare CR to column 1 of
    // WHEREVER the cursor is (screen.c) - not an absolute address:
    // every paint leaves the cursor on the prompt row, so there is
    // nothing to address. --old-bot is the exception, and clearBot
    // already carries it. Nor does less park afterwards, since writing
    // the prompt leaves the cursor exactly where the park would put
    // it; only an open command line positions inside its own text
    const bot = rows[rows.length - 1];

    // cmd_exec has already put this frame's opening on the terminal
    // (less's clear_bot before the command ran, command.c:124), so the
    // frame must not write a SECOND one. less spends one clear per
    // scroll key; without this we spent two, and the extra blank of
    // the bottom row is a flicker less does not have.
    // less's set_mca is `mca = action; clear_bot(); clear_cmd();`
    // (command.c:134) - start_mca clears UNCONDITIONALLY. forw_prompt
    // gates prompt()'s clear (command.c:993), never an mca's: that is
    // why less shows " Z" after a j and we showed ": Z", the prefix
    // echo appended to a ":" the forward paint had told us to keep.
    const mcaOpening = prevBottomEcho && !shownBottomEcho;

    const opening = mcaOpening
      ? clearBot()
      : (forwPrompt || cmdExecOpened) ? '' : clearBot();

    forwPrompt = false;

    putstr(eprPrefix() +
      opening + bot + tailClear(bot) +
      (cmd.active ? parkCursor(rows) : ''));
    prompting = promptPainted;
    promptedInHelp = mode.HELP;
    return;
  }

  // a squished screen unlatching is less's squish_check calling
  // repaint(): pos_clear + jump_loc paint EVERY row through the
  // skipping shape (jump.c:124) — never a diff-scroll, which would
  // leave the old rows' colors behind (visible under a leaked
  // --end-prompt SGR)
  const unsquished = prevInitAlt && !mode.INIT;
  prevInitAlt = mode.INIT;

  // an addressed repaint re-places the prompt absolutely, clearing a
  // drift an earlier NUL collapse left (less's lower_left); the two
  // sequential painters set it again when they lose a row. The
  // bottom-line shortcuts above return before this, keeping the
  // drift, like less writing the prompt with a bare \r
  nulCollapsed = 0;

  // -c repaints instead of scrolling (less's top_scroll homes; the
  // skipping scroll paint is the !top_scroll default)
  const frame = (firstPaint && !optClearRepaint()
    ? squishFrame(rows, squishBlanks)
    : null) ??
    (optClearRepaint() || forceFull
    ? null
    : (posClear || unsquished ? null : scrolledFrame(rows, rawContent)) ??
      skippedFrame(rows, rawContent, posClear || unsquished)) ??
    fullFrame(rows);

  prevTopRow = config.row - config.blankTop;
  prevTopKnown = true;
  prevTopSub = config.subRow;
  prevRows = rows;
  prevCursorCol = cmd.active ? cursorCol(rows) : -1;

  // less has no synchronized-update wrapper: its marker bytes sit
  // directly in the paint stream. Keep ours INSIDE the batch — a
  // terminal that isolates the ?2026 batch would otherwise drop
  // SGR state written just before it
  const epr = eprPrefix();
  putstr(epr && frame.startsWith(syncOn())
    ? syncOn() + epr + frame.slice(syncOn().length)
    : epr + frame);
  firstPaintDone = true;
  prompting = promptPainted;
    promptedInHelp = mode.HELP;
}

/**
 * Repaints for a terminal without cursor addressing, like less drawing
 * with the dumb entry's caps: nothing is ever erased.
 *
 * The rows arrive as they are. less's own attributes went dark in
 * initTerminalCapabilities, where the missing "smso" empties them the
 * way tmodes does; what is left is the FILE's escapes under -R, which
 * less's put_line hands to putchr untouched whatever the terminal is
 * (line.c:1300 stores them AT_ANSI, and at_switch ignores that bit).
 * Stripping here took those with it, so -R lost its colour.
 *
 * - A bottom-line change overwrites in place after a bare `\r`; a
 *   shorter line leaves the old tail visible, like less without `el`.
 * - A forward scroll prints only the newly exposed lines and the
 *   prompt, letting the terminal scroll.
 * - Anything else repaints behind the dumb `clear` of two newlines.
 */
function dumbFrame(
  prev: string[] | null,
  rows: string[],
  buffer: string[] = [],
  posClear: boolean = false
): string {
  const plain = rows;
  const last = plain.length - 1;

  // less's start_mca has run for a command line that was already open,
  // so this key is a cmd_ichar echo; the engine's own scroll count is
  // the only proof of a whole-screenful advance, which shares no row
  // with the frame before it
  const now = mcaOpen(buffer);
  const wasMca = now !== '' && prevMca === now;
  prevMca = now;
  const forwDist = scrolledRows;
  scrolledRows = 0;

  // a repaint that carries its own opening (jump_loc's lclear before
  // back()) writes that instead of the bare clear_bot CR
  const prefix = scrollPrefix;
  scrollPrefix = null;

  // less's pos_clear'd repaint redraws whole even when nothing moved,
  // so the incremental shapes below must not swallow it
  if (prev && !posClear && prev.length === plain.length) {
    const prevPlain = prev;

    let same = 0;
    while (same < last && plain[same] === prevPlain[same]) same++;

    // only the bottom (prompt) line changed: less's prompt() skips
    // clear_bot after a forward paint, which is all this CR is -
    // except that start_mca clear_bots unconditionally, and the
    // characters after it are cmd_ichar echoes (clear_eol is empty
    // here, so a typed "5" goes out as just "5 \b 5")
    if (same === last) {
      const head = cmdInsertEcho(plain[last], buffer);

      if (head !== null) {
        const c = plain[last].slice(head.length);
        const echo = CLEAR_LINE + c + '\b'.repeat(c.length) + c;
        forwPrompt = false;
        return wasMca ? echo : '\r' + head + echo;
      }

      const opening = forwPrompt ? '' : '\r';
      forwPrompt = false;
      return opening + plain[last];
    }

    // scrolled forward: the old rows moved up by k. At k === last
    // the frames share no row at all and only the engine's count can
    // name the distance less's forw still writes line by line
    for (let k = 1; k <= last; k++) {
      if (k < last
        ? plain[0] === prevPlain[k] && shifted(plain, prevPlain, k)
        : k === forwDist) {
        // less's forw sets forw_prompt after every line it puts
        // (forwback.c:368), so the prompt that follows skips
        // clear_bot - here a bare CR, since dumb has no "el". A frame
        // carrying its own prompt row has already spent it
        forwPrompt = !plain[last];
        return '\r' + joinDumb(plain.slice(last - k));
      }
    }
  }

  // the first paint just prints, like less's initial forw; a later
  // full paint is repaint()'s non-contiguous forw, which without
  // top_scroll prints "...skipping..." — only -c or a trashed
  // make_display (top_scroll forced) clears with two newlines and
  // hardcopy home's visible |-overstruck-^ marker ("|\b^"); a later
  // paint leads with lower_left's bare CR, the first one leans on the
  // one term_init has already written
  const drawn = prev !== null || dumbPainted;
  const clearHome = optClearRepaint() || dumbHomePending;
  dumbHomePending = false;
  dumbPainted = true;

  // a dumb terminal cannot reverse-scroll, so EVERY paint that gets
  // here is less's forw() - through repaint() for a backward move - and
  // forw sets forw_prompt after every line it puts
  forwPrompt = !plain[last];

  // less's FIRST forw leads with neither: first_time still holds, so
  // there is no marker (forwback.c:272) and no lower_left CR in front
  // of one. A command line open before anything is painted echoes
  // frame after frame - the "-" the startup error gate ungets opens
  // one - and each of those leaves a prev behind, which made the
  // first forw look like a repaint and print "...skipping..." over
  // its own first screen. top_scroll's clear+home is NOT gated that
  // way: need_home at :271 carries no first_time test.
  const repaint = drawn && !firstOutput;
  const home = drawn && clearHome;

  return (prefix ?? (repaint || home ? '\r' : '')) +
    (home
      ? '\n\n|\b^'
      : repaint && fullScreen() ? '...skipping...\n' : '') +
    joinDumb(plain);
}

/**
 * WHICH of less's mca prompts owns the command line, or "" for none.
 *
 * The identity matters, not just the fact: start_mca runs again for
 * every new mca, so a `5` that opens the digit prompt and then an ESC
 * that opens the A_PREFIX one both carry clear_bot and their prompt
 * string - even though a command line was open the whole time.
 */
function mcaOpen(buffer: string[]): string {
  if (config.keyPrefix) return 'prefix';
  if (cmd.active) return 'cmd';
  if (marks.pending) return 'mark';
  if (pipeMark.pending) return 'pipe';
  if (brackets.pending) return 'bracket';
  if (option.pending) return 'option';
  if (examine.pending) return 'examine';
  if (miscInput.pending) return 'misc';
  return buffer.length > 0 ? 'digit' : '';
}

/**
 * less's get_back_scroll (forwback.c:535): zero when the terminal can
 * neither add a line nor reverse-index (no_back_scroll, so every
 * backward movement repaints), -h when it is set, a whole screen
 * minus two under -c, where every repaint starts a new screen anyway,
 * and no limit at all otherwise.
 */
export const backScrollCap = (): number =>
  !REVERSE_INDEX ? 0
    : optBackScroll() >= 0 ? optBackScroll()
      : optClearRepaint() ? config.window - 2
        : 10000;

/** True when -X keeps the pager on the main screen with less's
 *  scroll-model painting (a dumb terminal keeps its own painter). */
const scrollMode = (): boolean => !mode.DUMB && optNoInit();

/**
 * less's clear_bot: erase from the left of the current (prompt) line,
 * or jump to the physical bottom row first with --old-bot
 * (screen.c's lower_left vs line_left).
 */
export function clearBot(): string {
  // whatever prints next sits on the bottom row under --old-bot
  promptAtBottom = true;
  return (optOldBot() ? CURSOR_TO(config.window, 1) : '\r') + CLEAR_LINE;
}

// set by a frame that wrote nothing: the caller keeps the old rows
let keepPrevRows = false;

// WHICH mca the previous scroll-mode frame had open, so this one's
// keystroke is a cmd_ichar echo and not another start_mca
let prevMca = '';

// less's forw_prompt (forwback.c): forw() sets it after every line it
// puts, and prompt() then SKIPS clear_bot - "the forward movement
// guarantees that we're in the right position to display the prompt"
// (command.c). The row the scroll brought in is blank and the cursor
// is at its start, so clearing it would only cost bytes
let forwPrompt = false;

// less's forw_prompt leaves the prompt directly after forward-painted
// lines, possibly mid-screen; --old-bot's next clear_bot then visibly
// jumps it to the bottom row. less reprints the prompt through
// clear_bot on every command — we compress identical reprints away,
// except that first old-bot jump, which changes the screen.
let promptAtBottom = false;

// true while the last scroll-mode frame was an open pipe fill:
// less's initial forw prints arriving lines bare, and the prompt
// waits for the screenful or the learned length (forw_prompt)
let scrollOpen = false;

function prefixEqual(prev: string[], rows: string[]): boolean {
  for (let i = 0; i < prev.length; i++) {
    if (rows[i] !== prev[i]) return false;
  }

  return true;
}

/**
 * Ends a painted row like less's pdone: a row that exactly fills the
 * width gets no newline — less forces the deferred wrap with space +
 * backspace instead (line.c), so the terminal's auto-wrap carries
 * to the next row without doubling.
 */
/**
 * The clear-to-end that follows a painted bottom line - EMPTY when
 * the line already fills the width.
 *
 * less clears before it writes (prompt's clear_bot, error's leading
 * \r + clear_eol), never after. Clearing after is harmless while the
 * cursor still sits mid-row, but a full-width line leaves it parked
 * on the last column with the wrap deferred, and erasing from there
 * takes the character just written with it.
 */
/**
 * Whether a rendered row reached the right edge, leaving the cursor
 * parked there with the wrap deferred.
 *
 * less compares end_column against sc_width (line.c:1523), and
 * end_column STARTS at linebuf.pfx_end - plinestart sets it there
 * (line.c:452), so the -N/-J gutter counts and sc_width is the whole
 * terminal. Ours is the same row, gutter and all, but
 * config.screenWidth has had the gutter taken out of it by
 * reserveGutter, so it has to be added back.
 *
 * Comparing against the text width called every row of gutter + 64
 * columns "full" on a 79-column screen, so the nudge went out where a
 * newline was needed and the rows ran together. Only --wordwrap makes
 * it visible: without it a wrapped row fills the text width exactly,
 * and both widths then answer the same.
 */
function filledRow(row: string): boolean {
  const plain = row.replace(STYLE_REGEX_G, '');
  return visualWidth(plain) >= fullScreenWidth();
}

function tailClear(row: string): string {
  if (mcaBare()) return '';
  return filledRow(row) ? '' : CLEAR_LINE;
}

/**
 * True while an open command line still reads exactly as less's
 * start_mca left it: clear_bot, clear_cmd, cmd_putstr(prompt), and
 * nothing after (command.c:196).
 *
 * The trailing clear_eol on the bottom row belongs to prompt()'s
 * put_line, which writes the MAIN prompt, or to cmd_repaint's
 * per-character echo (cmdbuf.c:520) - never to opening a command
 * line. We sent one anyway, so every mca prompt cost a stray ESC[K.
 */
function mcaBare(): boolean {
  if (cmd.active) return cmdText() === '';
  if (marks.pending) return true;
  if (pipeMark.pending) return !pipeMark.num;
  if (brackets.pending) return !brackets.chars;
  return false;
}

/**
 * How a row ends, like pdone (line.c:1523).
 *
 * less answers three ways for a row that reached the right edge, and
 * only the first is xterm's:
 *
 * - defer_wrap: the cursor is parked on the last column with the wrap
 *   held, so nudge it over with a space and take the column back.
 * - no auto_wrap: the terminal will not wrap at all, so end the line.
 * - auto_wrap without defer_wrap: it has ALREADY wrapped, so send
 *   nothing. Anything at all costs a whole blank line here.
 *
 * (less also ends a full row with a newline when the LINE ends there and
 * defer_wrap is set. On xterm the nudge lands the cursor in the same
 * place, which is why our output has always matched.)
 */
function rowEnd(row: string): string {
  // less ends every -r row with a newline: pdone's first branch takes
  // "ctldisp == OPT_ON" (line.c:1523), because nothing was counted and
  // it cannot know whether the row reached the edge
  if (optCtldisp() === 1) return '\n';
  if (!filledRow(row)) return '\n';
  if (!AUTO_WRAP) return '\n';
  return DEFER_WRAP ? ' \b' : '';
}

/**
 * The same, between the rows of a whole-screen repaint.
 *
 * The paint addresses no row absolutely: it homes once and lets the
 * separators walk down. A deferring terminal leaves a full row's
 * cursor parked, so the newline moves down exactly one and this is
 * the '\n' it has always been; a terminal that wrapped on its own has
 * already moved, and the newline would move it again.
 */
function frameRowEnd(row: string): string {
  return !DEFER_WRAP && AUTO_WRAP && filledRow(row) ? '' : '\n';
}

/**
 * Row terminator for reverse-indexed (ESC M) rows: less's back() leaves
 * a full-width row bare - pdone skips the deferred-wrap ' \b' going
 * backward, and emitting it here would wrap onto the row BELOW and
 * overwrite its first column.
 */
function revRowEnd(row: string): string {
  const end = rowEnd(row);
  return end === '\n' ? end : '';
}

// less's cursor rests where the prompt print ended; editing inside the
// command buffer moves it left with backspaces, like cmdbuf's putbs —
// -X can't address the prompt row absolutely (the screen may have
// started mid-terminal and never filled)
function scrollPark(rows: string[]): string {
  // less's query() (output.c:786) closes with lower_left(), so the
  // cursor leaves a y/n question parked on the BOTTOM row and not on
  // the question. Everything that clear_bots next lands there: the
  // quit path's, so the question survives on screen, and a re-asked
  // query's, so it prints below instead of overwriting the first.
  if (overwrite.pending || binaryConfirm.pending) {
    return CURSOR_TO(config.window, 1);
  }

  if (!cmd.active) return '';

  const plain = rows[rows.length - 1].replace(STYLE_REGEX_G, '');
  const back = visualWidth(plain) - cmdCol();
  return back > 0 ? '\b'.repeat(back) : '';
}

// the top of the last scroll-mode frame, so far paints know their
// direction like less's jump_loc comparing pos against position(TOP)
let prevTopRow = -1;

// whether prevTopRow holds a real paint (it may be NEGATIVE when a
// forced back padded rows above BOF, so its sign says nothing)
let prevTopKnown = false;

// whether the last frame's bottom line was a command-buffer echo (an
// open option or search prompt) rather than the ordinary prompt: less's
// repaint marker is a bare putstr at the cursor, so such an echo stays
// on the line and the marker appends to it
let prevBottomEcho = false;

// the same, for the frame being built now (the bottom line the screen
// still shows while this frame is painted)
let shownBottomEcho = false;

// less's O_REPAINT options call repaint() when the toggle finishes -
// AFTER error()'s get_return, so the toggle's message shows over the
// old screen first and the fresh paint lands when it is dismissed
let fullRepaintPending = false;
let hiliteRepaintPending_ = false;
let hiliteErasePending_ = false;

let prevTopSub = 0;

// less's trashed-screen repaints print from wherever the cursor sits:
// only a command's cmd_exec adds a clear_bot before them. This
// overrides that prefix — term_init's bare CR after a screen
// re-entry (shell return), or nothing at all when quitting the help
// file re-edits the input (no cmd_exec clear_bot reaches the screen).
let scrollPrefix: string | null = null;

// whether the last scroll-mode frame was still squished (mode.INIT)
let prevInit = false;

// whether the previous scroll-mode frame was a bare (promptless) one
let prevBare = false;

// Display rows the last move covered. less reads this off its position
// table; the array-backed core reads it off config.row. The
// block-backed one can do neither -- it advances its WINDOW and
// leaves config.row where it was -- so it reports the distance here.
let scrolledRows = 0;

/** The block engine reporting how far its last move scrolled. */
export function noteScrollRows(n: number): void {
  scrolledRows = n;
}

/** Marks the next scroll-mode paint as a fresh screen entry. */
export function screenEntered(): void {
  scrollPrefix = '';
}

/**
 * less's jump_loc far-backward branch clearing before back():
 * cmd_exec's clear_bot for the command, then `if (!top_scroll)
 * lclear(); else home();` (jump.c:353). back() repaints from there
 * when a whole screen exceeds get_back_scroll, and the repaint brings
 * no clear_bot of its own.
 */
export function markFarBackClear(): void {
  scrollPrefix = clearBot() +
    (optClearRepaint() ? CURSOR_HOME : CLEAR_SCREEN);
}

/**
 * less's DO_SEARCH (command.c:1973): a repeated search runs
 * `mca_search(); cmd_exec();` first, so the search prompt is written
 * over the command line and then cleared away again before anything
 * is painted - a visible "/" flash on every n and N.
 */
export function markSearchFlash(label: string): void {
  scrollPrefix = clearBot() + label + clearBot();
}

/** Marks the next scroll-mode paint as a bare re-edit repaint. */
export function markBareRepaint(prefix: string = ''): void {
  scrollPrefix = prefix;
}

/** Forces the next full paint to clear and home, like less's forw
 *  with top_scroll (also jump_loc's !full_screen lclear). */
export function markClearHome(): void {
  dumbHomePending = true;
}

// less's prompting flag (output.c): display_prompt sets it, and the
// FIRST putchr of whatever prints next emits the --end-prompt
// expansion before it — a marker for "output resumed after the
// prompt". Only the true prompt arms it; messages and input lines
// print through error()/cmdbuf and never do.
let prompting = false;

// true while the frame being built bottoms out in the real prompt
let promptPainted = false;

// whether the armed prompt belonged to the help file: less's
// end_pr_string checks CH_HELPFILE at FIRE time. less's fire moments
// straddle the edits — 'h' fires at cmd_exec BEFORE the help edit
// (marking the help's first paint), an in-help scroll fires with
// the helpfile current (suppressed), and the help-quit repaint
// fires AFTER editing back (marking the file repaint) — so the
// marker is mute only when the arming prompt AND the target frame
// are both the helpfile
let promptedInHelp = false;

/**
 * The --end-prompt string owed to the next output, like less's putchr
 * checking `prompting` (output.c:496): consumed once per prompt,
 * suppressed for prompts painted on the help file.
 */
export function eprPrefix(): string {
  if (!prompting) return '';
  prompting = false;

  const proto = promptedInHelp && mode.HELP ? null : optEndPrompt();
  return proto ? prExpand(session.content, proto) : '';
}

// less's jump_forw (G) runs pos_clear() before jump_loc: the paint
// sees an empty position table and repaints with the skipping
// marker even when the target rows overlap the current screen —
// unlike a scroll or a search jump reaching the same place
let posClearPending = false;

// whether the last alt-mode frame was still squished (mode.INIT),
// mirroring scrollFrame's prevInit for the -X painter
let prevInitAlt = false;

/**
 * Whether anything has been painted yet.
 *
 * less's position table is empty until the first make_display, and a
 * forward move asks position(BOTTOM_PLUS_ONE) before anything else --
 * with no table there is no row past the bottom, so it bells rather
 * than moving. That only happens before the FIRST paint: a key ungot
 * at the startup gate runs while prompt() is still skipping.
 */
export const screenPainted = (): boolean => contentPainted;

/**
 * Marks the next paint as less's jump_loc far-BACKWARD branch: lclear()
 * then back(sc_height-1) from the target (jump.c:353), a cleared
 * screen painted upward through home + reverse index.
 */
export function markBackPaint(): void {
  backPaintPending = true;
}

// set by markBackPaint, consumed by the next render
let backPaintPending = false;

/** Marks the next paint as less's pos_clear'd jump (G). */
export function markPosClear(): void {
  posClearPending = true;

  // less's pos_clear wipes the whole position table, so the entries a
  // backward move prepended go with it and every row is regenerated
  // whole. Everything that reaches this - jump_loc, a search landing,
  // a repaint - has already cleared them in less.
  config.screen = [];
}

/**
 * less's cmd_ichar echo (cmdbuf.c:520): the inserted character is not
 * painted as part of a rewritten row. cmd_repaint clear_eols at the
 * insertion point and prints the tail from there, backs the cursor up
 * to where it was, and cmd_right then RE-PRINTS the character to
 * advance over it -- so a typed "5" goes out as "5 \b 5".
 *
 * @param row - The command line as it will read after the keystroke.
 * @returns The row up to the inserted character, or null when this is
 *          not a plain insertion.
 */
function cmdInsertEcho(row: string, buffer: string[]): string | null {
  // a digit prefix goes through less's mca number mode, which is the
  // same cmd_char path as a prompt's own text; a held A_PREFIX
  // character is inserted as its prchar REPRESENTATION, so what was
  // echoed is "ESC" and not one byte
  const c = config.keyPrefix
    ? prChar(config.keyPrefix.slice(-1))
    : (cmd.active ? cmdText() : buffer.join('')).slice(-1);

  if (!c || !row.endsWith(c)) return null;

  return row.slice(0, -c.length);
}

/**
 * Paints like less on the main screen for -X (no-init): less never
 * redraws frames in place — forw() prints the new lines and lets the
 * terminal scroll, back() inserts rows with home + reverse index
 * (painted nearest-first), and far jumps either print
 * "...skipping..." and scroll (forward and plain repaints, forw
 * without top_scroll) or clear and paint backward (jump_loc's
 * lclear + back for targets above the screen). The alt screen hides
 * this model behind our full frames; the main screen preserves the
 * scrollback, so these shapes match less's bytes.
 */
function scrollFrame(
  prev: string[] | null,
  rows: string[],
  open: boolean = false,
  src: string[] = [],
  posClear: boolean = false,
  buffer: string[] = [],
  backPaint: boolean = false
): string {
  const effRow = config.row - config.blankTop;

  // less's pos_clear'd G never looks like a backward jump: the empty
  // position table sends jump_loc down the forward/skipping path.
  //
  // config.row is a row of the MATERIALIZED WINDOW, not of the file,
  // so for a source engine whose window slid under the jump it says 0
  // on both sides and the comparison cannot see the direction at all.
  // backPaint is the engine naming less's branch outright.
  const backJump = !posClear && (backPaint ||
    (prevTopRow >= 0 && (effRow < prevTopRow ||
      (effRow === prevTopRow && config.subRow < prevTopSub))));

  // the display-row distance the top advanced, like less comparing
  // pos against position(BOTTOM_PLUS_ONE): a full-screenful move
  // shares no visible rows yet forw still scrolls it contiguously
  let forwDist = -1;
  if (prev && prevTopRow >= 0 && !backJump && !config.blankTop &&
      src.length) {
    forwDist = -prevTopSub;
    const cap = prev.length + 1;

    for (let r = prevTopRow; r < effRow && forwDist <= cap; r++) {
      forwDist += maxSubRow(src[r] ?? '') + 1;
    }

    forwDist += config.subRow;
  }

  // the engine's own count, when config.row could not say
  if (forwDist <= 0 && scrolledRows > 0) forwDist = scrolledRows;

  // a backward move reports itself negative; a whole screenful back
  // shares NO row with the frame before it, so nothing else can name
  // the distance less's back() still walks row by row
  const backDist = scrolledRows < 0 ? -scrolledRows : 0;
  scrolledRows = 0;

  prevTopRow = effRow;
  prevTopSub = config.subRow;

  // a squished screen unlatching is less's squish_check calling
  // repaint(): the tilde pad rows appear through the full skipping
  // paint, never as an appended forward scroll
  const unsquished = prevInit && !mode.INIT;
  prevInit = mode.INIT;

  const wasOpen = scrollOpen;
  scrollOpen = open;

  // whether the SAME command line was already open in the previous
  // frame: less's start_mca has run for it, so this key is only an echo
  const nowMca = mcaOpen(buffer);
  const wasMca = nowMca !== '' && prevMca === nowMca;
  prevMca = nowMca;

  // the frame before this one carried no prompt row
  const wasBare = prevBare;
  prevBare = bareFrame;

  // a clearBot() in any shape below overrides this to the bottom row
  promptAtBottom = rows.length >= config.window;

  // an open pipe fill prints only its newly arrived lines, bare
  if (open) {
    dumbPainted = true;
    promptAtBottom = false;

    if (prev) {
      // a closed wait frame parked less's message on the bot row;
      // resuming data clear_bots it and prints there (less capture:
      // "\r ESC[K 3" over the wait message)
      const base = wasOpen ? prev : prev.slice(0, -1);

      if (rows.length >= base.length && prefixEqual(base, rows)) {
        const appended = rows.slice(base.length)
          .map(r => r + rowEnd(r)).join('');
        return (wasOpen ? '' : clearBot()) + appended;
      }
    }

    return '\r' + rows.map(r => r + rowEnd(r)).join('');
  }

  // the fill completed: remaining lines print, then less's forw_prompt
  // appends the prompt with no clear_bot — under --old-bot it stays
  // right there, mid-screen, until the next command's clear_bot; the
  // stall's wait message instead arrives like less's ixerror, behind a
  // clear_bot and without the prompt's trailing clear
  if (wasOpen && prev) {
    const grown = rows.slice(0, -1);

    if (grown.length >= prev.length && prefixEqual(prev, grown)) {
      const tail = session.pipeWaiting
        ? clearBot() + rows[rows.length - 1]
        : rows[rows.length - 1] + tailClear(rows[rows.length - 1]) +
          scrollPark(rows);

      return grown.slice(prev.length).map(r => r + rowEnd(r)).join('') + tail;
    }
  }

  const last = rows.length - 1;
  const bot = rows[last] + tailClear(rows[last]) + scrollPark(rows);

  // How this frame OPENS. Normally cmd_exec's clear_bot for the
  // command that ran; but something may have positioned the cursor
  // there already - a repaint_hilite pass addresses the bottom row
  // itself, and jump_loc's far-back branch lclear()s - and then less
  // sends nothing at all
  const prefix = scrollPrefix;
  scrollPrefix = null;

  const opening = (): string =>
    prefix ?? (cmdExecOpened ? '' : clearBot());

  // A bare frame carries no prompt row, so its LAST row is content:
  // it ends with a newline like the others, and the shapes below
  // compare against the previous frame's content rows only.
  const promptless = bareFrame;

  // only the trailing `bot` goes: the rows still scroll, exactly as
  // less's forw() wrote them before it went back for more data
  const holdBot = heldPrompt && !promptless;

  // a -h-capped backward scroll repaints forward, like less's back()
  let capped = false;

  // less's G pos_clears: the overlap shapes below assume a live
  // position table and must not swallow its skipping repaint
  if (prev && !wasOpen && !unsquished && !posClear) {
    // The bare frame just painted these content rows and left the
    // cursor on the fresh bottom line; less writes the prompt there and
    // nothing else (forw, then currline, then prompt). Reprinting the
    // content here is what doubled every scrolled line.
    if (wasBare && !bareFrame && rows.length === prev.length + 1 &&
        prefixEqual(prev, rows)) {
      return holdBot ? '' : bot;
    }

    // and the mirror: a bare frame whose rows the screen already
    // shows has nothing to draw. less's forw()/back() write only the
    // rows they scroll in, so a command that moved NOTHING - a failed
    // search, say - paints nothing before its line-number walk. The
    // length mismatch alone would otherwise send it to a full repaint
    if (bareFrame && prev.length === rows.length + 1 &&
        prefixEqual(rows, prev)) {
      // and it does not spend the opening either: whatever carried it
      // is still waiting for the paint that follows. Nor does it count
      // as "a bare frame just painted these rows" - it left the cursor
      // where it was, so the prompt after it still needs its clear_bot
      scrollPrefix = prefix;
      prevBare = false;

      // the screen still shows the frame BEFORE this one, so that is
      // what the next frame has to diff against
      keepPrevRows = true;
      return '';
    }

    // only the bottom (prompt) line changed: less's clear_bot + reprint
    if (prev.length === rows.length) {
      let same = 0;
      while (same < last && rows[same] === prev[same]) same++;

      if (same === last) {
        // less's error() clear_bots itself (output.c:722), on top of the
        // clear_bot cmd_exec already did for the command that failed:
        // its bytes carry TWO before a message, and we carried one
        // less's error() clear_bots itself (output.c:722), on top of
        // the one cmd_exec did for the command that failed - unless
        // something already positioned the cursor there, which is
        // what a repaint_hilite pass leaves behind
        if (search.message) {

          // and no clear_eol after it: error() ends at the text, and
          // the lower_left + clear_eol that follows belongs to
          // get_return (output.c:731), which sends its own
          return opening() + clearBot() + rows[last] + scrollPark(rows);
        }

        const head = cmdInsertEcho(rows[last], buffer);

        if (head !== null) {
          const c = rows[last].slice(head.length);
          const echo = CLEAR_LINE + c + '\b'.repeat(c.length) + c;

          // less's start_mca runs when the command line OPENS, not per
          // character, so the FIRST key of an mca carries clear_bot
          // and the prompt string and the rest are the echo alone.
          // Comparing the prompt TEXT instead was right for a second
          // digit ("1" -> ":1" -> ":12") and wrong whenever the main
          // prompt already read ":" - a second N g dropped less's
          // "\r ESC[K :" entirely.
          return wasMca ? echo : clearBot() + head + echo;
        }

        // NOT opening(): a carried prefix belongs to the PAINT that
        // follows it. less's prompt() clear_bots only when the previous
        // action did NOT paint forward (command.c:993) - a search that
        // moved ran forw(), so the cursor is already parked at the
        // lower left repaint_hilite left it on and the prompt goes
        // straight there; a search that moved nothing never ran forw,
        // and less does clear_bot.
        // ...and cmd_exec has already put this frame's opening on the
        // terminal (command.c:124), so writing another blanks the
        // prompt row a second time per key - 6 clears against less's 3
        // on "jjj", and 6 against 4 scrolling the help. That second
        // blank IS the flicker.
        const open = (forwPrompt || cmdExecOpened) ? '' : clearBot();
        forwPrompt = false;
        return open + (holdBot ? '' : bot);
      }
    }

    // forward: the old content rows survive shifted up by k (k = 0
    // while a short screen is still filling); less clear_bots the
    // prompt row and prints only the new lines, letting the
    // terminal scroll (forw)
    for (let k = 0; k < prev.length - 1; k++) {
      const overlap = prev.length - 1 - k;
      if (promptless ? overlap > last : overlap >= last) continue;

      let ok = true;
      for (let i = 0; i < overlap; i++) {
        if (rows[i] !== prev[k + i]) { ok = false; break; }
      }
      if (!ok) continue;

      const appended = rows.slice(overlap, last);
      // -y caps the scroll before less repaints instead — except an
      // exact screenful, "since repainting itself involves
      // scrolling forward a screenful" (forw, forwback.c:244)
      if (optForwScroll() >= 0 && appended.length > optForwScroll() &&
          appended.length !== config.window - 1) {
        break;
      }

      // -c: forw() starts a NEW screen for a move of a screenful or
      // more (top_scroll && n >= sc_height-1, forwback.c:247), so it
      // never scrolls that far - it clears and homes instead
      if (optClearRepaint() && appended.length >= config.window - 1) break;

      if (promptless) {
        return opening() +
          rows.slice(overlap).map(r => r + rowEnd(r)).join('');
      }

      return opening() + appended.map(r => r + rowEnd(r)).join('') +
        (holdBot ? '' : bot);
    }

    // an exact-screenful advance: contiguous by position in less (the new
    // top is the old BOTTOM_PLUS_ONE), and exempt from -y since
    // "repainting itself involves scrolling forward a screenful"
    if (forwDist === prev.length - 1 && !optClearRepaint() &&
        rows.length === (promptless ? prev.length - 1 : prev.length)) {
      if (promptless) {
        return opening() + rows.map(r => r + rowEnd(r)).join('');
      }

      const appended = rows.slice(0, last);
      return opening() + appended.map(r => r + rowEnd(r)).join('') +
        (holdBot ? '' : bot);
    }

    // backward: k rows scrolled in at the top; less back()'s home +
    // reverse index per line, then lower_left before the prompt
    // a bare frame is one row shorter, so its rows line up against
    // the previous frame's CONTENT rows rather than all of them
    const backBase = promptless ? prev.slice(0, -1) : prev;

    // a whole-screen scroll is one row further on a bare frame,
    // whose last row is content rather than the prompt
    const span = promptless ? last + 1 : last;

    if (backBase.length === rows.length) {
      for (let k = 1; k <= span; k++) {
        // at k === span the two frames share no row at all, so only
        // the engine's count can prove the scroll; below that the
        // rows themselves still have to agree
        const overlap = k < span
          ? rows[k] === backBase[0] && shifted(backBase, rows, k)
          : k === backDist;

        if (overlap) {
          // less's get_back_scroll caps it: -h when set, a screen minus
          // two under -c, and no limit otherwise (forwback.c:535).
          // Past the cap back() sets do_repaint and repaint() paints
          // forward with the skipping marker — never the far-backward
          // clear + reverse paint
          if (k > backScrollCap()) {
            capped = true;
            break;
          }

          // less's cmd_exec clear_bots before back() starts inserting
          let frame = opening();
          for (let i = k - 1; i >= 0; i--) {
            frame += CURSOR_HOME + REVERSE_INDEX + rows[i] + revRowEnd(rows[i]);
          }

          // less lower_lefts and THEN clear_bots before the prompt on a
          // backward scroll (the forward one lands on a fresh line
          // the newline already cleared, so it needs no clear)
          if (promptless) {
            return frame + CURSOR_TO(config.window, 1) + clearBot();
          }

          return frame + CURSOR_TO(config.window, 1) + clearBot() +
            (holdBot ? '' : bot);
        }
      }
    }
  }

  const repaint = prev !== null || dumbPainted;
  const clearHome = optClearRepaint() || dumbHomePending;
  dumbHomePending = false;
  dumbPainted = true;

  // a bare frame's last row is content, so it ends with a newline
  // like every other row -- the prompt row it would otherwise be
  // does not scroll, and the skipping marker then survived on screen
  const body = (promptless ? rows : rows.slice(0, last))
    .map(r => r + rowEnd(r)).join('');

  // -c and the freeze-unlatching make_display (top_scroll forced)
  // clear and paint forward, like less's forw calling clear() + home().
  // The FIRST paint has no command behind it, so no clear_bot either -
  // term_init has just scrolled a whole screen in
  if (clearHome) {
    // a bare frame's rows ARE the body; appending bot printed its
    // last content row a second time
    return (repaint ? prefix ?? clearBot() : '') +
      CLEAR_SCREEN + CURSOR_HOME + body + (promptless || holdBot ? '' : bot);
  }

  // the first paint prints in place behind term_init's line_left CR,
  // which termInitTail has already written
  if (!repaint) return body + bot;

  // a backward far jump clear_bots (cmd_exec), clears, and paints
  // the rows in reverse through home + reverse index (jump_loc's
  // lclear + back)
  if (backJump && !capped) {
    let frame = clearBot() + CLEAR_SCREEN;

    // a bare frame's last row is CONTENT, so back() paints it too -
    // counting from `last - 1` there dropped less's topmost row
    for (let i = (promptless ? last : last - 1); i >= 0; i--) {
      frame += CURSOR_HOME + REVERSE_INDEX + rows[i] + revRowEnd(rows[i]);
    }

    frame += CURSOR_TO(config.window, 1) + clearBot();
    return promptless || holdBot ? frame : frame + bot;
  }

  // forward far jumps and repaints print less's skipping marker over
  // the cleared prompt row and scroll (repaint() without top_scroll);
  // trashed-screen repaints carry their own prefix instead of a
  // command's clear_bot. The rows still print without a full screen,
  // only the marker goes (forwback.c:272)
  return (prefix ?? clearBot()) +
    (fullScreen() && !firstOutput ? '...skipping...\n' : '') + body +
    (promptless || holdBot ? '' : bot);
}

/**
 * Joins dumb rows like less's pdone: a row that exactly fills the
 * screen width gets no newline (auto-margins wrap it), and a bottom
 * line following such a row starts with clear_bot's bare CR — which
 * a deferred-wrap terminal puts on the hanging row, overwriting it
 * like less.
 */
function joinDumb(plain: string[]): string {
  let out = '';

  for (let i = 0; i < plain.length; i++) {
    out += plain[i];
    if (i === plain.length - 1) break;

    if (visualWidth(plain[i]) < config.screenWidth) {
      out += '\n';
    } else if (i === plain.length - 2 && search.message) {
      // less's error() leads with clear_bot's CR, overwriting the
      // hanging row; a prompt appends directly instead (forw_prompt
      // skips clear_bot) and the deferred wrap moves it down a line
      out += '\r';
    }
  }

  return out;
}

// true once a dumb session painted, so a repaint after resetRender
// (^L) still shows less's skipping marker for identical content
let dumbPainted = false;

export function resetDumbPaint(): void {
  dumbPainted = false;
}

/**
 * Counts the dumb screen as painted, so the next full frame carries
 * less's "...skipping..." marker: a search executing before any paint
 * compresses less's paint-repaint sequence, whose final repaint is
 * always past first_time.
 */
export function markDumbPaint(): void {
  dumbPainted = true;
}

/**
 * Composes the full screen: the formatted content rows plus the bottom
 * prompt line (expanded prototype, input prompt or message).
 *
 * @param rawContent - The string content to display.
 * @param buffer - Array of buffer characters.
 * @returns The screen rows, top to bottom.
 */
export function screenRows(
  rawContent: string[],
  buffer: string[],
  open: boolean = false
): string[] {
  const content = formatContent(rawContent);

  // an open pipe fill has no prompt row yet, like less's initial forw;
  // the alt screen still owns a blank bottom row so the cursor parks
  // at less's lower left below the newest line (-X frames must not
  // gain a row: scrollFrame counts them)
  if (open) {
    if (!scrollMode()) content.push('');
    return content.join('\n').split('\n');
  }

  // less's lclear leaves rows it never redraws: back() drew fewer null
  // lines than the screen holds, and what is under them is the
  // CLEARED screen, not a tilde
  if (config.blankBelow > 0) {
    const keep = Math.max(content.length - config.blankBelow, 0);
    content.length = keep;
    while (content.length < config.window - 1) content.push('');
  }

  const prompt = getPrompt(rawContent);

  // an echoed prefix replaces the number echo, like less's cmd_reset;
  // a pending prefix owns the command line (less's A_PREFIX mca resets
  // cmdbuf first), so counted digits do not show behind it; a pipe
  // drain's blank line still owns the bottom row, cursor at less's
  // lower left
  if (prompt) {
    content.push(config.keyPrefix ? prompt : prompt + getBuffer(buffer));
  } else if (pipeDraining.active || pendingScroll.rows) {
    content.push('');
  }

  return content.join('\n').split('\n');
}

// park the cursor after the prompt row's content, like less's
// command-line position at the lower left; an open command buffer
// places it at the editing position instead
function parkCursor(rows: string[]): string {
  return CURSOR_TO(promptRow(rows), cursorCol(rows));
}

/** The prompt's PHYSICAL row, one up per row a NUL collapse ate. */
function promptRow(rows: string[]): number {
  return rows.length - nulCollapsed;
}

/** The parked cursor's 1-based column for the current frame. */
function cursorCol(rows: string[]): number {
  if (cmd.active) return Math.min(cmdCol() + 1, config.screenWidth);

  // a NUL collapse moves the prompt's ROW, never which row it is:
  // the prompt is the last row here whether or not one collapsed
  const last = rows[rows.length - 1];
  return Math.min(visualWidth(last) + 1, config.screenWidth);
}

function sameRows(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

// less reads these through ltgetstr, so LESS_TERMCAP_SUSPEND and
// LESS_TERMCAP_RESUME override them (screen.c:1596). They exist
// because the sequences are not in termcap/terminfo at all. We named
// them in a comment and then emitted our own pair unconditionally, so
// the override did nothing; our sync-update pair stays the DEFAULT.
const syncOn = (): string =>
  terminalCapability(null, 'SUSPEND') ?? TERMINAL_SUSPEND;
const syncOff = (): string =>
  terminalCapability(null, 'RESUME') ?? TERMINAL_RESUME;

/**
 * less's squished first paint (forw()'s `first_time && pos ==
 * NULL_POSITION && !top_scroll`): term_init has already left the
 * cursor on the BOTTOM line, and put_line writes each line followed by
 * a newline, so the terminal SCROLLS the short file up into place.
 *
 * Nothing is addressed and nothing is cleared. Painting the same
 * screen row by row from the top lands identically for ordinary text -
 * which is why the two agreed for so long - but not for content that
 * moves the cursor itself, and under -r it can: an ESC D in the file
 * scrolls the terminal too, and only the sequential paint carries that
 * through the way less does.
 *
 * @param rows - The padded window, blanks first, prompt last.
 * @param blanks - How many leading rows the pad added.
 */
function squishFrame(rows: string[], blanks: number): string {
  // the pad rows are never written - the terminal's own scrolling is
  // what puts them there - but they are still what a NUL collapse was
  // measured against, so the physical rows have to be taken the same
  // way fullFrame takes them
  const physical = collapseNulRows(rows);
  nulCollapsed = rows.length - physical.length;

  const bottom = physical[physical.length - 1] ?? '';
  let content = physical.slice(blanks, -1);

  // less draws one line per line it READ, and a zero-byte file has
  // none - forw_line returns EOF straight away. Our content array
  // still carries one synthetic empty row for such a file, and
  // drawing it would scroll a row that less never scrolls
  if (content.length === 1 && content[0] === '' &&
      (files.list[files.index]?.size ?? 0) <= 0) {
    content = [];
  }

  // less's prompt() skips clear_bot when the last action was a forward
  // movement, "since the forward movement guarantees that we're in
  // the right position" (command.c): every drawn line ends with a
  // newline, so the cursor is already at the start of the prompt row.
  // With nothing drawn, forw_prompt stays FALSE and the clear runs
  const bot = content.length ? '' : clearBot();

  // no leading CR: term_init already parked the cursor there
  return syncOn() +
    content.map(row => frameRowEnd(row) ? row + '\n' : row).join('') +
    bot + bottom + tailClear(bottom) + parkCursor(rows) + syncOff();
}

function fullFrame(rows: string[]): string {
  const physical = collapseNulRows(rows);
  nulCollapsed = rows.length - physical.length;

  const body = physical
    .map((row, i) => CLEAR_LINE + row +
      (i === physical.length - 1 ? '' : frameRowEnd(row)))
    .join('');

  // CLEAR_BELOW blanks the rows the collapse freed, like less's paint
  // ending early and clear_eos wiping what the screen still showed
  return syncOn() + CURSOR_HOME + body + CLEAR_BELOW + parkCursor(rows) +
    syncOff();
}

/**
 * The display-row distance the screen top moved since the last frame,
 * positive forward, like less comparing paint positions in jump_loc.
 *
 * @returns The signed distance, or null when it is unknown or larger
 *          than a screenful.
 */
function topDelta(src: string[], cap: number): number | null {
  if (!prevTopKnown) return null;

  const effRow = config.row - config.blankTop;
  const sign = effRow > prevTopRow ||
    (effRow === prevTopRow && config.subRow >= prevTopSub) ? 1 : -1;

  const [loRow, loSub, hiRow, hiSub] = sign > 0
    ? [prevTopRow, prevTopSub, effRow, config.subRow]
    : [effRow, config.subRow, prevTopRow, prevTopSub];

  let dist = -loSub;

  for (let r = loRow; r < hiRow; r++) {
    dist += chopLine() || config.col ? 1 : maxSubRow(src[r] ?? '') + 1;
    if (dist > cap) return null;
  }

  return sign * (dist + hiSub);
}

/**
 * Builds a minimal frame when the screen content only scrolled.
 *
 * - less's jump_loc picks scrolling by POSITION, never by matching
 *   screen text: only the shift matching the top's actual movement
 *   is considered, so repeated text (blank runs) cannot fake one.
 * - The bottom (prompt) row is excluded from shift matching and always
 *   redrawn, like less reprinting its prompt after scrolling.
 *
 * @returns The frame, or null when the change is not a pure scroll.
 */
function scrolledFrame(rows: string[], src: string[]): string | null {
  const prev = prevRows;
  const n = rows.length;

  if (!prev || prev.length !== n || n < 3) return null;

  // less derives the distance from its position table, which moves with
  // the file. config.row does the same for the array-backed core, but
  // the block-backed one moves its WINDOW and leaves config.row at 0,
  // so topDelta sees nothing and every scroll became a full repaint -
  // the same screen, so nothing caught it, until a physically drifted
  // screen (a wrapped prompt under -r) showed the repaint resetting
  // drift that less carries. The shift is still there to be read off the
  // rows, and shifted() below proves whichever k we pick.
  // topDelta is preferred - it is the POSITION arithmetic less uses -
  // but it can be confidently wrong. The block-backed engine slides
  // its WINDOW and leaves config.row at 0, so a backward step across a
  // wrapped line's boundary looks to it like subRow simply rising:
  // scrolling up from (row 0, sub 0) onto the previous 4-row line
  // reads as +3 FORWARD where the screen moved 1 row BACK. Non-zero
  // and wrong, so `||` never reached shiftDelta, the forward branch
  // failed its own check, and the whole screen was repainted - 1965
  // bytes where less sends 104, on every scroll that crosses a line.
  //
  // Both candidates are tried instead, in that order. Nothing is taken
  // on trust: each is put through the same rows[k] === prev[0] and
  // shifted() proof below, so a wrong delta simply does not verify and
  // the next one gets its turn.
  for (const delta of [topDelta(src, n), shiftDelta(rows, prev, n)]) {
    if (delta === null || delta === 0) continue;

    const frame = scrolledBy(delta, rows, prev, n);
    if (frame !== null) return frame;
  }

  return null;
}

/**
 * The frame for ONE candidate scroll distance, or null when the rows
 * do not actually bear it out.
 *
 * @param delta - Rows the top moved: positive forward, negative back.
 */
function scrolledBy(
  delta: number,
  rows: string[],
  prev: string[],
  n: number
): string | null {

  // scrolled forward: new rows show what was k rows lower; -y limits
  // how far the screen scrolls before repainting instead
  if (delta > 0) {
    const k = delta;

    if (k < n - 1 && rows[0] === prev[k] && shifted(rows, prev, k)) {
      if (optForwScroll() >= 0 && k > optForwScroll()) return null;

      // less never asks the terminal to scroll: forw() writes each new
      // line ON the bottom line - the prompt row, cleared by the
      // deferred clear_bot the first putchr triggers - and the
      // NEWLINE ending it scrolls the screen. Then prompt() writes
      // the prompt where the cursor already sits. Byte for byte:
      //   \r ESC[K  (line \r\n) x k  prompt ESC[K
      // less's forw() opens with the clear_bot cmd_exec already sent
      // (command.c:124) - it does not send a second. Ours did, so
      // every scroll key blanked the prompt row twice: 6 clears
      // against less's 3 on "jjj", 6 against 4 in the help. That extra
      // blank is the flicker.
      let frame = syncOn() + (cmdExecOpened ? '' : clearBot());

      for (let r = n - 1 - k; r < n - 1; r++) frame += rows[r] + '\n';

      // a bare frame's bottom row is the blank command line, and the
      // row the scroll just brought in is blank already - less writes
      // nothing for it
      const bottom = rows[n - 1];
      forwPrompt = !bottom;
      return frame + (bottom ? bottom + tailClear(bottom) : '') + syncOff();
    }

    return null;
  }

  // scrolled backward: new rows show what was k rows higher; -h is
  // the backward scroll limit
  const k = -delta;

  if (k < n - 1 && rows[k] === prev[0] && shifted(prev, rows, k)) {
    if (optBackScroll() >= 0 && k > optBackScroll()) return null;

    // back() is the mirror: home(), add_line() - a REVERSE INDEX,
    // which scrolls the screen down - then the line and its newline,
    // once per exposed row, newest first. Afterwards the cursor is
    // mid-screen, so less addresses the bottom row before its prompt.
    //   \r ESC[K  (ESC[H ESC M line \r\n) x k  ESC[24;1H \r ESC[K
    //   prompt ESC[K
    let frame = syncOn() + (cmdExecOpened ? '' : clearBot());

    for (let r = k - 1; r >= 0; r--) {
      frame += CURSOR_HOME + REVERSE_INDEX + rows[r] + '\n';
    }

    // The reverse index scrolls the WHOLE screen down, so the last
    // content row lands on the command line - less has the same leak and
    // wipes it in prompt(), whose clear_bot (command.c:993) runs
    // before the prompt text. Held, there is no prompt() to do it, and
    // the leaked row then sits there for the whole scroll. So the
    // clear is unconditional here, exactly as less's lower_left +
    // clear_bot pair is: it is what keeps that row blank, not the
    // prompt that usually follows it.
    //
    // The forward branch above needs none: forw() ends its rows with a
    // newline, and the row that scrolls in at the bottom is already
    // blank.
    const addressed = CURSOR_TO(promptRow(rows), 1) + clearBot();
    const bottom = rows[n - 1];

    if (!bottom) return frame + addressed + syncOff();

    return frame + addressed + bottom + tailClear(bottom) + syncOff();
  }

  return null;
}

/**
 * The scroll distance implied by the rows themselves: the smallest k
 * that turns the previous frame into this one. Only consulted when the
 * top's own arithmetic cannot answer.
 */
function shiftDelta(
  rows: string[],
  prev: string[],
  n: number
): number | null {
  for (let k = 1; k < n - 1; k++) {
    if (rows[0] === prev[k] && shifted(rows, prev, k)) return k;
  }

  for (let k = 1; k < n - 1; k++) {
    if (rows[k] === prev[0] && shifted(prev, rows, k)) return -k;
  }

  return null;
}

function shifted(top: string[], bottom: string[], k: number): boolean {
  for (let i = 0; i <= top.length - 2 - k; i++) {
    if (top[i] !== bottom[i + k]) return false;
  }

  return true;
}

/**
 * Paints a far-forward jump like less's forw() without top_scroll,
 * which the alt screen runs all the same: the prompt row clears,
 * "...skipping..." prints over it, and the new lines scroll in
 * (forwback.c:274) — except an exact-screenful advance, contiguous
 * by position (the new top is the old BOTTOM_PLUS_ONE), which
 * scrolls without the marker; a -y-capped scroll instead repaints
 * WITH it (do_repaint, forwback.c:244). Backward jumps and
 * same-position repaints keep the home repaint (less's make_display
 * forces top_scroll for those).
 *
 * @returns The frame, or null when this is not a forward jump.
 */
function skippedFrame(
  rows: string[],
  src: string[],
  posClear: boolean = false
): string | null {
  const prev = prevRows;
  const effRow = config.row - config.blankTop;

  // less guards: !first_time, full_screen, !is_filtering
  // the squished first paint stores one row per collapse MORE than
  // the window (its loss is absorbed at the top), so require a full
  // screen on both sides rather than an exact match
  if (!prev || session.lastFilter || !fullScreen() ||
      prev.length < config.window || rows.length < config.window) {
    return null;
  }

  // less's G paints skipping through its pos_clear no matter the
  // direction or distance — the position table looks empty
  // less prints the marker only when it is NOT drawing the first
  // screen of output (forwback.c:272 tests !first_time)
  let marker = firstOutput ? '' : '...skipping...\n';

  if (!posClear) {
    if (prevTopRow < 0 || config.blankTop) return null;

    if (effRow < prevTopRow ||
        (effRow === prevTopRow && config.subRow <= prevTopSub)) {
      return null;
    }

    // the display-row distance the top advanced, like less comparing
    // the paint position against position(BOTTOM_PLUS_ONE)
    let dist = -prevTopSub;
    const cap = prev.length + 1;

    for (let r = prevTopRow; r < effRow && dist <= cap; r++) {
      dist += maxSubRow(src[r] ?? '') + 1;
    }

    dist += config.subRow;

    const screenful = prev.length - 1;
    const capped = optForwScroll() >= 0 && dist > optForwScroll() &&
      dist !== screenful;

    if (dist < screenful && !capped) return null;
    if (dist === screenful) marker = '';
  }

  // a bottom-anchored paint scrolls its rows up from the last line,
  // so a collapsed row costs a scroll, not the prompt's row: the
  // prompt still lands on the bottom and nothing drifts
  const physical = collapseNulRows(rows);
  nulCollapsed = 0;

  const last = physical.length - 1;
  const body = physical.slice(0, last).map(r => r + rowEnd(r)).join('');

  // less prints the marker with a bare putstr at the cursor
  // (forwback.c:274). A normal command has already cleared the
  // bottom line by then, but an option prompt's echo has not, so the
  // marker lands after it: "-...skipping..."
  const head = marker && shownBottomEcho ? '' : '\r' + CLEAR_LINE;

  return syncOn() + head + marker + body +
    physical[last] + tailClear(physical[last]) + parkCursor(rows) +
    syncOff();
}

/**
 * Calculates the last content row and sub-row that fits in the current window.
 * 
 * - Works backwards from the end of content.
 * - Accounts for wrapped lines that span multiple screen rows.
 * 
 * @param content - The full array of content lines.
 * @returns Object containing the last visible row index and sub-row offset.
 */
export function getLastRow(content: string[]): {
  lastRow: number,
  lastSubRow: number
} {
  // less's jump_forw puts the file's LAST LINE on the bottom screen line
  // and lets jump_loc fill upward from there (jump.c:62), so the anchor
  // is a back_line walk, not a sum. Counting whole-line rows instead
  // needed a correction whenever the walk reached a top that sits
  // part-way into a row, since such a line paints fewer rows than its
  // boundary grid holds; a walk simply steps and never miscounts.
  let row = Math.max(content.length - 1, 0);
  let at = lastRowStart(content[row] ?? '');
  let steps = config.window - 2;

  while (steps > 0) {
    if (at > 0) {
      at = rowStartBelow(content[row] ?? '', at);
      steps--;
      continue;
    }

    if (row <= 0) break;

    row--;
    at = lastRowStart(content[row] ?? '');
    steps--;
  }

  return { lastRow: row, lastSubRow: subRowAt(content[row] ?? '', at) };
}

/**
 * Recalculates the EOF anchor position for the current window size.
 *
 * - Stores the last window-fitting row and sub-row in `config`.
 * - Sets `mode.EOF` when the whole content already fits the window.
 *
 * @param content - The full array of content lines.
 */
export function calculateEOF(content: string[]): void {
  const { lastRow, lastSubRow } = getLastRow(content);
  config.endRow = lastRow;
  config.endSubRow = lastSubRow;

  // less answers "is the end displayed" from ONE place - eof_displayed
  // reads position(BOTTOM_PLUS_ONE) off the position table
  // (forwback.c:95). We had two answers: this one, derived from
  // whether the CONTENT ARRAY fits a screen, and the source engine's
  // own sync(), derived from the file. For a source engine the array
  // is a materialized window of several screens, so this one is
  // always "no" and silently overwrote the correct answer.
  //
  // Four separate bugs came from that single mismatch before it was
  // named: --past-eof reaching only one engine (74f75b8), a resize
  // clearing the flag (e12e089), a horizontal shift not re-deriving
  // it (728fd51), and G under an & filter (54cd68b). The engine owns
  // the flag whenever one is attached; the anchors above are still
  // wanted by both.
  if (hook.sourceLineCount !== null) return;

  mode.EOF = lastRow === 0 && (chopLine() || lastSubRow === 0);
}

/**
 * Returns the prompt string to be shown at the bottom of the screen.
 *
 * - Input prompts and messages take precedence; otherwise the -P
 *   prototype for the current -m/-M style expands like less, falling
 *   back to `:` when it comes out empty.
 *
 * @param content - Display lines, for prompt expansion.
 * @returns The prompt string.
 */
export function getPrompt(content: string[]): string {
  // only the branches below that paint less's display_prompt re-arm
  // the --end-prompt marker
  promptPainted = false;


  // during a pipe drain less leaves the command line blank for G and
  // shows ierror's interruptible note for % (jump.c/output.c), and
  // a forward move blocked in forw_line waits behind its command's
  // clear_bot the same way; a 4s data stall prints ch.c's
  // wait_message over any of them — less's last ixerror owns the
  // bottom line
  if (pipeDraining.active || pendingScroll.rows) {
    if (session.pipeWaiting) {
      return colored('prompt',
        prExpand(content, wProto()) +
          `... (${prChar(optIntrChar())} or interrupt to abort)`,
        INVERSE_ON, INVERSE_OFF);
    }

    return pipeDraining.active && pipeDraining.note
      ? colored('error',
        pipeDraining.note + '... (interrupt to abort)',
        INVERSE_ON, INVERSE_OFF)
      : '';
  }

  const inputPrompt = searchPrompt();
  if (inputPrompt !== null) return inputPrompt;

  // the binary file question replaces the prompt, like less's query
  if (binaryConfirm.pending) {
    return `"${binaryConfirm.path}" may be a binary file.  ` +
      'See it anyway? ';
  }

  // and the same shape for a search the host engine could not finish:
  // the pattern is not wrong, the engine asked for cannot get through
  // it, and the one that can is right here
  if (posixRetry.pending) {
    return 'Pattern too complex.  Try again with POSIX RegExp? ';
  }

  if (option.pending) {
    if (option.spec) {
      return (option.spec.prompt ?? '') +
        (cmd.active ? cmdDisplay() : option.param);
    }

    // ^P shows "(P)" and -+/-! their flag, like less's mca_opt_toggle
    const marks = (option.noPrompt ? '(P)' : '') + option.flag;

    if (option.name !== null) {
      return option.pending + option.pending + marks +
        (cmd.active ? cmdDisplay() : option.name);
    }

    return option.pending + marks;
  }

  if (pipeMark.pending) {
    const which = pipeMark.stage === 'first' ? 'first '
      : pipeMark.stage === 'second' ? 'second ' : '';

    // ^N swaps the mark prompt for line-number entry, like v707
    return pipeMark.lineMode
      ? `|${which}line number: ` + pipeMark.num
      : `|${which}mark: `;
  }

  if (miscInput.pending) {
    // the pipe command reuses the shell prompt, like less's
    // start_mca(A_PIPE, "!", ...); the buffer renders its own carets
    return miscPromptLabel(miscInput.pending) + cmdDisplay();
  }

  if (overwrite.pending) {
    return overwrite.reminder
      ? 'Overwrite, Append, Don\'t log, or Quit? (Type "O", "A", "D" or "Q") '
      : `Warning: "${overwrite.file}" exists; ` +
        'Overwrite, Append, Don\'t log, or Quit? ';
  }

  if (brackets.pending) return 'Brackets: ' + brackets.chars;

  if (marks.pending === 'm' || marks.pending === 'M') return 'set mark: ';
  if (marks.pending === "'") return 'goto mark: ';
  if (marks.pending === 'c') return 'clear mark: ';

  if (examine.pending) return 'Examine: ' + cmdDisplay();

  // pending multi-key prefix, echoed like less's A_PREFIX: the mca
  // opens with a " " prompt and every held char goes through prchar
  // (command.c:2506), which spells the escape character "ESC"
  // (charset.c:533) - so a half-read arrow shows " ESC", then " ESCO"
  if (config.keyPrefix) {
    return ' ' + Array.from(config.keyPrefix, prChar).join('');
  }

  if (search.message) {
    return colored('error', search.message + '  (press RETURN)',
      INVERSE_ON, INVERSE_OFF);
  }

  // a stalled initial fill shows less's wait_message the same way
  // (ch.c ixerror while the blocked read polls)
  if (session.pipeWaiting) {
    return colored('prompt',
      prExpand(content, wProto()) +
        `... (${prChar(optIntrChar())} or interrupt to abort)`,
      INVERSE_ON, INVERSE_OFF);
  }

  // the F command waits with the -Pw prompt plus ixerror's suffix,
  // naming the --intr char: "... (^X or interrupt to abort)"
  if (follow.active) {
    return colored('prompt',
      prExpand(content, wProto()) +
        `... (${prChar(optIntrChar())} or interrupt to abort)`,
      INVERSE_ON, INVERSE_OFF);
  }

  // less's ':' carries AT_NORMAL|AT_COLOR_PROMPT: colored under
  // --use-color, never standout (command.c:1007)
  if (mode.BUFFERING) return colored('prompt', ':');

  if (mode.HELP) {
    const helpPrompt = transformPrompt(prExpand(content, hProto()));
    promptPainted = true;

    return colored(
      'prompt',
      helpPrompt.slice(
        Math.max(helpPrompt.length - config.screenWidth + 2, 0)
      ),
      INVERSE_ON,
      INVERSE_OFF
    );
  }

  // the bottom line expands the -P prototype of the -m/-M style; the
  // short prompt shows a new file's name once (?n) and the (END)
  // marker with the next file, like s_proto
  // less hands pr_string's result to load_line, which pappends it like
  // any file line: tabs reach their stops and control chars take
  // caret notation rather than the terminal (command.c:1027)
  const text = transformPrompt(prExpand(content, prProto(displayPrType())));
  if (files.newFile) files.newFile = false;

  promptPainted = true;

  // less marks a filtered session on the prompt line: prompt() writes
  // "& " plain and loads the prompt itself two columns in
  // (command.c:1019), so the marker never takes the standout
  const amp = search.filters.length ? '& ' : '';

  if (!text) return amp + colored('prompt', ':');

  // load_line colours the prompt standout only when the line carries
  // no ANSI sequences of its own (line.c:1950): a -P prototype with
  // escapes in it keeps its own attributes instead
  if (promptHasAnsi(text)) return amp + clipPrompt(text, amp.length);

  return amp +
    colored('prompt', clipPrompt(text, amp.length), INVERSE_ON, INVERSE_OFF);
}

/**
 * Truncates the BEGINNING of an overlong prompt so its tail fits the
 * screen minus one reserved column, like less's load_line shifting the
 * head off (line.c:1924). Error messages are never clipped - less
 * prints those full and lets them trash the screen.
 */
function clipPrompt(text: string, indent: number = 0): string {
  // under -r less counts no widths at all: fits_on_screen returns TRUE
  // outright for ctldisp == OPT_ON ("We're not counting, so say that
  // everything fits", line.c), so load_line's hshift loop breaks on
  // its first pass and the prompt is never truncated - it just wraps,
  // scrolling the screen, which is part of what -r's documented
  // "display may be messed up" means
  if (optCtldisp() === 1) return text;

  // load_line reserves ONE column of less's sc_width (command.c:1027).
  // sc_width is the terminal's width: the -N/-J gutter is added by
  // plinenum, per content line, and never comes out of the prompt's
  // room. config.screenWidth already has it subtracted, so asking it
  // here clipped the prompt by a whole gutter
  const max = fullScreenWidth() - 1 - indent;
  if (text.length <= max && !isStyled(text)) return text;
  if (visualWidth(text) <= max) return text;

  const chars = [...text];
  let width = visualWidth(text);
  let i = 0;

  while (i < chars.length && width > max) {
    width -= visualWidth(chars[i]);
    i++;
  }

  return chars.slice(i).join('');
}

/**
 * Renders a key in printable form like less's prchar: control characters
 * in caret notation, ESC as `ESC`.
 *
 * @param char - Single character to render.
 */


/**
 * Trims the buffer to fit within the screen width.
 *
 * - If too long, trims equally from the start to keep the tail visible.
 *
 * @param buffer - Array of buffer characters.
 * @returns The buffer as a string, trimmed if necessary.
 */
function getBuffer(buffer: string[]): string {
  const width = fullScreenWidth() - 1;
  const halfWidth = Math.floor(width / 2);

  return buffer.slice(halfWidth * config.bufferOffset).join('');
}

/**
 * Calculates visible characters in the buffer.
 *
 * @param bufferLength - Total buffer character count.
 * @returns Number of visible characters based on offset.
 */
function visibleBufferLength(bufferLength: number): number {
  const width = fullScreenWidth() - 1;
  const halfWidth = Math.floor(width / 2);
  return bufferLength - halfWidth * config.bufferOffset;
}

/**
 * Pads remaining window space with `~` lines or an `(END)` marker.
 *
 * @param lines - The array of formatted lines to pad.
 */
// how many trailing rows the last frame padded past the end of the
// file. less needs no such count: those rows simply have no entry in the
// position table, and everything that walks the screen skips them
let padRows = 0;

function padToEOF(lines: string[]): void {
  padRows = 0;

  // less's gline draws a null line as "~" or "" by the twiddle flag, so
  // -~ pads with blank rows and the prompt keeps the bottom line
  if (!mode.INIT && config.window - lines.length > 1) {
    const rows = config.window - lines.length - 1;
    padRows = rows;

    // one self-contained row per tilde, like the blankTop pad above
    // and like less attributing every null line it draws. A single
    // wrapped block would leave the attribute on the first row and
    // the reset on the last, so identical rows would carry DIFFERENT
    // strings depending on where they sat — and the scroll paints,
    // which recognize a shift by row text, could never match one
    const tilde = optTildes()
      ? colored('tilde', '~', BOLD_ON, BOLD_OFF)
      : '';

    for (let i = 0; i < rows; i++) lines.push(tilde);
  }

  if (mode.INIT && lines.length === config.window - 1) mode.INIT = false;
}
