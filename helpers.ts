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
 * Format content for rendering.
 * - Output format is determined by chopLongLines configuration.
 * 
 * @param content string content.
 * @returns formatted content for rendering.
 */
export function formatText(content: string): string {
  let formattedText = '';

  if (config.chopLongLines) {
    let rows = 0;
    let cols = 0;
    let i = 0;

    while (i < content.length && rows < config.window - 1) {
      if (rows >= config.row) formattedText += content[i];

      cols++;

      if (content[i] === '\n') {
        rows++;
        cols = 0;
      }

      if (cols === config.screenWidth && rows >= config.row) {
        if (content[i + 1] !== '\n') formattedText += '\n';
        rows++;
        cols = 0;
      }

      i++;
    }

    return formattedText;
  }

  return formattedText;
}
