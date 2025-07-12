import { Actions } from "./interfaces";

import { readKey } from "./readKey";
import { getAction } from "./normalKeys";

import {
  inputToFilePaths,
  inputToString,
  formatContent,
  getPrompt,
  renderContent,
  ringBell,
  bufferToNum
} from "./helpers";

import {
  lineForward,
  lineBackward,
  windowForward,
  windowBackward,
} from "./features/moving";

import { config, mode } from "./pagerConfig";

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
    mode.INIT = false;

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
  let buffer = '';

  while (!exit) {
    mode.BUFFERING = Boolean(buffer);

    if (render) {
      const displayContent = formatContent(content) + getPrompt() + buffer;
      renderContent(displayContent);
    }

    render = true;

    const key = await readKey();

    if (key >= '0' && key <= '9') {
      buffer += key;
      continue;
    }

    const action: Actions | undefined = getAction(key);

    switch (action) {
      case 'EXIT':
        exit = true;
        break;

      case 'LINE_FORWARD':
        lineForward(content, Math.max(bufferToNum(buffer), 1));
        break;

      case 'LINE_BACKWARD': {
        lineBackward(content, Math.max(bufferToNum(buffer), 1));
        break;
      }

      case 'WINDOW_FORWARD':
        windowForward(content, buffer);
        break;

      case 'WINDOW_BACKWARD':
        windowBackward(content, buffer);
        break;

      case 'REPAINT':
        break;
  
      default:
        ringBell();
        render = false;
    }

    buffer = '';

    if (mode.INIT && mode.EOF && action !== 'LINE_FORWARD') {
      mode.INIT = false;
    }
  }

  process.stdin.setRawMode(false);
  process.stdin.pause();
}

export default pager;
