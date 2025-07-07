export async function readKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive terminal (TTY) is required to use this feature.');
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
      }

      if (key !== '\x1B') resolveKey(key);

      timer = setTimeout(() => {
        resolveKey('\x1B');
      }, 50);
    };

    process.stdin.on('data', keyListener);
  });
}
