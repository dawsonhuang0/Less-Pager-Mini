import fs from 'fs';
import v8 from 'v8';

import { keyboard, closeTtyKeyboard, dumbTerminal } from "./keyboard";

import { shellArgv } from "./platform";

import { Actions } from "./interfaces";

import {
  config,
  mode,
  applyConfig,
  applyMode,
  resetConfig,
  resetMode,
  DEFAULT_WINDOW,
  DEFAULT_COLUMN
} from "./config";

import { help } from "./lessHelp";

import { getAction, splitKeys } from "./keys";

import {
  inputToFilePaths,
  inputToString,
  addBufferChar,
  delBufferChar,
  render,
  freezeFrame,
  unfreezeFrame,
  resetRender,
  resetBellTimer,
  ringBell,
  bufferToNum,
  calculateEOF,
  lastScreen
} from "./helpers";

import { maxSubRow, transformContent, visualWidth } from "./lines/helpers";

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
  firstCol,
  forceLineBackward,
  newlineForward,
  newlineBackward,
  onEofForward
} from "./features/moving";

import {
  search,
  startSearch,
  searchInputKey,
  execSearch,
  execFilter,
  repeatSearch,
  toggleHighlight,
  clearHighlight,
  incrementalSearch,
  restoreSearchOrigin,
  onAutosave,
  lineMatches,
  filterLines
} from "./features/searching";

import {
  firstLine,
  lastLine,
  percentLine,
  goPos,
  jumpLoc,
  matchBracket,
  brackets,
  startBrackets,
  bracketsKey,
  marks,
  shiftMarkRows,
  marksKey,
  startSetMark,
  startGoMark,
  startClearMark,
  recordLastPosition,
  resetMarks,
  adoptFileMarks,
  setMouseMark,
  goMouseMark
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
  addExamineHistory,
  setPreviousPath,
  fileInfo,
  bottomRow,
  closeAlt,
  binaryConfirm,
  revealSize,
  revealPipeEnd,
  sizeIsKnown,
  pipeDraining,
  lineBase
} from "./features/files";

import {
  follow,
  startFollow,
  stopFollow,
  pollFollow,
  FollowKind
} from "./features/follow";

import { openAltFile } from "./features/lessopen";

import { initCharset, PipeDecoder } from "./features/charset";

import {
  option,
  startOption,
  optionKey,
  optQuitAtEof,
  optSqueeze,
  optWheelLines,
  optQuitOnIntr,
  optMouse,
  optIncrSearch,
  optNoPaste,
  optRedrawOnQuit,
  optPermaMarks,
  optAutosaveAction,
  optNoInit,
  optKnowDumb,
  optNoKeypad,
  optMouseReverse,
  optEndPrompt,
  optIntrChar,
  optShowAttn,
  optNoEditWarn,
  optQuitIfOneScreen,
  optOldBot,
  jumpSindex,
  resetHeaderStart,
  reserveGutter,
  onRebuild,
  scanOptions,
  checkModelines,
  optEmouseLclick,
  optEmouseRclick,
  optWheelEnabled,
  EMOUSE_HSCROLL,
  EMOUSE_HDRAG,
  EMOUSE_VDRAG,
  applyMouse,
  applyBracketedPaste,
  hook,
  chopLine,
  gutterWidth,
  getSwindow,
  initUnsupport,
  takeCliOptions,
  flushPendopt,
  opt
} from "./options";

import {
  miscInput,
  pipeMark,
  overwrite,
  startMiscInput,
  miscInputKey,
  startLogFile,
  startPipe,
  pipeMarkKey,
  shellCommand,
  setFirstCmd,
  getFirstCmd,
  logFileTarget,
  overwriteKey,
  writeLogFile,
  versionMessage,
  printVersion,
  applyStartupLogFile,
  takeCmdAtPrompt,
  resetMisc,
  onShellAutosave
} from "./features/misc";

import { prExpand, resetProtos } from "./features/prompt";

import {
  stepTag,
  tagRow,
  currTagFile,
  onTagJump
} from "./features/tags";

import { initSecure, secureAllow } from "./features/secure";

import { bigPager, BIG_FILE_THRESHOLD } from "./bigfile/session";

import {
  userBinding,
  userIsPrefix,
  userStop,
  translateEditKey,
  loadLesskey
} from "./features/lesskey";

import { spawnSync } from "child_process";

import { loadHistory, saveHistory } from "./histfile";

import { chopLongLines } from "./lines/chopLongLines";
import { wrapLongLines } from "./lines/wrapLongLines";

import {
  CONSOLE_TITLE_START,
  CONSOLE_TITLE_END,
  CONSOLE_TITLE_RESET,
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF,
  ALTERNATE_SCROLL_OFF,
  ALTERNATE_SCROLL_ON,
  KEYPAD_ON,
  KEYPAD_OFF,
  CLEAR_LINE,
  CONSOLE_CLEAR,
  CURSOR_TO,
  INVERSE_ON,
  INVERSE_OFF,
  MOUSE_ON,
  MOUSE_OFF,
  MOUSE_SGR_ON,
  MOUSE_SGR_OFF,
  BRACKETED_PASTE_ON,
  BRACKETED_PASTE_OFF,
  initAnsiChars
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
// a pipe still delivering data into the session (og's non-seekable
// ch input); set by pagerPipe before the session starts
let pipeSource: NodeJS.ReadableStream | null = null;
let pipeDecoder: PipeDecoder | null = null;

// og recycles pipe buffers when allocation fails; v8 aborts instead,
// so the same fallback triggers near the heap limit
const HEAP_LIMIT = v8.getHeapStatistics().heap_size_limit;

const heapPressed = (): boolean =>
  process.memoryUsage().heapUsed > HEAP_LIMIT * 0.7;

// how many lines past the view the pipe may buffer before pausing,
// like og reading a pipe only on demand (backpressure stops `yes`)
const PIPE_AHEAD = 1000;

/**
 * Pages a pipe the way og does: the first data displays immediately,
 * further reads happen on demand with the pipe paused in between, and
 * end-of-file becomes known only when the writer closes. `yes | lmn`
 * therefore starts instantly and holds bounded memory until a command
 * like G drains the input.
 *
 * @param stream - The piped input (stdin).
 */
export async function pagerPipe(
  stream: NodeJS.ReadableStream
): Promise<void> {
  if (!keyboard().isTTY) {
    throw new Error('Less-pager-mini requires interactive terminal (TTY).');
  }

  const decoder = new PipeDecoder();

  // the session starts with the first chunk (or an already-ended
  // pipe), like og displaying lines as the first screenful reads
  const first = await new Promise<{ lines: string[], ended: boolean }>(
    resolve => {
      const onData = (chunk: Buffer): void => {
        stream.off('end', onEnd);
        stream.pause();
        resolve({ lines: decoder.push(chunk), ended: false });
      };

      const onEnd = (): void => {
        stream.off('data', onData);
        resolve({ lines: decoder.flush(), ended: true });
      };

      stream.once('data', onData);
      stream.once('end', onEnd);
    }
  );

  const lines = first.lines;
  if (first.ended && !lines.length) lines.push('');

  initContent(lines);

  if (!first.ended) {
    files.list[0].streaming = true;
    pipeSource = stream;
    pipeDecoder = decoder;
  }

  try {
    await contentPager(lines);
  } finally {
    pipeSource = null;
    pipeDecoder = null;
  }
}

export default async function pager(
  input: unknown,
  preserveFormat: boolean = false,
  examineFile: boolean = false
): Promise<void> {
  if (!keyboard().isTTY) {
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

  // huge files take the og-style windowed session: never loaded,
  // read in blocks on demand (the ch.c model)
  if (filePaths.length === 1) {
    try {
      if (fs.statSync(filePaths[0]).size >= BIG_FILE_THRESHOLD) {
        await bigPager(filePaths[0]);
        return;
      }
    } catch {
      // fall through to the normal open error path
    }
  }

  initFiles(filePaths);

  for (let i = 0; i < files.list.length; i++) {
    let lines = loadFile(i);

    // a binary-looking file asks before the screen starts, like og's
    // edit query; refusing moves on to the next file
    if (!lines && binaryConfirm.request) {
      binaryConfirm.request = false;
      process.stdout.write(
        `"${files.list[i].path}" may be a binary file.  See it anyway? `
      );

      const answer = await warnReturn();
      keyboard().setRawMode(false);
      keyboard().pause();
      process.stdout.write('\n');

      if (answer === 'y' || answer === 'Y') {
        files.list[i].everOpened = true;
        lines = loadFile(i);
      }
    }

    if (lines) {
      files.index = i;
      files.newFile = true;
      addExamineHistory(files.list[i].path);
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
    FORCE_LINE_FORWARD: () =>
      lineForward(content, bufferToNum(buffer) || 1, true),
    FORCE_LINE_BACKWARD: () =>
      forceLineBackward(content, bufferToNum(buffer) || 1),
    FORCE_WINDOW_BACKWARD: () => forceLineBackward(
      content,
      bufferToNum(buffer) || getSwindow()
    ),
    NEWLINE_FORWARD: () => newlineForward(content, bufferToNum(buffer) || 1),
    NEWLINE_BACKWARD: () =>
      newlineBackward(content, bufferToNum(buffer) || 1),
    GO_POS: () => goPos(content, bufferToNum(buffer)),
    SPAN_REPEAT_SEARCH: () => spanningSearch(false),
    SPAN_REVERSE_SEARCH: () => spanningSearch(true),
    NEXT_TAG: () => tagStep(1),
    PREV_TAG: () => tagStep(-1),
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
    // og binds :t to toggle-option with an extra 't', opening the
    // -t tag prompt (decode.c A_OPT_TOGGLE|A_EXTRA)
    OPTION_TAG: () => { startOption('-'); optionKey(content, 't'); },
    FIRST_LINE: () => firstLine(content, bufferToNum(buffer)),
    LAST_LINE: () => {
      // a streaming pipe reads to its end first, like og's G with a
      // blank command line (jump_forw's ch_end_seek)
      const n = bufferToNum(buffer);

      if (!pipeDrain(() => lastLine(content, n), '',
        'Cannot seek to end of file')) {
        // jump_forw's ch_end_seek reads a completed pipe's EOI even
        // without a drain; a numbered G is jump_back and reads none
        if (!n) revealPipeEnd();
        lastLine(content, n);
      }
    },
    PERCENT_LINE: () => {
      // og's % shows ierror's interruptible note (jump_percent)
      const n = bufferToNum(buffer);

      if (!pipeDrain(() => percentLine(content, n),
        'Determining length of file', 'Don\'t know length of file')) {
        // jump_percent needs ch_length: the end seek reads the EOI
        revealPipeEnd();
        percentLine(content, n);
      }
    },
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
    FOLLOW: () => beginFollow('forever'),
    FOLLOW_BELL: () => beginFollow('bell'),
    FOLLOW_HILITE: () => beginFollow('hilite'),
    OPEN_FILE: () => {
      if (!mode.HELP && secureAllow('examine')) startExamine();
    },
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
    NOACTION: () => {},
    SHELL_COMMAND: () => { if (secureAllow('shell')) startMiscInput('!'); },
    PSHELL_COMMAND: () => { if (secureAllow('shell')) startMiscInput('#'); },
    PIPE_COMMAND: () => { if (secureAllow('pipe')) startPipe(); },
    SAVE_FILE: () => startLogFile(false),
    ADD_COMMAND: () => startMiscInput('+'),
    EDIT_FILE: () => runEditor(),
    VERSION: () => versionMessage(),
  };

  let fullContent = content;
  let lastClickY = -1;

  // the still-delivering pipe state (og's lazy non-seekable reads)
  let pipeStream: NodeJS.ReadableStream | null = null;
  let pipePaused = false;
  let pipeDrainTo: (() => void) | null = null;
  let detachPipe: () => void = () => {};

  // bytes of pipe data kept in memory before the oldest recycle
  // away: -B limits it to the -b buffer space up front (ch.c's
  // maxbufs for pipes); otherwise the budget locks in at the first
  // sign of heap pressure, og's failed-allocation moment
  let pipeBudget = Infinity;

  // og paints arriving lines only while the initial forw() fills the
  // first screenful; afterwards an idle pager never repaints on new
  // pipe data (F is the follow command)
  let pipeFirstFill = true;

  // -F reads the pipe before any terminal init, like og's
  // get_one_screen: nothing may reach the screen while it decides
  let pipeProbing = false;

  // drag origins for --emouse hdrag/vdrag, like og's last_drag_x/y
  let lastDragX = -1;
  let lastDragY = -1;
  let lastFilter: ((line: string) => boolean) | null = null;

  // $LESS options apply before the display pipeline first derives,
  // like og scanning the environment ahead of opening the first file;
  // session state resets first so ++cmd and -o survive to startup,
  // and the rebuild hook drops so -s/-x/-r cannot fire a previous
  // session's pipeline
  resetMisc();
  resetBellTimer();
  onRebuild(() => {});

  // lesskey loads before $LESS scans, like og's init_cmds preceding
  // scan_option: its #env lines can set $LESS itself
  initSecure();

  // like decode.c: lesskey files are ignored under LESSSECURE
  if (secureAllow('lesskey')) loadLesskey();

  // the charset comes from the (possibly lesskey-set) environment,
  // like init_charset before the first file opens
  initCharset();
  initAnsiChars();

  // $LESS_IS_MORE selects more compatibility and the $MORE options,
  // like og's init_option and main reading the right variable
  const lim = process.env.LESS_IS_MORE;
  opt.lessIsMore = lim !== undefined && lim !== '' && lim !== '0' ? 1 : 0;

  // like og's init_prompt after less_is_more is known; $MORE below may
  // still override the prototypes with -P
  resetProtos();

  // $LESS_UNSUPPORT lists options the scan must ignore (init_unsupport)
  initUnsupport(process.env.LESS_UNSUPPORT ?? '');

  const startup = scanOptions(
    process.env[opt.lessIsMore ? 'MORE' : 'LESS'] ?? '', fullContent);

  // command line options follow the env, one scan per argument like
  // og's main; -r keeps its command line meaning there
  for (const arg of takeCliOptions()) {
    const extra = scanOptions(arg, fullContent, false);
    startup.firstCmds.push(...extra.firstCmds);
    if (extra.dohelp) startup.dohelp = true;
    if (extra.version) startup.version = true;
  }

  // a still-dangling string/number option reports now (og nopendopt)
  flushPendopt();

  // -V prints the version and never starts the pager, like og
  if (startup.version) {
    printVersion();
    return;
  }

  // the $LESSOPEN "-" forms preprocess even in-memory content, like og
  // handing the input pipe to the preprocessor with %s as "-"
  const pseudo = files.list[files.index];

  if (pseudo && pseudo.path === '-' && !pseudo.alt) {
    const alt = openAltFile('-', fullContent.join('\n') + '\n');

    if (alt) {
      pseudo.alt = alt.alt;
      pseudo.size = alt.size;
      pseudo.lines = alt.lines;
      fullContent = alt.lines;
      content = alt.lines;
    }
  }

  // a --modelines value from $LESS applies to the already-loaded file
  checkModelines(fullContent);

  // the display pipeline applies & filters, -s squeezing, -x tab stops
  // and -r control char handling to the raw lines
  function deriveContent(): string[] {
    if (!lastFilter) return transformContent(fullContent);

    // filters run in guarded slices; a catastrophic pattern (or an
    // interrupt) drops the filter instead of hanging the pager
    const filtered = filterLines(fullContent, lastFilter);

    if (!filtered) {
      lastFilter = null;
      return transformContent(fullContent);
    }

    return transformContent(filtered);
  }

  content = deriveContent();

  // -s, -x and -r reshape the displayed content when toggled
  onRebuild(() => {
    // inside the help screen the help itself repaints (og's -D and
    // friends carry O_REPAINT on the current file); the main content
    // rebuild lands in the parked copy for when help exits
    if (mode.HELP) {
      prevContent = deriveContent();
      content = transformContent(help);
      calculateEOF(content);
      return;
    }

    content = deriveContent();
    config.row = Math.min(config.row, Math.max(content.length - 1, 0));
    config.subRow = 0;
    calculateEOF(content);

    if (!mode.EOF) {
      mode.EOF = config.row > config.endRow || (
        config.row === config.endRow && config.subRow >= config.endSubRow
      );
    }
  });

  // -F prints a file that fits on one screen to the main display and
  // quits, like og's term_init skipping the init strings; more than
  // one file disables it, like main.c checking nifile()
  calculateDimensions();
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  calculateEOF(content);

  // $LESS_SHELL_LINES reserves shell rows in the fits test, like
  // get_one_screen's `nlines + shell_lines <= sc_height`
  const shellLines = Math.min(
    Math.max(parseInt(process.env.LESS_SHELL_LINES ?? '', 10) || 1, 1),
    Math.max(config.window - 1, 1)
  );

  // -F on a pipe keeps reading until a screenful or EOF before any
  // terminal init, like og's get_one_screen under F_UNTIL_SCREEN: an
  // input that ends within one screen falls through to the cat below
  if (
    optQuitIfOneScreen() && !startup.dohelp && files.list.length <= 1 &&
    files.list[files.index]?.streaming && pipeSource && pipeDecoder
  ) {
    await pipeOneScreenProbe();
  }

  let totalRows = 0;
  for (const line of content) totalRows += maxSubRow(line) + 1;

  if (
    optQuitIfOneScreen() && !startup.dohelp && files.list.length <= 1 &&
    !files.list[files.index]?.streaming &&
    totalRows + shellLines <= config.window && !choppedColumns()
  ) {
    const rows: string[] = [];

    if (chopLine() || config.col) {
      chopLongLines(content, rows);
    } else {
      wrapLongLines(content, rows);
    }

    process.stdout.write(rows.join('\n') + '\n');
    return;
  }

  const processTitle = process.title;

  let prevContent = content, prevConfig = config, prevMode = mode;
  let key = '', escCount = 0, buffer: string[] = [];
  let pendingFirstCmds: string[] = [];
  let shellPause: false | 'shell' | 'pager' = false;
  let exited = false;

  // true when the help screen IS the input (--help/-?), like og's
  // dohelp FAKE_HELPFILE; q then quits instead of restoring a file
  let startupHelp = false;
  let exit = () => {};
  let pasting = false;
  let followTimer: ReturnType<typeof setInterval> | null = null;
  let pendingEditWarn = false;
  let userSeq = '';

  // a terminal without cursor capabilities runs degraded, like og's
  // missing_cap set from the dumb/unknown termcap entry; -d suppresses
  // the warning (know_dumb) but not the degradation
  mode.DUMB = dumbTerminal();

  if (mode.DUMB && keyboard().isTTY && !optKnowDumb()) {
    process.stdout.write('WARNING: terminal is not fully functional\n');
    process.stdout.write('Press RETURN to continue ');

    // og's get_return accepts any key and quits on q
    if (await warnReturn() === 'q') {
      keyboard().setRawMode(false);
      keyboard().pause();
      closeTtyKeyboard();
      return;
    }

    process.stdout.write('\n');
  }

  // startup scan errors print before the screen erases them, gated
  // on a keystroke like og main's errmsgs check
  if (search.message) {
    process.stdout.write(search.message + '\n');

    while (search.messageQueue.length) {
      process.stdout.write(search.messageQueue.shift()! + '\n');
    }

    search.message = '';
    process.stdout.write('Press RETURN to continue ');
    await warnReturn();
    process.stdout.write('\n');
  }

  init();

  // -? pages the help file first, like og's dohelp registering
  // FAKE_HELPFILE as an input file: quitting that help quits the
  // pager, unlike the h command's overlay
  if (startup.dohelp) {
    prepareHelp();
    startupHelp = true;
  }

  // -o/-O in $LESS start logging piped-in content right away
  applyStartupLogFile(fullContent);

  // + commands (and -p searches) run at the first file, followed by
  // the ++cmd every-file command, like og's ungotten startup input
  pendingFirstCmds = startup.firstCmds;
  const everyCmd = getFirstCmd();
  if (everyCmd) pendingFirstCmds.push(everyCmd);

  // -t from $LESS queued a tag jump before the pager could run it
  onTagJump(gotoCurrentTag);

  // a still-delivering pipe keeps feeding the session (og's ch
  // reads); wired after init so appends can repaint
  if (pipeSource) attachPipe();

  // -e/-E: a forward move at end-of-file edits the next file, or
  // quits on the last one, like og's forward() calling edit_next --
  // only when EOF is already DISPLAYED: a pipe whose length is still
  // unknown takes the EOI-discovering read (and the bell) instead
  onEofForward(() => {
    if (!optQuitAtEof() || mode.HELP || !sizeIsKnown()) return false;

    if (files.list[files.index + 1] !== undefined) {
      switchToFile(files.index + 1);
    } else {
      exit();
    }

    return true;
  });

  keyboard().on('data', keyHandler);
  await new Promise<void>((resolve) => {
    exit = () => {
      exited = true;
      resolve();
    };

    // the startup replay may quit (+q), so it runs with exit armed
    if (!drainFirstCmd()) render(content, buffer);

    // --cmd runs once at the first prompt, like og's prompt() unget
    for (const sequence of splitKeys(takeCmdAtPrompt())) {
      if (exited) break;
      handleKey(sequence);
    }
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

    // the +cmd replay is queued input: it runs before the new file's
    // first paint, so the new-file prompt survives to the final frame,
    // which the replay itself has already rendered
    const drained = drainFirstCmd();

    // a paused pipe resumes when the view nears the buffered end,
    // like og reading more of a non-seekable input on demand
    pipeDemand();

    // -E quits as soon as end-of-file DISPLAYS on the last file,
    // like og's prompt() checking get_quit_at_eof()==OPT_ONPLUS
    // against eof_displayed (a pipe's end must have been read)
    // before drawing anything; -e acts on forward moves at EOF
    // instead (og's forward())
    if (!exited && optQuitAtEof() === 2 && mode.EOF && sizeIsKnown() &&
        !mode.HELP && files.list[files.index + 1] === undefined) {
      exit();
      return;
    }

    // quitting must not repaint over the final prompt, like less
    if (!exited && !drained) render(content, buffer);
  }

  /**
   * Replays queued first-file commands as keystrokes ($LESS `+cmd` at
   * startup, the `+cmd` prompt on every examined file), like less
   * feeding them through ungetsc.
   *
   * @returns True when a replay ran (and rendered) here.
   */
  function drainFirstCmd(): boolean {
    if (!pendingFirstCmds.length || exited) return false;

    const cmds = pendingFirstCmds;
    pendingFirstCmds = [];

    for (const cmd of cmds) {
      for (const sequence of splitKeys(cmd)) {
        if (exited) return true;
        handleKey(sequence);
      }

      endFirstCmd();
    }

    return true;
  }

  /**
   * Completes a replayed command, like less's getcc_end_command: an
   * open search or filter prompt gets its newline, collected digits
   * jump (`+15` acts as `15g`), other prompts wait for the user.
   */
  function endFirstCmd(): void {
    if (exited) return;

    if (search.input) {
      handleKey('\x0D');
    } else if (buffer.length) {
      handleKey('g');
    }
  }

  function keyHandler(data: Buffer): void {
    let text = data.toString();

    // --no-paste drops everything between bracketed paste markers
    if (optNoPaste() || pasting) text = stripPaste(text);

    for (const sequence of splitKeys(text)) handleKey(sequence);
  }

  function stripPaste(text: string): string {
    let out = '';
    let i = 0;

    while (i < text.length) {
      if (pasting) {
        const end = text.indexOf('\x1B[201~', i);
        if (end < 0) return out;

        i = end + 6;
        pasting = false;
      } else if (text.startsWith('\x1B[200~', i)) {
        pasting = true;
        i += 6;
      } else {
        out += text[i++];
      }
    }

    return out;
  }

  function handleKey(sequence: string): void {
    dispatchKey(sequence);

    // og's prompt() checks -F after every command returns to a true
    // prompt: quit when the entire file is displayed, and either way
    // the flag gets only one chance at this
    if (!exited && optQuitIfOneScreen()) oneScreenQuit();
  }

  /**
   * Quits at a true prompt when -F is set and the entire file is on
   * screen, like og prompt()'s quit_if_one_screen check; whether it
   * quits or not, the flag is cleared afterwards.
   */
  function oneScreenQuit(): void {
    const atPrompt = !search.message && !option.pending &&
      !search.input && !examine.pending && !miscInput.pending &&
      !brackets.pending && !marks.pending && !mode.BUFFERING &&
      !config.keyPrefix && !binaryConfirm.pending && !follow.active &&
      !pipeDraining.active && !shellPause;

    if (!atPrompt) return;

    if (
      !mode.HELP && mode.EOF && config.row === 0 &&
      config.subRow === 0 && lineBase() === 0 &&
      files.index >= files.list.length - 1 && !choppedColumns()
    ) {
      exit();
      return;
    }

    opt.quitIfOneScreen = 0;
  }

  // og's forw_line clears quit_if_one_screen whenever a chopped or
  // shifted line hides columns, so -F never quits over hidden text
  function choppedColumns(): boolean {
    if (!chopLine() && !config.col) return false;

    const usable = config.screenWidth - gutterWidth();
    return content.some(line => visualWidth(line) > usable);
  }

  function dispatchKey(sequence: string): void {
    key = sequence;

    // the interrupt key abandons a G/% pipe drain, reporting like
    // og's interrupted ch_end_seek ("Cannot seek to end of file")
    if (pipeDrainTo && (key === '\x03' || key === optIntrChar())) {
      pipeDrainTo = null;
      search.message = pipeDraining.cancelMessage;
      pipeDraining.active = false;
      render(content, buffer);
      return;
    }

    // waiting after !/|: the keypress re-enters the pager (! pauses on
    // the shell screen, | on the blank pager screen); non-return keys
    // become the next command (get_return)
    if (shellPause) {
      if (shellPause === 'shell') {
        process.stdout.write('\n');
        enterScreen();
      } else {
        resetRender();
      }

      shellPause = false;

      if (key === '\x0D' || key === '\x0A' || key === ' ') {
        render(content, buffer);
        return;
      }
    }

    // a dumb terminal has no special key capabilities: arrows and
    // other CSI/SS3 sequences are unknown commands everywhere (og's
    // SK bindings resolve to nothing without termcap) and just bell
    if (
      mode.DUMB &&
      (key.startsWith('\x1B[') || key.startsWith('\x1BO'))
    ) {
      ringBell();
      return;
    }

    // -K exits on ctrl-C, like less's quit_on_intr
    if (key === '\x03' && optQuitOnIntr()) {
      exit();
      return;
    }

    // ctrl-C at the top level clears the & filter, like og's
    // u_interrupt calling set_filter_pattern(NULL)
    if (
      key === '\x03' && !search.input && !option.pending &&
      !examine.pending && !marks.pending && !brackets.pending &&
      !miscInput.pending && search.filters.length
    ) {
      search.filters = [];
      content = deriveContent();
      calculateEOF(content);
      ringBell();
      render(content, buffer);
      return;
    }

    // ^Z suspends like og's psignals S_STOP: the tty driver would
    // stop og anywhere, prompts included; restore the terminal, stop
    // the process, and repaint when the shell resumes it
    if (key === '\x1A') {
      suspendSelf();
      return;
    }

    // during the F wait only ctrl-C and the --intr char return to the
    // prompt; other keys queue as commands for afterwards, like og's
    // read poll ungetting them
    if (follow.active) {
      // a pending message (the LESSOPEN warning) waits for RETURN
      // before the wait prompt shows again
      if (
        search.message &&
        (key === '\x0D' || key === '\x0A' || key === ' ')
      ) {
        search.message = search.messageQueue.shift() ?? '';
        render(content, buffer);
        return;
      }

      if (key === '\x03' || key === optIntrChar()) {
        // ^C arrives as og's SIGINT, whose u_interrupt handler rings
        // the bell; the --intr char (READ_INTR) leaves silently
        if (key === '\x03') ringBell();

        const queued = endFollow();
        render(content, buffer);
        for (const sequence of queued) handleKey(sequence);
      } else {
        follow.queued.push(key);
      }

      return;
    }

    // dismissing a message reveals any queued follow-up, like less's
    // consecutive blocking error() calls
    const hadMessage = search.message !== '';
    search.message = search.messageQueue.shift() ?? '';

    // RETURN and space only dismiss a pending message; other keys are
    // reprocessed as commands, like less's get_return
    if (
      hadMessage &&
      (key === '\x0D' || key === '\x0A' || key === ' ')
    ) {
      // dismissing the LESSOPEN warning continues into the editor,
      // like og's error() returning before the edit
      if (pendingEditWarn) {
        runEditor();
      }

      render(content, buffer);
      return;
    }

    // any other command abandons a pending edit warning
    if (hadMessage && pendingEditWarn && key !== 'v') {
      pendingEditWarn = false;
    }

    // #line-edit bindings translate into the built-in editing keys
    if (
      search.input || option.pending || examine.pending ||
      miscInput.pending
    ) {
      key = translateEditKey(key);
    }

    if (search.input) {
      const origin = {
        originRow: search.input.originRow,
        originSubRow: search.input.originSubRow,
        originEof: search.input.originEof,
      };

      const result = searchInputKey(key);

      if (result === 'run') {
        if (search.input.type === '&') {
          applyFilter();
        } else {
          execSearch(content);
        }
      } else if (result === 'cancel') {
        // --incsearch restores the position the prompt opened at
        if (optIncrSearch()) restoreSearchOrigin(origin);
      } else if (optIncrSearch()) {
        // incsearch paints mid-mca, clearing the trash like og's
        // repaint resetting screen_trashed
        unfreezeFrame();
        incrementalSearch(content);
      }

      render(content, buffer);
      return;
    }

    if (option.pending) {
      optionKey(content, key);

      // a completed toggle reports like og's error(): the message
      // draws over the old screen and any repaint waits for the
      // dismissing keystroke (toggle_option's screen_trashed)
      if (search.message) freezeFrame();

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

      // --autosave with `m` writes changed marks right away
      if (optPermaMarks() && optAutosaveAction('m')) saveHistory();

      render(content, buffer);
      return;
    }

    if (examine.pending) {
      if (examineKey(key) === 'run') runExamine();
      if (!drainFirstCmd()) render(content, buffer);
      return;
    }

    if (pipeMark.pending) {
      pipeMarkKey(content, key);
      render(content, buffer);
      return;
    }

    if (miscInput.pending) {
      const kind = miscInput.pending;

      if (miscInputKey(key) === 'run') {
        const text = miscInput.text;
        miscInput.text = '';
        runMiscInput(kind, text);
      }

      // no repaint while paused on the shell screen
      if (!shellPause) render(content, buffer);
      return;
    }

    if (overwrite.pending) {
      const answer = overwriteKey(key);

      if (answer === 'overwrite' || answer === 'append') {
        writeLogFile(content, answer === 'append');
      } else if (answer === 'quit') {
        exit();
        return;
      }

      render(content, buffer);
      return;
    }

    // the binary file confirmation proceeds on y/Y, like og's query
    if (binaryConfirm.pending) {
      const proceed = binaryConfirm.proceed;
      binaryConfirm.pending = false;
      binaryConfirm.proceed = null;

      if ((key === 'y' || key === 'Y') && proceed) proceed();

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

      const user = userBinding(prefix + key);

      if (user) {
        if (user.key) key = user.key;
        act(user.action);

        if (!exited && user.extra) {
          for (const sequence of splitKeys(user.extra)) handleKey(sequence);
        }

        return;
      }

      const action = userStop() ? undefined : getAction(prefix + key);
      if (action === undefined && key.length > 1) extraBells();
      act(action);
      return;
    }

    if ((key === '\x18' || key === ':') && !escCount) {
      config.keyPrefix = key;
      render(content, buffer);
      return;
    }

    // mouse wheel ticks scroll --wheel-lines lines; --rmouse (or
    // --MOUSE) reverses the scroll direction, like less; the wheel
    // is ignored without the vscroll --emouse feature (decode.c)
    if (!escCount && key.startsWith('\x1b[<64;')) {
      if (!optWheelEnabled()) return;

      if (optMouseReverse()) {
        lineForward(content, optWheelLines());
      } else {
        lineBackward(content, optWheelLines());
      }

      render(content, buffer);
      return;
    }

    if (!escCount && key.startsWith('\x1b[<65;')) {
      if (!optWheelEnabled()) return;

      if (optMouseReverse()) {
        lineBackward(content, optWheelLines());
      } else {
        lineForward(content, optWheelLines());
      }

      render(content, buffer);
      return;
    }

    // a horizontal wheel shifts --wheel-lines columns when the
    // hscroll --emouse feature is on (og's A_L_MOUSE/A_R_MOUSE)
    if (!escCount &&
        (key.startsWith('\x1b[<66;') || key.startsWith('\x1b[<67;'))) {
      if (!(opt.emouse & EMOUSE_HSCROLL)) return;

      const left = key.startsWith('\x1b[<66;') !== (optMouseReverse());

      if (mode.INIT) mode.INIT = false;

      if (left) {
        config.col = Math.max(config.col - optWheelLines(), 0);
      } else {
        config.col += optWheelLines();
      }

      render(content, buffer);
      return;
    }

    // --emouse clicks and drags, like og's mouse_button_left/right:
    // left press records the drag origin, motion events drag the text
    // (hdrag/vdrag), a same-row release sets the mouse mark '#', and
    // a right-click release jumps to it
    const click = !escCount &&
      // eslint-disable-next-line no-control-regex
      /^\x1b\[<(0|2|32);(\d+);(\d+)([Mm])/.exec(key);

    if (click && click[1] === '32' &&
        (opt.emouse & (EMOUSE_HDRAG | EMOUSE_VDRAG))) {
      const x = parseInt(click[2], 10) - 1;
      const y = parseInt(click[3], 10) - 1;

      if ((opt.emouse & EMOUSE_HDRAG) && lastDragX >= 0 &&
          x !== lastDragX) {
        // dragging right moves the text right (hshift decreases)
        config.col = Math.max(config.col - (x - lastDragX), 0);
        if (mode.INIT) mode.INIT = false;
        lastDragX = x;
      }

      if ((opt.emouse & EMOUSE_VDRAG) && lastDragY >= 0) {
        if (y > lastDragY) {
          lineBackward(content, y - lastDragY);
        } else if (y < lastDragY) {
          lineForward(content, lastDragY - y);
        }

        lastDragY = y;
      }

      render(content, buffer);
      return;
    }

    if (click && click[1] === '0' &&
        (optEmouseLclick() ||
          (opt.emouse & (EMOUSE_HDRAG | EMOUSE_VDRAG)))) {
      const x = parseInt(click[2], 10) - 1;
      const y = parseInt(click[3], 10) - 1;

      if (click[4] === 'M') {
        lastClickY = y;
        lastDragX = x;
        lastDragY = y;
      } else if (optEmouseLclick() && y < config.window - 1 &&
                 y === lastClickY) {
        setMouseMark(content, y);
      }

      render(content, buffer);
      return;
    }

    if (click && click[1] === '2' && optEmouseRclick()) {
      const y = parseInt(click[3], 10) - 1;

      if (click[4] === 'm' && y < config.window - 1) {
        goMouseMark(content);
      }

      render(content, buffer);
      return;
    }

    if (key === '\x1B') {
      // og-dumb echoes every ESC immediately (no pending unechoed
      // first ESC) and stacks the prefix without the " ESC"/" ESCESC"
      // cycle or any bells (probed); the echo shows length-1 ESCs
      if (mode.DUMB) {
        escCount++;
        config.keyPrefix = '\x1B'.repeat(escCount + 1);
        render(content, buffer);
        return;
      }

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
      // og-dumb echoes the terminating key into the pending ESC line
      // as caret notation before the sequence resolves; without clear
      // caps the echo stays behind as leftovers, like og
      if (mode.DUMB && escCount && key.length === 1) {
        process.stdout.write(key < ' ' || key === '\x7F'
          ? '^' + String.fromCharCode((key.charCodeAt(0) + 0x40) & 0x7F)
          : key);
      }

      const seq = userSeq + (escCount ? '\x1B' + key : key);

      // lesskey #command bindings run before the built-in table; the
      // canonical key serves the key-sensitive actions and the extra
      // string feeds back in, like A_EXTRA's ungotten characters
      const user = userBinding(seq);

      if (user) {
        userSeq = '';
        config.keyPrefix = '';
        if (user.key) key = user.key;
        act(user.action);
        escCount = 0;

        if (!exited && user.extra) {
          for (const sequence of splitKeys(user.extra)) handleKey(sequence);
        }

        return;
      }

      // a partial match on a longer binding collects and echoes, like
      // og's A_PREFIX state (the built-in ^X/: prefixes own theirs)
      if (
        seq[0] !== ':' && seq[0] !== '\x18' && userIsPrefix(seq)
      ) {
        userSeq = seq;
        config.keyPrefix = seq;
        escCount = 0;
        render(content, buffer);
        return;
      }

      if (userSeq) {
        // the collected sequence completes no binding: bad command
        userSeq = '';
        config.keyPrefix = '';
        escCount = 0;
        ringBell();
        render(content, buffer);
        return;
      }

      let action = userStop() ? undefined : getAction(seq);

      // og-dumb resolves an unbound ESC sequence by running the last
      // key as a plain command (probed: ESC ESC RETURN still scrolls)
      if (action === undefined && mode.DUMB && escCount) {
        action = userStop() ? undefined : getAction(key);
      }

      if (
        action === undefined && escCount && key.length > 1 && !mode.DUMB
      ) {
        extraBells();
      }

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

    if (!lines) {
      // a binary-looking file arms the y/Y confirmation prompt and
      // retries the switch on approval, like og's edit query
      if (binaryConfirm.request) {
        binaryConfirm.request = false;
        binaryConfirm.pending = true;
        binaryConfirm.proceed = () => {
          files.list[target].everOpened = true;
          switchToFile(target);
        };
      }

      return false;
    }

    saveFilePosition();
    recordLastPosition();

    // the file being left becomes '#', like less's old_ifile, and its
    // $LESSOPEN product closes ($LESSCLOSE)
    if (files.index >= 0 && files.index !== target) {
      setPreviousPath(files.list[files.index].path);
      closeAlt(files.list[files.index]);
    }

    files.index = target;
    files.newFile = true;

    // every opened file joins the examine history, like edit_ifile
    addExamineHistory(files.list[target].path);

    // the header re-anchors at the new file's top, like edit_ifile
    // calling set_header(ch_zero())
    resetHeaderStart();

    // marks restored from the history file attach to their file
    adoptFileMarks(target, lines);

    fullContent = lines;
    lastFilter = null;
    search.filters = [];
    content = deriveContent();

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

    // schedule the +cmd replay for the newly examined file
    const firstCmd = getFirstCmd();
    pendingFirstCmds = firstCmd ? [firstCmd] : [];

    return true;
  }

  /**
   * Opens a file by name, inserting it into the file list after the
   * current entry when new, like less's edit().
   *
   * @returns True when the file displayed.
   */
  function openByName(name: string): boolean {
    let at = files.list.findIndex(entry => entry.path === name);

    if (at < 0) {
      at = files.index + 1;
      files.list.splice(at, 0, { path: name, lines: null, size: 0,
        sizeKnown: true, saved: null });

      if (!loadFile(at)) {
        // a binary-looking file keeps its entry and asks first,
        // like og's edit query before registering failure
        if (binaryConfirm.request) {
          binaryConfirm.request = false;
          binaryConfirm.pending = true;
          binaryConfirm.proceed = () => {
            files.list[at].everOpened = true;
            switchToFile(at);
          };
          return false;
        }

        files.list.splice(at, 1);
        return false;
      }
    } else if (!loadFile(at)) {
      // switchToFile re-runs loadFile and arms the binary
      // confirmation itself when that is what failed
      return switchToFile(at);
    }

    return switchToFile(at);
  }

  /**
   * Jumps to the current tag match, like command.c after nexttag:
   * edit the tag's file, then land its line on the -j target.
   */
  function gotoCurrentTag(): void {
    const file = currTagFile();
    if (file === null) return;

    if (!openByName(file)) return;

    const row = tagRow(content);

    if (row === null) {
      search.message = 'Tag not found';
      return;
    }

    jumpLoc(content, row, 0, jumpSindex());
  }

  /** Steps the tag list with t / T, like A_NEXT_TAG/A_PREV_TAG. */
  function tagStep(delta: 1 | -1): void {
    if (stepTag(delta, bufferToNum(buffer) || 1) === null) {
      search.message = delta > 0 ? 'No next tag' : 'No previous tag';
      return;
    }

    gotoCurrentTag();
  }

  /**
   * Repeats the search across the file list (ESC-n / ESC-N), like og's
   * A_T_AGAIN_SEARCH continuing into the next (or previous) files.
   */
  function spanningSearch(reverse: boolean): void {
    repeatSearch(content, bufferToNum(buffer) || 1, reverse);

    while (search.message === 'Pattern not found') {
      const forward = (search.lastDir === 1) !== reverse;
      const target = files.index + (forward ? 1 : -1);

      if (target < 0 || target >= files.list.length) return;
      if (!switchToFile(target)) return;

      // a fresh file searches from its top (its end going backward)
      if (!forward) lastLine(content, 0);

      search.message = '';
      repeatSearch(content, 1, reverse);
    }
  }

  function stepFile(delta: 1 | -1): void {
    if (mode.HELP) {
      ringBell();
      return;
    }

    const target = stepFileTarget(delta, bufferToNum(buffer) || 1);

    if (target === null) {
      // :n past the last file quits with -e at end-of-file, like
      // og's A_NEXT_FILE checking get_quit_at_eof after edit_next
      if (delta > 0 && optQuitAtEof() && mode.EOF && !mode.HELP) exit();
      return;
    }

    switchToFile(target);
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
          sizeKnown: true,
          saved: null,
        });
        inserted = true;
      }

      if (!loadFile(at)) {
        // a binary-looking file keeps its entry and asks first,
        // like og's edit query
        if (binaryConfirm.request) {
          binaryConfirm.request = false;
          binaryConfirm.pending = true;

          const target = at;
          binaryConfirm.proceed = () => {
            files.list[target].everOpened = true;
            switchToFile(target);
          };

          if (inserted) insertAt++;
          continue;
        }

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

  /**
   * Runs a shell command with the terminal restored, like less's
   * lsystem: echoes the command (unless it starts with `-`), runs it
   * through $SHELL, then repaints and reports the done message.
   */
  function runShell(cmd: string, doneMsg: string | null, input?: string): void {
    // --end-prompt prints where the prompt is erased for output, like
    // og's prompting flag firing in putchr
    const endProto = mode.HELP ? null : optEndPrompt();
    const endPrompt = endProto ? prExpand(content, endProto) : '';

    // --old-bot erases the prompt from lower-left instead of the
    // current line, like og's clear_bot
    const clearBot =
      (optOldBot() ? CURSOR_TO(config.window, 1) : '\r') + CLEAR_LINE;

    // only lsystem hides a "-" command; pipe_data always echoes
    if (input === undefined && cmd.startsWith('-')) {
      cmd = cmd.slice(1);
      if (endPrompt) process.stdout.write(clearBot + endPrompt);
    } else {
      // like lsystem's clear_bot + "!cmd": the expanded command shows on
      // the pager's bottom line, so the shell screen gets only output
      process.stdout.write(clearBot + endPrompt + '!' + cmd);
    }

    suspendTerminal();

    // $SHELL -c on unix (LESS_SHELL_COPTION replaces -c, "-" drops
    // the wrapper); %COMSPEC% /c on Windows, like og's lsystem
    const argv = shellArgv(cmd);

    spawnSync(argv[0], argv[1], input === undefined
      ? { stdio: 'inherit' }
      : { stdio: ['pipe', 'inherit', 'inherit'], input });

    // raw single-key input for the done pause, still on the shell screen
    keyboard().setRawMode(true);
    keyboard().resume();

    if (doneMsg) {
      // the pipe reinits first, like pipe_data trashing the screen, so
      // its done message waits at the bottom of a blank pager screen
      if (input !== undefined) {
        enterScreen();
        process.stdout.write(CONSOLE_CLEAR);
        process.stdout.write(CURSOR_TO(config.window, 1));
        process.stdout.write(
          INVERSE_ON + doneMsg + '  (press RETURN)' + INVERSE_OFF
        );
        shellPause = 'pager';
        return;
      }

      // like lsystem: the done message waits on the shell screen so the
      // command's output stays visible until a keypress
      process.stdout.write(doneMsg + '  (press RETURN)');
      shellPause = 'shell';
      return;
    }

    enterScreen();
  }

  /**
   * Pipes the section between the current position and the stored mark
   * to a shell command (`|X`).
   *
   * - Like less's A_PIPE, the command is taken literally: no `!!`, `%`
   *   or `#` expansion; a leading `^P` suppresses the done message.
   */
  function runPipe(cmd: string): void {
    let doneMsg: string | null = '|done';

    if (cmd.startsWith('\x10')) {
      doneMsg = null;
      cmd = cmd.slice(1);
    }

    if (!pipeMark.rows.length) return;

    // v707 pipe_pos: || pipes exactly between its two marks (last
    // line completed); a single mark before the screen pipes down to
    // the bottom line, anything else pipes top through the mark
    const [row, row2] = pipeMark.rows;
    let lo: number;
    let hi: number;

    if (pipeMark.rows.length > 1) {
      lo = Math.min(row, row2);
      hi = Math.max(row, row2) + 1;
    } else if (row < config.row) {
      lo = row;
      hi = bottomRow(content) + 1;
    } else {
      lo = config.row;
      hi = row + 1;
    }

    const text = content.slice(lo, hi).join('\n') + '\n';
    runShell(cmd, doneMsg, text);
  }

  /**
   * Starts the F command, like forw_loop: jump to the end of the file,
   * then wait for new data, polling every 50ms like og's read layer.
   *
   * @param kind - `forever` (F), `bell` (ESC-f) or `hilite` (ESC-F).
   */
  function beginFollow(kind: FollowKind): void {
    // og's forw_loop is a no-op on the help file
    if (mode.HELP || follow.active) return;

    if (!startFollow(kind)) {
      ringBell();
      return;
    }

    // og's forw_loop reads immediately: a completed pipe returns
    // its EOI before the wait prompt shows
    revealPipeEnd();

    // og warns before following a $LESSOPEN replacement, and follows
    // anyway; RETURN dismisses the warning during the wait
    if (files.list[files.index]?.alt) {
      search.message = 'Warning: command may not work correctly ' +
        'when file is viewed via LESSOPEN';
    }

    // og marks the pre-follow bottom line for -w before jumping
    if (optShowAttn()) {
      const next = bottomRow(content) + 1;
      config.attnRow = next < content.length ? next : -1;
    }

    // og's forw_loop enters through jump_forw_buffered: re-entering
    // F while already at the end rings the at-end bell (jump_loc's
    // back(0) hitting eof_bell); the first F just moves there
    lastLine(content, 0);
    followTimer = setInterval(followTick, 50);
  }

  /**
   * Jumps to the end of the file without the at-end bell, like
   * forw_loop's jump_forw_buffered.
   */
  function pinToEnd(): void {
    if (config.row !== config.endRow || config.subRow !== config.endSubRow) {
      lastLine(content, 0);
    }
  }

  /**
   * One follow poll: appends new data pinned to the end of the file,
   * reopens a rotated file under --follow-name, and leaves the wait on
   * --exit-follow-on-close.
   */
  function followTick(): void {
    const result = pollFollow();
    if (result.kind === 'idle' || exited) return;

    if (result.kind === 'close') {
      endFollow();
      render(content, buffer);
      return;
    }

    if (result.kind === 'rotate') {
      rotateFollow();
      return;
    }

    const lines = result.lines;
    let matchLines = lines;

    // the first new line completes a displayed partial last line
    if (result.extendTail && fullContent.length) {
      const tail = fullContent.length - 1;
      fullContent[tail] += lines.shift();
      matchLines = [fullContent[tail], ...lines];
    }

    fullContent.push(...lines);
    content = deriveContent();
    calculateEOF(content);
    pinToEnd();

    // ESC-f bells when the search pattern matches new data, ESC-F
    // stops there, like forw_loop watching highest_hilite
    if (follow.active !== 'forever' && matchLines.some(lineMatches)) {
      ringBell();

      if (follow.active === 'hilite') {
        endFollow();
        render(content, buffer);
        return;
      }
    }

    render(content, buffer);
  }

  /**
   * Reopens a rotated file under --follow-name and keeps following,
   * like og's screen_trashed=2 reopen after curr_ifile_changed.
   */
  function rotateFollow(): void {
    const kind = follow.active as FollowKind;
    endFollow();

    const lines = loadFile(files.index);

    if (!lines) {
      // the message set by loadFile shows at the prompt
      render(content, buffer);
      return;
    }

    fullContent = lines;
    content = deriveContent();
    config.row = Math.min(config.row, Math.max(content.length - 1, 0));
    config.subRow = 0;
    calculateEOF(content);

    beginFollow(kind);
    render(content, buffer);
  }

  /**
   * Leaves the F wait and runs the keys typed during it, like og
   * processing the ungotten commands after forw_loop returns.
   *
   * @returns Queued keys when the caller replays them itself.
   */
  function endFollow(): string[] {
    if (followTimer) {
      clearInterval(followTimer);
      followTimer = null;
    }

    return stopFollow();
  }

  // ---- the streaming pipe, like og's lazy non-seekable reads ----

  /** Bytes of pipe data currently held, past recycles excluded. */
  function pipeRetained(): number {
    const entry = files.list[files.index];
    if (!entry) return 0;
    return entry.size - (entry.discardedBytes ?? 0);
  }

  /** Wires the still-delivering pipe into the session. */
  function attachPipe(): void {
    const stream = pipeSource!;
    const decoder = pipeDecoder!;
    pipeStream = stream;

    // -B bounds a pipe to the -b buffer space, like og's maxbufs
    // applying to non-seekable input when autobuf is off
    pipeBudget = opt.autoBuffers
      ? Infinity
      : Math.max(opt.bufSpace, 64) * 1024;

    let chunks = 0;

    const onData = (chunk: Buffer): void => {
      growPipe(decoder.push(chunk));

      if (pipeRetained() > pipeBudget) {
        shedPipe();
      } else if (pipeBudget === Infinity && (++chunks & 31) === 0 &&
                 heapPressed()) {
        // og's allocation failure moment: from here on the oldest
        // data recycles away instead of the process dying (ch_addbuf
        // falling back to the tail buffer)
        pipeBudget = Math.max(pipeRetained() / 2, 64 * 1024 * 1024);
        shedPipe();
      }

      // og reads a pipe only on demand: pause once far enough ahead
      // of the view, which blocks the writer (`yes` stops producing)
      if (!pipeDrainTo &&
          content.length - config.row > config.window + PIPE_AHEAD) {
        pipePaused = true;
        stream.pause();
      }
    };

    const onEnd = (): void => {
      growPipe(decoder.flush());

      // no more data will come, but og's ch_length stays unknown
      // until a read returns EOI: a drain or follow is such a read,
      // and so was the screen fill if the input ran out mid-screen
      const entry = files.list[files.index];
      if (entry) entry.streaming = false;

      if (pipeDrainTo || follow.active ||
          (!mode.HELP && screenPastEnd())) {
        revealSize();
      }

      calculateEOF(content);

      const jump = pipeDrainTo;
      pipeDrainTo = null;
      pipeDraining.active = false;

      if (jump) jump();

      if (!exited && !shellPause) render(content, buffer);
    };

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.resume();

    detachPipe = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);

      // quitting closes the pipe so the writer sees EPIPE, like og
      (stream as unknown as { destroy?: () => void }).destroy?.();

      pipeStream = null;
      pipeDrainTo = null;
      pipeDraining.active = false;
      detachPipe = () => {};
    };
  }

  /**
   * Reads the pipe until the content exceeds one screen or it ends,
   * growing the session silently, like og's get_one_screen blocking
   * in forw_line before the terminal initializes.
   */
  function pipeOneScreenProbe(): Promise<void> {
    return new Promise(resolve => {
      const stream = pipeSource!;
      const decoder = pipeDecoder!;

      const overOneScreen = (): boolean => {
        let total = 0;

        for (const line of content) {
          total += maxSubRow(line) + 1;
          if (total + shellLines > config.window) return true;
        }

        return false;
      };

      const finish = (): void => {
        stream.off('data', onData);
        stream.off('end', onEnd);
        pipeProbing = false;

        // a screenful is already buffered, so the initial fill's
        // arrival-by-arrival painting is over before it begins
        pipeFirstFill = content.length < config.window - 1;
        resolve();
      };

      const onData = (chunk: Buffer): void => {
        growPipe(decoder.push(chunk));

        if (overOneScreen()) {
          stream.pause();
          finish();
        }
      };

      const onEnd = (): void => {
        growPipe(decoder.flush());

        const entry = files.list[files.index];
        if (entry) entry.streaming = false;
        revealSize();
        finish();
      };

      pipeProbing = true;

      if (overOneScreen()) {
        finish();
        return;
      }

      stream.on('data', onData);
      stream.on('end', onEnd);
      stream.resume();
    });
  }

  /**
   * True when the current screen extends past the end of the input:
   * og's fill requested window-1 rows, so the input ending before
   * they arrived means a read already returned EOI.
   */
  function screenPastEnd(): boolean {
    let rows = -config.subRow;

    for (let r = config.row; r < content.length; r++) {
      rows += maxSubRow(content[r]) + 1;
      if (rows >= config.window - 1) return false;
    }

    return true;
  }

  /** Appends decoded pipe lines to the session, like ch growing. */
  function growPipe(raw: string[]): void {
    if (!raw.length) return;

    const entry = files.list[files.index];

    fullContent.push(...raw);

    // the byte count grows with the data, for %b and = (one newline
    // per line, like byteOffset)
    if (entry) {
      for (const line of raw) entry.size += Buffer.byteLength(line) + 1;
    }

    if (lastFilter) {
      // an active & filter re-derives over the grown input
      if (mode.HELP) {
        prevContent = deriveContent();
      } else {
        content = deriveContent();
      }
    } else {
      const add = transformContent(raw);
      const target = mode.HELP ? prevContent : content;

      // the -s squeeze run at the boundary keeps one blank line
      if (optSqueeze() && target[target.length - 1] === '') {
        while (add.length && add[0] === '') add.shift();
      }

      target.push(...add);
    }

    if (mode.HELP) return;

    calculateEOF(content);

    // sitting at the old end of the data is no longer end-of-file
    if (mode.EOF && (config.row < config.endRow ||
        (config.row === config.endRow &&
          config.subRow < config.endSubRow))) {
      mode.EOF = false;
    }

    // og displays lines only while the first screenful is filling;
    // once it completes, new pipe data never repaints an idle screen
    if (pipeFirstFill && !pipeProbing && !exited && !shellPause &&
        !pipeDrainTo) {
      if (content.length >= config.window - 1) pipeFirstFill = false;
      render(content, buffer);
    }
  }

  /**
   * Recycles the oldest half of the buffered pipe data, like og's
   * ch_addbuf failure reusing the tail buffer: the early lines become
   * unreachable (marks there are lost, like og's unreadable blocks),
   * while line numbers and byte offsets keep counting from the true
   * start via the entry's discarded bases.
   */
  function shedPipe(): void {
    if (mode.HELP) return;

    const entry = files.list[files.index];
    if (!entry || !entry.streaming) return;

    const drop = Math.floor(fullContent.length / 2);
    if (drop < 1) return;

    let bytes = 0;
    for (let i = 0; i < drop; i++) {
      bytes += Buffer.byteLength(fullContent[i]) + 1;
    }

    fullContent.splice(0, drop);
    entry.discardedLines = (entry.discardedLines ?? 0) + drop;
    entry.discardedBytes = (entry.discardedBytes ?? 0) + bytes;

    let dropped = drop;

    if (lastFilter || optSqueeze()) {
      // squeezing and filters break the 1:1 raw-to-display mapping
      const before = content.length;
      content = deriveContent();
      dropped = Math.max(before - content.length, 0);
    } else {
      content.splice(0, drop);
    }

    config.row = Math.max(config.row - dropped, 0);
    if (config.attnRow >= 0) {
      config.attnRow = config.attnRow >= dropped
        ? config.attnRow - dropped
        : -1;
    }

    shiftMarkRows(dropped);
    calculateEOF(content);
  }

  /** Resumes a paused pipe when the view nears the buffered end. */
  function pipeDemand(): void {
    if (!pipeStream || !pipePaused) return;

    if (content.length - config.row < config.window + PIPE_AHEAD / 2) {
      pipePaused = false;
      pipeStream.resume();
    }
  }

  /**
   * G and % on a streaming pipe read to end-of-file first, like og's
   * ch_end_seek loop; the interrupt key cancels it. og's G runs with
   * a blank command line, % with ierror's "Determining length" note.
   *
   * @param jump - The jump to run once the pipe ends.
   * @param note - The ierror text shown while reading (og's %).
   * @param cancelMessage - The message an interrupt reports.
   * @returns True when the jump waits for the pipe to drain.
   */
  function pipeDrain(
    jump: () => void,
    note: string,
    cancelMessage: string
  ): boolean {
    const entry = files.list[files.index];
    if (!pipeStream || !entry || !entry.streaming || mode.HELP) {
      return false;
    }

    pipeDrainTo = jump;
    pipeDraining.active = true;
    pipeDraining.note = note;
    pipeDraining.cancelMessage = cancelMessage;
    pipePaused = false;
    pipeStream.resume();
    return true;
  }

  /**
   * Edits the current file with $VISUAL or $EDITOR at the middle
   * displayed line, then re-examines it, like less's LESSEDIT proto.
   */
  function runEditor(): void {
    if (mode.HELP || !secureAllow('edit')) return;

    const entry = files.list[files.index];

    if (!entry || entry.path === '-') {
      search.message = 'Cannot edit standard input';
      return;
    }

    // og warns before editing a $LESSOPEN replacement; RETURN then
    // continues into the editor (--no-edit-warn skips this)
    if (!optNoEditWarn() && entry.alt && !pendingEditWarn) {
      pendingEditWarn = true;
      search.message = 'WARNING: This file was viewed via LESSOPEN';
      return;
    }

    pendingEditWarn = false;

    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    const line = Math.min(
      config.row + Math.floor((config.window - 1) / 2),
      content.length - 1
    ) + 1;

    runShell(`${editor} +${line} "${entry.path}"`, null);

    // the file may have changed: re-examine it, like less's reedit
    switchToFile(files.index);
  }

  function runMiscInput(
    kind: '!' | '#' | '|' | 's' | 'S' | '+',
    text: string
  ): void {
    if (kind === '!') {
      const { cmd, doneMsg } = shellCommand(text);
      runShell(cmd, doneMsg);
    } else if (kind === '#') {
      // like A_PSHELL: prompt-expanded, no !! reuse, nothing stored
      let doneMsg: string | null = '#done';

      if (text.startsWith('\x10')) {
        doneMsg = null;
        text = text.slice(1);
      }

      runShell(prExpand(content, text), doneMsg);
    } else if (kind === '|') {
      runPipe(text);
    } else if (kind === '+') {
      setFirstCmd(text);
    } else {
      const target = logFileTarget(text, kind === 'S');

      if (target === 'write') {
        writeLogFile(content, false);
      }
    }
  }

  function applyFilter(): void {
    const filter = execFilter();
    if (filter === undefined) return;

    lastFilter = filter;
    content = deriveContent();
    config.row = 0;
    config.subRow = 0;
    config.blankTop = 0;
    calculateEOF(content);
  }

  function init() {
    loadHistory();
    onAutosave(saveHistory);
    onShellAutosave(saveHistory);
    resetMarks();
    resetRender();

    // fresh terminal dimensions (and the -N/-J gutter), like og's
    // get_term at startup
    calculateDimensions();

    if (config.windowContent.length !== config.window) {
      config.windowContent = new Array(config.window).fill('');
      config.startLine = 0;
    }

    keyboard().setRawMode(true);
    keyboard().resume();
    keyboard().setEncoding('utf8');

    // the kernel process name (what Terminal shows for less itself) is
    // fixed at exec time; the OSC title is the best an interpreted
    // program can do, and process.title at least fixes ps output
    process.title = 'less-pager-mini';

    // a dumb terminal gets no title, init or keypad strings, like
    // og's empty termcap capabilities
    if (!mode.DUMB) {
      process.stdout.write(TITLE);

      // -X leaves the init/deinit strings unsent, like less
      if (!optNoInit()) {
        process.stdout.write(ALTERNATE_CONSOLE_ON);
        process.stdout.write(ALTERNATE_SCROLL_ON);
      }

      if (!optNoKeypad()) process.stdout.write(KEYPAD_ON);
    }

    // mouse tracking and bracketed paste enable with the screen,
    // like og's init()/init_mouse, not during the option scan
    hook.screenActive = true;
    applyMouse();
    applyBracketedPaste();

    // SIGTERM/SIGHUP quit cleanly, restoring the terminal like og's
    // terminate() calling quit(15); an external SIGINT acts like the
    // interrupt key (og's u_interrupt)
    process.on('SIGTERM', onTerminate);
    process.on('SIGHUP', onTerminate);
    process.on('SIGINT', onSigint);

    // a SIGUSR1 runs the $LESS_SIGUSR1 keys, like og's sigusr()
    process.on('SIGUSR1', onSigusr1);

    process.on('uncaughtException', onUncaught);

    // node's tty emits 'resize' on every platform (SIGWINCH never
    // fires on Windows, where og polls the console size instead)
    process.stdout.on('resize', onResize);

    calculateEOF(content);
  }

  /** Restores the terminal before dying on an unexpected error. */
  function onUncaught(error: unknown): void {
    cleanUp();
    console.error(error);
    process.exit(1);
  }

  /** Repaints for the new size on SIGWINCH, like og's winch(). */
  function onResize(): void {
    if (shellPause) return;

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
  }

  /** Quits cleanly on SIGTERM/SIGHUP, like og's terminate(). */
  function onTerminate(): void {
    if (!exited) exit();
  }

  /** Treats an external SIGINT as the ^C key, like og's u_interrupt. */
  function onSigint(): void {
    if (!exited) handleKey('\x03');
  }

  /** Runs the $LESS_SIGUSR1 keys on SIGUSR1, like og's sigusr(). */
  function onSigusr1(): void {
    if (exited) return;

    const cmd = process.env.LESS_SIGUSR1;
    if (!cmd) return;

    for (const sequence of splitKeys(cmd)) handleKey(sequence);
  }

  /**
   * Suspends on ^Z, like og's psignals S_STOP handling: the terminal
   * restores, the process stops, and the screen repaints when the
   * shell resumes it.
   */
  function suspendSelf(): void {
    // like signal.c: SIGTSTP is ignored when "stop" is not allowed
    if (!secureAllow('stop')) return;

    suspendTerminal();
    process.kill(process.pid, 'SIGTSTP');

    // execution continues here when the shell resumes us — or right
    // away when the kernel discards the stop (orphaned process
    // group); og's psignals resumes the same way after its kill()
    keyboard().setRawMode(true);
    keyboard().resume();
    enterScreen();
    calculateDimensions();
    calculateEOF(content);
    render(content, buffer);
  }

  /**
   * Leaves the alternate screen and raw mode so a child process can use
   * the terminal, like less de-initializing before running a command.
   */
  function suspendTerminal(): void {
    if (!mode.DUMB) {
      if (optMouse() || opt.emouse) {
        process.stdout.write(MOUSE_OFF + MOUSE_SGR_OFF);
      }

      if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_OFF);

      if (!optNoKeypad()) process.stdout.write(KEYPAD_OFF);

      if (!optNoInit()) {
        process.stdout.write(ALTERNATE_SCROLL_OFF);
        process.stdout.write(ALTERNATE_CONSOLE_OFF);
      }
    }

    keyboard().setRawMode(false);
    keyboard().pause();
    hook.screenActive = false;
  }

  function enterScreen(): void {
    if (!mode.DUMB) {
      if (!optNoInit()) {
        process.stdout.write(ALTERNATE_CONSOLE_ON);
        process.stdout.write(ALTERNATE_SCROLL_ON);
      }

      if (!optNoKeypad()) process.stdout.write(KEYPAD_ON);

      if (optMouse() || opt.emouse) {
        process.stdout.write(MOUSE_SGR_ON + MOUSE_ON);
      }

      if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_ON);
    }

    hook.screenActive = true;
    resetRender();
  }

  function calculateDimensions(): void {
    // a zero size (some pseudo-terminals) falls back like og's scrsize
    config.window = process.stdout.rows || DEFAULT_WINDOW;
    config.screenWidth = process.stdout.columns || DEFAULT_COLUMN;

    // LESS_LINES / LESS_COLUMNS override the detected size, like
    // scrsize: a negative value is relative to the real size
    const lines = parseInt(process.env.LESS_LINES ?? '', 10);
    const cols = parseInt(process.env.LESS_COLUMNS ?? '', 10);

    if (!isNaN(lines)) {
      config.window = lines < 0 ? config.window + lines : lines;
      if (config.window <= 0) config.window = DEFAULT_WINDOW;
    }

    if (!isNaN(cols)) {
      config.screenWidth = cols < 0 ? config.screenWidth + cols : cols;
      if (config.screenWidth <= 0) config.screenWidth = DEFAULT_COLUMN;
    }

    // -N and -J reserve gutter columns inside the screen width
    reserveGutter();

    config.halfWindow = Math.floor(config.window / 2);
    config.halfScreenWidth = Math.floor(config.screenWidth / 2);
  }

  function exitHelp(): boolean {
    if (!mode.HELP) return false;

    // a --help/-? screen is og's FAKE_HELPFILE input, not the h
    // command's overlay: quitting it quits the pager
    if (startupHelp) return false;

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
    // the help file renders through the normal content pipeline, so
    // its nroff overstrikes become bold/underline like og
    content = transformContent(help);
    calculateEOF(content);

    mode.HELP = true;

    // dumb rendering is a terminal property; the help screen keeps it
    mode.DUMB = prevMode.DUMB;
  }

  function cleanUp(): void {
    endFollow();
    closeAlt(files.list[files.index]);
    saveHistory();

    // a dumb terminal never received any of the smart codes
    if (!mode.DUMB) {
      // --emouse enables tracking without --mouse, so check both
      if (optMouse() || opt.emouse) {
        process.stdout.write(MOUSE_OFF + MOUSE_SGR_OFF);
      }

      // --no-paste turned bracketed paste markers on
      if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_OFF);

      if (!optNoKeypad()) process.stdout.write(KEYPAD_OFF);

      if (!optNoInit()) {
        process.stdout.write(ALTERNATE_SCROLL_OFF);
        process.stdout.write(ALTERNATE_CONSOLE_OFF);
      }

      process.stdout.write(CONSOLE_TITLE_RESET);
    } else {
      // og-dumb quits with just lower_left (a bare CR) and no newline,
      // so the shell prompt overwrites the last prompt line
      process.stdout.write('\r');
    }

    // --end-prompt prints where output resumes after the final prompt
    const endProto = mode.HELP ? null : optEndPrompt();
    if (endProto) process.stdout.write(prExpand(content, endProto));

    // --redraw-on-quit leaves the last screen on the main display
    const screen = optRedrawOnQuit() ? lastScreen() : null;
    if (screen) process.stdout.write(screen.join('\n') + '\n');

    process.title = processTitle;
    hook.screenActive = false;

    // every session listener leaves with the session, so a library
    // caller's process is untouched afterwards
    process.off('SIGTERM', onTerminate);
    process.off('SIGHUP', onTerminate);
    process.off('SIGINT', onSigint);
    process.off('SIGUSR1', onSigusr1);
    process.stdout.off('resize', onResize);
    process.off('uncaughtException', onUncaught);

    keyboard().off('data', keyHandler);
    keyboard().setRawMode(false);
    keyboard().pause();

    // the -e hook holds this session's closure otherwise
    onEofForward(null);

    // a streaming pipe closes so the writer sees EPIPE, like og
    detachPipe();

    // a /dev/tty keyboard holds the event loop open until destroyed
    closeTtyKeyboard();
  }
}


/**
 * Reads the keystroke answering the dumb terminal warning, like og's
 * get_return before the screen initializes.
 */
function warnReturn(): Promise<string> {
  keyboard().setRawMode(true);
  keyboard().resume();

  return new Promise(resolve => {
    keyboard().once('data', (data: Buffer) => {
      resolve(data.toString()[0] ?? '');
    });
  });
}

// CommonJS interop; ESM importers use the default export directly
try {
  module.exports = pager;
  module.exports.default = pager;
  module.exports.pagerPipe = pagerPipe;
} catch {
  // ESM module records are frozen
}
