async function readKey(): Promise<string> {
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

function getHeight(): number {
  const rows = process.stdout.rows;
  if (rows < 2) {
    throw new Error('Insufficient terminal height. Minimum required is 2 lines.');
  }
  return rows;
}

const getDisplayEndIndex = (
  curr: number,
  height: number,
  contentLength: number
): number => Math.min(contentLength, curr + height - 1);

function getPositionInfo(
  curr: number,
  listEnd: number,
  contentLength: number
): string {
  let info = `${curr + 1}`;
  if (listEnd - curr !== 1) {
    info += `-${listEnd}`;
  }
  return info + ` of ${contentLength}`;
}

function getOutput(
  curr: number,
  listEnd: number,
  content: any[],
  showPosition: boolean
): string {
  let output = '';
  for (let i = curr; i < listEnd; i++) {
    output += `${content[i]}\n`;
  }

  if (showPosition) output += getPositionInfo(curr, listEnd, content.length);

  return output + ':';
}

function render(output: string): void {
  console.clear();
  process.stdout.write(output);
}

export async function pager(
  content: any[],
  showPosition: boolean = false
): Promise<void> {
  const CTRL_C = '\u0003', UP = '\u001b[A', DOWN = '\u001b[B';

  if (content.length === 0) {
    console.log('\nNO CONTENT.\n');
    return;
  }

  let height = getHeight();
  let curr = 0;
  let listEnd = getDisplayEndIndex(curr, height, content.length);

  let output = '';
  for (let i = curr; i < listEnd; i++) {
    output += `${content[i]}\n`;
  }

  if (showPosition) output += getPositionInfo(curr, listEnd, content.length);

  output += ':';

  render(output);

  let key = await readKey();

  while (key !== CTRL_C && key.toLowerCase() !== 'q') {
    height = getHeight();

    if (key === UP && curr > 0) {
      curr--;
    } else if (key === DOWN && curr + height - 1 < content.length) {
      curr++;
    }

    listEnd = getDisplayEndIndex(curr, height, content.length);

    output = '';
    for (let i = curr; i < listEnd; i++) {
      output += `${content[i]}\n`;
    }

    if (showPosition) output += getPositionInfo(curr, listEnd, content.length);

    output += ':';

    render(output);

    key = await readKey();
  }

  if (key === '\u0003') return;
  return;
}