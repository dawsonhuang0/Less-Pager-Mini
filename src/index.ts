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

import { getAction, splitKeys } from "./normalKeys";

import {
  inputToFilePaths,
  inputToString,
  addBufferChar,
  delBufferChar,
  render,
  ringBell,
  bufferToNum,
  calculateEOF
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
  setHalfScreenLeft,
  lastCol,
  firstCol
} from "./features/moving";

import {
  search,
  startSearch,
  searchInputKey,
  execSearch,
  execFilter,
  repeatSearch,
  toggleHighlight,
  clearHighlight
} from "./features/searching";

import { option, startOption, optionKey } from "./features/options";

import {
  CONSOLE_TITLE_START,
  CONSOLE_TITLE_END,
  CONSOLE_TITLE_RESET,
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF,
  ALTERNATE_SCROLL_OFF,
  ALTERNATE_SCROLL_ON
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
    LAST_COL: () => lastCol(content),
    FIRST_COL: () => firstCol(),
    REPAINT: () => {},
    DROP_INPUT_REPAINT: () => {},
    SEARCH_FORWARD: () => startSearch('/', bufferToNum(buffer) || 1),
    SEARCH_BACKWARD: () => startSearch('?', bufferToNum(buffer) || 1),
    REPEAT_SEARCH: () => repeatSearch(content, bufferToNum(buffer) || 1, false),
    REVERSE_SEARCH: () => repeatSearch(content, bufferToNum(buffer) || 1, true),
    HIGHLIGHT_TOGGLE: () => toggleHighlight(),
    CLEAR_SEARCH: () => clearHighlight(),
    PATTERN_ONLY: () => {
      if (mode.HELP) {
        ringBell();
      } else {
        startSearch('&', bufferToNum(buffer) || 1);
      }
    },
    TAG_COMMAND: () => startOption(key === '_' ? '_' : '-'),
  };

  const fullContent = content;

  let prevContent = content, prevConfig = config, prevMode = mode;
  let key = '', escCount = 0, buffer: string[] = [];
  let exit = () => {};

  init();
  render(content, buffer);

  process.stdin.on('data', keyHandler);
  await new Promise<void>((resolve) => { exit = resolve; });
  cleanUp();

  // helpers

  function act(action: Actions | undefined): void {
    if (action !== undefined && action in acts) {
      acts[action]();
    } else {
      ringBell();
    }

    if (action !== 'ADD_BUFFER' && action !== 'DEL_BUFFER') {
      buffer = [];
      config.bufferOffset = 0;
      mode.BUFFERING = false;
    }

    render(content, buffer);
  }

  function keyHandler(data: Buffer): void {
    for (const sequence of splitKeys(data.toString())) handleKey(sequence);
  }

  function handleKey(sequence: string): void {
    key = sequence;

    const hadMessage = search.message !== '';
    search.message = '';

    // RETURN only dismisses a pending message; other keys act normally
    if (hadMessage && key === '\x0D') {
      render(content, buffer);
      return;
    }

    if (search.input) {
      if (searchInputKey(key) === 'run') {
        if (search.input.type === '&') {
          applyFilter();
        } else {
          execSearch(content);
        }
      }

      render(content, buffer);
      return;
    }

    if (option.pending) {
      optionKey(key);
      render(content, buffer);
      return;
    }

    if (key === '\x1B') {
      escCount++;
      if (escCount > 2) escCount = 1;
    } else {
      act(getAction('\x1B'.repeat(escCount) + key));
      escCount = 0;
    }
  }

  function applyFilter(): void {
    const filter = execFilter();
    if (filter === undefined) return;

    content = filter ? fullContent.filter(filter) : fullContent;
    config.row = 0;
    config.subRow = 0;
    calculateEOF(content);
  }

  function init() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdout.write(TITLE);
    process.stdout.write(ALTERNATE_CONSOLE_ON);
    process.stdout.write(ALTERNATE_SCROLL_ON);

    process.on('uncaughtException', (error) => {
      cleanUp();
      console.error(error);
      process.exit(1);
    });

    process.on('SIGWINCH', () => {
      mode.INIT = false;

      calculateDimensions();
      calculateEOF(content);

      if (config.windowContent.length !== config.window) {
        config.windowContent = new Array(config.window).fill('');
        config.startLine = 0;
      }

      buffer = [];
      config.bufferOffset = 0;
      render(content, buffer);
    });

    calculateEOF(content);
  }

  function calculateDimensions(): void {
    config.window = process.stdout.rows;
    config.screenWidth = process.stdout.columns;
    config.halfWindow = Math.floor(config.window / 2);
    config.halfScreenWidth = Math.floor(config.screenWidth / 2);
  }

  function exitHelp(): boolean {
    if (!mode.HELP) return false;

    content = prevContent;
    applyConfig(prevConfig);
    applyMode(prevMode);

    calculateDimensions();
    calculateEOF(content);

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
    calculateEOF(content);

    mode.HELP = true;
  }

  function cleanUp(): void {
    process.stdout.write(ALTERNATE_SCROLL_OFF);
    process.stdout.write(ALTERNATE_CONSOLE_OFF);
    process.stdout.write(CONSOLE_TITLE_RESET);

    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

module.exports = pager;
module.exports.default = pager;
