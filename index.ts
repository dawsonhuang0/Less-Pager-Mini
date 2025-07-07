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

import { config } from "./pagerConfig";

config.halfWindow = config.window / 2;
config.halfScreenWidth = config.screenWidth / 2;

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
  let render = true;

  while (true) {
    if (render) {
      const displayContent = formatContent(content) + getPrompt();
      renderContent(displayContent);
    }

    render = true;

    const key = await readKey();
    const action: Actions | undefined = getAction(key);

    switch (action) {
      case 'EXIT':
        return;
  
      case undefined:
        ringBell();
  
      default:
        render = false;
    }
  }
}
