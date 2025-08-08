import fs from 'fs';

import wcwidth from 'wcwidth';

import { config, mode } from './config';

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
export const maxSubRow = (line: string): number =>
  config.chopLongLines ? 0 : Math.floor(visualWidth(line) / config.screenWidth);

/**
 * Converts a buffer string to a number.
 *
 * - Parses the string as a base-10 integer.
 * - Returns 0 if the input is not a valid number or equals 0.
 *
 * @param buffer - The string to convert.
 * @returns Parsed numeric value, or 0 if invalid.
 */
export function bufferToNum(buffer: string): number {
  const n = parseInt(buffer, 10);
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
 * Formats content for display based on line wrapping configuration.
 *
 * - Chooses between chopping or wrapping long lines.
 * - Limits formatting to the current window range.
 *
 * @param content - The full array of content lines to format.
 * @returns A formatted string ready for rendering.
 */
export function formatContent(content: string[]): string {
  const lines: string[] = [];

  if (config.chopLongLines) {
    chopLongLines(content, lines);
  } else {
    wrapLongLines(content, lines);
  }

  padToEOF(lines);
  return lines.join('\n');
}

/**
 * Returns the prompt string to be shown at the bottom of the screen.
 *
 * - Typically returns `':'` to indicate the pager is awaiting user input.
 * - Suppressed if an EOF marker like `(END)` is already displayed.
 * - May adapt based on the current mode (e.g. buffering, EOF).
 *
 * @returns The prompt string, or an empty string if suppressed.
 */
export function getPrompt(): string {
  if (!mode.EOF || mode.BUFFERING) return '\n:';

  return '';
}

/**
 * Renders the given content to the terminal.
 *
 * - Clears the screen before writing.
 * - Outputs the content directly to `stdout`.
 *
 * @param content - The string content to display in the terminal.
 */
export function renderContent(content: string): void {
  console.clear();
  process.stdout.write(content);
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
 * Checks whether a given segment consists entirely of ASCII characters.
 *
 * - Matches characters in the range 0x00 to 0x7F.
 * - Used to determine whether fast-path rendering can be applied.
 *
 * @param segment - A string segment to check.
 * @returns Whether the segment is pure ASCII.
 */
const isAscii = (segment: string): boolean =>
  // eslint-disable-next-line no-control-regex
  /^[\x00-\x7F]*$/.test(segment);

/**
 * Calculates the total visual width of a string based on terminal character
 * widths.
 *
 * @param line - The input string to measure.
 * @returns The total visual width of the string in terminal columns.
 */
function visualWidth(line: string): number {
  // eslint-disable-next-line no-control-regex
  if (/\x1b\[[0-9;]*m/g.test(line)) line = line.replace(/\x1b\[[0-9;]*m/g, '');

  if (isAscii(line)) return line.length;

  const segments = segmentLine(line);
  let length = 0;

  for (let i = 0; i < segments.length; i++) {
    length += wcwidth(segments[i]);
  }

  return length;
}

/**
 * Segments a given string into grapheme clusters (visible characters).
 *
 * - Uses `Intl.Segmenter` if available to accurately split the string into
 *   grapheme clusters
 * - Falls back to `Array.from` for environments where `Intl.Segmenter` is
 *   unavailable.
 *
 * @param line - The input string to be segmented.
 * @returns An array of grapheme segments, each representing one visible
 *          character.
 */
function segmentLine(line: string): string[] {
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - TS may not recognize Segmenter in older versions
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })

    // Fallback for environments without Intl.Segmenter
    /* v8 ignore next */
    : null;

  return segmenter
    ? [...segmenter.segment(line)].flatMap(s => s.segment)

    // Fallback for environments without Intl.Segmenter
    /* v8 ignore next */
    : Array.from(line);
}

/**
 * Chops long lines to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of chopped lines.
 */
function chopLongLines(content: string[], lines: string[]): void {
  const maxRow = content.length - config.row;

  while (lines.length < config.window - 1 && lines.length < maxRow) {
    const line = content[config.row + lines.length];

    if (visualWidth(line) <= config.screenWidth) {
      lines.push(line);
      continue;
    }

    lines.push(
      isAscii(line)
        ? line.slice(0, config.screenWidth - 1) + '\x1b[7m>\x1b[0m'
        : chopLine(line)
    );
  }

  mode.EOF = lines.length === maxRow;
}

/**
 * Determines if the current segment should be the last visible part of the
 * line.
 *
 * - Marks the point where the line would exceed the screen width.
 * - Also checks if the segment exactly fits the screen but isn't the last.
 *
 * @param concatLength - Current total display width including this segment.
 * @param segmentsLength - Total number of segments in the line.
 * @param i - Current segment index.
 * @returns True if this segment should trigger truncation with a tail marker.
 */
function isTail(
  concatLength: number,
  segmentsLength: number,
  i: number
): boolean {
  return (
    concatLength > config.screenWidth - 1 ||
    (concatLength === config.screenWidth && i !== segmentsLength - 1)
  );
}

/**
 * Truncates a long line to screen width and appends a `>` marker.
 *
 * @param longLine - The line to chop.
 * @returns The chopped line with marker.
 */
function chopLine(longLine: string): string {
  const line: string[] = [];

  const segments = segmentLine(longLine);
  let length = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentWidth = visualWidth(segment);
    const concatLength = length + segmentWidth;

    if (isTail(concatLength, segments.length, i)) {
      line.push(
        '\x1b[7m' +
        ' '.repeat(Math.max(config.screenWidth - length - 1, 0)) +
        '>\x1b[0m'
      );
      break;
    }

    line.push(segment);
    length = concatLength;
  }

  return line.join('');
}

/**
 * Wraps lines into subrows to fit screen width and fills the window.
 *
 * @param content - Full content lines.
 * @param lines - Output array of wrapped lines.
 */
function wrapLongLines(content: string[], lines: string[]): void {
  const maxRow = content.length - config.row;

  let row = 0;
  let isCompleteLine = true;
  let line = content[config.row];

  if (config.subRow) {
    isCompleteLine = partitionLine(lines, line, config.subRow);
    row++;
  }

  while (lines.length < config.window - 1 && row < maxRow) {
    line = content[config.row + row];

    if (visualWidth(line) > config.screenWidth) {
      isCompleteLine = partitionLine(lines, line, 0);
    } else {
      lines.push(line);
    }

    row++;
  }

  mode.EOF = isCompleteLine && row === maxRow;
}

/**
 * Wraps a long line into subrows and appends them to `lines`.
 *
 * - Starts from `subRowStart` for partial line display.
 * - Stops early if window limit is reached.
 *
 * @param lines - Output array for wrapped segments.
 * @param longLine - The line to split and wrap.
 * @param subRowStart - Starting subrow index (default 0).
 * @returns `true` if the line is fully wrapped, `false` if truncated.
 */
function partitionLine(
  lines: string[],
  longLine: string,
  subRowStart: number
): boolean {
  let line: string[] = [];

  const segments = segmentLine(longLine);
  let length = 0;
  let subRow = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentWidth = visualWidth(segment);
    const concatLength = length + segmentWidth;

    if (concatLength < config.screenWidth) {
      line.push(segment);
      length = concatLength;
      continue;
    }

    const overflow = concatLength > config.screenWidth;

    if (subRow >= subRowStart) {
      if (lines.length === config.window - 1) return false;

      if (!overflow) line.push(segment);
      lines.push(line.join(''));
    }

    line = overflow ? [segment] : [];
    length = overflow ? segmentWidth : 0;

    subRow++;
  }

  if (line.length && subRow >= subRowStart) {
    if (lines.length === config.window - 1) return false;
    lines.push(line.join(''));
  }

  return true;
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

  if (!mode.BUFFERING && mode.EOF) {
    lines.push('\x1b[7m(END)\x1b[0m');
  }
}
