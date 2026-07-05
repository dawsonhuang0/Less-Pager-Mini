import fs from 'fs';

import { strWidth } from 'char-width';

import { config, mode } from './config';

import { chopLongLines } from './chopLongLines';
import { wrapLongLines } from './wrapLongLines';

import { getLayout } from './lineLayout';

import { search, searchPrompt } from './features/searching';

import { option } from './features/options';

import {
  ASCII_REGEX,
  STYLE_REGEX,
  STYLE_REGEX_G,
  STYLE_RESET,
  INVERSE_ON,
  INVERSE_OFF,
  BOLD_ON,
  BOLD_OFF,
  END_MARKER,
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
 * Returns how many extra sub-rows a line will take if it overflows screen
 * width.
 *
 * - Returns 0 if line-chopping is enabled.
 * - Styled or Unicode lines use the cached layout, so the count always
 *   matches what the renderer actually emits.
 *
 * @param line - The string to measure.
 * @returns Number of sub-rows needed to display the line.
 */
export function maxSubRow(line: string): number {
  if (config.chopLongLines) return 0;

  if (!isStyled(line) && isAscii(line)) {
    return Math.floor(Math.max(line.length - 1, 0) / config.screenWidth);
  }

  return getLayout(line).rowStart.length - 1;
}

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
      return input.split('\n');

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
 * Triggers an audible bell sound in the terminal.
 *
 * Sends the ASCII bell character (`\x07`) to `stdout`.
 */
export function ringBell(): void {
  process.stdout.write('\x07');
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

  if (config.chopLongLines || config.col) {
    chopLongLines(content, lines);
  } else {
    wrapLongLines(content, lines);
  }

  padToEOF(lines);
  return lines;
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
export function render(rawContent: string[], buffer: string[]): void {
  const content = formatContent(rawContent);
  const prompt = getPrompt();

  if (prompt) content.push(prompt + getBuffer(buffer));

  const rows = content.join('\n').split('\n');

  // nothing changed (e.g. scrolling against BOF/EOF): leave the screen
  // and the parked cursor untouched, like less
  if (prevRows && sameRows(prevRows, rows)) return;

  const frame = scrolledFrame(rows) ?? fullFrame(rows);

  prevRows = rows;
  process.stdout.write(frame);
}

const drawRow = (rows: string[], row: number): string =>
  CURSOR_TO(row + 1, 1) + CLEAR_LINE + rows[row];

// park the cursor after the prompt row's content, like less's
// command-line position at the lower left
function parkCursor(rows: string[]): string {
  const last = rows[rows.length - 1];
  const col = Math.min(visualWidth(last) + 1, config.screenWidth);
  return CURSOR_TO(rows.length, col);
}

function sameRows(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function fullFrame(rows: string[]): string {
  const body = rows.map(row => CLEAR_LINE + row).join('\n');
  return SYNC_ON + CURSOR_HOME + body + CLEAR_BELOW + parkCursor(rows) +
    SYNC_OFF;
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
    // scrolled forward: new rows show what was k rows lower
    if (rows[0] === prev[k] && shifted(rows, prev, k)) {
      let frame = SYNC_ON + SCROLL_UP(k);
      for (let r = n - 1 - k; r < n; r++) frame += drawRow(rows, r);
      return frame + parkCursor(rows) + SYNC_OFF;
    }

    // scrolled backward: new rows show what was k rows higher
    if (rows[k] === prev[0] && shifted(prev, rows, k)) {
      let frame = SYNC_ON + SCROLL_DOWN(k);
      for (let r = 0; r < k; r++) frame += drawRow(rows, r);
      return frame + drawRow(rows, n - 1) + parkCursor(rows) + SYNC_OFF;
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
  mode.EOF = lastRow === 0 && (config.chopLongLines || lastSubRow === 0);
}

/**
 * Calculates the total visual width of a string based on terminal character
 * widths.
 *
 * @param line - The input string to measure.
 * @returns The total visual width of the string in terminal columns.
 */
export function visualWidth(line: string): number {
  if (isStyled(line)) line = line.replace(STYLE_REGEX_G, '');
  return isAscii(line) ? line.length : strWidth(line);
}

/**
 * Appends a style reset to a line only if a style is still open at its end.
 *
 * - Prevents style bleeding without emitting redundant reset codes.
 *
 * @param line - The line to terminate.
 * @returns The line with styles guaranteed closed.
 */
export function withReset(line: string): string {
  const i = line.lastIndexOf(STYLE_RESET);
  const tail = i === -1 ? line : line.slice(i + STYLE_RESET.length);
  return STYLE_REGEX.test(tail) ? line + STYLE_RESET : line;
}

const segmenter = new Intl.Segmenter();

/**
 * Splits a line into grapheme clusters.
 *
 * - Keeps multi-code-point sequences (ZWJ emoji, variation selectors,
 *   combining marks) together as single units.
 *
 * @param line - The string to split.
 * @returns Array of grapheme clusters.
 */
export const splitChars = (line: string): string[] =>
  Array.from(segmenter.segment(line), ({ segment }) => segment);

/**
 * Checks whether a given segment consists entirely of ASCII characters.
 *
 * - Matches characters in the range 0x00 to 0x7F.
 * - Used to determine whether fast-path rendering can be applied.
 *
 * @param segment - A string segment to check.
 * @returns Whether the segment is pure ASCII.
 */
export const isAscii = (segment: string): boolean => ASCII_REGEX.test(segment);

/**
 * Checks whether a given string contains ANSI style codes.
 *
 * @param line The input string to test.
 * @returns `true` if ANSI style codes are present, otherwise `false`.
 */
export const isStyled = (line: string): boolean => STYLE_REGEX.test(line);

/**
 * Returns the prompt string to be shown at the bottom of the screen.
 *
 * - Typically returns `':'` to indicate the pager is awaiting user input.
 * - Suppressed if an EOF marker like `(END)` is already displayed.
 * - May adapt based on the current mode (e.g. buffering, EOF).
 *
 * @returns The prompt string, or an empty string if suppressed.
 */
function getPrompt(): string {
  const inputPrompt = searchPrompt();
  if (inputPrompt !== null) return inputPrompt;

  if (option.pending) return option.pending;

  if (search.message) {
    return INVERSE_ON + search.message + '  (press RETURN)' + INVERSE_OFF;
  }

  const helpPrompt = (
    'HELP -- ' +
    (mode.EOF ? 'END -- Press g to see it again' : 'Press RETURN for more') +
    ', or q when done'
  );

  if (mode.HELP && !mode.BUFFERING) return (
    INVERSE_ON +
    helpPrompt.slice(Math.max(helpPrompt.length - config.screenWidth + 2, 0)) +
    INVERSE_OFF
  );

  if (!mode.EOF || mode.BUFFERING) return ':';

  return '';
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
  if (!mode.INIT && config.window - lines.length > 1) {
    lines.push(
      BOLD_ON +
      '~\n'.repeat(Math.max(config.window - lines.length - 2, 0)) + '~' +
      BOLD_OFF
    );
  }

  if (mode.INIT && lines.length === config.window - 1) mode.INIT = false;

  // search input, option input and messages replace the bottom line
  if (
    !mode.BUFFERING && !mode.HELP && mode.EOF &&
    !search.input && !search.message && !option.pending
  ) {
    lines.push(END_MARKER);
  }
}
