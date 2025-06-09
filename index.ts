function listenKey(): Promise<string> {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) {
      throw new Error('Interactive terminal (TTY) is required to use this feature.');
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const listener = (key: string) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', listener);
      resolve(key);
    };

    process.stdin.on('data', listener);
  });
}

const getHeight = (): number => process.stdout.rows;

export async function pager(content: any[]): Promise<void> {
  if (content.length === 0) {
    console.log('\nNO CONTENT.\n');
    return;
  }

  const render = (content: any[], start: number, end: number): void => {
    let output = '';
    for (let i = start; i < end; i++) {
      output += content[i] + '\n';
    }

    output += end - start === 1 || content.length === 1?
      `${curr + 1}`:
      `${curr + 1}-${listTo}`;
    output += ` of ${content.length}\n`;
    output += '[q] quit, [↑] go up, [↓] go down';

    console.clear();
    process.stdout.write(`\r${output}`);
  };

  let linesHeight = getHeight();
  if (linesHeight === -1) {
    throw new Error('Insufficient terminal height. Minimum required is 2 lines.');
  }

  let curr = 0;
  let listTo = curr + linesHeight - 2 > content.length?
    content.length:
    curr + linesHeight - 2;

  render(content, curr, listTo);

  let key = await listenKey();

  while (key !== '\u0003' && key.toLowerCase() !== 'q') {
    linesHeight = getHeight();
    if (linesHeight === -1) {
      console.log(
        '\nTOO LOW TERMINAL HEIGHT,\n' +
        'Showing scrollable page aborted.\n'
      );
      return;
    }

    if (key === '\u001b[A' && curr > 0) {
      curr--;
    } else if (key === '\u001b[B' && curr + linesHeight - 2 < content.length) {
      curr++;
    }

    listTo = curr + linesHeight - 2 > content.length?
      content.length:
      curr + linesHeight - 2;

    render(content, curr, listTo);

    key = await listenKey();
  }

  if (key === '\u0003') return;
  return;
}