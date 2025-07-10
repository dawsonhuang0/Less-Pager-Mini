import fs from 'fs';

import { config, mode } from './pagerConfig';

/**
 * Calculates the max sub-row index for a line based on screen width.
 * - Always returns 0 if config.chopLongLines is true.
 * 
 * @param line line of content.
 * @returns max subRow index.
 */
export const maxSubRow = (line: string): number =>
  config.chopLongLines? 0: Math.floor(line.length / config.screenWidth);

/**
 * Converts input to an array of file paths.
 * - Invalid paths will be ignored.
 * 
 * @param input unknown input that may convert to file paths.
 * @returns array of file paths.
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
 * Converts input to string array.
 * - Symbol type will convert to empty array.
 * 
 * @param input unknown input that may convert to string array.
 * @param preserveFormat decide whether to format the output.
 * @returns converted string array.
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
 * Formats content for rendering.
 * - Output format is determined by chopLongLines configuration.
 * 
 * @param content string content array.
 * @returns formatted content for rendering.
 */
export function formatContent(content: string[]): string {
  const maxRow = config.row + config.window - 1;
  const formattedContent: string[] = new Array(config.window).fill('');

  return config.chopLongLines
    ? chopLongLines(content, formattedContent, maxRow)
    : wrapLongLines(content, formattedContent, maxRow);
}

/**
 * Generates prompt depends on mode.
 * 
 * @returns command prompt string.
 */
export function getPrompt(): string {
  if (mode.NORMAL && !mode.EOF) return ':';

  return '';
}

/**
 * Renders processed content on terminal.
 * 
 * @param content processed string content
 */
export function renderContent(content: string): void {
  console.clear();
  process.stdout.write(content);
}

/**
 * Makes terminal play alert sound.
 */
export function ringBell(): void {
  process.stdout.write('\x07');
}

/**
 * Formats content by chopping long lines to fit screen width.
 * 
 * @param content string content array.
 * @param formattedContent formatted content array for rendering.
 * @param maxRow insertion stops when row >= maxRow.
 * @returns formatted content for rendering.
 */
function chopLongLines(
  content: string[],
  formattedContent: string[],
  maxRow: number
): string {
  let row = config.row;

  while (row < maxRow && row < content.length) {
    const line = content[row];

    formattedContent[row - config.row] = line.length > config.screenWidth
      ? line.slice(0, config.screenWidth - 1) + '\x1b[7m>\x1b[0m'
      : line;

    row++;
  }

  mode.EOF = row === content.length && row <= maxRow;
  if (mode.EOF) formattedContent[row - config.row] = '\x1b[7m(END)\x1b[0m';

  return formattedContent.join('\n');
}

/**
 * Formats content by wrapping long lines to fit screen width.
 * 
 * @param content string content array.
 * @param formattedContent formatted content array for rendering.
 * @param maxRow insertion stops when row >= maxRow.
 * @returns formatted content for rendering.
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

  if (mode.EOF) {
    while (!mode.INIT && row < maxRow) {
      formattedContent[row - config.row] = '\x1b[1m~\x1b[0m';
      row++;
    }

    formattedContent[row - config.row] = '\x1b[7m(END)\x1b[0m';
  }

  return formattedContent.join('\n');
}

/**
 * Assigns a line to formattedContent array by row.
 * 
 * @param formattedContent formatted content array for rendering.
 * @param line line of content at index i in chopLongLines.
 * @param row current row relative to terminal window.
 * @returns incremented row.
 */
function assignLine(
  formattedContent: string[],
  line: string,
  row: number
): number {
  formattedContent[row - config.row] = line;
  return row + 1;
}

/**
 * Partitions a long line and inserts each to formattedContent array.
 * 
 * @param formattedContent formatted content array for rendering.
 * @param line line of content at index i in chopLongLines.
 * @param row current row relative to terminal window.
 * @param maxRow partitioning stops when row >= maxRow.
 * @param firstLine if true, partition starts from config.subRow instead of 0.
 * @returns updated row.
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

    formattedContent[row - config.row] = line.slice(start, end);

    row++;
    subRow++;
  }

  return row;
}
