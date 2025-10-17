import fs from 'fs';

import { wcswidth } from 'wcwidth-o1';

import { config, mode } from './config';

import { chopLongLines } from './chopLongLines';
import { wrapLongLines } from './wrapLongLines';

import {
  ASCII_REGEX,
  STYLE_REGEX,
  STYLE_REGEX_G,
  INVERSE_ON,
  INVERSE_OFF
} from './constants';

/**
 * Returns how many extra sub-rows a line will take if it overflows screen
 * width.
 * 
 * - Returns 0 if line-chopping is enabled.
 * - Otherwise, calculates how many full rows the visual width spans.
 * 
 * @param line - The string to measure.
 * @returns Number of sub-rows needed to display the line.
 */
export const maxSubRow = (line: string): number => config.chopLongLines
  ? 0
  : Math.floor(Math.max(visualWidth(line) - 1, 0) / config.screenWidth);

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
 * - Limits formatting to the current window range.
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
}

/**
 * Removes the last character from the input buffer.
 *
 * - Decrements buffer offset if no visible characters remain.
 *
 * @param buffer - Current input buffer array.
 */
export function delBufferChar(buffer: string[]): void {
  if (visibleBufferLength(buffer.length) === 0) {
    config.bufferOffset--;
  }

  buffer.pop();
}

/**
 * Renders the given content to the terminal.
 *
 * - Clears the screen before writing.
 * - Outputs the content directly to `stdout`.
 *
 * @param rawContent - The string content to display in the terminal.
 * @param buffer - Array of buffer characters.
 */
export function render(rawContent: string[], buffer: string[]): void {
  const content = formatContent(rawContent);
  const prompt = getPrompt();

  if (prompt) content.push(prompt + getBuffer(buffer));

  console.clear();
  process.stdout.write(content.join('\n'));
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
  return isAscii(line) ? line.length : wcswidth(line);
}

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
  const helpPrompt = [
    'HELP -- ' ,
    mode.EOF ? 'END -- Press g to see it again' : 'Press RETURN for more',
    ', or q when done'
  ].join('');

  if (mode.HELP && !mode.BUFFERING) {
    return [
      INVERSE_ON,
      helpPrompt.slice(Math.max(helpPrompt.length - config.screenWidth + 2, 0)),
      INVERSE_OFF
    ].join('');
  }

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
  while (!mode.INIT && lines.length < config.window - 1) {
    lines.push('\x1b[1m~\x1b[0m');
  }

  if (mode.INIT && lines.length === config.window - 1) mode.INIT = false;

  if (!mode.BUFFERING && !mode.HELP && mode.EOF) {
    lines.push('\x1b[7m(END)\x1b[0m');
  }
}
