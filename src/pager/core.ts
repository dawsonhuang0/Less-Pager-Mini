import fs from 'fs';
import { putstr, flush } from '../tty/output';

import { refreshWindowTitle } from '../tty/title';

import { onHilitePaint, setHiliteHidden } from '../features/searching';
import { squishCheck, renderHiliteRepaint, markSearchFlash }
  from '../helpers';
import { armReadWatch } from '../state/reads';

import { lgetenv, screenFillGrace } from '../startup/environment';

import { jumpOsc8, osc8Internal, osc8OpenCommand, osc8SearchParam,
  osc8Visible, searchOsc8 }
  from '../features/osc8';

import { keyboard, closeTtyKeyboard, dumbTerminal, takeUngot,
  watchWinch, unwatchWinch, raiseSigint, wasSelfSigint,
  gateReturn, gateReleasedByWinch, gateReleaseKind }
  from "../tty/keyboard";


import { Actions } from "../state/interfaces";

import { PagerInput } from './input';

import { session, resetSession, deriveContent, shellReserveLines }
  from "../state/session";

import { startupInit, printStartupError, startupErrors, warnReturn }
  from "../startup/startup";

import { calculateDimensions, suspendTerminal, enterScreen,
  leaveScreenCodes, termInitTail }
  from "../tty/screen";

import { switchToFile, gotoCurrentTag, tagStep, spanningSearch,
  stepFile, removeFile, runExamine, runEditor, runMiscInput,
  applyFilter, openByName, runShell } from "../commands";

import {
  config,
  fullScreen,
  mode,
  applyConfig,
  applyMode,
  resetConfig,
  resetMode
} from "../state/config";

import { help } from "../startup/lessHelp";

import { lesskeyHelp } from "../startup/lesskeyHelp";

import { openLesskeyView, exitLesskeyView, isLesskeyViewSession }
  from "../features/lesskeyView";

import { LESS_VERSION } from "../features/lesskey";

import { raiseAbort, clearAbort } from "../tty/keyboard";

import { getAction, isKeyPrefix, splitKeys, kentSequence, kentToNewline,
  tailCascade } from "../keys";

import {
  addBufferChar,
  delBufferChar,
  render,
  markBurst,
  markBehind,
  markCommandTime,
  isStalled,
  armStall,
  promptHolding,
  endPromptHold,
  PROMPT_SETTLE_MS,
  freezeFrame,
  unfreezeFrame,
  markFullRepaint,
  fullRepaintArmed,
  markClearHome,
  markHiliteRepaint,
  markHiliteErase,
  hiliteRepaintPending,
  seedFrameRows,
  seedBlankFrame,
  resetRender,
  resetDumbPaint,
  markDumbPaint,
  ringBell,
  bufferToNum,
  calculateEOF,
  lastScreen,
  clearBot,
  markBareRepaint,
  dirtyBottomRow,
  markPosClear,
  eprPrefix
} from "../helpers";

import {
  maxSubRow,
  transformContent,
  visualWidth,
  sourceLine,
  sourceIndexAt,
  displayPrefixLength,
} from "../lines/helpers";

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
} from "../features/moving";

import {
  search,
  startSearch,
  searchInputKey,
  execSearch,
  repeatSearch,
  toggleHighlight,
  clearHighlight,
  incrementalSearch,
  restoreSearchOrigin,
  onAutosave,
  onHistTouch,
  onHistRecord
} from "../features/searching";

import {
  firstLine,
  lastLine,
  percentLine,
  goPos,
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
  setMouseMark,
  goMouseMark,
  onMarkSwitch,
  jumpToMark,
  jumpToUserMark,
  adoptFileMarks,
  posRehead
} from "../features/jumping";

import { topOffsetOf, setTopOffset } from "../lines/screenOps";

import {
  getLayout,
  stringIndexAt,
  charIndexAt,
} from "../lines/lineLayout";

import {
  files,
  examine,
  loadFile,
  indexFileTarget,
  startExamine,
  examineKey,
  fileInfo,
  closeAlt,
  binaryConfirm,
  revealPipeEnd,
  sizeIsKnown,
  revealAltEnd,
  pipeDraining,
  pendingScroll,
  stepFileTarget,
  lineBase,
} from "../features/files";

import { follow, beginFollow, endFollow } from "../features/follow";

import { openAltFile } from "../features/lessopen";

import {
  option,
  startOption,
  optionKey,
  optQuitAtEof,
  optWheelLines,
  optQuitOnIntr,
  optIncrSearch,
  optNoPaste,
  optRedrawOnQuit,
  optNoInit,
  optNoKeypad,
  optMouseReverse,
  optIntrChar,
  optQuitIfOneScreen,
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
  getSwindow,
  applyPendingHeader,
  optHeader,
  resetHeaderStart,
  optShowPreprocError,
  optTildes,
  optOldBot,
  optNoShell,
  NO_SHELL_MESSAGE,
  opt
} from "../options";

import {
  miscInput,
  pipeMark,
  overwrite,
  startMiscInput,
  miscInputKey,
  startLogFile,
  startPipe,
  pipeMarkKey,
  getFirstCmd,
  overwriteKey,
  writeLogFile,
  logFileName,
  versionMessage,
  printVersion,
  takeStartupLog,
  takeCmdAtPrompt,
  onShellAutosave,
  onShellHistTouch,
  onShellHistRecord
} from "../features/misc";

import {
  onTagJump
} from "../features/tags";

import { cmd } from "../features/cmdbuf";

import { pipeInput, attachPipe, pipeDemand, pipeDrain,
  pipeOneScreenProbe, pipeFullProbe, pipeFilling, abortPipeFill,
  startPendingScroll, abortPendingScroll }
  from "../features/pipe";

import { secureAllow } from "../features/secure";

import {
  userBinding,
  userBoundTo,
  userIsPrefix,
  userStop,
  translateEditKey
} from "../features/lesskey";


import { loadHistory, saveHistory, touchSearchList, touchShellList,
  recordSearchEntry, recordShellEntry } from "../startup/histfile";

import { chopLongLines } from "../lines/chopLongLines";
import { wrapLongLines } from "../lines/wrapLongLines";

import {
  ALTERNATE_CONSOLE_ON,
  ON_ALTERNATE_SCREEN,
  KEYPAD_ON,
  CLEAR_LINE,
  BOLD_ON,
  BOLD_OFF,
  CURSOR_TO
} from "../state/constants";


// The active acquisition backend. It may answer only the operations which
// depend on seekable byte positions; the shared controller owns everything
// else.
let pagerInput: PagerInput | null = null;

/**
 * Less-pager-mini
 *
 * - If `examineFile` is true, treats input as file path(s) and loads file
 *   content.
 * - Otherwise, converts arbitrary input into displayable string content.
 *
 * @param input - The input to render, which can be a string, object, or array.
 * @param tabObject - Whether objects indent, one tab per level
 *                    (flat on one line otherwise).
 * @param examineFile - If true, treats input as file path(s) and reads from
 *                      disk.
 */
// a pipe still delivering data into the session (og's non-seekable
// ch input); set by pagerPipe before the session starts


// og's MAX_PASTE_IGNORE_SEC: a lost end marker stops eating input
const MAX_PASTE_IGNORE_MS = 5000;

/**
 * Starts an interactive pager session to navigate through string content.
 *
 * - Handles terminal resizing (SIGWINCH) to repaint content.
 * - Supports key-based navigation with buffered numeric input.
 * - Responds to various paging actions like line/window movement and exit.
 *
 * @param content - The content to be displayed in the pager.
 */
export async function contentPager(
  initialContent: string[],
  startupOverride: ReturnType<typeof startupInit> | null = null,
  input: PagerInput | null = null
): Promise<void> {
  pagerInput = input;
  resetSession(initialContent);

  // $LESS and command line options are already applied for file
  // sessions (og's main scans them before edit_first opens anything);
  // in-memory and pipe sessions scan here with their content
  const startup = startupOverride ?? startupInit(session.fullContent);

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
  hook.hiliteRepaint = markHiliteRepaint;
  hook.hiliteErase = markHiliteErase;
  hook.reheadSource = () => pagerInput?.retopOffset(0);

  // og's table[TOP] survives a width change untouched; ours indexes
  // wrap boundaries, so the offset is captured before and restored
  // after (options/ cannot reach the layout directly)
  hook.topOffset = (content: string[]) => {
    const top = content[config.row];

    if (top === undefined) return () => {};

    // og's table[TOP] is a byte into the FILE, so an option that
    // changes what a line DISPLAYS cannot move it. A display-character
    // offset can: -r turns the escape codes into visible characters
    // and -x re-expands tabs, so the same offset names a different
    // place in the new display line. Carry the SOURCE index across,
    // which is what og's byte is, and re-derive the display offset
    // from it afterwards.
    // Three spaces meet here and only one is stable across an option:
    // the layout's CHARACTER offset (what the top is kept in), the
    // display STRING index, and the RAW string index - og's byte. A
    // line the transform left alone has no source mapping, and then
    // the display string IS the raw one, so the conversion is
    // stringIndexAt rather than the identity: on a styled line under
    // -R those differ by every escape sequence before the top.
    const offset = topOffsetOf(content);
    const raw = sourceLine(top);
    const at = raw === undefined
      ? stringIndexAt(getLayout(top), offset)
      : sourceIndexAt(raw, offset);

    return () => {
      if (offset <= 0) return;

      const line = session.content[config.row] ?? top;
      const after = sourceLine(line);
      // and back the same way: no mapping means the new display line
      // IS the raw one, so the raw index converts through the layout,
      // not straight across
      const carried = after === undefined
        ? charIndexAt(getLayout(line), at)
        : displayPrefixLength(after, at);

      setTopOffset(line, config.row, carried);
      config.screen = [];
    pagerInput?.posClear?.();

      // a source engine owns the top and derives config.subRow from
      // it, so the carry has to reach the engine or the next sync puts
      // the old boundary straight back - and the next forward move
      // steps by the OLD row width.
      pagerInput?.retopOffset(carried);
    };
  };

  onRebuild(() => {
    // inside the help screen the help itself repaints (og's -D and
    // friends carry O_REPAINT on the current file); the main content
    // rebuild lands in the parked copy for when help exits
    if (mode.HELP) {
      session.prevContent = deriveContent();
      session.content = transformContent(session.helpSource);
      calculateEOF(session.content);
      return;
    }

    // og's O_REPAINT: the option's repaint() runs once the toggle
    // returns, painting the whole screen fresh
    markFullRepaint();

    if (pagerInput?.rebuild()) return;

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

  // --file-size reads a pipe to its end before any terminal init,
  // like edit() calling scan_eof under want_filesize: og blocks the
  // first paint until the length is known
  if (opt.wantFileSize > 0 && !startup.dohelp &&
      files.list[files.index]?.streaming &&
      pipeInput.source && pipeInput.decoder) {
    await pipeFullProbe();
  }

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

    putstr(rows.join('\n') + '\n');
    return;
  }

  // a terminal without cursor capabilities runs degraded, like og's
  // missing_cap set from the dumb/unknown termcap entry; -d suppresses
  // the warning (know_dumb) but not the degradation
  mode.DUMB = dumbTerminal();

  // messages set after the scan (a forced open's read error) still
  async function logQuery(prompt: string): Promise<string> {
    putstr(prompt);
    const answer = await warnReturn();
    putstr('\n');

    // og's query() quits on a capital Q only (output.c:808)
    if (answer === 'Q') {
      keyboard().setRawMode(false);
      closeTtyKeyboard();
      process.exit(0);
    }

    return answer;
  }

  // og's use_logfile (edit.c:954) runs at edit time, BEFORE the
  // errmsgs gate and term_init: the -o overwrite query asks on the
  // plain screen, one raw key per ask, and only a capital Q quits
  // (query() itself, output.c:808) - lowercase q retypes like any
  // other invalid answer. A failed open error()s into the same
  // pre-screen message flow below, like og's errmsgs.
  const startupLog = takeStartupLog();

  if (startupLog) {
    overwrite.file = startupLog.name;

    let answer = startupLog.force || !fs.existsSync(startupLog.name)
      ? 'O'
      : await logQuery(`Warning: "${startupLog.name}" exists; ` +
          "Overwrite, Append, Don't log, or Quit? ");

    for (let decided = false; !decided;) {
      switch (answer) {
        case 'O': case 'o':
          writeLogFile(session.fullContent, false, true);
          decided = true;
          break;
        case 'A': case 'a':
          writeLogFile(session.fullContent, true, true);
          decided = true;
          break;
        case 'D': case 'd':
          decided = true;
          break;
        default:
          answer = await logQuery("Overwrite, Append, Don't log, " +
            'or Quit? (Type "O", "A", "D" or "Q") ');
      }
    }

    keyboard().setRawMode(false);
    keyboard().pause();
  }

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
    putstr('Press RETURN to continue ');
    const answer = await warnReturn();
    putstr('\n');

    // ^C is og's READ_INTR at get_return: swallowed, not ungot
    if (answer && answer !== '\x0D' && answer !== '\x0A' &&
        answer !== ' ' && answer !== '\x03') {
      session.ungotStartKey = answer;
    }

    // og's pending S_INTERRUPT: psignals runs getcc_clear at the
    // top of the command loop, discarding the gate's ungot key
    if (session.intrPending) {
      session.intrPending = false;
      session.ungotStartKey = '';
    }
  }

  init();

  // a command-line --header applies now that the file is open, like
  // og's deferred init_header (find_pos works, the view opens at the
  // header start via the first jump's after_header_pos)
  pagerInput?.ready();
  applyPendingHeader(session.fullContent);

  // -? pages the help file first, like og's dohelp registering
  // FAKE_HELPFILE as an input file: quitting that help quits the
  // pager, unlike the h command's overlay.
  //
  // AFTER the engine is ready, not before: a file-backed session
  // finishes ready() by seeking and syncing, which puts the FILE's
  // lines back into session.content. Opening help first left the
  // file's text under a "HELP --" prompt whenever -?/--help was given
  // a filename. This is also the order the h command already works
  // in, since by then the engine has long been ready.
  if (startup.dohelp) {
    openHelp();
    session.startupHelp = true;
  } else if (startup.lesskeyHelp) {
    openHelp(lesskeyHelp);
    session.startupHelp = true;
  } else if (startup.viewLesskey && !isLesskeyViewSession()) {
    // over the file, not instead of it: q ends the view and the
    // session carries on with what was named, unlike -? whose help
    // IS the input file and whose q quits
    openLesskeyView();
  }


  // og never squishes the first paint with a header configured
  // (forwback.c's squish condition requires header_lines == 0 &&
  // header_cols == 0): a short first screen paints top-anchored
  // with tildes instead of the lower-left scroll-up
  if (optHeader().lines > 0 || optHeader().cols > 0) mode.INIT = false;

  // the initial open ran before the dimensions were known: a short
  // pipe-form $LESSOPEN alt reveals its length now (og's first
  // paint reading to EOI shows (END))
  revealAltEnd(session.content);

  // + commands (and -p searches) run at the first file, followed by
  // the ++cmd every-file command, like og's ungotten startup input
  session.pendingFirstCmds = startup.firstCmds;
  const everyCmd = getFirstCmd();
  if (everyCmd) session.pendingFirstCmds.push(everyCmd);

  // og paints TWICE before a new pattern's search runs -
  // repaint_hilite(FALSE) to erase what is on screen, then
  // hilite_screen() to paint the new matches (search.c:2137, :2147).
  // Neither is conditional: hilite_search is OPT_ONPLUS by default,
  // which is truthy. This used to run only when a row was WIDER than
  // the screen, on the theory that repainting the same rows is
  // otherwise invisible - true on the SCREEN, but repaint_hilite
  // ADDRESSES each row (goto_line, clear_eol, put_line) where an
  // ordinary paint scrolls, so the bytes differ for every search
  onHilitePaint((content: string[]) => {
    // repaint_hilite opens with `if (squished) repaint()`, and a file
    // whose whole content is one row IS squished - so the erase pass
    // costs a paint before it even starts
    squishCheck();

    setHiliteHidden(true);
    renderHiliteRepaint(content, session.buffer);

    // og clears hide_hilite BETWEEN the two paints (search.c:2146),
    // so the second one already shows the new pattern's matches and
    // the search itself has nothing left to paint
    setHiliteHidden(false);
    search.highlight = true;
    renderHiliteRepaint(content, session.buffer);

    // repaint_hilite ends by addressing the bottom row itself, so
    // whatever the search paints next starts there - no clear_bot,
    // which is otherwise how a command's paint opens
    markBareRepaint();
  });

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

  // a half-read escape sequence never outlives its session
  heldKeyBytes = '';

  keyboard().on('data', keyHandler);

  // og's getchr on an exhausted keyboard: "EOF on the tty means there
  // is no more keyboard input. Don't loop forever waiting for a byte
  // which cannot arrive" - quit(QUIT_ERROR) (ttyin.c:220). It happens
  // AFTER the first screen is painted, which is why less with no
  // terminal to read still shows you the file and then leaves
  keyboard().once('end', () => {
    if (session.exited) return;
    process.exitCode = 1;
    session.exit();
  });
  // deferred fill keys replay through the same handler
  session.feedKeys = data => keyHandler(Buffer.from(data));

  // a silent probe abort's pending interrupt dies here, like og's
  // psignals at the first command iteration (the gate consumed it
  // for messaged aborts above)
  session.intrPending = false;

  // keys polled during a --file-size startup scan run first
  const ungotStart = takeUngot();
  if (ungotStart) keyHandler(ungotStart);

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

    // the startup paint is the one screen no keypress produced, so
    // the command loop's flush never covers it: without this the
    // pager sits on a blank terminal, prompt and all, until the
    // first key arrives and pushes the buffer out
    flush();
  });
  cleanUp();
}

/** Starts an interactive process escape unless policy forbids it. */
function startShellFeature(
  feature: 'shell' | 'pipe',
  start: () => void
): void {
  if (optNoShell()) {
    search.message = NO_SHELL_MESSAGE;
    return;
  }

  if (secureAllow(feature)) start();
}

/**
 * Shifts the view --wheel-lines columns, og's A_L_MOUSE/A_R_MOUSE.
 *
 * Both cases open with pos_rehead(), like the keyboard shifts
 * (command.c:1740 and :1754), and the left one floors at column 0
 * where og's `if (wheel_lines > hshift) hshift = 0` does.
 *
 * @param direction -1 to shift left, 1 to shift right.
 */
function mouseShift(direction: -1 | 1): void {
  if (mode.INIT) mode.INIT = false;

  posRehead();

  config.col = direction < 0
    ? Math.max(config.col - optWheelLines(), 0)
    : config.col + optWheelLines();
}

// @ts-expect-error - TODO: Remove this ignore once all Actions implemented
const acts: Record<Actions, () => void> = {
  FORCE_EXIT: () => session.exit(),
  EXIT: () => {
    // the lesskey view unwinds before help does, and before quitting:
    // both are stashes over the same session
    if (exitLesskeyView(LESS_VERSION)) return;
    if (!exitHelp()) session.exit();
  },
  HELP: () => openHelp(),
  ADD_BUFFER: () => addBufferChar(session.buffer, session.key),
  DEL_BUFFER: () => delBufferChar(session.buffer),
  LINE_FORWARD: () =>
    lineForward(session.content, bufferToNum(session.buffer) || 1),
  FORCE_LINE_FORWARD: () =>
    lineForward(session.content, bufferToNum(session.buffer) || 1, true),
  FORCE_LINE_BACKWARD: () =>
    forceLineBackward(session.content, bufferToNum(session.buffer) || 1),
  FORCE_WINDOW_BACKWARD: () => forceLineBackward(
    session.content,
    bufferToNum(session.buffer) || getSwindow(),
    true
  ),
  NEWLINE_FORWARD: () =>
    newlineForward(session.content, bufferToNum(session.buffer) || 1),
  NEWLINE_BACKWARD: () =>
    newlineBackward(session.content, bufferToNum(session.buffer) || 1),
  GO_POS: () => goPos(session.content, bufferToNum(session.buffer)),
  // og's four wheel cases (command.c:1720-1755). They take no count
  // and read no option: whoever produced the action already decided
  // the direction, so a lesskey file bound to code 66 scrolls with
  // --emouse off entirely - og's decoder never sees the key
  MOUSE_FORWARD: () => lineForward(session.content, optWheelLines()),
  MOUSE_BACKWARD: () => lineBackward(session.content, optWheelLines()),
  MOUSE_LEFT: () => mouseShift(-1),
  MOUSE_RIGHT: () => mouseShift(1),
  SPAN_REPEAT_SEARCH: () => spanningSearch(
    false,
    request => pagerInput?.search(request) ?? false,
    () => pagerInput?.handle('LAST_LINE', 0) ?? false
  ),
  SPAN_REVERSE_SEARCH: () => spanningSearch(
    true,
    request => pagerInput?.search(request) ?? false,
    () => pagerInput?.handle('LAST_LINE', 0) ?? false
  ),
  NEXT_TAG: () => tagStep(1),
  PREV_TAG: () => tagStep(-1),
  // "If new link is on screen, just highlight it without scrolling."
  // (og search.c:2049)
  OSC8_FORWARD: () => {
    if (searchOsc8(session.fullContent, 1,
      bufferToNum(session.buffer) || 1) &&
      !osc8Visible(session.content)) jumpOsc8(session.content);
  },
  OSC8_BACKWARD: () => {
    if (searchOsc8(session.fullContent, -1,
      bufferToNum(session.buffer) || 1) &&
      !osc8Visible(session.content)) jumpOsc8(session.content);
  },
  OSC8_JUMP: () => { jumpOsc8(session.content); },
  OSC8_OPEN: () => {
    if (!secureAllow('osc8')) return;

    // a link into the same file runs nothing: og searches for the
    // "id=" anchor it names, forward with wrap (search.c:1942)
    const param = osc8Internal();

    if (param !== null) {
      if (osc8SearchParam(session.fullContent, param) &&
        !osc8Visible(session.content)) jumpOsc8(session.content);
      return;
    }

    const open = osc8OpenCommand();
    if (open) runShell(open.command, open.done);
  },
  LINE_BACKWARD: () =>
    lineBackward(session.content, bufferToNum(session.buffer) || 1),
  WINDOW_FORWARD: () => windowForward(session.content, session.buffer),
  WINDOW_BACKWARD: () => windowBackward(session.content, session.buffer),
  SET_WINDOW_FORWARD: () => setWindowForward(session.content, session.buffer),
  SET_WINDOW_BACKWARD: () => setWindowBackward(session.content, session.buffer),
  NO_EOF_WINDOW_FORWARD: () =>
    windowForward(session.content, session.buffer, true),
  SET_HALF_WINDOW_FORWARD: () =>
    setHalfWindowForward(session.content, session.buffer),
  SET_HALF_WINDOW_BACKWARD: () =>
    setHalfWindowBackward(session.content, session.buffer),
  SET_HALF_SCREEN_RIGHT: () => setHalfScreenRight(session.buffer),
  SET_HALF_SCREEN_LEFT: () => setHalfScreenLeft(session.buffer),
  LAST_COL: () => lastCol(session.content),
  FIRST_COL: () => firstCol(),
  // og's repaint() unsquishes a short first paint: the screen comes
  // back top-anchored with tilde fill (pos_clear + jump_loc), so a
  // squished screen ends at r/^L/^R — not at the eof bell
  // og's repaint() keeps the top's POSITION and pos_clears the table
  // (jump.c:131), so the rows a backward move exposed are regenerated
  // whole - the shifted top survives, the partial row does not
  REPAINT: () => {
    mode.INIT = false;
    config.screen = [];
    pagerInput?.posClear?.();
    resetRender();
  },
  DROP_INPUT_REPAINT: () => {
    mode.INIT = false;
    config.screen = [];
    pagerInput?.posClear?.();
    resetRender();
  },
  SEARCH_FORWARD: () => startSearch('/', bufferToNum(session.buffer) || 1),
  SEARCH_BACKWARD: () => startSearch('?', bufferToNum(session.buffer) || 1),
  REPEAT_SEARCH: () => {
    searchFlash(false);
    repeatSearch(
      session.content,
      bufferToNum(session.buffer) || 1,
      false,
      request => pagerInput?.search(request) ?? false
    );
  },
  REVERSE_SEARCH: () => {
    searchFlash(true);
    repeatSearch(
      session.content,
      bufferToNum(session.buffer) || 1,
      true,
      request => pagerInput?.search(request) ?? false
    );
  },
  HIGHLIGHT_TOGGLE: () => toggleHighlight(),
  CLEAR_SEARCH: () => clearHighlight(),
  // og's A_FILTER has no helpfile guard: the & prompt opens in
  // help; is_filtering() is FALSE on the helpfile, so the pattern
  // stores for the file and the help view stays unfiltered
  PATTERN_ONLY: () => startSearch('&', bufferToNum(session.buffer) || 1),
  TAG_COMMAND: () => startOption(session.key === '_' ? '_' : '-'),
  // og binds :t to toggle-option with an extra 't', opening the
  // -t tag prompt (decode.c A_OPT_TOGGLE|A_EXTRA)
  OPTION_TAG: () => { startOption('-'); optionKey(session.content, 't'); },
  FIRST_LINE: () => firstLine(session.content, bufferToNum(session.buffer)),
  LAST_LINE: () => {
    // a streaming pipe reads to its end first, like og's G with a
    // blank command line (jump_forw's ch_end_seek)
    const n = bufferToNum(session.buffer);

    // og's bare G is jump_forw, which pos_clears past its eof_bell:
    // the paint repaints with the skipping marker however close the
    // end is; a numbered G is jump_back and scrolls when on screen
    const jump = (): void => {
      if (lastLine(session.content, n)) markPosClear();
    };

    // an interrupted end scan is not og's error case: ch_end_seek's
    // loop exits on the READ_INTR EOI before ABORT_SIGS is checked,
    // returns success, and jump_forw jumps to the BUFFERED end — the
    // "Cannot seek to end of file" error needs a real seek failure
    if (!pipeDrain(jump, '', '')) {
      // jump_forw's ch_end_seek reads a completed pipe's EOI even
      // without a drain; a numbered G is jump_back and reads none
      if (!n) revealPipeEnd();
      jump();
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
    matchBracket(
      session.content, '{', '}', true,
      bufferToNum(session.buffer) || 1
    ),
  ROUND_BRACKET_RIGHT: () =>
    matchBracket(
      session.content, '(', ')', true,
      bufferToNum(session.buffer) || 1
    ),
  SQUARE_BRACKET_RIGHT: () =>
    matchBracket(
      session.content, '[', ']', true,
      bufferToNum(session.buffer) || 1
    ),
  CURLY_BRACKET_LEFT: () =>
    matchBracket(
      session.content, '{', '}', false,
      bufferToNum(session.buffer) || 1
    ),
  ROUND_BRACKET_LEFT: () =>
    matchBracket(
      session.content, '(', ')', false,
      bufferToNum(session.buffer) || 1
    ),
  SQUARE_BRACKET_LEFT: () =>
    matchBracket(
      session.content, '[', ']', false,
      bufferToNum(session.buffer) || 1
    ),
  CUSTOM_BRACKET_RIGHT: () =>
    startBrackets(true, bufferToNum(session.buffer) || 1),
  CUSTOM_BRACKET_LEFT: () =>
    startBrackets(false, bufferToNum(session.buffer) || 1),
  SET_MARK: () => startSetMark(false, bufferToNum(session.buffer)),
  SET_MARK_BOTTOM: () => startSetMark(true, bufferToNum(session.buffer)),
  GO_MARK: () => startGoMark(bufferToNum(session.buffer)),
  CLEAR_MARK: () => startClearMark(),
  FOLLOW: () => beginFollow('forever'),
  FOLLOW_BELL: () => beginFollow('bell'),
  FOLLOW_HILITE: () => beginFollow('hilite'),
  // og's A_EXAMINE has no helpfile guard: :e works from help and
  // the edit leaves the help screen
  OPEN_FILE: () => {
    if (secureAllow('examine')) startExamine();
  },
  // og's :n/:p carry no helpfile guard: stepping the file list
  // leaves help; with no target og stays (error on the help screen)
  NEXT_FILE: () => {
    if (mode.HELP &&
        stepFileTarget(1, bufferToNum(session.buffer) || 1) !== null) {
      exitHelp();
    }
    stepFile(1);
  },
  PREV_FILE: () => {
    if (mode.HELP &&
        stepFileTarget(-1, bufferToNum(session.buffer) || 1) !== null) {
      exitHelp();
    }
    stepFile(-1);
  },
  // og's A_INDEX_FILE has no helpfile guard either: :x edits the
  // n-th file, leaving help
  INDEX_FILE: () => {
    const target = indexFileTarget(bufferToNum(session.buffer) || 1);

    if (target !== null) {
      exitHelp();
      switchToFile(target);
    }
  },
  REMOVE_FILE: () => removeFile(),
  CURRENT_INFO: () => fileInfo(session.content),
  NOACTION: () => {},
  SHELL_COMMAND: () => startShellFeature('shell', () => startMiscInput('!')),
  PSHELL_COMMAND: () => startShellFeature('shell', () => startMiscInput('#')),
  PIPE_COMMAND: () => startShellFeature('pipe', startPipe),
  SAVE_FILE: () => startLogFile(false),
  ADD_COMMAND: () => startMiscInput('+'),
  EDIT_FILE: () => runEditor(),
  VERSION: () => versionMessage(),
};

// helpers

/**
 * Exactly the commands og runs cmd_exec() for, read off command.c's
 * switch (:1694, :1707, :1759, ...).
 */
const CMD_EXEC_ACTIONS = new Set<Actions>([
  'LINE_FORWARD', 'NEWLINE_FORWARD',
  'LINE_BACKWARD', 'NEWLINE_BACKWARD',
  'WINDOW_FORWARD', 'SET_WINDOW_FORWARD',
  'WINDOW_BACKWARD', 'SET_WINDOW_BACKWARD',
  'FORCE_LINE_FORWARD', 'FORCE_LINE_BACKWARD',
  'NO_EOF_WINDOW_FORWARD', 'FORCE_WINDOW_BACKWARD',
  'SET_HALF_WINDOW_FORWARD', 'SET_HALF_WINDOW_BACKWARD',
  'FIRST_LINE', 'LAST_LINE', 'PERCENT_LINE', 'GO_POS',
  'MOUSE_FORWARD', 'MOUSE_BACKWARD', 'MOUSE_LEFT', 'MOUSE_RIGHT',
]);

function act(action: Actions | undefined): void {
  // a new command: the previous one's cmd_exec opening is spent
  search.cmdExecOpened = false;

  // og's cmd_exec (command.c:124): `clear_attn(); clear_bot();
  // flush();` before the command runs, so the ":" is off the screen
  // while the work happens - which on a burst scroll is exactly when
  // the line-number walk is still going. The frame that follows sees
  // cmdExecOpened and does not write a second clear.
  // No mode.INIT guard: og's cmd_exec is unconditional at every one of
  // these cases (command.c:1694, :1707, ...), and first_time gates
  // only the "...skipping..." marker inside forw(), never the clear.
  // Skipping it on the first keys left the ":" standing through their
  // work - the one or two early flashes that survived every other fix.
  if (action !== undefined && CMD_EXEC_ACTIONS.has(action) &&
      !session.shellPause) {
    putstr(clearBot());

    // og's cmd_exec ends with flush() (command.c:128): the clear goes
    // to the terminal BEFORE the command runs, so the ":" is off the
    // screen while the work happens. og can flush unconditionally
    // because its work is microseconds - the blank IS on the glass,
    // just never long enough to catch.
    //
    // Ours is milliseconds on every key, so flushing here put that
    // blank in front of the user on every key: the flicker, and the
    // half-second the help prompt went missing. Held back, the clear
    // stays in the buffer and the frame overwrites it in the same
    // write - og's imperceptible gap, made actually imperceptible.
    //
    // When the ":" is meant to be gone (promptHolding), we flush like
    // og and it really does leave the screen for the work.
    if (promptHolding()) flush();

    search.cmdExecOpened = true;
    dirtyBottomRow();
  }

  config.keyPrefix = '';

  const handled = action !== undefined &&
    pagerInput?.handle(action, bufferToNum(session.buffer)) === true;

  if (handled) {
    // The input already updated the shared config/content view.
  } else if (action !== undefined && action in acts) {
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

  // a forward move that clamped short of a live pipe's data blocks
  // reading like og's forw_line: the render below paints og's
  // cleared command line while the wait runs
  if (pendingScroll.rows) startPendingScroll();

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

  // og's forw()/back() end with currline(BOTTOM) (forwback.c:382,
  // 457): the moved rows are already up, the eager line-number walk
  // runs now, and the prompt below paints only after it completes
  if (!session.exited && !drained && !session.shellPause) {
    pagerInput?.resolveBottom?.();

    // quitting must not repaint over the final prompt, like less —
    // and a shell done-message pause owns the screen until its key
    // (og's lsystem blocks inside the command; ours resumes at the
    // shellPause dismissal, which repaints)
    render(session.content, session.buffer);
  }
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

// og reads ONE character at a time and, when what it has so far is
// only a prefix of some binding, waits for the next one (A_PREFIX,
// command.c:2499). A terminal is free to split an escape sequence
// across reads - a slow link does it, and lesstest feeds byte by
// byte - so an incomplete tail has to wait here too rather than
// being dispatched as separate keys.
const PARTIAL_SEQUENCE = /\x1b(?:\[[\x20-\x3f]*|O)?$/;

let heldKeyBytes = '';

/**
 * og's flush point, and the only one the command loop needs.
 *
 * og buffers everything a command emits and flushes when it is about
 * to make the user wait (cmd_exec, command.c:128). Returning from
 * here IS that moment: the chunk is fully processed and we go back to
 * waiting on the tty. One write per input chunk, so a key that echoes
 * five fragments draws once instead of five times.
 *
 * The finally matters more than the call: keyHandlerKeys returns
 * early in a dozen places, and a path that skipped the flush would
 * leave the screen stale until the next keypress.
 */
function keyHandler(data: Buffer): void {
  try {
    keyHandlerKeys(data);
  } finally {
    flush();
  }
}

function keyHandlerKeys(data: Buffer): void {
  // og's psignals clears sigs before handling it (signal.c:290), so
  // the flag lives only for the work the interrupt was meant to stop.
  // Clearing it at the top of every input chunk makes that fail-safe:
  // a stuck flag would abort every paint forever, and any keystroke
  // recovers from it.
  clearAbort();

  let text = heldKeyBytes + data.toString();
  heldKeyBytes = '';

  const partial = PARTIAL_SEQUENCE.exec(text);

  if (partial) {
    heldKeyBytes = partial[0];
    text = text.slice(0, partial.index);

    // og echoes what it is holding through the A_PREFIX mca: a " "
    // prompt and the char through prchar (command.c:2506). But it
    // only gets that far if getcc RETURNED the char, and getcc_repl
    // swallows anything that is still a partial match of kent (the
    // keypad-Enter sequence) - it loops on its own read, never
    // reaching the command loop. On an xterm kent is ESC O M, so a
    // bare ESC produces no output at all; captured in a pty, exactly
    // zero bytes. lesstest's terminal defines no kent, which is why
    // its recordings do show " ESC".
    const kent = kentSequence();
    const swallowed = kent !== '' && kent.startsWith(heldKeyBytes);

    if (!swallowed && !session.buffer.length && !cmd.active &&
        !option.pending && !search.input && !examine.pending &&
        !miscInput.pending && !brackets.pending && !marks.pending) {
      config.keyPrefix = heldKeyBytes;
    }

    if (!text) {
      if (!swallowed) render(session.content, session.buffer);
      return;
    }
  }


  // og's raw mode keeps ISIG: a typed ^C is a kernel SIGINT to the
  // foreground group, killing a pipe's writer along the way — the
  // driver semantics node's raw mode dropped
  // NOT raiseAbort() here: og's signal fires at the DRIVER, but og
  // has already read and run the bytes ahead of the ^C - which is why
  // "jjjj^Cjjjj" leaves it on line 5, not line 1. Raising the flag on
  // the whole chunk aborted the paints of those first four j's too.
  // It is raised where the ^C is actually reached: in the key loop
  // below, or by the poll when one is typed during the work.
  if (text.includes('\x03')) {
    // og's ISIG: the tty driver FLUSHES the input queue when it
    // generates SIGINT, so every key typed before the ^C is thrown
    // away by the KERNEL and og never sees them.
    //
    // Ours are already out of the kernel - node's stream drained them
    // into userspace the moment they arrived - so a signal has nothing
    // left to flush and the backlog kept scrolling. Holding j and
    // hitting ^C left hundreds of queued j's still to run. This is
    // that flush, on the queue the bytes actually sit in.
    dropQueuedKeys();
    raiseSigint();
  }

  // og's initial fill blocks in read: check_poll queues typed tty
  // chars (ungetcc_back) until the screenful or the learned length;
  // only the --intr char or an interrupt breaks out (READ_INTR),
  // and the first queued key surfaces the wait message (READ_AGAIN)
  // — a forward move blocked on the pipe (forw_line) gates the same
  if ((pipeFilling() || pendingScroll.rows > 0) && !session.shellPause) {
    // OG does not poll the tty while acquiring the first screen until
    // LESS_SCREENFILL_TIME expires. Queue ordinary keys for the command
    // loop, but let ^C interrupt the fill immediately.
    if (pipeFilling() && screenFillGrace() && !text.includes('\x03')) {
      session.fillKeys.push(text);
      return;
    }

    if (text.includes('\x03') || text.includes(optIntrChar())) {
      if (pendingScroll.rows) {
        abortPendingScroll(text.includes('\x03'));
      } else {
        // og's ^C is a SIGINT whose u_interrupt handler bells; the
        // --intr char reaches the read silently
        if (text.includes('\x03')) ringBell();
        abortPipeFill();
      }

      // getcc_clear discards the QUEUED keys; chars typed after the
      // interrupt are still unread in og's tty buffer and run as
      // commands
      const cut = Math.max(
        text.lastIndexOf('\x03'), text.lastIndexOf(optIntrChar()));
      const tail = text.slice(cut + 1);
      if (tail && !session.exited) keyHandler(Buffer.from(tail));

      return;
    }

    session.fillKeys.push(text);

    if (!session.pipeWaiting) {
      session.pipeWaiting = true;
      render(session.content, session.buffer);
    }

    return;
  }

  // a movement/search/G wait over a growing spool is the pipe read
  // itself: ^C or --intr abandons it and restores bounded read-ahead,
  // like og's READ_INTR breaking out of a blocked pipe read
  if ((text.includes('\x03') || text.includes(optIntrChar())) &&
      pagerInput?.interrupt?.()) {
    if (text.includes('\x03')) ringBell();
    render(session.content, session.buffer);

    const cut = Math.max(
      text.lastIndexOf('\x03'), text.lastIndexOf(optIntrChar()));
    const tail = text.slice(cut + 1);
    if (tail && !session.exited) keyHandler(Buffer.from(tail));

    return;
  }

  if (optNoPaste() || session.pasting || session.ignoringPaste) {
    text = filterPaste(text);
  }

  // one write per COMMAND, which is og's granularity: cmd_exec flushes
  // before each command runs (command.c:128), so a burst of forty keys
  // reaches the terminal as forty paints and scrolls smoothly. Holding
  // the whole chunk back instead would be one jump at the end — the
  // buffer is there to stop a single command arriving in fragments,
  // not to merge commands together.

  // og reads a byte at a time, so a chunk carrying more than one
  // command always has something left in the tty when it stops to
  // read - and the prompt it writes is overwritten in the buffer
  // before any of it is flushed. Marked PER KEY: the last one has
  // nothing behind it and gets its prompt, like og's.
  // og's command loop is ONE key at a time:
  //
  //     for (;;) { c = getcc(); ... commands(); }
  //
  // It returns to the read after every command, which is what makes a
  // ^C land promptly, the ":" time correctly, and the backlog
  // discardable. Ours ran a whole chunk in one synchronous loop and
  // never yielded, so node could deliver neither the signal nor the
  // next byte until the last key was done - the root cause behind the
  // uninterruptible scroll AND the prompt flicker.
  //
  // The queue below IS og's tty queue, held explicitly because ours
  // has already left the kernel.
  const chunk = splitKeys(text);

  // og's ISIG: when the driver generates SIGINT it flushes the input
  // QUEUE - everything typed BEFORE the ^C, which is what is sitting
  // in it. Bytes after the ^C are enqueued afterwards and survive.
  // Measured across four shapes, and it is the leading keys that go:
  //
  //   jjjj^Cjjjj -> line 5   leading 4 flushed, trailing 4 ran
  //   jjjj^Cj    -> line 2   leading 4 flushed, trailing 1 ran
  //   jj^C       -> line 1   leading 2 flushed, none after
  //   ^Cjj       -> line 3   nothing queued, both ran
  //
  // I had this backwards at first - keeping the leading keys and
  // dropping the trailing ones - which matched only the first shape.
  const intr = chunk.indexOf('\x03');

  if (intr > 0) {
    chunk.splice(0, intr);
    raiseAbort();
  }

  if (!pendingKeys.length) backlogSince = Date.now();

  pendingKeys.push(...chunk);
  drainKeys();
}

/**
 * How long the screen rests at an edge before the queue moves again.
 *
 * A DURATION, not a count of surviving keys. Keeping n no-op commands
 * seemed like the same thing - they cost a frame each, so they buy
 * time - but a no-op frame is a couple of milliseconds and four of
 * them went by as a flash: the bottom was never actually seen.
 *
 * The pause matters when the keys that scroll BACK are already queued
 * behind the ones that hit the edge, which is what a fast down-then-up
 * burst is: without it the discarded tail lets them run immediately
 * and the screen leaves the bottom the instant it arrives. og needs
 * none of this because its backlog drains at microseconds a key and
 * the edge holds for however long the user keeps pressing.
 *
 * A FLOOR, not a target: the edge is guaranteed to hold this long,
 * and holds longer whenever the user simply keeps pressing.
 */
export const EDGE_DWELL_MS = 120;

/**
 * How long the queue must still rest at an edge, 0 when it may run.
 *
 * A FLOOR, not a target: the edge is guaranteed to hold this long and
 * holds longer while the user keeps pressing. og needs none of it -
 * its no-op costs microseconds, so the edge naturally holds for as
 * long as keys arrive - but we discard the backlog, so without a rest
 * the keys that scroll BACK run the instant the bottom is reached and
 * the screen leaves it in the same breath.
 */
export function edgeWait(until: number, now: number): number {
  return until > 0 ? Math.max(until - now, 0) : 0;
}

/** How long an unbroken backlog means the loop is losing the race. */
export const BEHIND_MS = 80;

/**
 * Whether the key loop is BEHIND: keys waiting, and waiting since
 * longer ago than a person can type.
 *
 * Takes the clock rather than reading it, so the rule can be stated
 * without one. A terminal hands a burst over in chunks, so a queue
 * length on its own cannot tell "losing the race" from "briefly
 * holding five keys" - which is why hiding the ":" on queue length
 * alone took it off a one-screen file where og's stays put.
 *
 * @param since - When the CURRENT unbroken backlog began, 0 when the
 *   queue is empty. Not "when the queue was last empty": after a quiet
 *   spell that reads as an enormous backlog the moment one key lands.
 */
export function fallingBehind(
  queued: number,
  since: number,
  now: number
): boolean {
  return queued > 0 && since > 0 && now - since >= BEHIND_MS;
}

/** When the CURRENT unbroken backlog started, 0 when the queue is
 *  empty. Not "when the queue was last empty": after a quiet spell
 *  that reads as an enormous backlog the moment one key lands. */
let backlogSince = 0;

/** When the current edge rest ends, 0 when not resting. */
let edgeDwellUntil = 0;
let dwellTimer: ReturnType<typeof setTimeout> | null = null;

/** Ends an edge rest early, for a teardown or a discarded queue. */
function cancelEdgeDwell(): void {
  edgeDwellUntil = 0;
  if (!dwellTimer) return;
  clearTimeout(dwellTimer);
  dwellTimer = null;
}

/**
 * Drops the run of keys identical to the one just run, in place.
 *
 * Stops at the first DIFFERENT key, which is the whole contract: at an
 * edge the repeats do the same nothing and are free to discard, but
 * the key that means something else must still run at once - hold j
 * into the bottom, press k, and it moves without waiting for the j's.
 * Dropping the lot instead makes the pager ignore the turn.
 */
export function collapseRun(queue: string[], key: string): void {
  while (queue.length && queue[0] === key) queue.shift();
}

/** og's tty input queue: keys read but not yet run. */
let pendingKeys: string[] = [];
let draining = false;

/**
 * og's ISIG queue flush: the driver throws away everything typed
 * before the ^C, so og never sees it. Ours is an array.
 */
function dropQueuedKeys(): void {
  pendingKeys = [];
  backlogSince = 0;
  cancelEdgeDwell();
  takeUngot();
}

/**
 * One key, then back to the event loop - og's `commands()` returning
 * to `getcc()`.
 */
function drainKeys(): void {
  if (draining) return;

  // Resting at an edge. Checked HERE rather than only where a drain
  // hands off to the next key, because the rest has to outlive the
  // queue going empty: the burst that hit the bottom is discarded, so
  // there is usually nothing left to hold, and the keys the rest
  // exists to delay are the ones the tty delivers DURING it. Those
  // arrive through keyHandler, which calls straight in here - so this
  // is the only gate they pass.
  {
    const rest = edgeWait(edgeDwellUntil, Date.now());

    if (rest > 0) {
      // one timer for the whole rest, however many chunks arrive
      if (!dwellTimer) {
        dwellTimer = setTimeout(() => {
          dwellTimer = null;
          drainKeys();
        }, rest);
      }

      return;
    }

    edgeDwellUntil = 0;
  }

  draining = true;

  try {
    const key = pendingKeys.shift();
    if (key === undefined) {
      backlogSince = 0;
      return;
    }

    // drained: the next backlog starts its own clock
    if (!pendingKeys.length) backlogSince = 0;

    cancelPromptSettle();

    // og's tty still holds the rest of the burst while it runs this
    // one, and its reads poll and unget from it - which is what keeps
    // the ":" off the screen for the whole scroll.
    //
    // Read BEFORE armStall clears it: at an edge the previous command
    // moved nothing, so this one will not read either and og's prompt
    // stays up. Re-arming the hold here is what flickered "(END)".
    markBurst(pendingKeys.length > 0);

    // Falling BEHIND, as against merely holding a chunk. A terminal
    // hands a burst over in chunks, so a few keys sit in the queue for
    // a couple of milliseconds even when we are well ahead - that is
    // why a queue length alone took the ":" off a one-screen file.
    // A queue that has not gone empty for this long means the work
    // provoked by the keys is outrunning the loop that reads them,
    // which is exactly when the user cannot get a keypress in and
    // exactly when the ":" should be out of the way.
    if (fallingBehind(pendingKeys.length, backlogSince, Date.now())) {
      markBehind();
    }

    // Whether we are losing the race, read BEFORE the command runs -
    // its own eof_bell clears the flag (an edge does no work), and the
    // discard and rest below both hang off this.
    const behind = promptHolding();

    // this command has not hit an edge yet - its own eof_bell decides
    armStall();

    // ...and it has not read anything yet either, so og would not yet
    // have polled for it
    armReadWatch();

    // og's cmd_exec/prompt() pair leaves the command line blank for
    // exactly as long as the work takes. This is that long: a command
    // slow enough to see holds the ":" off even without a backlog.
    const started = Date.now();
    handleKey(key);
    flush();
    markCommandTime(Date.now() - started);

    // The command moved nothing (og's nlines == 0, forwback.c:335,
    // :372) and the queue's head is the SAME key: it will hit the
    // same wall, bell into the same rate limit, and repaint the same
    // "(END)". Running it is indistinguishable from dropping it,
    // except that running it costs a full frame - which is what made
    // an overshoot into EOF unresponsive for as long as the backlog
    // took to drain.
    //
    // Dropped only up to the first DIFFERENT key, which runs at once:
    // holding j into EOF then pressing k moves back immediately
    // instead of after the j's finish. og needs none of this because
    // its no-op costs microseconds; ours is a whole render.
    //
    // Not done by skipping the paint instead: the frame is also what
    // wipes the arrow's own key echo, and without it the ESC O A sat
    // on the command line as "ESCOA".
    //
    // The whole run goes, and the screen then RESTS here for
    // EDGE_DWELL_MS before anything else runs - see EDGE_DWELL_MS for
    // why the rest is a clock and not a few surviving keys.
    // Only while BEHIND. Both halves below are compensation for not
    // keeping up: the discard throws away work og would have done, and
    // the rest gives back the dwell that discard removed. When the
    // loop is keeping up there is nothing to compensate for - og runs
    // those few no-op commands and so do we, and resting anyway would
    // delay an ordinary keypress for no reason (press j at the bottom,
    // then k, and the k waits). Same condition that hides the ":", so
    // the two can never disagree about whether we are struggling.
    if (isStalled() && behind && pendingKeys.length) {
      collapseRun(pendingKeys, key);
      edgeDwellUntil = Date.now() + EDGE_DWELL_MS;
    }
  } finally {
    draining = false;
  }

  if (session.exited) {
    pendingKeys = [];
    cancelEdgeDwell();
    cancelPromptSettle();
    return;
  }

  if (pendingKeys.length) {
    // back to the read, exactly as og does - and THIS is the yield
    // that lets a ^C typed mid-scroll be delivered at all. A rest
    // started by the key just run is honoured at the top.
    setImmediate(drainKeys);
    return;
  }

  armPromptSettle();

  // keys the interrupt poll queued during a blocking walk run now,
  // like og's command loop draining the ungot queue - except while a
  // message waits: og's get_return reads the raw tty, so queued keys
  // stay behind it until a fresh key dismisses
  if (!search.message) {
    const pending = takeUngot();
    if (pending && !session.exited) keyHandler(pending);
  }
}

/** The pending "the scroll is over, put the ":" back" repaint. */
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPromptSettle(): void {
  if (!settleTimer) return;
  clearTimeout(settleTimer);
  settleTimer = null;
}

/**
 * Brings the ":" back once the work has actually stopped.
 *
 * og needs nothing here: its prompt() writes the ":" at the end of
 * every command, and the next command's clear_bot takes it away again
 * microseconds later, so "hidden while working" and "back when idle"
 * are the same instant. Ours holds the line blank across the whole
 * burst instead - that is what keeps it from blinking - so something
 * has to decide the burst is over, and an empty key queue does not:
 * macOS auto-repeat empties it between the last few keys. A quiet
 * interval does.
 */
function armPromptSettle(): void {
  cancelPromptSettle();
  if (!promptHolding()) return;

  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (session.exited || pendingKeys.length) return;

    endPromptHold();

    // an open mca owns the bottom line; the ":" is not what belongs
    // there, and prompt() is not reached while one is collecting
    if (search.message || search.input || promptOpen()) return;

    // the held frames left the row blank on the glass while the table
    // still carries whatever the last written prompt was, so the
    // delta would dedupe the ":" away and it would never come back
    dirtyBottomRow();
    render(session.content, session.buffer);
    flush();
  }, PROMPT_SETTLE_MS);
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

  return session.content.some(line => visualWidth(line) > config.screenWidth);
}

// og's x11mouse_action keeps the last button pressed in a static,
// because the X10 report says only "a button came up" (button 3) and
// never which one (decode.c:773)
let prevMouseButton = 0;

/**
 * An X10/X11 mouse report rewritten in the SGR shape, or null when the
 * key is not one.
 *
 * og decodes the two formats separately and calls the same handlers;
 * rewriting is the same thing with one decoder. The byte arithmetic is
 * og's: the button and both coordinates are offset by 32, and og then
 * takes one more off each coordinate (X11MOUSE_OFFSET-1) where SGR
 * counts from 1 - so an SGR parameter is just the raw byte minus 32.
 */
function normalizeMouse(key: string): string | null {
  const intro = userBoundTo('MOUSE_X11_IN') ?? '\x1b[M';
  if (!key.startsWith(intro)) return null;

  return x11ToSgr(key.slice(intro.length));
}

/** The three report bytes, in the SGR shape. */
function x11ToSgr(rest: string): string | null {
  if (rest.length < 3) return null;

  const button = rest.charCodeAt(0) - 32;
  const x = rest.charCodeAt(1) - 32;
  const y = rest.charCodeAt(2) - 32;

  // og's X11MOUSE_BUTTON_REL: a release names no button, so the one
  // remembered from the press is the one that came up. The drag bit
  // rides along in the SGR parameter, which is why only the BARE
  // button is compared here
  const bare = button & ~0x20;

  if (bare === 3) return `\x1b[<${prevMouseButton};${x};${y}m`;

  // og remembers the BARE button (its `b` has the drag bit already
  // stripped, decode.c:777), so a release after a drag reports the
  // button that was held, not the drag bit
  if (bare <= 2) prevMouseButton = bare;
  return `\x1b[<${button};${x};${y}M`;
}

// a mouse report whose INTRODUCER a lesskey file moved: og reads the
// rest with getcc from inside x11mouse_action/x116mouse_action, so the
// binding names only the introducer and the decoder discovers the
// length. Ours arrives pre-split, so the bytes are collected here.
let mouseReport: { sgr: boolean, buf: string } | null = null;

function dispatchKey(sequence: string): void {
  session.key = sequence;

  if (mouseReport !== null) {
    const report = mouseReport;
    report.buf += sequence;

    // og's getcc_int gives up on a char that cannot belong to the
    // report (decode.c), and so does this
    const ok = report.sgr
      ? /^[\d;]*[Mm]?$/.test(report.buf)
      : report.buf.length <= 3;

    if (!ok) {
      mouseReport = null;
      return;
    }

    const done = report.sgr
      ? /^\d+;\d+;\d+[Mm]$/.test(report.buf)
      : report.buf.length === 3;

    if (!done) return;

    mouseReport = null;

    // NOT by re-forming the introducer: it is the REBOUND one, which
    // normalizeMouse would then look for again. The report's own
    // bytes are what both formats decode from
    const sgr = report.sgr ? '\x1b[<' + report.buf : x11ToSgr(report.buf);
    if (sgr !== null) dispatchKey(sgr);
    return;
  }

  {
    const bound = userBinding(sequence)?.action;

    if (bound === 'MOUSE_SGR_IN' || bound === 'MOUSE_X11_IN') {
      mouseReport = { sgr: bound === 'MOUSE_SGR_IN', buf: '' };
      return;
    }
  }

  // a report that arrives while a prompt - or a COUNT - is open is
  // read and thrown away. og's line editor decodes it through
  // editchar, which hands it to x116mouse_action(skip=TRUE), and
  // that returns A_NOACTION before it ever looks at the button
  // (decode.c:818). cmd_char turns A_NOACTION into CC_OK and the
  // digit prompt turns it into MCA_MORE, "ignore this char and get
  // another one" (command.c:690) - so the prompt keeps its text,
  // nothing scrolls, and nothing repaints. Measured: with ":5" up,
  // og swallows a wheel tick whole and still shows ":5" at exit.
  if (!session.escCount && (promptOpen() || mode.BUFFERING)) {
    const report = normalizeMouse(session.key) ?? session.key;

    if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(report)) return;
  }

  // the interrupt key abandons a G/% pipe drain: og's interrupted
  // ch_end_seek returns SUCCESS (the loop exits on the READ_INTR
  // EOI), so G jumps to the buffered end and paints — only % still
  // fails its ch_length check and errors ("Don't know length of
  // file"); ^C's u_interrupt handler rings the bell either way
  if (session.pipeDrainTo &&
      (session.key === '\x03' || session.key === optIntrChar())) {
    const jump = session.pipeDrainTo;
    session.pipeDrainTo = null;
    pipeDraining.active = false;
    session.pipeWaiting = false;

    if (session.key === '\x03') ringBell();

    if (pipeDraining.cancelMessage) search.message = pipeDraining.cancelMessage;
    else jump();

    render(session.content, session.buffer);
    return;
  }

  // waiting after !/|: the keypress re-enters the pager (! pauses on
  // the shell screen, | on the blank pager screen); non-return keys
  // become the next command (get_return)
  if (session.shellPause) {
    if (session.shellPause === 'shell') {
      putstr('\n');
      enterScreen();
    } else {
      // the | screen was already re-entered before the done message,
      // so this only forgets the frame - not og's first_time
      resetRender(true);
    }

    session.shellPause = false;

    if (session.key === '\x0D' || session.key === '\x0A' ||
        session.key === ' ') {
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

  // -K exits on ctrl-C, like less's quit_on_intr; og's psignals
  // quits with QUIT_INTERRUPT = 2 (signal.c:296)
  if (session.key === '\x03' && optQuitOnIntr()) {
    process.exitCode = 2;
    session.exit();
    return;
  }

  // og's u_interrupt (signal.c:41) is a SIGNAL handler, so it runs
  // whatever the pager was doing: it lbell()s and calls
  // set_filter_pattern(NULL, 0) - which drops any & filter and, at
  // its end, screen_trashed() UNCONDITIONALLY (search.c). The next
  // prompt therefore repaints through make_display with top_scroll
  // forced: clear, home, redraw. We only cleared the filter, and only
  // when there was one, and never repainted. It does NOT return: a
  // command line still cancels below, exactly as og's ABORT_SIGS does
  // ...but not while something is already WAITING on the interrupt:
  // F, a pipe drain and a pending scroll each read it as their own
  // stop signal below, ring their own bell and repaint their own way
  if (session.key === '\x03' && !follow.active && !session.pipeDrainTo &&
      !pendingScroll.rows && !session.pipeWaiting) {
    ringBell();

    if (search.filters.length) {
      search.filters = [];
      session.content = deriveContent();
      pagerInput?.rebuild();
      calculateEOF(session.content);
    }

    // repaint() is pos_clear + jump_loc (jump.c:124), and
    // make_display forces top_scroll for a trashed screen
    // (command.c:865), so the paint clears and homes
    // the mca's number goes with it: og's command loop starts the
    // next iteration from cmd_reset, and the interrupt never reaches
    // an action that could consume the count
    session.buffer.length = 0;

    markFullRepaint();
    markPosClear();
    markClearHome();

    // make_display's repaint is not a command's paint: no cmd_exec
    // ran, so nothing clear_bots in front of it
    markBareRepaint();

    // og's getcc_clear (signal.c:299) throws the interrupt away, so
    // no command runs behind it. A command LINE still has to cancel,
    // which the branches below do, but an idle ^C ends here - it was
    // ringing a second bell through the unbound-key path
    const idle = !search.input && !option.pending && !examine.pending &&
      !marks.pending && !brackets.pending && !miscInput.pending &&
      !pipeMark.pending && !config.keyPrefix;

    if (idle) {
      render(session.content, session.buffer);
      return;
    }
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
      // og: a message wider than the screen wrapped and trashed the
      // rows above the prompt (command.c:998 calls make_display
      // again) - the dismissal repaint must be full, not a scroll
      if (visualWidth(search.message + '  (press RETURN)') >
          config.screenWidth) {
        resetRender();
      }

      search.message = search.messageQueue.shift() ?? '';
      render(session.content, session.buffer);
      return;
    }

    if (session.key === '\x03' || session.key === optIntrChar()) {
      // ^C arrives as og's SIGINT, whose u_interrupt handler rings
      // the bell; the --intr char (READ_INTR) leaves silently — and
      // both run getcc_clear, discarding the keys typed in the wait
      if (session.key === '\x03') ringBell();

      endFollow();
      render(session.content, session.buffer);
    } else {
      follow.queued.push(session.key);
    }

    return;
  }

  // dismissing a message reveals any queued follow-up, like less's
  // consecutive blocking error() calls
  const hadMessage = search.message !== '';

  // og: a message wider than the screen wrapped and trashed the rows
  // above the prompt (command.c:998 calls make_display again) - the
  // dismissal repaint must be full, never a scroll shortcut
  if (hadMessage && visualWidth(search.message + '  (press RETURN)') >
      config.screenWidth) {
    resetRender();
  }

  search.message = search.messageQueue.shift() ?? '';

  // og's error() ends get_return with lower_left() + clear_eol()
  // (output.c:731): the message row is addressed absolutely and
  // cleared the moment the key arrives, before whatever the key then
  // does repaints. We left it to the repaint alone.
  if (hadMessage && !search.message && !mode.DUMB) {
    putstr(CURSOR_TO(config.window, 1) + CLEAR_LINE);
    dirtyBottomRow();

    // get_return RETURNS into the rest of the command that errored -
    // A_SETMARK's repaint(), say - and only then is the ungotten key
    // re-read. A repaint armed behind the message runs here, before
    // whatever that key does.
    //
    // ...but only when the key was CONSUMED. get_return ungets
    // anything that is not RETURN, space or an interrupt
    // (output.c:687), and og's prompt() then returns before
    // make_display while that key is pending (command.c:924) - so a
    // deferred screen_trashed (toggle_option's, unlike A_SETMARK's
    // immediate repaint()) waits for it too. Dismissing "Chop long
    // lines" with "-" repainted the chopped screen here; og keeps
    // showing the old one behind the "-" prompt.
    const consumed = session.key === '\x0D' || session.key === '\x0A' ||
      session.key === ' ';

    if (consumed && fullRepaintArmed()) {
      markPosClear();
      markBareRepaint();
      render(session.content, session.buffer);
    }
  }

  // RETURN and space only dismiss a pending message; other keys are
  // reprocessed as commands, like less's get_return
  if (
    hadMessage &&
    (session.key === '\x0D' || session.key === '\x0A' || session.key === ' ')
  ) {
    /* raw get_return: the kent conversion below never applies */
    // dismissing the LESSOPEN warning continues into the editor,
    // like og's error() returning before the edit
    if (session.pendingEditWarn) {
      runEditor();
    }

    render(session.content, session.buffer);
    return;
  }

  // og's kent translation happens at getcc, below error()'s raw
  // get_return: keypad Enter is '\n' for every prompt and command,
  // while at a message the raw ESC ungot above already dismissed
  session.key = kentToNewline(session.key);

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
        pagerInput?.rebuild();
      } else {
        execSearch(
          session.content,
          request => pagerInput?.search(request) ?? false
        );
      }
    } else if (result === 'cancel') {
      // --incsearch restores the position the prompt opened at
      if (optIncrSearch()) {
        restoreSearchOrigin(origin);
        pagerInput?.restoreSearchOrigin();
      }
    } else if (optIncrSearch()) {
      // incsearch paints mid-mca, clearing the trash like og's
      // repaint resetting screen_trashed
      unfreezeFrame();
      pagerInput?.restoreSearchOrigin();
      incrementalSearch(
        session.content,
        request => pagerInput?.search(request) ?? false
      );
    }

    render(session.content, session.buffer);
    return;
  }

  if (option.pending) {
    optionKey(session.content, session.key);

    // a completed toggle reports like og's error(): the message
    // draws over the old screen and any repaint waits for the
    // dismissing keystroke (toggle_option's screen_trashed, whose
    // make_display repaint homes a dumb terminal).
    //
    // Except for an O_HL_REPAINT option: chg_hilite runs BEFORE the
    // message (option.c:463) and repaint_hilite redraws every row
    // (search.c:1119), so that one is already on screen underneath
    if (search.message && !hiliteRepaintPending()) freezeFrame(true);

    render(session.content, session.buffer);
    return;
  }

  if (brackets.pending) {
    bracketsKey(
      session.content,
      session.key,
      (open, close, forward, n) =>
        pagerInput?.bracket(open, close, forward, n) ?? false
    );
    render(session.content, session.buffer);
    return;
  }

  if (marks.pending) {
    // og's gomark has no helpfile guard: jumping to a mark from
    // help edits the mark's file, leaving the help screen
    if (marks.pending === "'" && mode.HELP && session.key !== '\x1b') {
      exitHelp();
    }

    // --autosave with `m` writes changed marks right away, inside
    // setMark/clearMark like og (gomark never saves immediately)
    marksKey(session.content, session.key);

    render(session.content, session.buffer);
    return;
  }

  if (examine.pending) {
    if (examineKey(session.key) === 'run') {
      // og's edit from the help file leaves it (even an empty
      // answer re-examines the current file)
      exitHelp();
      runExamine();
    }
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
    } else if (answer === 'none') {
      // og's 'D' just `return`s from use_logfile, straight back into
      // opt_o's TOGGLE and on to toggle_option, which prints the
      // option's own message like every other toggle. With no log
      // opened that is _o's "No log file" (optfunc.c).
      search.message = logFileName()
        ? `Log file "${logFileName()}"`
        : 'No log file';
    } else if (answer === 'quit') {
      // og quits from INSIDE query(), before it has repainted
      // anything: the warning it asked with is still the last thing
      // on the screen. Painting here wipes it.
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
  // which keys can HOLD is the table's business, not a hardcoded list
  if (config.keyPrefix && isKeyPrefix(config.keyPrefix)) {
    const prefix = config.keyPrefix;

    // erase and newline cancel a prefix silently (CF_QUIT_ON_ERASE)
    if (
      session.key === '\x03' || session.key === '\x08' ||
      session.key === '\x7F' ||
      session.key === '\x0D' || session.key === '\x0A'
    ) {
      config.keyPrefix = '';
      render(session.content, session.buffer);
      return;
    }

    // the built-in prefix already echoed itself when it opened; og
    // echoes the byte that COMPLETES it the same way (A_PREFIX,
    // command.c:2499) before the pair is looked up
    echoPrefix(prefix + session.key, prefix.length + 1);

    // og's DO the command: the mca completing runs cmd_exec(), whose
    // clear_bot opens whatever the command then writes - a paint, or
    // just a bell
    markBareRepaint(clearBot());

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

    // og's tail cascade covers the ^X/: prefixed bytes all the same
    // (the ":" entries live in the same cmd_decode tables); the
    // prefix ages out WITH the cascade — leaving it set would feed
    // every re-dispatched piece back into this branch forever
    // og's cmd_decode tail-matches whatever the pair accumulated,
    // one byte or several: "^X q" runs the tail `q` and quits
    if (action === undefined && !userStop() && !mode.DUMB) {
      config.keyPrefix = '';

      for (const piece of tailCascade(prefix + session.key)) {
        if (session.exited) return;

        if (piece === null) {
          act(undefined);
        } else {
          dispatchKey(piece);
        }
      }

      return;
    }

    act(action);
    return;
  }

  if (isKeyPrefix(session.key) && !session.escCount) {
    config.keyPrefix = session.key;
    render(session.content, session.buffer);
    return;
  }

  // og reads mouse reports in TWO wire formats, each introduced by
  // its own bound sequence: A_X11MOUSE_IN for the three-byte X10/X11
  // form and A_X116MOUSE_IN for SGR/1006 (decode.c:78). Both decode
  // into the same handlers, so the X11 one is normalized into the SGR
  // shape here and everything below reads one format
  if (!session.escCount) {
    const normalized = normalizeMouse(session.key);
    if (normalized !== null) session.key = normalized;
  }

  // mouse wheel ticks scroll --wheel-lines lines; --rmouse (or
  // --MOUSE) reverses the scroll direction, like less; the wheel
  // is ignored without the vscroll --emouse feature (decode.c)
  if (!session.escCount && (session.key.startsWith('\x1b[<64;') ||
      session.key.startsWith('\x1b[<65;'))) {
    // og's command loop returns to prompt() for EVERY key it consumed,
    // even one whose action does nothing: the report is swallowed but
    // the prompt is still reprinted, which is visible on the first one
    // because that is when the filename prompt gives way to ":"
    if (!optWheelEnabled()) return void render(session.content, session.buffer);

    const up = session.key.startsWith('\x1b[<64;');

    // og's mouse_wheel_up/down (decode.c:613): the DECODER picks
    // which of the two actions the report becomes, and --rmouse
    // swaps them there, not in the handler. The action then runs the
    // ordinary way - a wheel tick is a command like any other in og's
    // loop, so it gets cmd_exec, the input's own mover, and the
    // prompt that follows
    act(up !== optMouseReverse() ? 'MOUSE_BACKWARD' : 'MOUSE_FORWARD');
    return;
  }

  // a horizontal wheel shifts --wheel-lines columns when the
  // hscroll --emouse feature is on (og's A_L_MOUSE/A_R_MOUSE)
  if (!session.escCount &&
      (session.key.startsWith('\x1b[<66;') ||
        session.key.startsWith('\x1b[<67;'))) {
    if (!(opt.emouse & EMOUSE_HSCROLL)) {
      return void render(session.content, session.buffer);
    }

    const left = session.key.startsWith('\x1b[<66;') !== (optMouseReverse());

    act(left ? 'MOUSE_LEFT' : 'MOUSE_RIGHT');
    return;
  }

  // --emouse clicks and drags, like og's mouse_button_left/right:
  // left press records the drag origin, motion events drag the text
  // (hdrag/vdrag), a same-row release sets the mouse mark '#', and
  // a right-click release jumps to it
  const click = !session.escCount &&
    /^\x1b\[<(0|2|32);(\d+);(\d+)([Mm])/.exec(session.key);

  if (click && click[1] === '32' &&
      (opt.emouse & (EMOUSE_HDRAG | EMOUSE_VDRAG))) {
    const x = parseInt(click[2], 10) - 1;
    const y = parseInt(click[3], 10) - 1;

    if ((opt.emouse & EMOUSE_HDRAG) && session.lastDragX >= 0 &&
        x !== session.lastDragX) {
      // every horizontal move re-heads table[TOP] to its line's start
      // first (decode.c:666), exactly as LSHIFT/RSHIFT and the
      // horizontal wheel do. It is pos_rehead(FALSE): the hshift
      // adjustment that -S makes would send the shift to an
      // unexpected value here (778e15152, which is why the flag
      // exists at all).
      posRehead();

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

    // og's A_PREFIX (command.c:2499): an incomplete command opens an
    // mca with the " " prompt and echoes the character through
    // cmd_char "so the user knows what's going on", and every later
    // held character echoes the same way from the top of the loop.
    // EVERY ESC shows, from the first - there is no unechoed leading
    // one, no " ESC"/" ESCESC" cycle and no bell. (The old model had
    // all three; none of them appears in og's bytes.)
    session.escCount++;
    config.keyPrefix = '\x1B'.repeat(session.escCount);
    render(session.content, session.buffer);
  } else {
    // og-dumb echoes the terminating key into the pending ESC line
    // as caret notation before the sequence resolves; without clear
    // caps the echo stays behind as leftovers, like og
    if (mode.DUMB && session.escCount && session.key.length === 1) {
      putstr(session.key < ' ' || session.key === '\x7F'
        ? '^' + String.fromCharCode((session.key.charCodeAt(0) + 0x40) & 0x7F)
        : session.key);
    }

    const seq = session.userSeq +
      (session.escCount ? '\x1B' + session.key : session.key);

    // og reads one byte at a time, and every byte of an INCOMPLETE
    // command echoes into an mca opened with the " " prompt
    // (A_PREFIX, command.c:2499) before the action is looked up at
    // all - the terminating byte included. Our reader hands the whole
    // sequence over at once, so the echo is replayed here; og's bytes
    // are the same either way (measured: an arrow key chunked and
    // byte-by-byte produce identical output).
    echoPrefix(seq);

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
      seq[0] !== ':' && seq[0] !== '\x18' && seq[0] !== '\x0F' &&
      userIsPrefix(seq)
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

    // og's cmd_decode matches bindings against the TAIL of the
    // accumulated bytes (decode.c:943, cmd_match:845): stray prefix
    // bytes age out silently, a completed tail binding runs as its
    // own command (ESC j scrolls, ESC + arrow arrows), and an
    // unmatched buffer is ONE invalid command - bell, count dropped
    if (
      action === undefined && !mode.DUMB && !userStop() &&
      seq.length > 1 && !seq.startsWith('\x1b[<')
    ) {
      session.escCount = 0;

      for (const piece of tailCascade(seq)) {
        if (session.exited) return;

        if (piece === null) {
          act(undefined);
        } else {
          dispatchKey(piece);
        }
      }

      return;
    }

    act(action);
    session.escCount = 0;
  }
}

/**
 * og's A_PREFIX echo for a multi-byte key sequence: " " for the mca,
 * then each byte through cmd_char as its prchar representation.
 */
function echoPrefix(seq: string, from: number = 1): void {
  if (mode.DUMB || seq.length < 2) return;

  const held = config.keyPrefix;

  for (let i = from; i <= seq.length; i++) {
    config.keyPrefix = seq.slice(0, i);
    render(session.content, session.buffer);
  }

  config.keyPrefix = held;
}

/** og's `search_type = last_search_type; mca_search(); cmd_exec();` */
function searchFlash(reverse: boolean): void {
  if (!search.regex) return;

  const dir = reverse
    ? (search.lastDir === 1 ? -1 : 1)
    : search.lastDir;

  markSearchFlash(dir === 1 ? '/' : '?');
}

function init() {
  resetMarks();
  loadHistory();
  onAutosave(saveHistory);
  onShellAutosave(saveHistory);
  onHistTouch(touchSearchList);
  onHistRecord(recordSearchEntry);
  onShellHistTouch(touchShellList);
  onShellHistRecord(recordShellEntry);

  // og's gomark edits the mark's file: switch to an open entry, or
  // open a restored mark's file by name (mark_get_ifile + edit_ifile)
  onMarkSwitch(
    (mark, sline) => {
      // the mark holds the file itself; the switch wants its place in
      // the list, and a mark into a file no longer listed goes nowhere
      const index = files.list.indexOf(mark.file);

      if (index < 0 || !switchToFile(index)) return;
      jumpToMark(session.content, mark, sline, true);
    },
    (path, char, sline) => {
      if (!openByName(path)) return;
      jumpToUserMark(session.content, char, sline);
    }
  );

  // og's init_cmdhist runs before edit_first, so the restored marks
  // bind to the first file as it opens; ours opened it already -
  // bind them now (mark_check_ifile)
  if (files.index >= 0 && session.fullContent.length) {
    adoptFileMarks(files.index, session.fullContent);
  }

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
  refreshWindowTitle();

  // a dumb terminal gets no title, init or keypad strings, like
  // og's empty termcap capabilities
  if (!mode.DUMB) {
    // -X leaves the init/deinit strings unsent, like less
    if (!optNoInit()) {
      putstr(ALTERNATE_CONSOLE_ON);

      // og's term_init lower_lefts after switching to the alternate
      // screen (screen.c:2061), which is what makes a short first
      // screen scroll up from the bottom instead of printing at the
      // top. It guards on both "ti" and "te" existing, the same
      // condition ON_ALTERNATE_SCREEN carries
      if (ON_ALTERNATE_SCREEN) {
        putstr(CURSOR_TO(config.window, 1));
      }
    }

    if (!optNoKeypad()) putstr(KEYPAD_ON);
  }

  // mouse tracking and bracketed paste enable with the screen,
  // like og's init()/init_mouse, not during the option scan
  hook.screenActive = true;
  applyMouse();
  applyBracketedPaste();
  termInitTail();

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
  watchWinch(onResize);

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

  // og's lwinch longjmps out of get_return: a waiting error message
  // dismisses on resize without a key, the repaint erasing it
  search.message = '';
  unfreezeFrame();

  resetRender();

  // og keeps table[TOP] across a resize - screen_size_changed and
  // screen_trashed touch neither (signal.c:288) - so the top stays on
  // the same byte and only the wrapping changes. Ours indexes wrap
  // boundaries, so carry the OFFSET across and keep the remainder as
  // the shift.
  const top = session.content[config.row];
  const before = config.screenWidth;
  const offset = top === undefined ? -1 : topOffsetOf(session.content);

  calculateDimensions();
  pagerInput?.rebuild();

  // og's pos_init keeps exactly ONE entry across a resize - the top,
  // at its screen line - and pos_clears the rest (position.c:100), so
  // every other row regenerates at the new width. Ours must drop them
  // whatever the top's offset: their ends were measured at the OLD
  // width, and a stale end started the row below in the wrong place.
  if (config.screenWidth !== before) {
    config.screen = [];
    pagerInput?.posClear?.();
  }

  // after the rebuild: a source engine owns the top's sub-row and its
  // materialization writes config.subRow back from it, so the carry
  // has to land on both or the rebuild undoes it
  if (offset > 0 && top !== undefined && config.screenWidth !== before) {
    setTopOffset(top, config.row, offset);
    pagerInput?.retopOffset(offset);
  }

  // calculateEOF decides mode.EOF from whether the CONTENT ARRAY fits
  // one screen. For a source engine that array is a materialized
  // window of several screens, so the answer is always "no" and it
  // wipes the mode.EOF that the engine's own sync() just derived from
  // the file. og has no such conflict: eof_displayed reads
  // position(BOTTOM_PLUS_ONE) off the one table (forwback.c:95), so a
  // resize that does not move the top cannot change the answer. Keep
  // the endRow/endSubRow anchors it computes and put the engine's
  // verdict back.
  const sourceEof = pagerInput !== null ? mode.EOF : null;

  calculateEOF(session.content);

  if (sourceEof !== null) mode.EOF = sourceEof;

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
  // our own raiseSigint echo: the typed ^C's byte path already ran
  if (wasSelfSigint()) return;

  if (!session.exited) handleKey('\x03');
}

/** Runs the $LESS_SIGUSR1 keys on SIGUSR1, like og's sigusr(). */
function onSigusr1(): void {
  if (session.exited) return;

  const cmd = lgetenv('LESS_SIGUSR1');
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
  pagerInput?.rebuild();
  calculateEOF(session.content);
  render(session.content, session.buffer);
}

function exitHelp(): boolean {
  if (!mode.HELP) return false;

  // a --help/-? screen is og's FAKE_HELPFILE input, not the h
  // command's overlay: quitting it quits the pager
  if (session.startupHelp) return false;

  const helpConfig = config;

  // og restores save_bs_mode/save_proc_backspace on quit-help
  if (helpSavedBs) {
    opt.bsMode = helpSavedBs.bs;
    opt.procBackspace = helpSavedBs.pb;
    helpSavedBs = null;
  }

  session.content = session.prevContent;
  applyConfig(session.prevConfig);
  applyMode(session.prevMode);

  // Quitting help re-edits the file, and og's edit_ifile sets
  // `hshift = 0` (edit.c:680) for that switch like any other - so og
  // comes back at column 0 however far the file was shifted before h.
  // Entering help already matched (resetConfig zeroes it); leaving
  // restored the whole saved config, shift included.
  config.col = 0;

  // og's option variables (shift_count, swindow, wscroll,
  // chop_line) are globals: a change made inside the help screen
  // persists after leaving it
  config.setCol = helpConfig.setCol;
  config.setWindow = helpConfig.setWindow;
  config.halfWindow = helpConfig.halfWindow;
  config.chopLongLines = helpConfig.chopLongLines;

  // og's help exit re-edits the file: a $LESSOPEN preprocessor runs
  // again, arming a fresh altpipe whose status can report at the
  // next close (a second q prompts the error again, like og)
  if (helpClosedAlt) {
    helpClosedAlt = false;
    const entry = files.list[files.index];

    if (entry && entry.path !== '-') {
      entry.lines = null;
      const lines = loadFile(files.index);

      if (lines) {
        session.fullContent = lines;
        session.content = deriveContent();

        // og's repaint reads the fresh altpipe to EOI when the
        // content ends on screen: the length is learned and the
        // prompt shows (END) again, like eof_displayed
        if (session.content.length <= config.window - 1) {
          revealPipeEnd();
        }
      }
    }
  }

  calculateDimensions();
  pagerInput?.rebuild();
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

  // the re-edit repaints the whole screen: a squished short first
  // paint is abandoned (tildes fill in), and og's trashed-screen
  // repaint prints bare — the q never reaches the file's screen as
  // a clear_bot
  mode.INIT = false;
  // quitting help is another edit(), not a new session: og's
  // first_time stays false, so the file's screen comes back with
  // "...skipping..." (forwback.c:272)
  resetRender(true);
  markBareRepaint();

  return true;
}

// -u/-U and --proc-backspace saved across the help view, like og's
// save_bs_mode: help renders with BS_SPECIAL, quit-help restores the
// entry values (discarding in-help toggles)
let helpSavedBs: { bs: number, pb: number } | null = null;

// the preproc gate at help entry released with an ungot command:
// og's prompt() skips make_display while ungot input pends, so the
// command (a - option, a search...) runs over the STALE file screen
// and help paints only when the interaction returns to the prompt
let helpGateUngot = false;

// the help entry closed a $LESSOPEN altpipe: og's help exit re-edits
// the file, running the preprocessor AGAIN (edit_prev -> edit_ifile)
let helpClosedAlt = false;

/**
 * Opens a help screen as og's h does: a full edit of the FAKE_HELPFILE.
 *
 * `text` is ours, not og's - og has exactly one help file. The lesskey
 * syntax page rides the same path so it scrolls, searches and exits
 * identically; only the content differs.
 */
// the --lesskey-help option reaches the pager through here: options
// cannot import this module, so the entry point is a hook
hook.showLesskeyHelp = (): void => openHelp(lesskeyHelp);

// the nested session is what makes `q` mean "done looking": it
// unwinds the lesskey pager and leaves this one exactly as it was
hook.viewLesskey = (): void => {
  // like the h command's overlay rather than a session of its own:
  // one painter, and `q` unwinds one level
  if (openLesskeyView()) render(session.content, session.buffer);
};

function openHelp(text: string[] = help): void {
  if (mode.HELP) return;

  session.helpSource = text;

  // leaving the current content records the previous position, like
  // less's edit_ifile calling lastmark when switching to the help file
  recordLastPosition();

  // og's h is a full edit(FAKE_HELPFILE): leaving the file closes
  // its $LESSOPEN altpipe, whose exit status reports here (the
  // error gates before the help shows). og has already painted the
  // NEW file's still-empty screen - ...skipping... over null-line
  // tildes - when the close's error() blocks
  const helpEntry = files.list[files.index];
  helpClosedAlt = !!helpEntry?.alt;

  // og's error() runs squish_check (output.c:720): with a squished
  // short first paint, the un-squish repaints the JUST-CLOSED file -
  // an empty skipping frame of tildes; a full screen stays intact
  if (helpEntry?.alt && helpEntry.preprocError &&
      optShowPreprocError() && process.stdout.isTTY &&
      mode.INIT && !optOldBot()) {
    let frame = '\r' + CLEAR_LINE +
      (fullScreen() ? '...skipping...\n' : '');

    for (let i = 0; i < config.window - 1; i++) {
      frame += optTildes() ? BOLD_ON + '~' + BOLD_OFF + '\n' : '\n';
    }

    fs.writeSync(1, frame);
    mode.INIT = false;

    // the raw frame bypassed the renderer: seed it as the previous
    // rows so an unget-release's freeze preserves the tilde screen
    const tilde = optTildes() ? BOLD_ON + '~' + BOLD_OFF : '';
    seedFrameRows([...new Array(config.window - 1).fill(tilde), '']);
  }

  closeAlt(helpEntry);
  helpGateUngot = gateReleaseKind() === 'unget';

  // og's winch-released gate resumes a half-open edit that the
  // resize broke: jump_loc's seek fails and a SECOND gated error
  // chains before the help paints (og-verified byte shape:
  // lower-left + clear, then the standout message)
  if (gateReleasedByWinch()) {
    fs.writeSync(1, CURSOR_TO(config.window, 1) + CLEAR_LINE);
    gateReturn('Cannot seek to that file position');
  }

  // og forces BS_SPECIAL + proc_backspace off for the help file
  // (command.c:2115) so its overstrike bold/underline always renders
  helpSavedBs = { bs: opt.bsMode, pb: opt.procBackspace };
  opt.bsMode = 0;
  opt.procBackspace = 0;

  session.prevConfig = config;
  resetConfig();

  // the og globals follow into the help screen too
  config.setCol = session.prevConfig.setCol;
  config.setWindow = session.prevConfig.setWindow;
  config.halfWindow = session.prevConfig.halfWindow;
  config.chopLongLines = session.prevConfig.chopLongLines;

  // the helpfile is a normal file to og's line prefix: -N/-J
  // reserve their gutter columns inside the help's width too, so
  // its long lines wrap where og's do (plinestart runs on the
  // helpfile like any other)
  calculateDimensions();

  session.prevMode = mode;
  resetMode();

  session.prevContent = session.content;
  // the help file renders through the normal content pipeline, so
  // its nroff overstrikes become bold/underline like og
  session.content = transformContent(text);

  // Help is og's CH_HELPFILE pseudo-file, but edit_ifile still calls
  // set_header(ch_zero()) for it: headers remain active and re-anchor
  // at the beginning of the help text just like any newly opened file.
  resetHeaderStart();
  calculateEOF(session.content);

  mode.HELP = true;

  // dumb rendering is a terminal property; the help screen keeps it
  mode.DUMB = session.prevMode.DUMB;

  // the content swap is a fresh screen: scroll deltas against the
  // parked file rows would misread the jump's direction - except
  // when the preproc gate released with an ungot command: og's
  // prompt() skips make_display while ungot input pends, so the
  // stale FILE rows stay while the command's prompt runs on the
  // bottom line, and help paints when it returns to the prompt
  if (helpGateUngot) {
    helpGateUngot = false;
    freezeFrame();
  } else {
    // the swap is a fresh screen, but NOT a fresh session: og's
    // first_time stays false through edit(), so the incoming screen
    // still prints "...skipping..."
    resetRender(true);
  }
}

function cleanUp(): void {
  endFollow();

  // quitting OUT of the lesskey view (Q, or -e reaching the end)
  // still owes the write-back and the temp files: exitLesskeyView is
  // what does both, and it costs nothing when no view is open
  exitLesskeyView(LESS_VERSION);

  // og's quit() runs check_altpipe_error before restoring the
  // terminal: closeAlt's inline gate blocks at (press RETURN) on
  // the way out, like error()'s get_return before term_deinit
  closeAlt(files.list[files.index]);

  // og's quit() edit-closes the file, whose lastmark raises
  // marks_modified (edit.c:385) - every clean tty quit with a screen
  // position rewrites the history file, even a plain j session
  if (process.stdout.isTTY && session.content.length) recordLastPosition();
  saveHistory();

  // og's putchr fires --end-prompt on the first output after the
  // prompt: the quit's clear_bot is that output (output.c:496)
  putstr(eprPrefix());

  // og's quit() clear_bots the prompt line before deinit whenever the
  // session is interactive - `if (interactive()) clear_bot()`
  // (main.c), with no test for which screen we are on. We used to do
  // it only under -X, on the reasoning that the alternate screen is
  // about to vanish anyway, but og's bytes carry it either way and a
  // capture sees it: the ":" prompt survived into the restored screen.
  // A dumb terminal has no clear_eol and gets the bare CR below
  if (!mode.DUMB) putstr(clearBot());

  // mouse, paste, keypad and the alternate screen, in og's order --
  // the same sequences suspendTerminal sends, and shared with it so
  // the two ways out of the screen cannot drift apart
  leaveScreenCodes();

  if (mode.DUMB) {
    // og-dumb quits with just lower_left (a bare CR) and no newline,
    // so the shell prompt overwrites the last prompt line
    putstr('\r');
  }

  // --redraw-on-quit leaves the last screen on the main display,
  // like og's quit() repaint after term_deinit: only the content
  // rows print (no prompt row -- prompt() never runs while
  // quitting), so the shell prompt overwrites the ":" line; og
  // also requires term_addrs, which a dumb terminal lacks and -X
  // never sets (the last screen already sits on the main display)
  const screen =
    optRedrawOnQuit() && !mode.DUMB && !optNoInit() ? lastScreen() : null;
  if (screen) putstr(screen.slice(0, -1).join('\n') + '\n');

  // og's term_deinit is the last flush of the session: nothing may
  // still be sitting in the buffer once the terminal is restored
  flush();

  process.title = session.processTitle;
  hook.screenActive = false;

  // every session listener leaves with the session, so a library
  // caller's process is untouched afterwards
  process.off('SIGTERM', onTerminate);
  process.off('SIGHUP', onTerminate);
  process.off('SIGINT', onSigint);
  process.off('SIGUSR1', onSigusr1);
  unwatchWinch(onResize);
  process.off('uncaughtException', onUncaught);

  keyboard().off('data', keyHandler);
  keyboard().setRawMode(false);
  keyboard().pause();

  // the -e hook holds this session's closure otherwise
  onEofForward(null);
  onTagJump(null);

  // a streaming pipe closes so the writer sees EPIPE, like og
  session.detachPipe();

  // a /dev/tty keyboard holds the event loop open until destroyed
  closeTtyKeyboard();
}


/**
 * Reads the keystroke answering the dumb terminal warning, like og's
 * get_return before the screen initializes.
 */
