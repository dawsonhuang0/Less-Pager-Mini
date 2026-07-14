import fs from 'fs';

import { keyboard, closeTtyKeyboard, dumbTerminal } from "./keyboard";

import { shellArgv } from "./platform";

import { Actions } from "./interfaces";

import { session, resetSession, deriveContent, shellReserveLines }
  from "./session";

import { startupInit, printStartupError, startupErrors, warnReturn }
  from "./startup";

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
  seedBlankFrame,
  resetRender,
  resetDumbPaint,
  markDumbPaint,
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
  lineMatches
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
  revealPipeEnd,
  sizeIsKnown,
  pipeDraining,
  lineBase,
  binFile
} from "./features/files";

import {
  follow,
  startFollow,
  stopFollow,
  pollFollow,
  FollowKind
} from "./features/follow";

import { openAltFile } from "./features/lessopen";

import { PipeDecoder } from "./features/charset";

import {
  option,
  startOption,
  optionKey,
  optQuitAtEof,
  optWheelLines,
  optQuitOnIntr,
  optMouse,
  optIncrSearch,
  optNoPaste,
  optRedrawOnQuit,
  optPermaMarks,
  optAutosaveAction,
  optNoInit,
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
  onShellAutosave
} from "./features/misc";

import { prExpand } from "./features/prompt";

import {
  stepTag,
  tagRow,
  currTagFile,
  onTagJump
} from "./features/tags";

import { cmd } from "./features/cmdbuf";

import { pipeInput, attachPipe, pipeDemand, pipeDrain,
  pipeOneScreenProbe } from "./features/pipe";

import { secureAllow } from "./features/secure";

import { bigPager, BIG_FILE_THRESHOLD } from "./bigfile/session";

import {
  userBinding,
  userIsPrefix,
  userStop,
  translateEditKey
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
  BRACKETED_PASTE_OFF
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
    pipeInput.source = stream;
    pipeInput.decoder = decoder;
  }

  try {
    await contentPager(lines);
  } finally {
    pipeInput.source = null;
    pipeInput.decoder = null;
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

  // options apply before any file opens, like og's main scanning
  // ahead of edit_first: -f must already guard the first loadFile
  const startup = startupInit([]);

  if (startup.version) {
    printVersion();
    return;
  }

  pendingStartup = startup;

  initFiles(filePaths);

  // a single sizable file streams its tail through the pipe
  // machinery so the first screenful paints immediately, like og's
  // ch reading blocks on demand instead of the whole file
  if (files.list.length === 1 && !process.env.LESSOPEN) {
    const streamed = await streamSingleFile();
    if (streamed) return;
  }

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

    // an unopenable file's error prints right away, like og's edit()
    // calling error() before the screen exists
    if (!lines && search.message) {
      printStartupError(search.message);
      search.message = '';
    }

    if (lines) {
      files.index = i;
      files.newFile = true;
      addExamineHistory(files.list[i].path);
      await contentPager(lines);
      return;
    }
  }

  // nothing opened: og's failing edit_first quits after the errors
  // have printed (main.c's quit(QUIT_ERROR))
  pendingStartup = null;
}

// a file session's startup scan runs before its first loadFile;
// contentPager consumes it (og applies options ahead of edit_first)
let pendingStartup: ReturnType<typeof startupInit> | null = null;

// files at least this big stream instead of loading eagerly
const STREAM_FILE_MIN = 1024 * 1024;

// og's MAX_PASTE_IGNORE_SEC: a lost end marker stops eating input
const MAX_PASTE_IGNORE_MS = 5000;

/**
 * Opens a single regular file as a stream: the head block reads
 * synchronously (og's edit reading its first block for bin_file) and
 * the rest arrives through the pipe machinery's on-demand reads,
 * like og's ch layer pulling blocks as the display needs them. The
 * file's length is known from stat, so unlike a true pipe the
 * prompts and (END) never wait on EOI.
 *
 * @returns True when the session ran (or was refused) here; false
 *   falls back to the eager loader.
 */
async function streamSingleFile(): Promise<boolean> {
  const entry = files.list[0];

  let stat;
  try {
    stat = fs.statSync(entry.path);
  } catch {
    return false;
  }

  if (!stat.isFile() || stat.size < STREAM_FILE_MIN) return false;

  let head = Buffer.alloc(64 * 1024);
  let n = 0;

  try {
    const fd = fs.openSync(entry.path, 'r');
    n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
  } catch {
    return false;
  }

  head = head.subarray(0, n);

  // og's edit asks about a binary-looking file before the screen
  // starts; refusing the only file quits
  if (!opt.forceOpen && keyboard().isTTY && binFile(head)) {
    process.stdout.write(
      `"${entry.path}" may be a binary file.  See it anyway? `
    );

    const answer = await warnReturn();
    keyboard().setRawMode(false);
    keyboard().pause();
    process.stdout.write('\n');

    if (answer !== 'y' && answer !== 'Y') return true;
  }

  entry.size = stat.size;
  entry.sizeKnown = true;
  entry.everOpened = true;
  entry.streaming = true;

  const decoder = new PipeDecoder();
  const lines = decoder.push(head);
  if (!lines.length) lines.push('');

  checkModelines(lines);

  files.index = 0;
  files.newFile = true;
  addExamineHistory(entry.path);

  pipeInput.source = fs.createReadStream(entry.path, { start: n });
  pipeInput.decoder = decoder;

  try {
    await contentPager(lines);
  } finally {
    pipeInput.source = null;
    pipeInput.decoder = null;
  }

  return true;
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
async function contentPager(initialContent: string[]): Promise<void> {
  resetSession(initialContent);

  // @ts-expect-error - TODO: Remove this ignore once all Actions implemented
  const acts: Record<Actions, () => void> = {
    FORCE_EXIT: () => session.exit(),
    EXIT: () => { if (!exitHelp()) session.exit(); },
    HELP: () => prepareHelp(),
    ADD_BUFFER: () => addBufferChar(session.buffer, session.key),
    DEL_BUFFER: () => delBufferChar(session.buffer),
    LINE_FORWARD: () => lineForward(session.content, bufferToNum(session.buffer) || 1),
    FORCE_LINE_FORWARD: () =>
      lineForward(session.content, bufferToNum(session.buffer) || 1, true),
    FORCE_LINE_BACKWARD: () =>
      forceLineBackward(session.content, bufferToNum(session.buffer) || 1),
    FORCE_WINDOW_BACKWARD: () => forceLineBackward(
      session.content,
      bufferToNum(session.buffer) || getSwindow()
    ),
    NEWLINE_FORWARD: () => newlineForward(session.content, bufferToNum(session.buffer) || 1),
    NEWLINE_BACKWARD: () =>
      newlineBackward(session.content, bufferToNum(session.buffer) || 1),
    GO_POS: () => goPos(session.content, bufferToNum(session.buffer)),
    SPAN_REPEAT_SEARCH: () => spanningSearch(false),
    SPAN_REVERSE_SEARCH: () => spanningSearch(true),
    NEXT_TAG: () => tagStep(1),
    PREV_TAG: () => tagStep(-1),
    LINE_BACKWARD: () => lineBackward(session.content, bufferToNum(session.buffer) || 1),
    WINDOW_FORWARD: () => windowForward(session.content, session.buffer),
    WINDOW_BACKWARD: () => windowBackward(session.content, session.buffer),
    SET_WINDOW_FORWARD: () => setWindowForward(session.content, session.buffer),
    SET_WINDOW_BACKWARD: () => setWindowBackward(session.content, session.buffer),
    NO_EOF_WINDOW_FORWARD: () => windowForward(session.content, session.buffer, true),
    SET_HALF_WINDOW_FORWARD: () => setHalfWindowForward(session.content, session.buffer),
    SET_HALF_WINDOW_BACKWARD: () => setHalfWindowBackward(session.content, session.buffer),
    SET_HALF_SCREEN_RIGHT: () => setHalfScreenRight(session.buffer),
    SET_HALF_SCREEN_LEFT: () => setHalfScreenLeft(session.buffer),
    LAST_COL: () => lastCol(session.content),
    FIRST_COL: () => firstCol(),
    REPAINT: () => resetRender(),
    DROP_INPUT_REPAINT: () => resetRender(),
    SEARCH_FORWARD: () => startSearch('/', bufferToNum(session.buffer) || 1),
    SEARCH_BACKWARD: () => startSearch('?', bufferToNum(session.buffer) || 1),
    REPEAT_SEARCH: () => repeatSearch(session.content, bufferToNum(session.buffer) || 1, false),
    REVERSE_SEARCH: () => repeatSearch(session.content, bufferToNum(session.buffer) || 1, true),
    HIGHLIGHT_TOGGLE: () => toggleHighlight(),
    CLEAR_SEARCH: () => clearHighlight(),
    PATTERN_ONLY: () => {
      if (mode.HELP) {
        ringBell();
      } else {
        startSearch('&', bufferToNum(session.buffer) || 1);
      }
    },
    TAG_COMMAND: () => startOption(session.key === '_' ? '_' : '-'),
    // og binds :t to toggle-option with an extra 't', opening the
    // -t tag prompt (decode.c A_OPT_TOGGLE|A_EXTRA)
    OPTION_TAG: () => { startOption('-'); optionKey(session.content, 't'); },
    FIRST_LINE: () => firstLine(session.content, bufferToNum(session.buffer)),
    LAST_LINE: () => {
      // a streaming pipe reads to its end first, like og's G with a
      // blank command line (jump_forw's ch_end_seek)
      const n = bufferToNum(session.buffer);

      if (!pipeDrain(() => lastLine(session.content, n), '',
        'Cannot seek to end of file')) {
        // jump_forw's ch_end_seek reads a completed pipe's EOI even
        // without a drain; a numbered G is jump_back and reads none
        if (!n) revealPipeEnd();
        lastLine(session.content, n);
      }
    },
    PERCENT_LINE: () => {
      // og's % shows ierror's interruptible note (jump_percent)
      const n = bufferToNum(session.buffer);

      if (!pipeDrain(() => percentLine(session.content, n),
        'Determining length of file', 'Don\'t know length of file')) {
        // jump_percent needs ch_length: the end seek reads the EOI
        revealPipeEnd();
        percentLine(session.content, n);
      }
    },
    CURLY_BRACKET_RIGHT: () =>
      matchBracket(session.content, '{', '}', true, bufferToNum(session.buffer) || 1),
    ROUND_BRACKET_RIGHT: () =>
      matchBracket(session.content, '(', ')', true, bufferToNum(session.buffer) || 1),
    SQUARE_BRACKET_RIGHT: () =>
      matchBracket(session.content, '[', ']', true, bufferToNum(session.buffer) || 1),
    CURLY_BRACKET_LEFT: () =>
      matchBracket(session.content, '{', '}', false, bufferToNum(session.buffer) || 1),
    ROUND_BRACKET_LEFT: () =>
      matchBracket(session.content, '(', ')', false, bufferToNum(session.buffer) || 1),
    SQUARE_BRACKET_LEFT: () =>
      matchBracket(session.content, '[', ']', false, bufferToNum(session.buffer) || 1),
    CUSTOM_BRACKET_RIGHT: () => startBrackets(true, bufferToNum(session.buffer) || 1),
    CUSTOM_BRACKET_LEFT: () => startBrackets(false, bufferToNum(session.buffer) || 1),
    SET_MARK: () => startSetMark(false, bufferToNum(session.buffer)),
    SET_MARK_BOTTOM: () => startSetMark(true, bufferToNum(session.buffer)),
    GO_MARK: () => startGoMark(bufferToNum(session.buffer)),
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

      const target = indexFileTarget(bufferToNum(session.buffer) || 1);
      if (target !== null) switchToFile(target);
    },
    REMOVE_FILE: () => removeFile(),
    CURRENT_INFO: () => fileInfo(session.content),
    NOACTION: () => {},
    SHELL_COMMAND: () => { if (secureAllow('shell')) startMiscInput('!'); },
    PSHELL_COMMAND: () => { if (secureAllow('shell')) startMiscInput('#'); },
    PIPE_COMMAND: () => { if (secureAllow('pipe')) startPipe(); },
    SAVE_FILE: () => startLogFile(false),
    ADD_COMMAND: () => startMiscInput('+'),
    EDIT_FILE: () => runEditor(),
    VERSION: () => versionMessage(),
  };

  // $LESS and command line options are already applied for file
  // sessions (og's main scans them before edit_first opens anything);
  // in-memory and pipe sessions scan here with their content
  const startup = pendingStartup ?? startupInit(session.fullContent);
  pendingStartup = null;

  // -V prints the version and never starts the pager, like og
  if (startup.version) {
    printVersion();
    return;
  }

  // the $LESSOPEN "-" forms preprocess even in-memory content, like og
  // handing the input pipe to the preprocessor with %s as "-"
  const pseudo = files.list[files.index];

  if (pseudo && pseudo.path === '-' && !pseudo.alt) {
    const alt = openAltFile('-', session.fullContent.join('\n') + '\n');

    if (alt) {
      pseudo.alt = alt.alt;
      pseudo.size = alt.size;
      pseudo.lines = alt.lines;
      session.fullContent = alt.lines;
      session.content = alt.lines;
    }
  }

  // a --modelines value from $LESS applies to the already-loaded file
  checkModelines(session.fullContent);

  // the display pipeline applies & filters, -s squeezing, -x tab stops
  // and -r control char handling to the raw lines
  session.content = deriveContent();

  // -s, -x and -r reshape the displayed content when toggled
  onRebuild(() => {
    // inside the help screen the help itself repaints (og's -D and
    // friends carry O_REPAINT on the current file); the main content
    // rebuild lands in the parked copy for when help exits
    if (mode.HELP) {
      session.prevContent = deriveContent();
      session.content = transformContent(help);
      calculateEOF(session.content);
      return;
    }

    session.content = deriveContent();
    config.row = Math.min(config.row, Math.max(session.content.length - 1, 0));
    config.subRow = 0;
    calculateEOF(session.content);

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
  calculateEOF(session.content);

  // $LESS_SHELL_LINES reserves shell rows in the fits test, like
  // get_one_screen's `nlines + shell_lines <= sc_height`
  const shellLines = shellReserveLines();

  // -F on a pipe keeps reading until a screenful or EOF before any
  // terminal init, like og's get_one_screen under F_UNTIL_SCREEN: an
  // input that ends within one screen falls through to the cat below
  if (
    optQuitIfOneScreen() && !startup.dohelp && files.list.length <= 1 &&
    files.list[files.index]?.streaming && pipeInput.source && pipeInput.decoder
  ) {
    await pipeOneScreenProbe();
  }

  // counting display rows lays out every line -- expensive on binary
  // data -- so only the -F check pays for it, stopping past a screen
  let totalRows = 0;

  if (optQuitIfOneScreen() && !startup.dohelp) {
    for (const line of session.content) {
      totalRows += maxSubRow(line) + 1;
      if (totalRows + shellLines > config.window) break;
    }
  }

  if (
    optQuitIfOneScreen() && !startup.dohelp && files.list.length <= 1 &&
    !files.list[files.index]?.streaming &&
    totalRows + shellLines <= config.window && !choppedColumns()
  ) {
    const rows: string[] = [];

    if (chopLine() || config.col) {
      chopLongLines(session.content, rows);
    } else {
      wrapLongLines(session.content, rows);
    }

    process.stdout.write(rows.join('\n') + '\n');
    return;
  }

  const processTitle = process.title;

  // a terminal without cursor capabilities runs degraded, like og's
  // missing_cap set from the dumb/unknown termcap entry; -d suppresses
  // the warning (know_dumb) but not the degradation
  mode.DUMB = dumbTerminal();

  // messages set after the scan (a forced open's read error) still
  // print here before the screen erases them
  if (search.message) {
    printStartupError(search.message);

    while (search.messageQueue.length) {
      printStartupError(search.messageQueue.shift()!);
    }

    search.message = '';
  }

  // og main's errmsgs gate blocks in get_return, which ungets any
  // key other than RETURN or space to become the first command
  if (startupErrors.count > 0) {
    startupErrors.count = 0;
    process.stdout.write('Press RETURN to continue ');
    const answer = await warnReturn();
    process.stdout.write('\n');

    if (answer && answer !== '\x0D' && answer !== '\x0A' &&
        answer !== ' ') {
      session.ungotStartKey = answer;
    }
  }

  init();

  // -? pages the help file first, like og's dohelp registering
  // FAKE_HELPFILE as an input file: quitting that help quits the
  // pager, unlike the h command's overlay
  if (startup.dohelp) {
    prepareHelp();
    session.startupHelp = true;
  }

  // -o/-O in $LESS start logging piped-in content right away
  applyStartupLogFile(session.fullContent);

  // + commands (and -p searches) run at the first file, followed by
  // the ++cmd every-file command, like og's ungotten startup input
  session.pendingFirstCmds = startup.firstCmds;
  const everyCmd = getFirstCmd();
  if (everyCmd) session.pendingFirstCmds.push(everyCmd);

  // -t from $LESS queued a tag jump before the pager could run it
  onTagJump(gotoCurrentTag);

  // a still-delivering pipe keeps feeding the session (og's ch
  // reads); wired after init so appends can repaint
  if (pipeInput.source) attachPipe();

  // -e/-E: a forward move at end-of-file edits the next file, or
  // quits on the last one, like og's forward() calling edit_next --
  // only when EOF is already DISPLAYED: a pipe whose length is still
  // unknown takes the EOI-discovering read (and the bell) instead
  onEofForward(() => {
    if (!optQuitAtEof() || mode.HELP || !sizeIsKnown()) return false;

    if (files.list[files.index + 1] !== undefined) {
      switchToFile(files.index + 1);
    } else {
      session.exit();
    }

    return true;
  });

  keyboard().on('data', keyHandler);
  await new Promise<void>((resolve) => {
    session.exit = () => {
      session.exited = true;
      resolve();
    };

    // og's prompt() skips make_display while ungot startup input
    // (the errmsgs gate key, +cmds) collects a command: the screen
    // stays blank under the command echo until the command finishes
    if (session.pendingFirstCmds.length || session.ungotStartKey) {
      seedBlankFrame();
      freezeFrame();
    }

    // the startup replay may quit (+q), so it runs with exit armed
    const drained = drainFirstCmd();

    if (session.ungotStartKey && !session.exited) {
      // the gate's key is ordinary terminal input after the +cmds
      // (og's ungetsc stacking), with no end-command newline
      const gateKey = session.ungotStartKey;
      session.ungotStartKey = '';
      handleKey(gateKey);
    } else if (!drained) {
      render(session.content, session.buffer);
    }

    // --cmd runs once at the first prompt, like og's prompt() unget
    for (const sequence of splitKeys(takeCmdAtPrompt())) {
      if (session.exited) break;
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
      session.buffer = [];
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
    if (!session.exited && optQuitAtEof() === 2 && mode.EOF && sizeIsKnown() &&
        !mode.HELP && files.list[files.index + 1] === undefined) {
      session.exit();
      return;
    }

    // quitting must not repaint over the final prompt, like less
    if (!session.exited && !drained) render(session.content, session.buffer);
  }

  /**
   * Replays queued first-file commands as keystrokes ($LESS `+cmd` at
   * startup, the `+cmd` prompt on every examined file), like less
   * feeding them through ungetsc.
   *
   * @returns True when a replay ran (and rendered) here.
   */
  function drainFirstCmd(): boolean {
    if (!session.pendingFirstCmds.length || session.exited) return false;

    const cmds = session.pendingFirstCmds;
    session.pendingFirstCmds = [];

    for (const cmd of cmds) {
      for (const sequence of splitKeys(cmd)) {
        if (session.exited) return true;
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
    if (session.exited) return;

    if (search.input) {
      handleKey('\x0D');
    } else if (session.buffer.length) {
      handleKey('g');
    }
  }

  function keyHandler(data: Buffer): void {
    let text = data.toString();

    if (optNoPaste() || session.pasting || session.ignoringPaste) text = filterPaste(text);

    for (const sequence of splitKeys(text)) handleKey(sequence);
  }

  /** True while a prompt is collecting input, like og's mca != 0. */
  function promptOpen(): boolean {
    return cmd.active || !!option.pending || examine.pending ||
      !!miscInput.pending || !!brackets.pending || !!marks.pending ||
      pipeMark.pending;
  }

  /**
   * Applies --no-paste to bracketed paste markers, like og: a paste
   * at the main prompt is ignored whole (A_START_PASTE calling
   * start_ignoring_input), but a command buffer accepts the text up
   * to the first pasted newline, which starts ignoring instead of
   * executing (mca_char's pasting && no_paste).
   */
  function filterPaste(text: string): string {
    let out = '';
    let i = 0;

    while (i < text.length) {
      if (session.ignoringPaste) {
        if (Date.now() >= session.ignoreStart + MAX_PASTE_IGNORE_MS) {
          session.ignoringPaste = false;
          session.pasting = false;
          continue;
        }

        const end = text.indexOf('\x1B[201~', i);
        if (end < 0) return out;

        i = end + 6;
        session.ignoringPaste = false;
        session.pasting = false;
      } else if (text.startsWith('\x1B[200~', i)) {
        i += 6;

        if (promptOpen()) {
          session.pasting = true;
        } else {
          session.ignoringPaste = true;
          session.ignoreStart = Date.now();
        }
      } else if (session.pasting && text.startsWith('\x1B[201~', i)) {
        i += 6;
        session.pasting = false;
      } else if (session.pasting && (text[i] === '\x0D' || text[i] === '\x0A')) {
        // the pasted newline never executes the command
        session.ignoringPaste = true;
        session.ignoreStart = Date.now();
        i++;
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
    if (!session.exited && optQuitIfOneScreen()) oneScreenQuit();
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
      !pipeDraining.active && !session.shellPause;

    if (!atPrompt) return;

    if (
      !mode.HELP && mode.EOF && config.row === 0 &&
      config.subRow === 0 && lineBase() === 0 &&
      files.index >= files.list.length - 1 && !choppedColumns()
    ) {
      session.exit();
      return;
    }

    opt.quitIfOneScreen = 0;
  }

  // og's forw_line clears quit_if_one_screen whenever a chopped or
  // shifted line hides columns, so -F never quits over hidden text
  function choppedColumns(): boolean {
    if (!chopLine() && !config.col) return false;

    const usable = config.screenWidth - gutterWidth();
    return session.content.some(line => visualWidth(line) > usable);
  }

  function dispatchKey(sequence: string): void {
    session.key = sequence;

    // the interrupt key abandons a G/% pipe drain, reporting like
    // og's interrupted ch_end_seek ("Cannot seek to end of file")
    if (session.pipeDrainTo && (session.key === '\x03' || session.key === optIntrChar())) {
      session.pipeDrainTo = null;
      search.message = pipeDraining.cancelMessage;
      pipeDraining.active = false;
      render(session.content, session.buffer);
      return;
    }

    // waiting after !/|: the keypress re-enters the pager (! pauses on
    // the shell screen, | on the blank pager screen); non-return keys
    // become the next command (get_return)
    if (session.shellPause) {
      if (session.shellPause === 'shell') {
        process.stdout.write('\n');
        enterScreen();
      } else {
        resetRender();
      }

      session.shellPause = false;

      if (session.key === '\x0D' || session.key === '\x0A' || session.key === ' ') {
        render(session.content, session.buffer);
        return;
      }
    }

    // a dumb terminal has no special key capabilities: arrows and
    // other CSI/SS3 sequences are unknown commands everywhere (og's
    // SK bindings resolve to nothing without termcap) and just bell
    if (
      mode.DUMB &&
      (session.key.startsWith('\x1B[') || session.key.startsWith('\x1BO'))
    ) {
      ringBell();
      return;
    }

    // -K exits on ctrl-C, like less's quit_on_intr
    if (session.key === '\x03' && optQuitOnIntr()) {
      session.exit();
      return;
    }

    // ctrl-C at the top level clears the & filter, like og's
    // u_interrupt calling set_filter_pattern(NULL)
    if (
      session.key === '\x03' && !search.input && !option.pending &&
      !examine.pending && !marks.pending && !brackets.pending &&
      !miscInput.pending && search.filters.length
    ) {
      search.filters = [];
      session.content = deriveContent();
      calculateEOF(session.content);
      ringBell();
      render(session.content, session.buffer);
      return;
    }

    // ^Z suspends like og's psignals S_STOP: the tty driver would
    // stop og anywhere, prompts included; restore the terminal, stop
    // the process, and repaint when the shell resumes it
    if (session.key === '\x1A') {
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
        (session.key === '\x0D' || session.key === '\x0A' || session.key === ' ')
      ) {
        search.message = search.messageQueue.shift() ?? '';
        render(session.content, session.buffer);
        return;
      }

      if (session.key === '\x03' || session.key === optIntrChar()) {
        // ^C arrives as og's SIGINT, whose u_interrupt handler rings
        // the bell; the --intr char (READ_INTR) leaves silently
        if (session.key === '\x03') ringBell();

        const queued = endFollow();
        render(session.content, session.buffer);
        for (const sequence of queued) handleKey(sequence);
      } else {
        follow.queued.push(session.key);
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
      (session.key === '\x0D' || session.key === '\x0A' || session.key === ' ')
    ) {
      // dismissing the LESSOPEN warning continues into the editor,
      // like og's error() returning before the edit
      if (session.pendingEditWarn) {
        runEditor();
      }

      render(session.content, session.buffer);
      return;
    }

    // any other command abandons a pending edit warning
    if (hadMessage && session.pendingEditWarn && session.key !== 'v') {
      session.pendingEditWarn = false;
    }

    // #line-edit bindings translate into the built-in editing keys
    if (
      search.input || option.pending || examine.pending ||
      miscInput.pending
    ) {
      session.key = translateEditKey(session.key);
    }

    if (search.input) {
      const origin = {
        originRow: search.input.originRow,
        originSubRow: search.input.originSubRow,
        originEof: search.input.originEof,
      };

      const result = searchInputKey(session.key);

      if (result === 'run') {
        // og's search execution repaints a dumb screen (clear_attn
        // and friends fall back to repaint() without can_goto_line):
        // the content paints in the same frame as the result, on a
        // fresh screen rather than over the frozen echo
        if (mode.DUMB) {
          unfreezeFrame();
          resetRender();
          markDumbPaint();
        }

        if (search.input.type === '&') {
          applyFilter();
        } else {
          execSearch(session.content);
        }
      } else if (result === 'cancel') {
        // --incsearch restores the position the prompt opened at
        if (optIncrSearch()) restoreSearchOrigin(origin);
      } else if (optIncrSearch()) {
        // incsearch paints mid-mca, clearing the trash like og's
        // repaint resetting screen_trashed
        unfreezeFrame();
        incrementalSearch(session.content);
      }

      render(session.content, session.buffer);
      return;
    }

    if (option.pending) {
      optionKey(session.content, session.key);

      // a completed toggle reports like og's error(): the message
      // draws over the old screen and any repaint waits for the
      // dismissing keystroke (toggle_option's screen_trashed, whose
      // make_display repaint homes a dumb terminal)
      if (search.message) freezeFrame(true);

      render(session.content, session.buffer);
      return;
    }

    if (brackets.pending) {
      bracketsKey(session.content, session.key);
      render(session.content, session.buffer);
      return;
    }

    if (marks.pending) {
      marksKey(session.content, session.key);

      // --autosave with `m` writes changed marks right away
      if (optPermaMarks() && optAutosaveAction('m')) saveHistory();

      render(session.content, session.buffer);
      return;
    }

    if (examine.pending) {
      if (examineKey(session.key) === 'run') runExamine();
      if (!drainFirstCmd()) render(session.content, session.buffer);
      return;
    }

    if (pipeMark.pending) {
      pipeMarkKey(session.content, session.key);
      render(session.content, session.buffer);
      return;
    }

    if (miscInput.pending) {
      const kind = miscInput.pending;

      if (miscInputKey(session.key) === 'run') {
        const text = miscInput.text;
        miscInput.text = '';
        runMiscInput(kind, text);
      }

      // no repaint while paused on the shell screen
      if (!session.shellPause) render(session.content, session.buffer);
      return;
    }

    if (overwrite.pending) {
      const answer = overwriteKey(session.key);

      if (answer === 'overwrite' || answer === 'append') {
        writeLogFile(session.content, answer === 'append');
      } else if (answer === 'quit') {
        session.exit();
        return;
      }

      render(session.content, session.buffer);
      return;
    }

    // the binary file confirmation proceeds on y/Y, like og's query
    if (binaryConfirm.pending) {
      const proceed = binaryConfirm.proceed;
      binaryConfirm.pending = false;
      binaryConfirm.proceed = null;

      if ((session.key === 'y' || session.key === 'Y') && proceed) proceed();

      render(session.content, session.buffer);
      return;
    }

    // ^X and : start two-key commands (^X^X, :n), like less's tables
    if (config.keyPrefix === '\x18' || config.keyPrefix === ':') {
      const prefix = config.keyPrefix;

      // erase and newline cancel a prefix silently (CF_QUIT_ON_ERASE)
      if (
        session.key === '\x03' || session.key === '\x08' || session.key === '\x7F' ||
        session.key === '\x0D' || session.key === '\x0A'
      ) {
        config.keyPrefix = '';
        render(session.content, session.buffer);
        return;
      }

      const user = userBinding(prefix + session.key);

      if (user) {
        if (user.key) session.key = user.key;
        act(user.action);

        if (!session.exited && user.extra) {
          for (const sequence of splitKeys(user.extra)) handleKey(sequence);
        }

        return;
      }

      const action = userStop() ? undefined : getAction(prefix + session.key);
      if (action === undefined && session.key.length > 1) extraBells();
      act(action);
      return;
    }

    if ((session.key === '\x18' || session.key === ':') && !session.escCount) {
      config.keyPrefix = session.key;
      render(session.content, session.buffer);
      return;
    }

    // mouse wheel ticks scroll --wheel-lines lines; --rmouse (or
    // --MOUSE) reverses the scroll direction, like less; the wheel
    // is ignored without the vscroll --emouse feature (decode.c)
    if (!session.escCount && session.key.startsWith('\x1b[<64;')) {
      if (!optWheelEnabled()) return;

      if (optMouseReverse()) {
        lineForward(session.content, optWheelLines());
      } else {
        lineBackward(session.content, optWheelLines());
      }

      render(session.content, session.buffer);
      return;
    }

    if (!session.escCount && session.key.startsWith('\x1b[<65;')) {
      if (!optWheelEnabled()) return;

      if (optMouseReverse()) {
        lineBackward(session.content, optWheelLines());
      } else {
        lineForward(session.content, optWheelLines());
      }

      render(session.content, session.buffer);
      return;
    }

    // a horizontal wheel shifts --wheel-lines columns when the
    // hscroll --emouse feature is on (og's A_L_MOUSE/A_R_MOUSE)
    if (!session.escCount &&
        (session.key.startsWith('\x1b[<66;') || session.key.startsWith('\x1b[<67;'))) {
      if (!(opt.emouse & EMOUSE_HSCROLL)) return;

      const left = session.key.startsWith('\x1b[<66;') !== (optMouseReverse());

      if (mode.INIT) mode.INIT = false;

      if (left) {
        config.col = Math.max(config.col - optWheelLines(), 0);
      } else {
        config.col += optWheelLines();
      }

      render(session.content, session.buffer);
      return;
    }

    // --emouse clicks and drags, like og's mouse_button_left/right:
    // left press records the drag origin, motion events drag the text
    // (hdrag/vdrag), a same-row release sets the mouse mark '#', and
    // a right-click release jumps to it
    const click = !session.escCount &&
      // eslint-disable-next-line no-control-regex
      /^\x1b\[<(0|2|32);(\d+);(\d+)([Mm])/.exec(session.key);

    if (click && click[1] === '32' &&
        (opt.emouse & (EMOUSE_HDRAG | EMOUSE_VDRAG))) {
      const x = parseInt(click[2], 10) - 1;
      const y = parseInt(click[3], 10) - 1;

      if ((opt.emouse & EMOUSE_HDRAG) && session.lastDragX >= 0 &&
          x !== session.lastDragX) {
        // dragging right moves the text right (hshift decreases)
        config.col = Math.max(config.col - (x - session.lastDragX), 0);
        if (mode.INIT) mode.INIT = false;
        session.lastDragX = x;
      }

      if ((opt.emouse & EMOUSE_VDRAG) && session.lastDragY >= 0) {
        if (y > session.lastDragY) {
          lineBackward(session.content, y - session.lastDragY);
        } else if (y < session.lastDragY) {
          lineForward(session.content, session.lastDragY - y);
        }

        session.lastDragY = y;
      }

      render(session.content, session.buffer);
      return;
    }

    if (click && click[1] === '0' &&
        (optEmouseLclick() ||
          (opt.emouse & (EMOUSE_HDRAG | EMOUSE_VDRAG)))) {
      const x = parseInt(click[2], 10) - 1;
      const y = parseInt(click[3], 10) - 1;

      if (click[4] === 'M') {
        session.lastClickY = y;
        session.lastDragX = x;
        session.lastDragY = y;
      } else if (optEmouseLclick() && y < config.window - 1 &&
                 y === session.lastClickY) {
        setMouseMark(session.content, y);
      }

      render(session.content, session.buffer);
      return;
    }

    if (click && click[1] === '2' && optEmouseRclick()) {
      const y = parseInt(click[3], 10) - 1;

      if (click[4] === 'm' && y < config.window - 1) {
        goMouseMark(session.content);
      }

      render(session.content, session.buffer);
      return;
    }

    if (session.key === '\x1B') {
      // og-dumb echoes every ESC immediately (no pending unechoed
      // first ESC) and stacks the prefix without the " ESC"/" ESCESC"
      // cycle or any bells (probed); the echo shows length-1 ESCs
      if (mode.DUMB) {
        session.escCount++;
        config.keyPrefix = '\x1B'.repeat(session.escCount + 1);
        render(session.content, session.buffer);
        return;
      }

      // like less: leading ESCs are pending and unechoed (one normally,
      // three when a number is being entered, where digit mode's
      // editchar loop swallows them); further ones echo as literal
      // "ESC", a third literal is invalid and resets to one (the
      // " ESC" <-> " ESCESC" cycle), and any number of pending ESCs
      // still decodes as a single ESC prefix
      const absorb = session.buffer.length ? 3 : 1;

      if (session.escCount - absorb >= 2) {
        // " ESCESC" resets to " ESC" silently
        session.escCount = absorb + 1;
      } else {
        session.escCount++;
        const literals = session.escCount - absorb;

        // og rings when the second literal lands (" ESC" -> " ESCESC")
        // and when the first lands after swallowed digit-mode input
        if (literals === 2 || (literals === 1 && absorb === 3)) {
          ringBell();
        }
      }

      config.keyPrefix = '\x1B'.repeat(Math.max(session.escCount - absorb, 0) + 1);
      render(session.content, session.buffer);
    } else {
      // og-dumb echoes the terminating key into the pending ESC line
      // as caret notation before the sequence resolves; without clear
      // caps the echo stays behind as leftovers, like og
      if (mode.DUMB && session.escCount && session.key.length === 1) {
        process.stdout.write(session.key < ' ' || session.key === '\x7F'
          ? '^' + String.fromCharCode((session.key.charCodeAt(0) + 0x40) & 0x7F)
          : session.key);
      }

      const seq = session.userSeq + (session.escCount ? '\x1B' + session.key : session.key);

      // lesskey #command bindings run before the built-in table; the
      // canonical key serves the key-sensitive actions and the extra
      // string feeds back in, like A_EXTRA's ungotten characters
      const user = userBinding(seq);

      if (user) {
        session.userSeq = '';
        config.keyPrefix = '';
        if (user.key) session.key = user.key;
        act(user.action);
        session.escCount = 0;

        if (!session.exited && user.extra) {
          for (const sequence of splitKeys(user.extra)) handleKey(sequence);
        }

        return;
      }

      // a partial match on a longer binding collects and echoes, like
      // og's A_PREFIX state (the built-in ^X/: prefixes own theirs)
      if (
        seq[0] !== ':' && seq[0] !== '\x18' && userIsPrefix(seq)
      ) {
        session.userSeq = seq;
        config.keyPrefix = seq;
        session.escCount = 0;
        render(session.content, session.buffer);
        return;
      }

      if (session.userSeq) {
        // the collected sequence completes no binding: bad command
        session.userSeq = '';
        config.keyPrefix = '';
        session.escCount = 0;
        ringBell();
        render(session.content, session.buffer);
        return;
      }

      let action = userStop() ? undefined : getAction(seq);

      // og-dumb resolves an unbound ESC sequence by running the last
      // key as a plain command (probed: ESC ESC RETURN still scrolls)
      if (action === undefined && mode.DUMB && session.escCount) {
        action = userStop() ? undefined : getAction(session.key);
      }

      if (
        action === undefined && session.escCount && session.key.length > 1 && !mode.DUMB
      ) {
        extraBells();
      }

      act(action);
      session.escCount = 0;
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

    session.fullContent = lines;
    session.lastFilter = null;
    search.filters = [];
    session.content = deriveContent();

    const saved = files.list[target].saved;
    config.row = saved ? saved.row : 0;
    config.subRow = saved ? saved.subRow : 0;
    config.blankTop = 0;

    mode.INIT = false;
    calculateEOF(session.content);

    if (!mode.EOF) {
      mode.EOF = config.row > config.endRow || (
        config.row === config.endRow && config.subRow >= config.endSubRow
      );
    }

    // schedule the +cmd replay for the newly examined file
    const firstCmd = getFirstCmd();
    session.pendingFirstCmds = firstCmd ? [firstCmd] : [];

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

    const row = tagRow(session.content);

    if (row === null) {
      search.message = 'Tag not found';
      return;
    }

    jumpLoc(session.content, row, 0, jumpSindex());
  }

  /** Steps the tag list with t / T, like A_NEXT_TAG/A_PREV_TAG. */
  function tagStep(delta: 1 | -1): void {
    if (stepTag(delta, bufferToNum(session.buffer) || 1) === null) {
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
    repeatSearch(session.content, bufferToNum(session.buffer) || 1, reverse);

    while (search.message === 'Pattern not found') {
      const forward = (search.lastDir === 1) !== reverse;
      const target = files.index + (forward ? 1 : -1);

      if (target < 0 || target >= files.list.length) return;
      if (!switchToFile(target)) return;

      // a fresh file searches from its top (its end going backward)
      if (!forward) lastLine(session.content, 0);

      search.message = '';
      repeatSearch(session.content, 1, reverse);
    }
  }

  function stepFile(delta: 1 | -1): void {
    if (mode.HELP) {
      ringBell();
      return;
    }

    const target = stepFileTarget(delta, bufferToNum(session.buffer) || 1);

    if (target === null) {
      // :n past the last file quits with -e at end-of-file, like
      // og's A_NEXT_FILE checking get_quit_at_eof after edit_next
      if (delta > 0 && optQuitAtEof() && mode.EOF && !mode.HELP) session.exit();
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
    const endPrompt = endProto ? prExpand(session.content, endProto) : '';

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
        session.shellPause = 'pager';
        return;
      }

      // like lsystem: the done message waits on the shell screen so the
      // command's output stays visible until a keypress
      process.stdout.write(doneMsg + '  (press RETURN)');
      session.shellPause = 'shell';
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
      hi = bottomRow(session.content) + 1;
    } else {
      lo = config.row;
      hi = row + 1;
    }

    const text = session.content.slice(lo, hi).join('\n') + '\n';
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
      const next = bottomRow(session.content) + 1;
      config.attnRow = next < session.content.length ? next : -1;
    }

    // og's forw_loop enters through jump_forw_buffered: re-entering
    // F while already at the end rings the at-end bell (jump_loc's
    // back(0) hitting eof_bell); the first F just moves there
    lastLine(session.content, 0);
    session.followTimer = setInterval(followTick, 50);
  }

  /**
   * Jumps to the end of the file without the at-end bell, like
   * forw_loop's jump_forw_buffered.
   */
  function pinToEnd(): void {
    if (config.row !== config.endRow || config.subRow !== config.endSubRow) {
      lastLine(session.content, 0);
    }
  }

  /**
   * One follow poll: appends new data pinned to the end of the file,
   * reopens a rotated file under --follow-name, and leaves the wait on
   * --exit-follow-on-close.
   */
  function followTick(): void {
    const result = pollFollow();
    if (result.kind === 'idle' || session.exited) return;

    if (result.kind === 'close') {
      endFollow();
      render(session.content, session.buffer);
      return;
    }

    if (result.kind === 'rotate') {
      rotateFollow();
      return;
    }

    const lines = result.lines;
    let matchLines = lines;

    // the first new line completes a displayed partial last line
    if (result.extendTail && session.fullContent.length) {
      const tail = session.fullContent.length - 1;
      session.fullContent[tail] += lines.shift();
      matchLines = [session.fullContent[tail], ...lines];
    }

    session.fullContent.push(...lines);
    session.content = deriveContent();
    calculateEOF(session.content);
    pinToEnd();

    // ESC-f bells when the search pattern matches new data, ESC-F
    // stops there, like forw_loop watching highest_hilite
    if (follow.active !== 'forever' && matchLines.some(lineMatches)) {
      ringBell();

      if (follow.active === 'hilite') {
        endFollow();
        render(session.content, session.buffer);
        return;
      }
    }

    render(session.content, session.buffer);
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
      render(session.content, session.buffer);
      return;
    }

    session.fullContent = lines;
    session.content = deriveContent();
    config.row = Math.min(config.row, Math.max(session.content.length - 1, 0));
    config.subRow = 0;
    calculateEOF(session.content);

    beginFollow(kind);
    render(session.content, session.buffer);
  }

  /**
   * Leaves the F wait and runs the keys typed during it, like og
   * processing the ungotten commands after forw_loop returns.
   *
   * @returns Queued keys when the caller replays them itself.
   */
  function endFollow(): string[] {
    if (session.followTimer) {
      clearInterval(session.followTimer);
      session.followTimer = null;
    }

    return stopFollow();
  }

  // ---- the streaming pipe, like og's lazy non-seekable reads ----

  /** Bytes of pipe data currently held, past recycles excluded. */
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
    if (!optNoEditWarn() && entry.alt && !session.pendingEditWarn) {
      session.pendingEditWarn = true;
      search.message = 'WARNING: This file was viewed via LESSOPEN';
      return;
    }

    session.pendingEditWarn = false;

    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    const line = Math.min(
      config.row + Math.floor((config.window - 1) / 2),
      session.content.length - 1
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

      runShell(prExpand(session.content, text), doneMsg);
    } else if (kind === '|') {
      runPipe(text);
    } else if (kind === '+') {
      setFirstCmd(text);
    } else {
      const target = logFileTarget(text, kind === 'S');

      if (target === 'write') {
        writeLogFile(session.content, false);
      }
    }
  }

  function applyFilter(): void {
    const filter = execFilter();
    if (filter === undefined) return;

    session.lastFilter = filter;
    session.content = deriveContent();
    config.row = 0;
    config.subRow = 0;
    config.blankTop = 0;
    calculateEOF(session.content);
  }

  function init() {
    loadHistory();
    onAutosave(saveHistory);
    onShellAutosave(saveHistory);
    resetMarks();
    resetRender();
    resetDumbPaint();

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

    calculateEOF(session.content);
  }

  /** Restores the terminal before dying on an unexpected error. */
  function onUncaught(error: unknown): void {
    cleanUp();
    console.error(error);
    process.exit(1);
  }

  /** Repaints for the new size on SIGWINCH, like og's winch(). */
  function onResize(): void {
    if (session.shellPause) return;

    mode.INIT = false;

    resetRender();
    calculateDimensions();
    calculateEOF(session.content);

    if (config.windowContent.length !== config.window) {
      config.windowContent = new Array(config.window).fill('');
      config.startLine = 0;
    }

    session.buffer = [];
    config.bufferOffset = 0;
    config.blankTop = 0;
    render(session.content, session.buffer);
  }

  /** Quits cleanly on SIGTERM/SIGHUP, like og's terminate(). */
  function onTerminate(): void {
    if (!session.exited) session.exit();
  }

  /** Treats an external SIGINT as the ^C key, like og's u_interrupt. */
  function onSigint(): void {
    if (!session.exited) handleKey('\x03');
  }

  /** Runs the $LESS_SIGUSR1 keys on SIGUSR1, like og's sigusr(). */
  function onSigusr1(): void {
    if (session.exited) return;

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
    calculateEOF(session.content);
    render(session.content, session.buffer);
  }

  /**
   * Leaves the alternate screen and raw mode so a child process can use
   * the terminal, like less de-initializing before running a command.
   */
  function suspendTerminal(): void {
    // og's mouse and paste strings are hardcoded, not termcap: even
    // a dumb terminal receives them when the options are on
    if (optMouse() || opt.emouse) {
      process.stdout.write(MOUSE_OFF + MOUSE_SGR_OFF);
    }

    if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_OFF);

    if (!mode.DUMB) {
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
    }

    if (optMouse() || opt.emouse) {
      process.stdout.write(MOUSE_SGR_ON + MOUSE_ON);
    }

    if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_ON);

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
    if (session.startupHelp) return false;

    const helpConfig = config;

    session.content = session.prevContent;
    applyConfig(session.prevConfig);
    applyMode(session.prevMode);

    // og's option variables (shift_count, swindow, wscroll,
    // chop_line) are globals: a change made inside the help screen
    // persists after leaving it
    config.setCol = helpConfig.setCol;
    config.setWindow = helpConfig.setWindow;
    config.halfWindow = helpConfig.halfWindow;
    config.chopLongLines = helpConfig.chopLongLines;

    calculateDimensions();
    calculateEOF(session.content);

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

    session.prevConfig = config;
    resetConfig();

    // the og globals follow into the help screen too
    config.setCol = session.prevConfig.setCol;
    config.setWindow = session.prevConfig.setWindow;
    config.halfWindow = session.prevConfig.halfWindow;
    config.chopLongLines = session.prevConfig.chopLongLines;

    session.prevMode = mode;
    resetMode();

    session.prevContent = session.content;
    // the help file renders through the normal content pipeline, so
    // its nroff overstrikes become bold/underline like og
    session.content = transformContent(help);
    calculateEOF(session.content);

    mode.HELP = true;

    // dumb rendering is a terminal property; the help screen keeps it
    mode.DUMB = session.prevMode.DUMB;
  }

  function cleanUp(): void {
    endFollow();
    closeAlt(files.list[files.index]);
    saveHistory();

    // --emouse enables tracking without --mouse, so check both;
    // these strings are hardcoded like og's, so dumb gets them too
    if (optMouse() || opt.emouse) {
      process.stdout.write(MOUSE_OFF + MOUSE_SGR_OFF);
    }

    // --no-paste turned bracketed paste markers on
    if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_OFF);

    // a dumb terminal never received the termcap-backed codes
    if (!mode.DUMB) {
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
    if (endProto) process.stdout.write(prExpand(session.content, endProto));

    // --redraw-on-quit leaves the last screen on the main display,
    // like og's quit() repaint after term_deinit: only the content
    // rows print (no prompt row -- prompt() never runs while
    // quitting), so the shell prompt overwrites the ":" line; og
    // also requires term_addrs, which a dumb terminal lacks
    const screen = optRedrawOnQuit() && !mode.DUMB ? lastScreen() : null;
    if (screen) process.stdout.write(screen.slice(0, -1).join('\n') + '\n');

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
    session.detachPipe();

    // a /dev/tty keyboard holds the event loop open until destroyed
    closeTtyKeyboard();
  }
}


/**
 * Reads the keystroke answering the dumb terminal warning, like og's
 * get_return before the screen initializes.
 */

// CommonJS interop; ESM importers use the default export directly
try {
  module.exports = pager;
  module.exports.default = pager;
  module.exports.pagerPipe = pagerPipe;
} catch {
  // ESM module records are frozen
}
