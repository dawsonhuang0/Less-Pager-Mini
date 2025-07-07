import fs from 'fs';

import { config } from './pagerConfig';

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
 * Converts input to string.
 * - Symbol type will convert to empty string.
 * 
 * @param input unknown input that may convert to text.
 * @param preserveFormat decide whether to format the output.
 * @returns converted string.
 */
export function inputToString(
  input: unknown,
  preserveFormat: boolean
): string {
  switch (typeof input) {
    case 'string':
      return input;

    case 'undefined':
      return 'undefined';

    case 'number':
    case 'bigint':
    case 'boolean':
    case 'function':
      return input.toString();
    
    case 'object':
      return JSON.stringify(input, null, preserveFormat? 0: config.indentation);
  }

  return '';
}

/**
 * Formats content for rendering.
 * - Output format is determined by chopLongLines configuration.
 * 
 * @param content string content.
 * @returns formatted content for rendering.
 */
export function formatContent(content: string): string {
  if (config.chopLongLines) return chopLongLines(content);

  let formattedContent = '';

  let rows = 0;
  let cols = 0;
  let i = 0;

  while (i < content.length && rows < config.window - 1) {
    if (cols < config.screenWidth - 1 && rows >= config.row) {
      formattedContent += content[i];
    }

    cols++;

    if (content[i] === '\n') {
      cols = 0;
      rows++;
    }

    if (cols === config.screenWidth - 1 && content[i + 1] !== '\n') {
      formattedContent += '\x1b[7m>\x1b[0m\n';
    }

    i++;
  }

  if (rows < config.window - 1) {
    formattedContent += '\x1b[1m'
      + '\n~'.repeat(config.window - rows - 2)
      + '\x1b[0m';
  }

  return formattedContent;
}

/**
 * Generates prompt depends on program events.
 * 
 * @returns command prompt string.
 */
export function getPrompt(): string {
  let prompt = '\n:';
  return prompt;
}

/**
 * Renders processed content on terminal.
 * 
 * @param content processed string content
 */
export function renderContent(content: string): void {
  process.stdout.write('\x1b[H\x1b[2J');
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
 * @param content string content.
 * @returns formatted content for rendering.
 */
function chopLongLines(content: string): string {
  let formattedContent = '';

  let rows = 0;
  let cols = 0;
  let i = 0;

  while (i < content.length && rows < config.window - 1) {
    if (rows >= config.row) formattedContent += content[i];

    cols++;

    if (content[i] === '\n') {
      rows++;
      cols = 0;
    }

    if (cols === config.screenWidth && rows >= config.row) {
      if (content[i + 1] !== '\n') formattedContent += '\n';
      rows++;
      cols = 0;
    }

    i++;
  }

  if (rows < config.window - 1) {
    formattedContent += '\n'.repeat(config.window - rows - 1);
  }

  return formattedContent;
}
