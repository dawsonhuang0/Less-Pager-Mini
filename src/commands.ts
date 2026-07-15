import { spawnSync } from 'child_process';

import { shellArgv } from './platform';

import { keyboard } from './keyboard';

import { config, mode } from './config';

import { session, deriveContent } from './session';

import { suspendTerminal, enterScreen } from './screen';

import { ringBell, bufferToNum, calculateEOF, clearBot } from './helpers';

import {
  files,
  examine,
  binaryConfirm,
  loadFile,
  saveFilePosition,
  stepFileTarget,
  expandExamineList,
  addExamineHistory,
  setPreviousPath,
  bottomRow,
  closeAlt
} from './features/files';

import { search, repeatSearch, execFilter }
  from './features/searching';

import { lastLine, jumpLoc, adoptFileMarks, recordLastPosition }
  from './features/jumping';

import { stepTag, tagRow, currTagFile } from './features/tags';

import { pipeMark, shellCommand, setFirstCmd, getFirstCmd,
  logFileTarget, writeLogFile } from './features/misc';

import { prExpand } from './features/prompt';

import { secureAllow } from './features/secure';

import { optQuitAtEof, optEndPrompt, optNoEditWarn,
  jumpSindex, resetHeaderStart } from './options';

import {
  CONSOLE_CLEAR,
  CURSOR_TO,
  INVERSE_ON,
  INVERSE_OFF
} from './constants';

/**
 * Switches the session to another file entry, like less's edit_ifile:
 * stores the position of the file being left, records the previous
 * position, and restores the target's saved position.
 */
export function switchToFile(target: number): boolean {
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
export function openByName(name: string): boolean {
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
export function gotoCurrentTag(): void {
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
export function tagStep(delta: 1 | -1): void {
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
export function spanningSearch(reverse: boolean): void {
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

export function stepFile(delta: 1 | -1): void {
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

export function removeFile(): void {
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
export function runExamine(): void {
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
export function runShell(cmd: string, doneMsg: string | null, input?: string): void {
  // --end-prompt prints where the prompt is erased for output, like
  // og's prompting flag firing in putchr
  const endProto = mode.HELP ? null : optEndPrompt();
  const endPrompt = endProto ? prExpand(session.content, endProto) : '';

  // only lsystem hides a "-" command; pipe_data always echoes
  if (input === undefined && cmd.startsWith('-')) {
    cmd = cmd.slice(1);
    if (endPrompt) process.stdout.write(clearBot() + endPrompt);
  } else {
    // like lsystem's clear_bot + "!cmd" + newline: the expanded
    // command shows on the pager's bottom line, so the shell screen
    // gets only output
    process.stdout.write(clearBot() + endPrompt + '!' + cmd + '\n');
  }

  suspendTerminal();

  // $SHELL -c on unix (LESS_SHELL_COPTION replaces -c, "-" drops
  // the wrapper); %COMSPEC% /c on Windows, like og's lsystem
  const argv = shellArgv(cmd);

  spawnSync(argv[0], argv[1], input === undefined
    ? { stdio: 'inherit' }
    : { stdio: ['pipe', 'inherit', 'inherit'], input });

  // og's lsystem re-edits the current file on return (reedit_ifile):
  // the filename prompt shows again (new_file), and the trashed
  // screen's repaint abandons a squished short first paint
  files.newFile = true;
  mode.INIT = false;

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
export function runPipe(cmd: string): void {
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

// ---- the streaming pipe, like og's lazy non-seekable reads ----

/** Bytes of pipe data currently held, past recycles excluded. */
/**
 * Edits the current file with $VISUAL or $EDITOR at the middle
 * displayed line, then re-examines it, like less's LESSEDIT proto.
 */
export function runEditor(): void {
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

export function runMiscInput(
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

export function applyFilter(): void {
  const filter = execFilter();
  if (filter === undefined) return;

  session.lastFilter = filter;
  session.content = deriveContent();
  config.row = 0;
  config.subRow = 0;
  config.blankTop = 0;
  calculateEOF(session.content);
}
