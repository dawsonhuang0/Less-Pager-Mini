import fs from 'fs';

import { config, mode } from './config';

import { chopLongLines } from './lines/chopLongLines';
import { wrapLongLines } from './lines/wrapLongLines';

import { maxSubRow, visualWidth } from './lines/helpers';

import { search, searchPrompt, statusColChar } from './features/searching';

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
  gutterWidth,
  chopLine
} from './options';

import { prExpand, prProto, hProto, wProto } from './features/prompt';

import { colored } from './features/color';

import { cmd, cmdCol, cmdDisplay } from './features/cmdbuf';

import { follow } from './features/follow';

import { brackets, marks, markAtRow } from './features/jumping';

import { files, examine, binaryConfirm, pipeDraining, sizeIsKnown }
  from './features/files';

import { session } from './session';

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
  CLEAR_BELOW,
  CLEAR_SCREEN,
  REVERSE_INDEX,
  SCROLL_UP,
  SCROLL_DOWN,
  CURSOR_TO,
  SYNC_ON,
  SYNC_OFF
} from './constants';

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
 * @param preserveFormat - Whether to keep original formatting.
 * @returns - Array of strings representing the input.
 */
export function inputToString(
  input: unknown,
  preserveFormat: boolean
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
      return JSON
        .stringify(input, null, preserveFormat ? 0 : config.indentation)
        .split('\n');
  }

  return [];
}

/**
 * Builds the left gutter for a display row: the -J status column and
 * the -N line number field. Empty when neither option is on.
 *
 * @param content - Display lines.
 * @param row - The content row of this display row.
 * @param lineStart - False for a wrapped line's continuation rows.
 */
export function gutterFor(
  content: string[],
  row: number,
  lineStart: boolean
): string {
  let gutter = '';

  if (optStatusCol()) {
    let char = ' ';
    let kind: 'mark' | 'attn' | 'search' | '' = '';

    if (lineStart) {
      // og's plinestart: the mark letter in the M color, else an
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
      const match = statusColChar(content[row], row);

      if (match) {
        char = match;
        kind = 'search';
      }
    }

    // og attributes only the status char; the padding stays normal
    gutter += (kind
      ? colored(kind, char, INVERSE_ON, INVERSE_OFF)
      : char) + ' '.repeat(Math.max(optStatusColWidth() - 1, 0));
  }

  if (optLinenums() === 2) {
    // --no-number-headers blanks the header lines' numbers (0)
    const num = lineStart ? vlinenum(row + 1) : 0;

    gutter += num
      ? colored('linenum', String(num).padStart(optLinenumWidth())) + ' '
      : ' '.repeat(optLinenumWidth() + 1);
  }

  return gutter;
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
  // og's command loop calling draw_target_attn on every display
  const target = optHiliteTarget() && sindex !== undefined &&
    sindex === jumpSindex();
  const marked = optStatusLine() && markAtRow(row) !== '';

  // with -J the attn line marks in the status column instead of
  // standing out, like og's is_hilited_attr checking !status_col
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

  // og underlines the target line without color; attn and marks
  // stand out
  return kind === 'target'
    ? colored(kind, text, UNDERLINE_ON, UNDERLINE_OFF)
    : colored(kind, text, INVERSE_ON, INVERSE_OFF);
}

// the second of the last eof/bof bell, like og rate limiting eof_bell
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

  if (kind === 'eof') {
    const now = Math.floor(Date.now() / 1000);
    if (now === lastEofBell) return;
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

  process.stdout.write('\x07');
}

/**
 * Flashes the screen with ~100ms of reverse video, like og's vbell
 * writing the terminfo flash capability.
 */
function visualBell(): void {
  // a dumb terminal has no flash capability, like og's empty vb
  if (optNoVbell() || mode.DUMB) return;

  process.stdout.write('\x1B[?5h');
  setTimeout(() => process.stdout.write('\x1B[?5l'), 100);
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
export function formatContent(content: string[]): string[] {
  const lines: string[] = [];

  // rows above BOF from a forced back or a bracket jump are og null
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

  padToEOF(lines);
  return overlayHeaderLines(content, lines);
}

/**
 * Replaces the top screen rows with the --header lines, like less's
 * overlay_header: rendered from the header start row without horizontal
 * shift, the last one underlined unless the screen top sits exactly at
 * the header start (no gap below it).
 *
 * @param content - Full content lines.
 * @param lines - The formatted screen lines.
 * @returns The screen lines with the header rows in place.
 */
function overlayHeaderLines(content: string[], lines: string[]): string[] {
  const header = optHeader();
  if (header.lines <= 0 || mode.HELP) return lines;

  const saved = {
    row: config.row,
    subRow: config.subRow,
    col: config.col,
    blankTop: config.blankTop,
    window: config.window,
  };

  config.row = header.start;
  config.subRow = 0;
  config.col = 0;
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

  const seamless = saved.row === header.start && saved.subRow === 0 &&
    saved.blankTop === 0;

  for (let i = 0; i < header.lines && i < flat.length; i++) {
    let row = colored('header', rows[i] ?? '');

    if (i === header.lines - 1 && !seamless) {
      // inner resets would drop the underline for the rest of the row
      row = UNDERLINE_ON +
        row.split(STYLE_RESET).join(STYLE_RESET + UNDERLINE_ON) +
        UNDERLINE_OFF;
    }

    flat[i] = row;
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
  if (visibleBufferLength(buffer.length) + 1 === config.screenWidth - 1) {
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
 */
export function resetRender(): void {
  prevRows = null;
  prevCursorCol = -1;
  prevTopRow = -1;
  prevTopSub = 0;
  scrollOpen = false;
  promptAtBottom = false;
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
// bottom line, like og's error() drawing the message over the
// untouched screen: get_return ungets the dismissing key, so the mca
// it starts never reaches the prompt()/make_display that repaints the
// trashed screen — repeated toggles keep the stale rows until a
// render with no message and no option prompt open finally repaints
let frozenFrame = false;

// the unlatching repaint is og's make_display with top_scroll forced,
// which a dumb terminal shows as clear+home instead of "...skipping"
let frozenHome = false;
let dumbHomePending = false;

export function freezeFrame(homeOnUnfreeze: boolean = false): void {
  frozenFrame = true;
  frozenHome = homeOnUnfreeze;
}

// --incsearch repaints while the pattern is typed (og's mca_search
// jumping to the match), which clears the pending trash
export function unfreezeFrame(): void {
  frozenFrame = false;
}

/**
 * Seeds the previous frame as a blank screen, so frozen frames show
 * og's unpainted display while startup ungot commands (the errmsgs
 * gate key, +cmds) collect input before the first make_display.
 */
export function seedBlankFrame(): void {
  prevRows = new Array(config.window).fill('');
  prevCursorCol = -1;
}

export function render(rawContent: string[], buffer: string[]): void {
  // og's error() runs squish_check first (unless --old-bot): a
  // message over a squished short first paint repaints the whole
  // screen, tildes and all, before showing (output.c:719)
  if (mode.INIT && search.message && !optOldBot()) mode.INIT = false;

  // a still-filling first screen of a pipe paints its lines bare in
  // scroll mode, like og's initial forw: the prompt appears only
  // with the screenful or the learned length — or as the wait
  // message when the read stalls (pipeFilling(), inlined: importing
  // features/pipe here would run its module body too early)
  const filling = scrollMode() && session.pipeStream !== null &&
    session.pipeFirstFill && !session.pipeProbing && !sizeIsKnown() &&
    !session.pipeWaiting;

  let rows = screenRows(rawContent, buffer, filling);

  if (frozenFrame) {
    // og's prompt() returns early on ungot input and MCA_MORE loops
    // without reaching it, so the stale rows survive any message,
    // prompt or echo on the bottom line; only a render back at the
    // true prompt runs make_display's repaint
    const atPrompt = !search.message && !option.pending && !search.input &&
      !examine.pending && !miscInput.pending && !brackets.pending &&
      !marks.pending && !mode.BUFFERING && !config.keyPrefix;

    if (atPrompt) {
      frozenFrame = false;
      if (frozenHome) dumbHomePending = true;
      frozenHome = false;
    } else if (prevRows) {
      rows = [...prevRows.slice(0, -1), rows[rows.length - 1]];
    }
  }

  // og (v618+) starts at the lower left of the alt screen and lets
  // the first paint scroll upward: a short first screen sits just
  // above the bottom prompt, its blank rows on top; -X never homes,
  // so a short first screen prints in place (og's squished screen)
  if (mode.INIT && !mode.DUMB && !optNoInit() &&
      rows.length < config.window) {
    rows.unshift(...Array(config.window - rows.length).fill(''));
  }

  // nothing changed (e.g. scrolling against BOF/EOF): leave the screen
  // and the parked cursor untouched, like less — but arrow movement
  // inside the command buffer must still move the cursor
  if (prevRows && sameRows(prevRows, rows)) {
    // og reprints the prompt through clear_bot on every command;
    // with --old-bot the first reprint after a forw_prompt visibly
    // jumps it from mid-screen to the bottom row, stale copy behind
    if (scrollMode() && optOldBot() && !promptAtBottom && !filling) {
      process.stdout.write(
        clearBot() + rows[rows.length - 1] + CLEAR_LINE + scrollPark(rows)
      );
      return;
    }

    const col = cmd.active && !mode.DUMB ? cursorCol(rows) : -1;

    if (col >= 0 && col !== prevCursorCol) {
      prevCursorCol = col;
      // -X owns no absolute rows: rewrite the prompt line in place
      // and backspace to the editing position, like og's cmdbuf
      process.stdout.write(scrollMode()
        ? '\r' + CLEAR_LINE + rows[rows.length - 1] + scrollPark(rows)
        : CURSOR_TO(rows.length, col));
    }

    return;
  }

  if (mode.DUMB) {
    const frame = dumbFrame(prevRows, rows);
    prevRows = rows;
    process.stdout.write(frame);
    return;
  }

  // -X stays on the main screen, where og's real paint model shows
  if (scrollMode()) {
    const frame = scrollFrame(prevRows, rows, filling);
    prevRows = rows;
    prevCursorCol = cmd.active ? cursorCol(rows) : -1;
    process.stdout.write(frame);
    return;
  }

  // -c repaints instead of scrolling
  const frame = (optClearRepaint() ? null : scrolledFrame(rows)) ??
    fullFrame(rows);

  prevRows = rows;
  prevCursorCol = cmd.active ? cursorCol(rows) : -1;
  process.stdout.write(frame);
}

/**
 * Repaints for a terminal without cursor addressing, like og drawing
 * with the dumb entry's caps: attribute strings are empty (styles
 * stripped; og's default caret mode never emits raw file escapes
 * either) and nothing is ever erased.
 *
 * - A bottom-line change overwrites in place after a bare `\r`; a
 *   shorter line leaves the old tail visible, like og without `el`.
 * - A forward scroll prints only the newly exposed lines and the
 *   prompt, letting the terminal scroll.
 * - Anything else repaints behind the dumb `clear` of two newlines.
 */
function dumbFrame(prev: string[] | null, rows: string[]): string {
  const plain = rows.map(row => row.replace(STYLE_REGEX_G, ''));
  const last = plain.length - 1;

  if (prev && prev.length === plain.length) {
    const prevPlain = prev.map(row => row.replace(STYLE_REGEX_G, ''));

    let same = 0;
    while (same < last && plain[same] === prevPlain[same]) same++;

    // only the bottom (prompt) line changed
    if (same === last) return '\r' + plain[last];

    // scrolled forward: the old rows moved up by k
    for (let k = 1; k < last; k++) {
      if (plain[0] === prevPlain[k] && shifted(plain, prevPlain, k)) {
        return '\r' + joinDumb(plain.slice(last - k));
      }
    }
  }

  // the first paint just prints, like og's initial forw; a later
  // full paint is repaint()'s non-contiguous forw, which without
  // top_scroll prints "...skipping..." — only -c or a trashed
  // make_display (top_scroll forced) clears with two newlines and
  // hardcopy home's visible |-overstruck-^ marker ("|\b^"); every
  // paint leads with lower_left's bare CR
  const repaint = prev !== null || dumbPainted;
  const clearHome = optClearRepaint() || dumbHomePending;
  dumbHomePending = false;
  dumbPainted = true;

  return '\r' +
    (repaint ? (clearHome ? '\n\n|\b^' : '...skipping...\n') : '') +
    joinDumb(plain);
}

/** True when -X keeps the pager on the main screen with og's
 *  scroll-model painting (a dumb terminal keeps its own painter). */
const scrollMode = (): boolean => !mode.DUMB && optNoInit();

/**
 * og's clear_bot: erase from the left of the current (prompt) line,
 * or jump to the physical bottom row first with --old-bot
 * (screen.c's lower_left vs line_left).
 */
export function clearBot(): string {
  // whatever prints next sits on the bottom row under --old-bot
  promptAtBottom = true;
  return (optOldBot() ? CURSOR_TO(config.window, 1) : '\r') + CLEAR_LINE;
}

// og's forw_prompt leaves the prompt directly after forward-painted
// lines, possibly mid-screen; --old-bot's next clear_bot then visibly
// jumps it to the bottom row. og reprints the prompt through
// clear_bot on every command — we compress identical reprints away,
// except that first old-bot jump, which changes the screen.
let promptAtBottom = false;

// true while the last scroll-mode frame was an open pipe fill:
// og's initial forw prints arriving lines bare, and the prompt
// waits for the screenful or the learned length (forw_prompt)
let scrollOpen = false;

function prefixEqual(prev: string[], rows: string[]): boolean {
  for (let i = 0; i < prev.length; i++) {
    if (rows[i] !== prev[i]) return false;
  }

  return true;
}

/**
 * Ends a painted row like og's pdone: a row that exactly fills the
 * width gets no newline — og forces the deferred wrap with space +
 * backspace instead (line.c), so the terminal's auto-wrap carries
 * to the next row without doubling.
 */
function rowEnd(row: string): string {
  const plain = row.replace(STYLE_REGEX_G, '');
  return visualWidth(plain) >= config.screenWidth ? ' \b' : '\n';
}

// og's cursor rests where the prompt print ended; editing inside the
// command buffer moves it left with backspaces, like cmdbuf's putbs —
// -X can't address the prompt row absolutely (the screen may have
// started mid-terminal and never filled)
function scrollPark(rows: string[]): string {
  if (!cmd.active) return '';

  const plain = rows[rows.length - 1].replace(STYLE_REGEX_G, '');
  const back = visualWidth(plain) - cmdCol();
  return back > 0 ? '\b'.repeat(back) : '';
}

// the top of the last scroll-mode frame, so far paints know their
// direction like og's jump_loc comparing pos against position(TOP)
let prevTopRow = -1;
let prevTopSub = 0;

// og's trashed-screen repaints print from wherever the cursor sits:
// only a command's cmd_exec adds a clear_bot before them. This
// overrides that prefix — term_init's bare CR after a screen
// re-entry (shell return), or nothing at all when quitting the help
// file re-edits the input (no cmd_exec clear_bot reaches the screen).
let scrollPrefix: string | null = null;

// whether the last scroll-mode frame was still squished (mode.INIT)
let prevInit = false;

/** Marks the next scroll-mode paint as a fresh screen entry. */
export function screenEntered(): void {
  scrollPrefix = '\r';
}

/** Marks the next scroll-mode paint as a bare re-edit repaint. */
export function markBareRepaint(prefix: string = ''): void {
  scrollPrefix = prefix;
}

/** Forces the next full paint to clear and home, like og's forw
 *  with top_scroll (also jump_loc's !full_screen lclear). */
export function markClearHome(): void {
  dumbHomePending = true;
}

/**
 * Paints like og on the main screen for -X (no-init): og never
 * redraws frames in place — forw() prints the new lines and lets the
 * terminal scroll, back() inserts rows with home + reverse index
 * (painted nearest-first), and far jumps either print
 * "...skipping..." and scroll (forward and plain repaints, forw
 * without top_scroll) or clear and paint backward (jump_loc's
 * lclear + back for targets above the screen). The alt screen hides
 * this model behind our full frames; the main screen preserves the
 * scrollback, so these shapes match og's bytes.
 */
function scrollFrame(
  prev: string[] | null,
  rows: string[],
  open: boolean = false
): string {
  const effRow = config.row - config.blankTop;
  const backJump = prevTopRow >= 0 && (effRow < prevTopRow ||
    (effRow === prevTopRow && config.subRow < prevTopSub));
  prevTopRow = effRow;
  prevTopSub = config.subRow;

  // a squished screen unlatching is og's squish_check calling
  // repaint(): the tilde pad rows appear through the full skipping
  // paint, never as an appended forward scroll
  const unsquished = prevInit && !mode.INIT;
  prevInit = mode.INIT;

  const wasOpen = scrollOpen;
  scrollOpen = open;

  // a clearBot() in any shape below overrides this to the bottom row
  promptAtBottom = rows.length >= config.window;

  // an open pipe fill prints only its newly arrived lines, bare
  if (open) {
    dumbPainted = true;
    promptAtBottom = false;

    if (prev) {
      // a closed wait frame parked og's message on the bot row;
      // resuming data clear_bots it and prints there (og capture:
      // "\r ESC[K 3" over the wait message)
      const base = wasOpen ? prev : prev.slice(0, -1);

      if (rows.length >= base.length && prefixEqual(base, rows)) {
        const appended = rows.slice(base.length).map(r => r + rowEnd(r)).join('');
        return (wasOpen ? '' : clearBot()) + appended;
      }
    }

    return '\r' + rows.map(r => r + rowEnd(r)).join('');
  }

  // the fill completed: remaining lines print, then og's forw_prompt
  // appends the prompt with no clear_bot — under --old-bot it stays
  // right there, mid-screen, until the next command's clear_bot; the
  // stall's wait message instead arrives like og's ixerror, behind a
  // clear_bot and without the prompt's trailing clear
  if (wasOpen && prev) {
    const grown = rows.slice(0, -1);

    if (grown.length >= prev.length && prefixEqual(prev, grown)) {
      const tail = session.pipeWaiting
        ? clearBot() + rows[rows.length - 1]
        : rows[rows.length - 1] + CLEAR_LINE + scrollPark(rows);

      return grown.slice(prev.length).map(r => r + rowEnd(r)).join('') + tail;
    }
  }

  const last = rows.length - 1;
  const bot = rows[last] + CLEAR_LINE + scrollPark(rows);

  // a -h-capped backward scroll repaints forward, like og's back()
  let capped = false;

  if (prev && !wasOpen && !unsquished) {
    // only the bottom (prompt) line changed: og's clear_bot + reprint
    if (prev.length === rows.length) {
      let same = 0;
      while (same < last && rows[same] === prev[same]) same++;
      if (same === last) return clearBot() + bot;
    }

    // forward: the old content rows survive shifted up by k (k = 0
    // while a short screen is still filling); og clear_bots the
    // prompt row and prints only the new lines, letting the
    // terminal scroll (forw)
    for (let k = 0; k < prev.length - 1; k++) {
      const overlap = prev.length - 1 - k;
      if (overlap >= last) continue;

      let ok = true;
      for (let i = 0; i < overlap; i++) {
        if (rows[i] !== prev[k + i]) { ok = false; break; }
      }
      if (!ok) continue;

      const appended = rows.slice(overlap, last);
      // -y caps the scroll before og repaints instead
      if (optForwScroll() >= 0 && appended.length > optForwScroll()) break;

      return clearBot() + appended.map(r => r + rowEnd(r)).join('') + bot;
    }

    // backward: k rows scrolled in at the top; og back()'s home +
    // reverse index per line, then lower_left before the prompt
    if (prev.length === rows.length) {
      for (let k = 1; k < last; k++) {
        if (rows[k] === prev[0] && shifted(prev, rows, k)) {
          // -h caps the scroll: og's back() sets do_repaint and
          // repaint() paints forward with the skipping marker —
          // never the far-backward clear + reverse paint
          if (optBackScroll() >= 0 && k > optBackScroll()) {
            capped = true;
            break;
          }

          // og's cmd_exec clear_bots before back() starts inserting
          let frame = clearBot();
          for (let i = k - 1; i >= 0; i--) {
            frame += CURSOR_HOME + REVERSE_INDEX + rows[i] + rowEnd(rows[i]);
          }

          return frame + CURSOR_TO(config.window, 1) + clearBot() + bot;
        }
      }
    }
  }

  const repaint = prev !== null || dumbPainted;
  const clearHome = optClearRepaint() || dumbHomePending;
  const prefix = scrollPrefix;
  dumbHomePending = false;
  dumbPainted = true;
  scrollPrefix = null;

  const body = rows.slice(0, last).map(r => r + rowEnd(r)).join('');

  // the first paint prints in place behind term_init's line_left CR
  if (!repaint) return '\r' + body + bot;

  // -c and the freeze-unlatching make_display (top_scroll forced)
  // clear and paint forward, like og's forw calling clear() + home()
  if (clearHome) {
    return (prefix ?? clearBot()) + CLEAR_SCREEN + CURSOR_HOME + body + bot;
  }

  // a backward far jump clear_bots (cmd_exec), clears, and paints
  // the rows in reverse through home + reverse index (jump_loc's
  // lclear + back)
  if (backJump && !capped) {
    let frame = clearBot() + CLEAR_SCREEN;
    for (let i = last - 1; i >= 0; i--) {
      frame += CURSOR_HOME + REVERSE_INDEX + rows[i] + rowEnd(rows[i]);
    }

    return frame + CURSOR_TO(config.window, 1) + clearBot() + bot;
  }

  // forward far jumps and repaints print og's skipping marker over
  // the cleared prompt row and scroll (repaint() without top_scroll);
  // trashed-screen repaints carry their own prefix instead of a
  // command's clear_bot
  return (prefix ?? clearBot()) + '...skipping...\n' + body + bot;
}

/**
 * Joins dumb rows like og's pdone: a row that exactly fills the
 * screen width gets no newline (auto-margins wrap it), and a bottom
 * line following such a row starts with clear_bot's bare CR — which
 * a deferred-wrap terminal puts on the hanging row, overwriting it
 * like og.
 */
function joinDumb(plain: string[]): string {
  let out = '';

  for (let i = 0; i < plain.length; i++) {
    out += plain[i];
    if (i === plain.length - 1) break;

    if (visualWidth(plain[i]) < config.screenWidth) {
      out += '\n';
    } else if (i === plain.length - 2 && search.message) {
      // og's error() leads with clear_bot's CR, overwriting the
      // hanging row; a prompt appends directly instead (forw_prompt
      // skips clear_bot) and the deferred wrap moves it down a line
      out += '\r';
    }
  }

  return out;
}

// true once a dumb session painted, so a repaint after resetRender
// (^L) still shows og's skipping marker for identical content
let dumbPainted = false;

export function resetDumbPaint(): void {
  dumbPainted = false;
}

/**
 * Counts the dumb screen as painted, so the next full frame carries
 * og's "...skipping..." marker: a search executing before any paint
 * compresses og's paint-repaint sequence, whose final repaint is
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

  // an open pipe fill has no prompt row yet, like og's initial forw
  if (open) return content.join('\n').split('\n');

  const prompt = getPrompt(rawContent);

  // an echoed prefix replaces the number echo, like less's cmd_reset;
  // a single pending ESC changes nothing; a pipe drain's blank
  // command line still owns the bottom row, cursor at og's lower left
  if (prompt) {
    content.push(
      config.keyPrefix && config.keyPrefix !== '\x1B'
        ? prompt
        : prompt + getBuffer(buffer)
    );
  } else if (pipeDraining.active) {
    content.push('');
  }

  return content.join('\n').split('\n');
}

const drawRow = (rows: string[], row: number): string =>
  CURSOR_TO(row + 1, 1) + CLEAR_LINE + rows[row];

// park the cursor after the prompt row's content, like less's
// command-line position at the lower left; an open command buffer
// places it at the editing position instead
function parkCursor(rows: string[]): string {
  return CURSOR_TO(rows.length, cursorCol(rows));
}

/** The parked cursor's 1-based column for the current frame. */
function cursorCol(rows: string[]): number {
  if (cmd.active) return Math.min(cmdCol() + 1, config.screenWidth);

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

// LESS_TERMCAP_SUSPEND/RESUME (v684) replace the strings wrapped
// around screen updates; our default is the sync-update pair
const syncOn = (): string => process.env.LESS_TERMCAP_SUSPEND ?? SYNC_ON;
const syncOff = (): string => process.env.LESS_TERMCAP_RESUME ?? SYNC_OFF;

function fullFrame(rows: string[]): string {
  const body = rows.map(row => CLEAR_LINE + row).join('\n');
  return syncOn() + CURSOR_HOME + body + CLEAR_BELOW + parkCursor(rows) +
    syncOff();
}

/**
 * Builds a minimal frame when the screen content only scrolled.
 *
 * - The bottom (prompt) row is excluded from shift matching and always
 *   redrawn, like less reprinting its prompt after scrolling.
 *
 * @returns The frame, or null when the change is not a pure scroll.
 */
function scrolledFrame(rows: string[]): string | null {
  const prev = prevRows;
  const n = rows.length;

  if (!prev || prev.length !== n || n < 3) return null;

  for (let k = 1; k < n - 1; k++) {
    // scrolled forward: new rows show what was k rows lower; -y limits
    // how far the screen scrolls before repainting instead
    if (rows[0] === prev[k] && shifted(rows, prev, k)) {
      if (optForwScroll() >= 0 && k > optForwScroll()) return null;

      let frame = syncOn() + SCROLL_UP(k);
      for (let r = n - 1 - k; r < n; r++) frame += drawRow(rows, r);
      return frame + parkCursor(rows) + syncOff();
    }

    // scrolled backward: new rows show what was k rows higher; -h is
    // the backward scroll limit
    if (rows[k] === prev[0] && shifted(prev, rows, k)) {
      if (optBackScroll() >= 0 && k > optBackScroll()) return null;

      let frame = syncOn() + SCROLL_DOWN(k);
      for (let r = 0; r < k; r++) frame += drawRow(rows, r);
      return frame + drawRow(rows, n - 1) + parkCursor(rows) + syncOff();
    }
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
  let lastRow = content.length - 1;
  let rows = 0;

  while (lastRow >= 0) {
    const remaining = config.window - rows - 1;
    const currSubRows = maxSubRow(content[lastRow]) + 1;

    if (currSubRows >= remaining) {
      return { lastRow, lastSubRow: currSubRows - remaining };
    }

    rows += currSubRows;
    lastRow--;
  }

  return { lastRow: 0, lastSubRow: 0 };
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
function getPrompt(content: string[]): string {
  // during a pipe drain og leaves the command line blank for G and
  // shows ierror's interruptible note for % (jump.c/output.c)
  if (pipeDraining.active) {
    return pipeDraining.note
      ? colored('error',
        pipeDraining.note + '... (interrupt to abort)',
        INVERSE_ON, INVERSE_OFF)
      : '';
  }

  const inputPrompt = searchPrompt();
  if (inputPrompt !== null) return inputPrompt;

  // the binary file question replaces the prompt, like og's query
  if (binaryConfirm.pending) {
    return `"${binaryConfirm.path}" may be a binary file.  ` +
      'See it anyway? ';
  }

  if (option.pending) {
    if (option.spec) {
      return (option.spec.prompt ?? '') +
        (cmd.active ? cmdDisplay() : option.param);
    }

    // ^P shows "(P)" and -+/-! their flag, like og's mca_opt_toggle
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

  // pending multi-key prefix, echoed like less's A_PREFIX (" ^X"); a
  // single pending ESC leaves the prompt untouched, and each further
  // ESC echoes as a literal "ESC"
  if (config.keyPrefix && config.keyPrefix !== '\x1B') {
    const echoed = config.keyPrefix[0] === '\x1B'
      ? 'ESC'.repeat(config.keyPrefix.length - 1)
      : Array.from(config.keyPrefix, prChar).join('');

    return ' ' + echoed;
  }

  if (search.message) {
    return colored('error', search.message + '  (press RETURN)',
      INVERSE_ON, INVERSE_OFF);
  }

  // a stalled initial fill shows og's wait_message the same way
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

  if (mode.BUFFERING) return ':';

  if (mode.HELP) {
    const helpPrompt = prExpand(content, hProto());

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
  const text = prExpand(content, prProto(displayPrType()));
  if (files.newFile) files.newFile = false;

  if (!text) return ':';

  return colored('prompt', text, INVERSE_ON, INVERSE_OFF);
}

/**
 * Renders a key in printable form like less's prchar: control characters
 * in caret notation, ESC as `ESC`.
 *
 * @param char - Single character to render.
 */
function prChar(char: string): string {
  const code = char.charCodeAt(0);

  if (code === 0x1B) return 'ESC';
  if (code < 0x20) return '^' + String.fromCharCode(code ^ 0x40);

  return char;
}

/**
 * Trims the buffer to fit within the screen width.
 *
 * - If too long, trims equally from the start to keep the tail visible.
 *
 * @param buffer - Array of buffer characters.
 * @returns The buffer as a string, trimmed if necessary.
 */
function getBuffer(buffer: string[]): string {
  const width = config.screenWidth - 1;
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
  const width = config.screenWidth - 1;
  const halfWidth = Math.floor(width / 2);
  return bufferLength - halfWidth * config.bufferOffset;
}

/**
 * Pads remaining window space with `~` lines or an `(END)` marker.
 *
 * @param lines - The array of formatted lines to pad.
 */
function padToEOF(lines: string[]): void {
  // og's gline draws a null line as "~" or "" by the twiddle flag, so
  // -~ pads with blank rows and the prompt keeps the bottom line
  if (!mode.INIT && config.window - lines.length > 1) {
    const rows = config.window - lines.length - 1;

    lines.push(optTildes()
      ? colored('tilde', '~\n'.repeat(rows - 1) + '~', BOLD_ON, BOLD_OFF)
      : '\n'.repeat(rows - 1));
  }

  if (mode.INIT && lines.length === config.window - 1) mode.INIT = false;
}
