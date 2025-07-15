import fs from 'fs';

import { config, mode } from './pagerConfig';

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
  const maxRow = config.row + config.window - 1;
  const formattedContent: string[] = [];

  return config.chopLongLines
    ? chopLongLines(content, formattedContent, maxRow)
    : wrapLongLines(content, formattedContent, maxRow);
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
 * Returns the terminal width of a character.
 *
 * - Wide characters (CJK, emoji, etc.) return 2.
 * - Narrow characters return 1.
 * - Invalid or empty input returns 0.
 *
 * @param c - The character to measure.
 * @returns Terminal display width in cells.
 */
function charWidth(c: string): number {
  const code = c.codePointAt(0);
  if (code === undefined) return 0;

  if (
    code < 0x1100 ||
    (code > 0x115F && code < 0x2329) ||
    (code > 0x232A && code < 0x2E80) ||
    (code > 0xA4CF && code < 0xAC00) ||
    (code > 0xD7A3 && code < 0xF900) ||
    (code > 0xFAFF && code < 0xFE10) ||
    (code > 0xFE19 && code < 0xFE30) ||
    (code > 0xFE6F && code < 0x1F300) ||
    (code > 0x1FAFF && code < 0x20000)
  ) return 1;

  return 2;
}

/**
 * Calculates the total visual width of a string based on terminal character
 * widths.
 *
 * @param line - The input string to measure.
 * @returns The total visual width of the string in terminal columns.
 */
export function visualWidth(line: string): number {
  if (isAscii(line)) return line.length;

  const segments = Array.from(line);
  let length = 0;

  for (const segment of segments) {
    length += charWidth(segment);
  }

  return length;
}

/**
 * Truncates long lines to fit the screen width with a visual marker.
 *
 * - Uses `chopLine` for non-ASCII content to handle wide characters safely.
 * - Adds a reverse video `>` if the line is chopped.
 * - Only processes lines within the visible window range.
 *
 * @param content - Raw content as an array of strings.
 * @param formattedContent - Output buffer for processed lines.
 * @param maxRow - Maximum row index to format up to.
 * @returns The final formatted content joined by newlines.
 */
function chopLongLines(
  content: string[],
  formattedContent: string[],
  maxRow: number
): string {
  let row = config.row;

  while (row < maxRow && row < content.length) {
    const line = content[row];

    if (visualWidth(line) <= config.screenWidth) {
      formattedContent.push(line);
      row++;
      continue;
    }

    formattedContent.push(
      isAscii(line)
        ? line.slice(0, config.screenWidth - 1) + '\x1b[7m>\x1b[0m'
        : chopLine(line)
    );

    row++;
  }

  mode.EOF = row === content.length && row <= maxRow;
  padToEOF(formattedContent, row, maxRow);

  return formattedContent.join('\n');
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
 * Truncates a single line to fit the screen width, respecting character width.
 *
 * - Handles wide characters (e.g. emoji, CJK) using `charWidth`.
 * - Appends a visual tail (`>`) in reverse video if the line is chopped.
 * - Ensures no mid-character truncation occurs.
 *
 * @param line - A single string line to process.
 * @returns The chopped line with visual overflow indicator if needed.
 */
function chopLine(line: string): string {
  const formattedLine: string[] = [];

  const segments = Array.from(line);
  let length = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentWidth = charWidth(segment);
    const concatLength = length + segmentWidth;

    if (isTail(concatLength, segments.length, i)) {
      formattedLine.push(
        '\x1b[7m' +
        ' '.repeat(Math.max(config.screenWidth - length - 1, 0)) +
        '>\x1b[0m'
      );
      break;
    }

    formattedLine.push(segment);
    length = concatLength;
  }

  return formattedLine.join('');
}

/**
 * Formats the visible window of content into screen-sized lines.
 *
 * - Begins rendering from the current `config.row` and `config.subRow`.
 * - Uses `partitionLine` for long lines, or `assignLine` for short ones.
 * - Stops when `maxRow` is filled or content ends.
 * - Sets `mode.EOF` if the end of content is reached.
 *
 * @param content - The full content split into original lines.
 * @param formattedContent - The buffer to store formatted screen lines.
 * @param maxRow - The maximum number of rows that can be filled.
 * @returns The formatted content joined by line breaks.
 */
function wrapLongLines(
  content: string[],
  formattedContent: string[],
  maxRow: number
): string {
  let row = config.row;

  let i = row;
  let line = content[i];

  if (config.subRow && i < content.length) {
    row = partitionLine(formattedContent, line, row, maxRow, config.subRow);
    i++;
  }

  while (row < maxRow && i < content.length) {
    line = content[i];

    row = visualWidth(line) > config.screenWidth
      ? partitionLine(formattedContent, line, row, maxRow)
      : assignLine(formattedContent, line, row);

    i++;
  }

  mode.EOF = i === content.length && row <= maxRow;
  padToEOF(formattedContent, row, maxRow);

  return formattedContent.join('\n');
}

/**
 * Assigns a single line of content to the formatted output.
 *
 * - Pushes the line directly into the `formattedContent` array.
 * - Advances the row index by one.
 *
 * @param formattedContent - The array to store formatted lines.
 * @param line - A single line of text to display.
 * @param row - The current row index.
 * @returns The next row index after assignment.
 */
function assignLine(
  formattedContent: string[],
  line: string,
  row: number
): number {
  formattedContent.push(line);
  return row + 1;
}

/**
 * Wraps a long line into multiple rows if it exceeds the screen width.
 *
 * - Splits the line into sub-rows based on `config.screenWidth`.
 * - Starts appending sub-rows from `subRowStart` index (for paged viewing).
 * - Updates and returns the new row index after appending wrapped lines.
 *
 * @param formattedContent - The array to store rendered lines.
 * @param line - The raw string line to be wrapped.
 * @param row - The starting row index in the output.
 * @param maxRow - The maximum number of rows allowed to write.
 * @param subRowStart - The sub-row index to begin rendering from
 *                      (used for scroll).
 * @returns The updated row index after wrapping and appending.
 */
function partitionLine(
  formattedContent: string[],
  line: string,
  row: number,
  maxRow: number,
  subRowStart: number = 0
): number {
  let formattedLine: string[] = [];

  const segments = Array.from(line);
  let length = 0;
  let subRow = 0;

  for (const segment of segments) {
    const segmentWidth = charWidth(segment);
    const concatLength = length + segmentWidth;

    if (concatLength < config.screenWidth) {
      formattedLine.push(segment);
      length = concatLength;
      continue;
    }

    const overflow = concatLength > config.screenWidth;

    if (subRow >= subRowStart) {
      formattedContent.push(
        formattedLine.join('') + (overflow ? '' : segment)
      );
      row++;
    }

    formattedLine = overflow ? [segment] : [];
    length = overflow ? segmentWidth : 0;

    subRow++;
  }

  if (row < maxRow && subRow >= subRowStart && formattedLine.length) {
    formattedContent.push(formattedLine.join(''));
    row++;
  }

  return row;
}

/**
 * Pads the remaining lines after content with placeholder or end indicator.
 *
 * - Pushes `~` lines if not in `INIT` mode and under `maxRow`.
 * - Appends `(END)` marker if at end of file and not buffering.
 * - Also disables `INIT` mode if it reaches `maxRow`.
 *
 * @param formattedContent - The array to append placeholder or end markers.
 * @param row - The current row index.
 * @param maxRow - The maximum number of rows allowed to fill.
 */
function padToEOF(
  formattedContent: string[],
  row: number,
  maxRow: number
): void {
  if (mode.INIT && row === maxRow) mode.INIT = false;

  while (!mode.INIT && row < maxRow) {
    formattedContent.push('\x1b[1m~\x1b[0m');
    row++;
  }

  if (!mode.BUFFERING && mode.EOF) {
    formattedContent.push('\x1b[7m(END)\x1b[0m');
  }
}
