import { it, expect, vi, beforeEach, afterEach } from 'vitest';

import { readKey } from '../src/readKey';

const mockStdin = {
  isTTY: true,
  on: vi.fn(),
  removeListener: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal('process', {
    stdin: mockStdin,
  });
  vi.clearAllMocks();

  mockStdin.isTTY = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('should throw error when not in TTY mode', async () => {
  mockStdin.isTTY = false;

  await expect(readKey()).rejects.toThrow(
    'Interactive terminal (TTY) is required to use this feature.'
  );
});

it('should resolve with regular key press', async () => {
  implement(['a']);

  const result = await readKey();
  expect(result).toBe('a');
});

it('should handle escape sequences', async () => {
  implement(['\x1B', 'v'], [10, 20]);

  const result = await readKey();
  expect(result).toBe('\x1Bv');
});

it('should resolve with standalone ESC after timeout', async () => {
  vi.useFakeTimers();

  implement(['\x1B']);

  const promise = readKey();

  vi.advanceTimersByTime(60);

  const result = await promise;
  expect(result).toBe('\x1B');

  vi.useRealTimers();
});

it('should clean up listeners and timers', async () => {
  implement(['x']);

  await readKey();
  
  expect(mockStdin.removeListener).toHaveBeenCalledWith('data', expect.any(Function));
});

/**
 * Simulates sequential keypress events for `readKey` tests.
 *
 * - Mocks `process.stdin.on('data')` to emit given keys in order.
 * - Each key is dispatched using `setTimeout` with provided delays.
 * - Defaults to 10 ms delay if `timeouts` array is not specified.
 *
 * @param keys - Array of key strings to simulate (e.g., `['\x1B', 'v']`).
 * @param timeouts - Optional delays (ms) for each key; defaults to 10 ms.
 */
function implement(keys: string[], timeouts: number[] = []): void {
  mockStdin.on.mockImplementation((event, listener) => {
    if (event === 'data') {
      for (let i = 0; i < keys.length; i++) {
        setTimeout(() => listener(keys[i]), timeouts[i] || 10);
      }
    }
  });
}
