import { Actions } from "./interfaces";

import {
  config,
  mode,
  applyConfig,
  applyMode,
  resetConfig,
  resetMode
} from "./config";

import { help } from "./help";

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
  setWindowForward,
  setWindowBackward,
  setHalfWindowForward,
  setHalfWindowBackward
} from "./features/moving";

/**
 * Less-pager-mini
 *
 * - If `examineFile` is true, treats input as file path(s) and loads file
 *   content.
 * - Otherwise, converts arbitrary input into displayable string content.
 *
 * @param input - The input to render, which can be a string, object, or array.
 * @param preserveFormat - Whether to preserve original formatting
 *                         (no indentation).
 * @param examineFile - If true, treats input as file path(s) and reads from
 *                      disk.
 */
export default async function pager(
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

/**
 * Displays the contents of provided file paths using the pager.
 *
 * - Ignores empty file path arrays.
 * - Converts file content to string arrays for rendering.
 *
 * @param filePaths - Array of file paths to display.
 * @param preserveFormat - Whether to preserve the file’s original formatting.
 */
async function filePager(
  filePaths: string[],
  preserveFormat: boolean
): Promise<void> {
  if (!filePaths.length) return;

  // remove line below in the future
  if (preserveFormat) console.log('TODO: preserveFormat not implemented yet');
}

/**
 * Starts an interactive pager session to navigate through string content.
 *
 * - Handles terminal resizing (SIGWINCH) to re-render content.
 * - Supports key-based navigation with buffered numeric input.
 * - Responds to various paging actions like line/window movement and exit.
 *
 * @param content - The content to be displayed in the pager.
 */
async function contentPager(content: string[]): Promise<void> {
  process.stdout.write('\x1b[?1049h');

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

  let prevContent: string[] = [];
  let prevConfig = config;
  let prevMode = mode;

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

    if (action === 'BACKSPACE' && buffer) {
      buffer = buffer.slice(0, -1);
      continue;
    }

    switch (action) {
      case 'FORCE_EXIT':
        exit = true;
        break;

      case 'EXIT':
        exit = shouldExit();
        break;

      case 'HELP':
        prepareHelp();
        break;

      case 'LINE_FORWARD':
        lineForward(content, bufferToNum(buffer) || 1);
        break;

      case 'LINE_BACKWARD': {
        lineBackward(content, bufferToNum(buffer) || 1);
        break;
      }

      case 'WINDOW_FORWARD':
        windowForward(content, buffer);
        break;

      case 'WINDOW_BACKWARD':
        windowBackward(content, buffer);
        break;

      case 'SET_WINDOW_FORWARD':
        setWindowForward(content, buffer);
        break;

      case 'SET_WINDOW_BACKWARD':
        setWindowBackward(content, buffer);
        break;

      case 'NO_EOF_WINDOW_FORWARD':
        windowForward(content, buffer, true);
        break;

      case 'SET_HALF_WINDOW_FORWARD':
        setHalfWindowForward(content, buffer);
        break;

      case 'SET_HALF_WINDOW_BACKWARD':
        setHalfWindowBackward(content, buffer);
        break;

      case 'REPAINT':
        break;
  
      default:
        ringBell();
        render = false;
    }

    buffer = '';
  }

  process.stdin.setRawMode(false);
  process.stdin.pause();

  process.stdout.write('\x1b[?1049l');

  // helpers

  /**
   * Exits help mode if active, otherwise allows pager to exit.
   *
   * @returns `true` if should exit, `false` if returning from help.
   */
  function shouldExit(): boolean {
    if (!mode.HELP) return true;

    content = prevContent;
    applyConfig(prevConfig);
    applyMode(prevMode);

    mode.HELP = false;
    return false;
  }

  /**
   * Enters help mode by saving current state and loading help content.
   */
  function prepareHelp(): void {
    if (mode.HELP) return;
  
    prevContent = content;
    prevConfig = config;
    prevMode = mode;
  
    resetConfig();
    resetMode();
  
    mode.HELP = true;
    content = help;
  }
}
