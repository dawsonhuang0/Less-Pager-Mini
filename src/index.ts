import { Actions } from "./interfaces";

import {
  config,
  mode,
  applyConfig,
  applyMode,
  resetConfig,
  resetMode
} from "./config";

import { help } from "./lessHelp";

import { readKey } from "./readKey";
import { getAction } from "./normalKeys";

import {
  inputToFilePaths,
  inputToString,
  addBufferChar,
  delBufferChar,
  render,
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
  setHalfWindowBackward,
  setHalfScreenRight,
  setHalfScreenLeft
} from "./features/moving";

import {
  CONSOLE_TITLE_START,
  CONSOLE_TITLE_END,
  CONSOLE_TITLE_RESET,
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF
} from "./constants";

const TITLE = CONSOLE_TITLE_START + 'less-pager-mini' + CONSOLE_TITLE_END;

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
 * - Handles terminal resizing (SIGWINCH) to repaint content.
 * - Supports key-based navigation with buffered numeric input.
 * - Responds to various paging actions like line/window movement and exit.
 *
 * @param content - The content to be displayed in the pager.
 */
async function contentPager(content: string[]): Promise<void> {
  // @ts-ignore - TODO: Remove this ignore once all Actions implemented
  const acts: Record<Actions, () => void> = {
    FORCE_EXIT: () => { exit = true; },
    EXIT: () => { exit = shouldExit(); },
    HELP: () => prepareHelp(),
    LINE_FORWARD: () => lineForward(content, bufferToNum(buffer) || 1),
    LINE_BACKWARD: () => lineBackward(content, bufferToNum(buffer) || 1),
    WINDOW_FORWARD: () => windowForward(content, buffer),
    WINDOW_BACKWARD: () => windowBackward(content, buffer),
    SET_WINDOW_FORWARD: () => setWindowForward(content, buffer),
    SET_WINDOW_BACKWARD: () => setWindowBackward(content, buffer),
    NO_EOF_WINDOW_FORWARD: () => windowForward(content, buffer, true),
    SET_HALF_WINDOW_FORWARD: () => setHalfWindowForward(content, buffer),
    SET_HALF_WINDOW_BACKWARD: () => setHalfWindowBackward(content, buffer),
    SET_HALF_SCREEN_RIGHT: () => setHalfScreenRight(buffer),
    SET_HALF_SCREEN_LEFT: () => setHalfScreenLeft(buffer),
    REPAINT: () => {},
  };

  process.stdout.write(TITLE);
  process.stdout.write(ALTERNATE_CONSOLE_ON);

  process.on('uncaughtException', (error) => {
    process.stdout.write(ALTERNATE_CONSOLE_OFF);
    process.stdout.write(CONSOLE_TITLE_RESET);
    console.error(error);
    process.exit(1);
  });

  process.on('SIGWINCH', () => {
    mode.INIT = false;

    config.window = process.stdout.rows;
    config.screenWidth = process.stdout.columns;
    config.halfWindow = Math.floor(config.window / 2);
    config.halfScreenWidth = Math.floor(config.screenWidth / 2);

    buffer = [];
    config.bufferOffset = 0;
    render(content, buffer);
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let exit = false;
  let repaint = true;
  let buffer: string[] = [];

  let prevContent: string[] = [];
  let prevConfig = config;
  let prevMode = mode;

  while (!exit) {
    mode.BUFFERING = Boolean(buffer.length);

    if (repaint) render(content, buffer);
    repaint = true;

    const key = await readKey();

    if (key >= '0' && key <= '9') {
      addBufferChar(buffer, key);
      continue;
    }

    const action: Actions | undefined = getAction(key);

    if (action === 'BACKSPACE' && buffer.length) {
      delBufferChar(buffer);
      continue;
    }

    if (action !== undefined && action in acts) {
      acts[action]();
    } else {
      ringBell();
      repaint = false;
    }

    buffer = [];
    config.bufferOffset = 0;
  }

  process.stdin.setRawMode(false);
  process.stdin.pause();

  process.stdout.write(ALTERNATE_CONSOLE_OFF);
  process.stdout.write(CONSOLE_TITLE_RESET);

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

module.exports = pager;
module.exports.default = pager;
