import { expect, test } from 'vitest';

import { getAction } from '../src/normalKeys';

test('valid keys should have their corresponding event as result', () => {
  const validKeys = ['\x08', '\x7F', 'q', ':', 'g', 'G'];
  validKeys.forEach(key => expect(getAction(key)).not.toBeUndefined());
});

test('invalid keys should only have undefined as result', () => {
  const invalidKeys = ['\x1BOP', '\x1B[17~', '\x1B[24~', '\x1B[25~', '\x1B[30~', '\x1B[35~'];
  invalidKeys.forEach(key => expect(getAction(key)).toBeUndefined());
});
