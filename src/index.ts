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

import { getAction } from "./normalKeys";

import {
  inputToFilePaths,
  inputToString,
  addBufferChar,
  delBufferChar,
  render,
  ringBell,
  bufferToNum,
  getLastRow
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
  ALTERNATE_CONSOLE_OFF,
  MOUSE_ON,
  MOUSE_OFF,
  MOUSE_SGR_ON,
  MOUSE_SGR_OFF
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
  if (!process.stdin.isTTY) {
    throw new Error('Less-pager-mini requires interactive terminal (TTY).');
  }

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
  // @ts-expect-error - TODO: Remove this ignore once all Actions implemented
  const acts: Record<Actions, () => void> = {
    FORCE_EXIT: () => exit(),
    EXIT: () => { if (!exitHelp()) exit(); },
    HELP: () => prepareHelp(),
    ADD_BUFFER: () => addBufferChar(buffer, key),
    DEL_BUFFER: () => delBufferChar(buffer),
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

  init();

  let prevContent = content;
  let prevConfig = config;
  let prevMode = mode;

  let key = '';
  let escCount = 0;
  let buffer: string[] = [];

  let lastRenderTime = 0;
  let repaint = false;
  paint();

  let exit = () => {};

  process.stdin.on('data', async (data: Buffer) => {
    key = data.toString();

    if (key === '\x1B') {
      escCount++;
      if (escCount > 2) escCount = 1;
    } else if (escCount) {
      act(getAction('\x1B'.repeat(escCount) + key));
      escCount = 0;
    } else if (key.startsWith('\x1B[<64')) {
      act('LINE_BACKWARD');
    } else if (key.startsWith('\x1B[<65')) {
      act('LINE_FORWARD');
    } else if (!key.startsWith('\x1B[<')) {
      act(getAction(key));
    }

    if (repaint) paint();

    // helper
    function act(action: Actions | undefined): void {
      if (action !== undefined && action in acts) {
        acts[action]();
        repaint = true;
      } else {
        ringBell();
      }

      if (action !== 'ADD_BUFFER' && action !== 'DEL_BUFFER') {
        buffer = [];
        config.bufferOffset = 0;
        mode.BUFFERING = false;
      }
    }
  });

  await new Promise<void>((resolve) => {
    exit = resolve;
  });

  cleanUp();

  // helpers

  function init() {
    process.stdout.write(TITLE);
    process.stdout.write(ALTERNATE_CONSOLE_ON);

    process.stdout.write(MOUSE_ON);
    process.stdout.write(MOUSE_SGR_ON);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.on('uncaughtException', (error) => {
      cleanUp();
      console.error(error);
      process.exit(1);
    });

    process.on('SIGWINCH', () => {
      mode.INIT = false;

      calculateDimensions();
      calculateEOF();

      buffer = [];
      config.bufferOffset = 0;
      render(content, buffer);
    });

    calculateEOF();
  }

  function calculateDimensions(): void {
    config.window = process.stdout.rows;
    config.screenWidth = process.stdout.columns;
    config.halfWindow = Math.floor(config.window / 2);
    config.halfScreenWidth = Math.floor(config.screenWidth / 2);
  }

  function calculateEOF(): void {
    const { lastRow, lastSubRow } = getLastRow(content);
    config.endRow = lastRow;
    config.endSubRow = lastSubRow;
    mode.EOF = lastRow === 0 && (config.chopLongLines || lastSubRow === 0);
  }

  function paint() {
    const now = performance.now();
    if (now - lastRenderTime < 1) return;
    lastRenderTime = now;

    render(content, buffer);
    repaint = false;
  }

  function exitHelp(): boolean {
    if (!mode.HELP) return false;

    content = prevContent;
    applyConfig(prevConfig);
    applyMode(prevMode);

    calculateDimensions();
    calculateEOF();

    return true;
  }

  function prepareHelp(): void {
    if (mode.HELP) return;

    prevConfig = config;
    resetConfig();

    prevMode = mode;
    resetMode();

    prevContent = content;
    content = help;
    calculateEOF();

    mode.HELP = true;
  }

  function cleanUp(): void {
    process.stdin.setRawMode(false);
    process.stdin.pause();

    process.stdout.write(MOUSE_SGR_OFF);
    process.stdout.write(MOUSE_OFF);

    process.stdout.write(ALTERNATE_CONSOLE_OFF);
    process.stdout.write(CONSOLE_TITLE_RESET);
  }
}

module.exports = pager;
module.exports.default = pager;
