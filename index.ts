import { Actions } from "./interfaces";

import { readKey } from "./readKey";
import { getAction } from "./normalKeys";

import {
  inputToFilePaths,
  inputToString,
  formatContent,
  getPrompt,
  renderContent,
  ringBell
} from "./helpers";

import {
  lineForward,
  lineBackward
} from "./features/moving";

import { config } from "./pagerConfig";

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
  if (!content.length) return;

  await contentPager(content);
}

async function filePager(
  filePaths: string[],
  preserveFormat: boolean
): Promise<void> {
  if (!filePaths.length) return;
}

async function contentPager(content: string[]): Promise<void> {
  process.on('SIGWINCH', () => {
    config.window = process.stdout.rows;
    config.screenWidth = process.stdout.columns;
    config.halfWindow = config.window / 2;
    config.halfScreenWidth = config.screenWidth / 2;

    const displayContent = formatContent(content) + getPrompt();
    renderContent(displayContent);
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let exit = false;
  let render = true;

  while (!exit) {
    if (render) {
      const displayContent = formatContent(content) + getPrompt();
      renderContent(displayContent);
    }

    render = true;

    const key = await readKey();
    const action: Actions | undefined = getAction(key);

    switch (action) {
      case 'EXIT':
        exit = true;
        break;

      case 'LINE_FORWARD':
        lineForward(
          Math.floor(content[config.index].length / config.screenWidth)
        );
        break;

      case 'LINE_BACKWARD': {
        lineBackward(
          Math.floor(content[config.index].length / config.screenWidth)
        );
        break;
      }

      case 'REPAINT':
        break;
  
      default:
        ringBell();
        render = false;
    }
  }

  process.stdin.setRawMode(false);
  process.stdin.pause();
}
