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
  resetRender,
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

import {
  firstLine,
  lastLine,
  percentLine,
  matchBracket,
  brackets,
  startBrackets,
  bracketsKey,
  marks,
  marksKey,
  startSetMark,
  startGoMark,
  startClearMark,
  recordLastPosition,
  resetMarks
} from "./features/jumping";

import {
  files,
  examine,
  initContent,
  initFiles,
  loadFile,
  saveFilePosition,
  stepFileTarget,
  indexFileTarget,
  startExamine,
  examineKey,
  expandExamineList,
  setPreviousPath,
  fileInfo
} from "./features/files";

import { option, startOption, optionKey } from "./features/options";

import { loadHistory, saveHistory } from "./histfile";

import {
  CONSOLE_TITLE_START,
  CONSOLE_TITLE_END,
  CONSOLE_TITLE_RESET,
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF,
  ALTERNATE_SCROLL_OFF,
  ALTERNATE_SCROLL_ON,
  KEYPAD_ON,
  KEYPAD_OFF
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
    await filePager(inputToFilePaths(input));
    return;
  }

  const content = inputToString(input, preserveFormat);
  if (!content.length) return;

  initContent(content);
  await contentPager(content);
}

/**
 * Displays the contents of provided file paths using the pager.
 *
 * - Ignores empty file path arrays.
 * - Opens the first readable file; the rest form the `:n`/`:p` list.
 *
 * @param filePaths - Array of file paths to display.
 */
async function filePager(filePaths: string[]): Promise<void> {
  if (!filePaths.length) return;

  initFiles(filePaths);

  for (let i = 0; i < files.list.length; i++) {
    const lines = loadFile(i);

    if (lines) {
      files.index = i;
      files.newFile = true;
      await contentPager(lines);
      return;
    }
  }
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
    REPAINT: () => resetRender(),
    DROP_INPUT_REPAINT: () => resetRender(),
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
    FIRST_LINE: () => firstLine(content, bufferToNum(buffer) || 1),
    LAST_LINE: () => lastLine(content, bufferToNum(buffer)),
    PERCENT_LINE: () => percentLine(content, bufferToNum(buffer)),
    CURLY_BRACKET_RIGHT: () =>
      matchBracket(content, '{', '}', true, bufferToNum(buffer) || 1),
    ROUND_BRACKET_RIGHT: () =>
      matchBracket(content, '(', ')', true, bufferToNum(buffer) || 1),
    SQUARE_BRACKET_RIGHT: () =>
      matchBracket(content, '[', ']', true, bufferToNum(buffer) || 1),
    CURLY_BRACKET_LEFT: () =>
      matchBracket(content, '{', '}', false, bufferToNum(buffer) || 1),
    ROUND_BRACKET_LEFT: () =>
      matchBracket(content, '(', ')', false, bufferToNum(buffer) || 1),
    SQUARE_BRACKET_LEFT: () =>
      matchBracket(content, '[', ']', false, bufferToNum(buffer) || 1),
    CUSTOM_BRACKET_RIGHT: () => startBrackets(true, bufferToNum(buffer) || 1),
    CUSTOM_BRACKET_LEFT: () => startBrackets(false, bufferToNum(buffer) || 1),
    SET_MARK: () => startSetMark(false, bufferToNum(buffer)),
    SET_MARK_BOTTOM: () => startSetMark(true, bufferToNum(buffer)),
    GO_MARK: () => startGoMark(bufferToNum(buffer)),
    CLEAR_MARK: () => startClearMark(),
    OPEN_FILE: () => { if (!mode.HELP) startExamine(); },
    NEXT_FILE: () => stepFile(1),
    PREV_FILE: () => stepFile(-1),
    INDEX_FILE: () => {
      if (mode.HELP) {
        ringBell();
        return;
      }

      const target = indexFileTarget(bufferToNum(buffer) || 1);
      if (target !== null) switchToFile(target);
    },
    REMOVE_FILE: () => removeFile(),
    CURRENT_INFO: () => fileInfo(content),
  };

  let fullContent = content;
  const processTitle = process.title;

  let prevContent = content, prevConfig = config, prevMode = mode;
  let key = '', escCount = 0, buffer: string[] = [];
  let exited = false;
  let exit = () => {};

  init();
  render(content, buffer);

  process.stdin.on('data', keyHandler);
  await new Promise<void>((resolve) => {
    exit = () => {
      exited = true;
      resolve();
    };
  });
  cleanUp();

  // helpers

  function act(action: Actions | undefined): void {
    config.keyPrefix = '';

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

    // quitting must not repaint over the final prompt, like less
    if (!exited) render(content, buffer);
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

    if (brackets.pending) {
      bracketsKey(content, key);
      render(content, buffer);
      return;
    }

    if (marks.pending) {
      marksKey(content, key);
      render(content, buffer);
      return;
    }

    if (examine.pending) {
      if (examineKey(key) === 'run') runExamine();
      render(content, buffer);
      return;
    }

    // ^X and : start two-key commands (^X^X, :n), like less's tables
    if (config.keyPrefix === '\x18' || config.keyPrefix === ':') {
      const prefix = config.keyPrefix;

      // erase and newline cancel a prefix silently (CF_QUIT_ON_ERASE)
      if (
        key === '\x03' || key === '\x08' || key === '\x7F' ||
        key === '\x0D' || key === '\x0A'
      ) {
        config.keyPrefix = '';
        render(content, buffer);
        return;
      }

      const action = getAction(prefix + key);
      if (action === undefined && key.length > 1) extraBells();
      act(action);
      return;
    }

    if ((key === '\x18' || key === ':') && !escCount) {
      config.keyPrefix = key;
      render(content, buffer);
      return;
    }

    if (key === '\x1B') {
      // like less: leading ESCs are pending and unechoed (one normally,
      // three when a number is being entered, where digit mode's
      // editchar loop swallows them); further ones echo as literal
      // "ESC", a third literal is invalid and resets to one (the
      // " ESC" <-> " ESCESC" cycle), and any number of pending ESCs
      // still decodes as a single ESC prefix
      const absorb = buffer.length ? 3 : 1;

      if (escCount - absorb >= 2) {
        // " ESCESC" resets to " ESC" silently
        escCount = absorb + 1;
      } else {
        escCount++;
        const literals = escCount - absorb;

        // og rings when the second literal lands (" ESC" -> " ESCESC")
        // and when the first lands after swallowed digit-mode input
        if (literals === 2 || (literals === 1 && absorb === 3)) {
          ringBell();
        }
      }

      config.keyPrefix = '\x1B'.repeat(Math.max(escCount - absorb, 0) + 1);
      render(content, buffer);
    } else {
      const action = getAction(escCount ? '\x1B' + key : key);
      if (action === undefined && escCount && key.length > 1) extraBells();
      act(action);
      escCount = 0;
    }
  }

  // og reprocesses the leftover bytes of a special key after a failed
  // prefix combo, ringing for each — ESC + an arrow key rings three times
  function extraBells(): void {
    ringBell();
    ringBell();
  }

  /**
   * Switches the session to another file entry, like less's edit_ifile:
   * stores the position of the file being left, records the previous
   * position, and restores the target's saved position.
   */
  function switchToFile(target: number): boolean {
    const lines = loadFile(target);
    if (!lines) return false;

    saveFilePosition();
    recordLastPosition();

    // the file being left becomes '#', like less's old_ifile
    if (files.index >= 0 && files.index !== target) {
      setPreviousPath(files.list[files.index].path);
    }

    files.index = target;
    files.newFile = true;

    content = lines;
    fullContent = lines;

    const saved = files.list[target].saved;
    config.row = saved ? saved.row : 0;
    config.subRow = saved ? saved.subRow : 0;
    config.blankTop = 0;

    mode.INIT = false;
    calculateEOF(content);

    if (!mode.EOF) {
      mode.EOF = config.row > config.endRow || (
        config.row === config.endRow && config.subRow >= config.endSubRow
      );
    }

    return true;
  }

  function stepFile(delta: 1 | -1): void {
    if (mode.HELP) {
      ringBell();
      return;
    }

    const target = stepFileTarget(delta, bufferToNum(buffer) || 1);
    if (target !== null) switchToFile(target);
  }

  function removeFile(): void {
    if (mode.HELP || files.list.length <= 1) {
      ringBell();
      return;
    }

    const removed = files.index;
    const target = removed < files.list.length - 1 ? removed + 1 : removed - 1;

    if (!switchToFile(target)) return;

    files.list.splice(removed, 1);
    if (files.index > removed) files.index--;
  }

  /**
   * Opens the files named at the `Examine: ` prompt, like less's
   * edit_list: every name enters the list after the current file,
   * unopenable ones drop out, and the first good one becomes current.
   */
  function runExamine(): void {
    const names = expandExamineList(examine.text.trim());
    examine.text = '';

    // an empty answer re-examines the current file, like less
    if (!names.length) {
      if (files.index >= 0) switchToFile(files.index);
      return;
    }

    let insertAt = files.index + 1;
    let firstGood = -1;

    for (const name of names) {
      let at = files.list.findIndex(entry => entry.path === name);
      let inserted = false;

      if (at < 0) {
        at = insertAt;
        files.list.splice(at, 0, {
          path: name,
          lines: null,
          size: 0,
          saved: null,
        });
        inserted = true;
      }

      if (!loadFile(at)) {
        if (inserted) files.list.splice(at, 1);
        continue;
      }

      if (inserted) insertAt++;
      if (firstGood < 0) firstGood = at;
    }

    if (firstGood >= 0) {
      search.message = '';
      switchToFile(firstGood);
    }
  }

  function applyFilter(): void {
    const filter = execFilter();
    if (filter === undefined) return;

    content = filter ? fullContent.filter(filter) : fullContent;
    config.row = 0;
    config.subRow = 0;
    config.blankTop = 0;
    calculateEOF(content);
  }

  function init() {
    loadHistory();
    resetMarks();
    resetRender();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // the kernel process name (what Terminal shows for less itself) is
    // fixed at exec time; the OSC title is the best an interpreted
    // program can do, and process.title at least fixes ps output
    process.title = 'less-pager-mini';

    process.stdout.write(TITLE);
    process.stdout.write(ALTERNATE_CONSOLE_ON);
    process.stdout.write(ALTERNATE_SCROLL_ON);
    process.stdout.write(KEYPAD_ON);

    process.on('uncaughtException', (error) => {
      cleanUp();
      console.error(error);
      process.exit(1);
    });

    process.on('SIGWINCH', () => {
      mode.INIT = false;

      resetRender();
      calculateDimensions();
      calculateEOF(content);

      if (config.windowContent.length !== config.window) {
        config.windowContent = new Array(config.window).fill('');
        config.startLine = 0;
      }

      buffer = [];
      config.bufferOffset = 0;
      config.blankTop = 0;
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

    // calculateEOF only detects short content; restore the flag for a
    // position at the end
    if (!mode.EOF) {
      mode.EOF = config.row > config.endRow || (
        config.row === config.endRow && config.subRow >= config.endSubRow
      );
    }

    // returning from help re-edits the file, so the name shows again
    // like less's edit_ifile setting new_file
    files.newFile = true;

    return true;
  }

  function prepareHelp(): void {
    if (mode.HELP) return;

    // leaving the current content records the previous position, like
    // less's edit_ifile calling lastmark when switching to the help file
    recordLastPosition();

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
    saveHistory();

    process.stdout.write(KEYPAD_OFF);
    process.stdout.write(ALTERNATE_SCROLL_OFF);
    process.stdout.write(ALTERNATE_CONSOLE_OFF);
    process.stdout.write(CONSOLE_TITLE_RESET);

    process.title = processTitle;

    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

module.exports = pager;
module.exports.default = pager;
