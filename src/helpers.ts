import fs from 'fs';

import { config, mode } from './pagerConfig';

/**
 * Calculates how many sub-rows (wrapped lines) a line occupies on screen.
 *
 * - Returns 0 if `config.chopLongLines` is enabled (no wrapping).
 * - Otherwise, returns the number of wrapped lines based on
 *   `config.screenWidth`.
 *
 * @param line - A single line of text from the content.
 * @returns The number of sub-rows needed to display the line.
 */
export const maxSubRow = (line: string): number =>
  config.chopLongLines? 0: Math.floor(line.length / config.screenWidth);

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
 * Converts various input types into a formatted array of strings.
 *
 * - Strings are split into segments, preserving lines and wide characters.
 * - Non-string primitives are converted via `.toString()`.
 * - Objects are serialized using `JSON.stringify`, respecting indentation.
 * - ASCII-only strings are processed with a fast path; others with UTF-aware
 *   splitting.
 *
 * @param input - The value to convert (string, number, object, etc.).
 * @param preserveFormat - Whether to disable indentation in JSON output.
 * @returns An array of string segments suitable for display in pagers or
 *          terminals.
 */
export function inputToString(
  input: unknown,
  preserveFormat: boolean
): string[] {
  let inputString = '';

  switch (typeof input) {
    case 'string':
      inputString = input;
      break;

    case 'undefined':
      inputString = 'undefined';
      break;

    case 'number':
    case 'bigint':
    case 'boolean':
    case 'function':
      inputString = input.toString();
      break;
    
    case 'object':
      inputString = JSON.stringify(
        input, null, preserveFormat ? 0 : config.indentation
      );
      break;

    default:
      return [];
  }

  if (!inputString) return [];

  const formattedInput: string[] = [];

  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(inputString)
    ? splitAsciiInput(formattedInput, inputString)
    : splitUtfInput(formattedInput, inputString);
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
  if (!code) return 0;

  if (code <= 0x1FFF) return 1;

  if (
    (code >= 0x1100  && code <= 0x115F) ||
    (code >= 0x2E80  && code <= 0xA4CF) ||
    (code >= 0xAC00  && code <= 0xD7A3) ||
    (code >= 0xF900  && code <= 0xFAFF) ||
    (code >= 0xFE10  && code <= 0xFE19) ||
    (code >= 0xFE30  && code <= 0xFE6F) ||
    (code >= 0x1F300 && code <= 0x1FAD6) ||
    (code >= 0x20000 && code <= 0x2FFFD)
  ) return 2;

  return 1;
}

/**
 * Splits an ASCII-only string into segments based on newline characters.
 *
 * - Each line is pushed individually, preserving the structure.
 * - If a newline appears at the start, it is preserved as '\n'.
 * - Avoids adding empty strings at the end.
 *
 * @param formattedInput - The array to store formatted string segments.
 * @param inputString - The ASCII-only input string.
 * @returns The formatted array of string segments.
 */
function splitAsciiInput(
  formattedInput: string[],
  inputString: string
): string[] {
  let prev = 0;
  let curr = inputString.indexOf('\n', prev);

  if (curr === -1) return [inputString];

  while (curr !== -1) {
    formattedInput.push(curr ? inputString.slice(prev, curr) : '\n');
    prev = curr;
    curr = inputString.indexOf('\n', prev + 1);
  }

  if (prev < inputString.length - 1) {
    formattedInput.push(inputString.slice(prev));
  }

  return formattedInput;
}

/**
 * Splits a UTF-8 encoded string into segments, ensuring wide characters
 * (e.g., emojis, CJK characters) and newline characters are isolated.
 *
 * - Preserves line structure by pushing accumulated characters until a newline
 *   or wide character.
 * - Wide characters (width 2) are isolated into their own lines.
 * - Handles surrogate pairs using `Array.from` to correctly process UTF-16.
 *
 * @param formattedInput - The array to store formatted string segments.
 * @param inputString - The UTF-8 encoded input string.
 * @returns The formatted array of string segments.
 */
function splitUtfInput(
  formattedInput: string[],
  inputString: string
): string[] {
  let line: string[] = [];

  for (const c of inputString) {
    if (c === '\n') {
      if (line.length) formattedInput.push(line.join(''));
      line = ['\n'];
    } else if (charWidth(c) === 2) {
      if (line.length) {
        formattedInput.push(line.join(''));
        line = [];
      }
      formattedInput.push(c);
    } else {
      line.push(c);
    }
  }

  if (line.length) formattedInput.push(line.join(''));

  return formattedInput;
}

/**
 * Truncates long lines and appends a visible overflow marker.
 *
 * - Adds an inverted `>` marker if a line exceeds the screen width.
 * - Pads the output with tildes (`~`) to fill the window height.
 * - Updates EOF mode if the end of content is reached.
 *
 * @param content - The full input content split into lines.
 * @param formattedContent - The array to store processed display lines.
 * @param maxRow - The maximum row index to process up to.
 * @returns A single formatted string ready to be rendered.
 */
function chopLongLines(
  content: string[],
  formattedContent: string[],
  maxRow: number
): string {
  let row = config.row;

  while (row < maxRow && row < content.length) {
    const line = content[row];

    formattedContent.push(
      line.length > config.screenWidth
        ? line.slice(0, config.screenWidth - 1) + '\x1b[7m>\x1b[0m'
        : line
    );

    row++;
  }

  mode.EOF = row === content.length && row <= maxRow;

  padToEOF(formattedContent, row, maxRow);

  return formattedContent.join('\n');
}

/**
 * Wraps long lines across multiple terminal rows based on screen width.
 *
 * - Handles partial rendering if `config.subRow` is active.
 * - Uses `partitionLine` to split long lines, `assignLine` for short ones.
 * - Updates EOF status and pads the rest of the window if needed.
 *
 * @param content - The full input content split into lines.
 * @param formattedContent - The array to store wrapped display lines.
 * @param maxRow - The maximum terminal row index to fill.
 * @returns A single formatted string ready to be rendered.
 */
function wrapLongLines(
  content: string[],
  formattedContent: string[],
  maxRow: number
): string {
  let row = config.row;
  let lastRow = row;

  let i = row;
  let line = content[i];

  if (config.subRow && i < content.length) {
    row = partitionLine(formattedContent, line, row, maxRow, true);
    i++;
  }

  while (row < maxRow && i < content.length) {
    lastRow = row;

    line = content[i];

    row = line.length > config.screenWidth
      ? partitionLine(formattedContent, line, row, maxRow)
      : assignLine(formattedContent, line, row);

    i++;
  }

  mode.EOF = i === content.length
    && row <= maxRow
    && lastRow + maxSubRow(line) - config.subRow < row;

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
 * Breaks a long line into sub-rows and appends them to the formatted output.
 *
 * - Splits a line based on `config.screenWidth` into multiple segments.
 * - Starts from `config.subRow` if it's the first line; otherwise starts at 0.
 * - Stops when the line is fully processed or the maximum row limit is reached.
 *
 * @param formattedContent - The array to store formatted line segments.
 * @param line - The long line to be partitioned.
 * @param row - The current row index.
 * @param maxRow - The maximum number of rows allowed.
 * @param firstLine - Whether this is the first line being rendered
 *                    (uses `config.subRow`).
 * @returns The next available row index after partitioning.
 */
function partitionLine(
  formattedContent: string[],
  line: string,
  row: number,
  maxRow: number,
  firstLine: boolean = false
): number {
  let subRow = firstLine ? config.subRow : 0;
  const subRows = maxSubRow(line) + 1;

  while (subRow < subRows && row < maxRow) {
    const start = subRow * config.screenWidth;
    const end = start + config.screenWidth;

    formattedContent.push(line.slice(start, end));

    row++;
    subRow++;
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
