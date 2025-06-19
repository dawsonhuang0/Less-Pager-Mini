const getMs = (time: [number, number]) => time[0] * 1000 + time[1] / 1e6;

export async function readKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive terminal (TTY) is required to use this feature.');
  }

  return new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const keys: string[] = [];
    const listener = (key: string) => {
      const currTime = getMs(process.hrtime());
      if (keys[0] && keys[0] !== '\x3A' && currTime - startTime > (/^[A-Z]$/.test(keys[0])? 200: 100)) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', listener);
          resolve(key);
      }

      keys.push(key);
      if (keys.length > 1 || (key !== '\x1B' && !/^[A-Z]$/.test(key) && key !== '\x3A')) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', listener);
        resolve(keys[1]? keys[0] + keys[1]: keys[0]);
      }

      startTime = getMs(process.hrtime());
    };

    let startTime = getMs(process.hrtime());
    process.stdin.on('data', listener);
  });
}