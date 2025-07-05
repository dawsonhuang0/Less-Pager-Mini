/**
 * Converts input to string.
 * - symbol type will convert to empty string
 * 
 * @param input unknown input that may convert to text.
 * @param preserveFormat decide whether to format the output.
 * @returns converted string
 */
export function inputToString(
  input: unknown,
  preserveFormat: boolean
): string {
  if (Array.isArray(input)) {
    const stringifiedArray = input.map(
      item => inputToString(item, preserveFormat)
    );

    return preserveFormat
      ? stringifiedArray.toString()
      : stringifiedArray.join('\n');
  }

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
      return JSON.stringify(
        input, null, preserveFormat? 0: 2
      );
  }

  return '';
}