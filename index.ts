import { readKey } from "./readKey";
import { inputToFilePaths, inputToString } from "./helpers";

import { Params } from "./interfaces";

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

/**
 * Less-mini-pager
 * 
 * @param input any unknown input to page.
 * @param preserveFormat if true, preserves JavaScript default formatting.
 * @param examineFile if true, attempts to treat input as file path(s)
 *                    and page content.
 * @returns void.
 */
export async function pager(
  input: unknown,
  preserveFormat: boolean = false,
  examineFile: boolean = false
): Promise<void> {
  if (examineFile) {
    await filePager(inputToFilePaths(input), preserveFormat);
    return;
  }

  const content = inputToString(input, preserveFormat);
  if (!content) return;

  await contentPager(content);
}

async function filePager(
  filePaths: string[],
  preserveFormat: boolean
): Promise<void> {
  if (!filePaths.length) return;
}

async function contentPager(content: string): Promise<void> {
  let height = getHeight();
  let curr = 0;
  let listEnd = getDisplayEndIndex(curr, height, input.length);

  render(getOutput(curr, listEnd, content, showPosition));

  let key = await readKey();

  while (key !== CTRL_C && key.toLowerCase() !== 'q') {
    height = getHeight();

    if (key === UP && curr > 0) {
      curr--;
    } else if (key === DOWN && curr + height - 1 < content.length) {
      curr++;
    }

    listEnd = getDisplayEndIndex(curr, height, content.length);

    render(getOutput(curr, listEnd, content, showPosition));

    key = await readKey();
  }

  if (key === CTRL_C) process.exit();
}

const params: Params = {

};
