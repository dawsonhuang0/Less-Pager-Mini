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

import { files, examine, binaryConfirm, pipeDraining }
  from './features/files';

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

export function freezeFrame(): void {
  frozenFrame = true;
}

// --incsearch repaints while the pattern is typed (og's mca_search
// jumping to the match), which clears the pending trash
export function unfreezeFrame(): void {
  frozenFrame = false;
}

export function render(rawContent: string[], buffer: string[]): void {
  let rows = screenRows(rawContent, buffer);

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
    } else if (prevRows) {
      rows = [...prevRows.slice(0, -1), rows[rows.length - 1]];
    }
  }

  // og (v618+) starts at the lower left of the alt screen and lets
  // the first paint scroll upward: a short first screen sits just
  // above the bottom prompt, its blank rows on top
  if (mode.INIT && !mode.DUMB && rows.length < config.window) {
    rows.unshift(...Array(config.window - rows.length).fill(''));
  }

  // nothing changed (e.g. scrolling against BOF/EOF): leave the screen
  // and the parked cursor untouched, like less — but arrow movement
  // inside the command buffer must still move the cursor
  if (prevRows && sameRows(prevRows, rows)) {
    const col = cmd.active && !mode.DUMB ? cursorCol(rows) : -1;

    if (col >= 0 && col !== prevCursorCol) {
      prevCursorCol = col;
      process.stdout.write(CURSOR_TO(rows.length, col));
    }

    return;
  }

  if (mode.DUMB) {
    const frame = dumbFrame(prevRows, rows);
    prevRows = rows;
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
        return '\r' +
          plain.slice(last - k, last).map(row => row + '\n').join('') +
          plain[last];
      }
    }
  }

  // the first paint just prints, like og's initial forw; only later
  // full repaints go behind the dumb `clear` of two newlines
  return (prev ? '\n\n' : '') + plain.join('\n');
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
  buffer: string[]
): string[] {
  const content = formatContent(rawContent);
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
    if (option.spec && option.spec.prompt) {
      return option.spec.prompt + option.param;
    }

    // ^P shows "(P)" and -+/-! their flag, like og's mca_opt_toggle
    const marks = (option.noPrompt ? '(P)' : '') + option.flag;

    if (option.name !== null) {
      return option.pending + option.pending + marks + option.name;
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
