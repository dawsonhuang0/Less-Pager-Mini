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