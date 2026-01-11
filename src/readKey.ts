/**
 * Reads a single keypress from the terminal asynchronously.
 *
 * - Handles escape sequences by combining `\x1B` with the following character.
 * - Times out after 50ms to detect standalone ESC key.
 * - Requires the terminal to be in TTY mode.
 *
 * @returns A promise that resolves to the pressed key string.
 * @throws If the terminal is not interactive (non-TTY).
 */
export async function readKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive terminal (TTY) is required.');
  }

  return new Promise(resolve => {
    const resolveKey = (key: string) => {
      process.stdin.removeListener('data', keyListener);
      clearTimeout(timer);
      resolve(key);
    };

    let timer: ReturnType<typeof setTimeout>;

    const keyListener = (key: string) => {
      if (timer) {
        resolveKey('\x1B' + key);
      } else if (key === '\x1B') {
        timer = setTimeout(() => { resolveKey('\x1B'); }, 50);
      } else {
        resolveKey(key);
      }
    };

    process.stdin.on('data', keyListener);
  });
}
