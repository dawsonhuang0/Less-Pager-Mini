import { spawnSync } from 'child_process';
import { putstr } from './tty/output';

import { shellArgv } from './tty/platform';

import { keyboard } from './tty/keyboard';

import { config, mode } from './state/config';

import { session, deriveContent } from './state/session';

import { suspendTerminal, enterScreen } from './tty/screen';

import { refreshWindowTitle } from './tty/title';

import { ringBell, bufferToNum, calculateEOF, clearBot, eprPrefix,
  freezeFrame, render }
  from './helpers';

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
  closeAlt,
  revealAltEnd,
  activateSourceFile
} from './features/files';

import { search, repeatSearch, execFilter, SearchFinder }
  from './features/searching';

import { lastLine, jumpLoc, adoptFileMarks, recordLastPosition,
  markPos }
  from './features/jumping';

import { stepTag, tagRow, currTagFile, jumpSourceTag }
  from './features/tags';

import { pipeMark, shellCommand, setFirstCmd, getFirstCmd,
  addShellHistory,
  logFileTarget, writeLogFile } from './features/misc';

import { editCommand, prExpand } from './features/prompt';

import { secureAllow } from './features/secure';

import { inLesskeyView, refreshLesskeyView }
  from './features/lesskeyView';

import { LESS_VERSION } from './features/lesskey';

import { optQuitAtEof, optNoEditWarn, optNoShell, optOldBot,
  jumpSindex, resetHeaderStart, NO_SHELL_MESSAGE, hook } from './options';

import {
  CONSOLE_CLEAR,
  CURSOR_TO,
  INVERSE_ON,
  INVERSE_OFF
} from './state/constants';

/**
 * Switches the session to another file entry, like less's edit_ifile:
 * stores the position of the file being left, records the previous
 * position, and restores the target's saved position.
 */
export function switchToFile(target: number): boolean {
  // og's edit_ifile returns at once for the file it already has open
  // (edit.c:465), so re-selecting the current file - `:x` with one
  // file, `:e` on the same name - re-reads nothing and repaints
  // nothing. We re-edited it, which showed the fresh-file prompt again
  if (target === files.index) return true;

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

  // a pipe-form $LESSOPEN alt whose content ends within the screen
  // learns its length at the paint, like og reading to EOI
  revealAltEnd(session.content);

  const saved = files.list[target].saved;
  config.row = saved ? saved.row : 0;
  config.subRow = saved ? saved.subRow : 0;
  config.blankTop = 0;

  // og's edit_ifile sets `hshift = 0` (edit.c:680) on EVERY switch,
  // in the same block as pos_clear/clr_hilite: a new file starts at
  // column 0 however far the last one was shifted. og saves a scrpos
  // per ifile (ifile.c:35) and the shift is not in it.
  //
  // Ours carried the shift across, so :n from a right-shifted file
  // opened the next one mid-line.
  config.col = 0;

  mode.INIT = false;
  calculateEOF(session.content);

  if (!mode.EOF) {
    mode.EOF = config.row > config.endRow || (
      config.row === config.endRow && config.subRow >= config.endSubRow
    );
  }

  activateSourceFile(target);

  // schedule the +cmd replay for the newly examined file
  const firstCmd = getFirstCmd();
  session.pendingFirstCmds = firstCmd ? [firstCmd] : [];

  // og renames the window on every prompt and its own source says the
  // right place is here ("{{ Seems like this should be done in
  // edit_ifile }}", command.c:969) - so here, where the name changes,
  // rather than costing every frame a sequence it does not need
  refreshWindowTitle();

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

  if (jumpSourceTag()) return;

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
export function spanningSearch(
  reverse: boolean,
  finder: SearchFinder | null = null,
  sourceEnd: (() => boolean) | null = null
): void {
  repeatSearch(
    session.content,
    bufferToNum(session.buffer) || 1,
    reverse,
    finder
  );

  while (search.message.startsWith('Pattern not found')) {
    const forward = (search.lastDir === 1) !== reverse;
    const target = files.index + (forward ? 1 : -1);

    if (target < 0 || target >= files.list.length) return;
    if (!switchToFile(target)) return;

    // a fresh file searches from its top (its end going backward)
    if (!forward && !sourceEnd?.()) lastLine(session.content, 0);

    search.message = '';
    repeatSearch(session.content, 1, reverse, finder);
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

  // og's del_ifile runs unmark(ifile): the removed file's marks die
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

  // og's edit_list EDITS each name in turn (edit.c:728), and edit()
  // is `edit_ifile(get_ifile(filename, curr_ifile))`: the new ifile
  // is inserted after the CURRENT one, and then becomes current. So
  // the insertion point follows along, and a name already in the
  // list drags it BACKWARD to wherever that name already sits.
  //
  // That is what puts the first globbed name last: ":e *.txt" over
  // an open a1.txt inserts UP.txt after a1, makes it current, then
  // meets a1.txt itself - which exists, so current jumps back to
  // index 0 - and every later name lands after a1, ahead of UP.
  let current = files.index;

  // og keeps good_filename as a NAME, not a position, and resolves
  // it again at the end (edit.c) - which it has to, because a later
  // name that fails to open del_ifile()s an entry and shifts every
  // index after it
  let goodName: string | null = null;
  const errors: string[] = [];

  for (const name of names) {
    let at = files.list.findIndex(entry => entry.path === name);

    if (at < 0) {
      at = current + 1;
      files.list.splice(at, 0, {
        path: name,
        lines: null,
        size: 0,
        sizeKnown: true,
        saved: null,
      });
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

        // the query has not been answered yet, so edit_ifile has not
        // reached its `curr_ifile = ifile` - the insertion point
        // stays where it was
        continue;
      }

      // og's edit_list error()s per failing name IN ORDER; each
      // message blocks in turn, not last-one-wins
      if (search.message) {
        errors.push(search.message);
        search.message = '';
      }

      // og's edit_error del_ifile()s the entry unconditionally
      // (edit.c) - a name that was already in the list and now
      // cannot be opened is dropped from it too
      files.list.splice(at, 1);
      if (at <= current) current--;
      continue;
    }

    // edit_ifile ends with `curr_ifile = ifile`: this file is now
    // the one the next insertion goes after
    current = at;
    if (goodName === null) goodName = name;
  }

  if (errors.length && goodName !== null) {
    // og's error() runs squish_check (output.c:720): a squished
    // short first paint repaints the OLD file top-anchored, tildes
    // and all, before the message shows
    if (mode.INIT && !optOldBot()) {
      mode.INIT = false;
      render(session.content, session.buffer);
    }

    // og's make_display then defers while the messages block: the
    // old screen survives the switch until RETURN dismisses them
    freezeFrame();
  }

  if (goodName !== null) {
    search.message = '';

    // og closes with `if (get_ifile(good_filename, curr_ifile) ==
    // curr_ifile) return 0; reedit_ifile(save); return
    // edit(good_filename);` - it can skip the re-edit because its
    // own loop already EDITED each name and left curr_ifile on the
    // last one. Ours only validates with loadFile, so the switch it
    // skips is the one we still owe; switchToFile's own
    // already-current guard covers og's early return.
    const target = files.list.findIndex(entry => entry.path === goodName);

    // og's loop left curr_ifile on the LAST name it edited, so when
    // that is not good_filename the closing edit() is a real switch:
    // new_file goes TRUE and the file it leaves becomes '#'. Ours
    // only validated, so a "switch" back to the file we never left
    // has to record both for itself - which is why ":e {a1,b2}.txt"
    // over a1 shows og's new-file prompt while ":e a1.txt" does not.
    if (target >= 0 && target === files.index && current !== target &&
        files.list[current]) {
      setPreviousPath(files.list[current].path);
      files.newFile = true;
    }

    if (target >= 0) switchToFile(target);
  } else if (errors.length && files.index >= 0) {
    // og's failed edit_ifile re-edits the current file
    // (reedit_ifile), so the next prompt is the new-file one with
    // the filename
    switchToFile(files.index);
  }

  if (errors.length) {
    // each failing name error()ed in order; they block in turn
    search.message = errors.shift()!;
    search.messageQueue.push(...errors);
  }
}

/**
 * Runs a shell command with the terminal restored, like less's
 * lsystem: echoes the command (unless it starts with `-`), runs it
 * through $SHELL, then repaints and reports the done message.
 */
export function runShell(
  cmd: string,
  doneMsg: string | null,
  input?: string,
  onDone?: () => boolean
): void {
  if (optNoShell()) {
    search.message = NO_SHELL_MESSAGE;
    return;
  }

  // og's putchr fires --end-prompt before the clear_bot that erases
  // the prompt for the command's output (output.c:496)
  const endPrompt = eprPrefix();

  // only lsystem hides a "-" command; pipe_data always echoes
  if (input === undefined && cmd.startsWith('-')) {
    cmd = cmd.slice(1);
    // The clear is NOT conditional on --end-prompt. og clears this
    // line in cmd_exec(), before the command runs at all, so the
    // typed "!-cmd" is gone whatever lsystem then decides to print;
    // lsystem's "-" rule only suppresses the echoed copy. Skipping
    // it left the typed line on screen and the shell's own output
    // landed on the end of it: "!-echo quietquiet".
    putstr(endPrompt + clearBot());
  } else {
    // like lsystem's clear_bot + "!cmd" + newline: the expanded
    // command shows on the pager's bottom line, so the shell screen
    // gets only output
    putstr(endPrompt + clearBot() + '!' + cmd + '\n');
  }

  suspendTerminal();

  // $SHELL -c on unix (LESS_SHELL_COPTION replaces -c, "-" drops
  // the wrapper); %COMSPEC% /c on Windows, like og's lsystem
  const argv = shellArgv(cmd);

  spawnSync(argv[0], argv[1], input === undefined
    ? { stdio: 'inherit' }
    : { stdio: ['pipe', 'inherit', 'inherit'], input });

  // og's lsystem re-edits the current file on return (reedit_ifile):
  // the filename prompt shows again (new_file), the trashed screen's
  // repaint abandons a squished short first paint, and edit_ifile
  // records the last position (lastmark, edit.c:385) - raising
  // marks_modified before the command's history accept
  files.newFile = true;
  mode.INIT = false;
  recordLastPosition();

  // raw single-key input for the done pause, still on the shell screen
  keyboard().setRawMode(true);
  keyboard().resume();

  if (doneMsg) {
    // the pipe reinits first, like pipe_data trashing the screen, so
    // its done message waits at the bottom of a blank pager screen
    if (input !== undefined) {
      enterScreen();
      putstr(CONSOLE_CLEAR);
      putstr(CURSOR_TO(config.window, 1));
      putstr(
        INVERSE_ON + doneMsg + '  (press RETURN)' + INVERSE_OFF
      );
      session.shellPause = 'pager';
      return;
    }

    // like lsystem: the done message waits on the shell screen so the
    // command's output stays visible until a keypress
    putstr(doneMsg + '  (press RETURN)');
    session.shellPause = 'shell';
    return;
  }

  // a last word on the SHELL's screen, before the pager takes it
  // back: anything printed after enterScreen lands on a cleared
  // alternate screen, where the command's own output is no longer
  // there to read it against
  if (onDone?.()) return;

  enterScreen();
}

/**
 * Pipes the section between the current position and the stored mark
 * to a shell command (`|X`).
 *
 * - Like less's A_PIPE, the command is taken literally: no `!!`, `%`
 *   or `#` expansion; a leading `^P` suppresses the done message.
 */
/**
 * The raw file bytes behind local rows [lo, hi), when the session is
 * backed by a seekable source. Returns null for an in-memory session,
 * where session.content IS the file.
 */
function sourceRangeText(
  lo: number,
  hi: number,
  fromFileStart: boolean = false
): string | null {
  if (!hook.sourceBytePosition || !hook.sourceReadRange) return null;

  const from = fromFileStart ? 0 : hook.sourceBytePosition(lo);
  const to = hook.sourceBytePosition(hi);
  if (from === null || from === undefined ||
      to === null || to === undefined || to <= from) {
    return null;
  }

  const buf = hook.sourceReadRange(from, to);
  return buf === null ? null : buf.toString('latin1');
}

/**
 * og's pipe_data: the file bytes from spos through epos INCLUSIVE, then
 * whatever is left of that last line.
 *
 * The inclusive bound is why "|^" at the very top of a file pipes one
 * line rather than none: the copy takes byte 0 and the finish-the-line
 * loop takes the rest of it.
 */
function pipeData(spos: number, epos: number): string | null {
  if (!hook.sourceReadRange) return null;

  // og's loop is `while (spos++ <= epos)`, which never runs when the
  // range is inverted, leaving c == EOI -- so the finish-line loop
  // does not run either and nothing is piped
  if (epos < spos) return '';

  const buf = hook.sourceReadRange(spos, epos + 1);
  let text = buf === null ? '' : buf.toString('latin1');

  // "Finish up the last line." og stops when the last byte it read was
  // a newline, so a range ending mid-line is extended, not truncated
  if (!text.endsWith('\n')) {
    const CHUNK = 64 * 1024;
    let at = epos + 1;

    for (;;) {
      const more = hook.sourceReadRange(at, at + CHUNK);
      if (more === null || more.length === 0) break;

      const s = more.toString('latin1');
      const nl = s.indexOf('\n');
      if (nl >= 0) {
        text += s.slice(0, nl + 1);
        break;
      }

      text += s;
      at += more.length;
    }
  }

  return text;
}

export function runPipe(cmd: string): void {
  let doneMsg: string | null = '|done';

  if (cmd.startsWith('\x10')) {
    doneMsg = null;
    cmd = cmd.slice(1);
  }

  if (!pipeMark.rows.length) return;

  // og's pipe_pos, on POSITIONS. A mark in og IS a position, so the
  // "is this mark above the screen?" test is a byte comparison against
  // position(TOP). Ours also carry a local row, and a row stops meaning
  // anything once the window slides -- which is why a mark set at the
  // top and then piped from the bottom of a big file compared as if it
  // were still on screen and delivered a single line.
  const positions = pipeMark.positions;

  if (hook.sourceBytePosition && hook.sourceReadRange &&
      positions.length === pipeMark.rows.length &&
      positions.every(p => p !== undefined)) {
    const [mpos1, mpos2] = positions as number[];
    // position(TOP), falling back to ch_zero() as og does
    const tpos = markPos(session.content, ':') ?? 0;
    const bpos = markPos(session.content, ';');

    let spos: number;
    let epos: number | undefined;

    if (mpos2 !== undefined) {
      spos = Math.min(mpos1, mpos2);
      epos = Math.max(mpos1, mpos2);
    } else if (mpos1 < tpos) {
      spos = mpos1;
      epos = bpos;
    } else {
      spos = tpos;
      epos = mpos1;
    }

    if (epos !== undefined) {
      const piped = pipeData(spos, epos);

      if (piped !== null) {
        runShell(cmd, doneMsg, piped);
        return;
      }
    }
  }

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

  // Below is the row path, for a mark that resolved to no position at
  // all -- a non-seekable stdin, where session.content is the whole of
  // what was read and a row is the only address there is.
  // og's pipe_data reads the FILE between two positions (lsystem.c),
  // which is why it can pipe 200 lines while showing 23. session.content
  // is only the spooled window -- piping from it sent whatever happened
  // to be materialized, so "|$" delivered 72 lines of a 200 line file.
  // The source hooks already carry both halves: a row's absolute byte
  // (falling back to the file size past the window) and the block file's
  // own ranged read.
  // '^' is the start of the FILE wherever it appears, including as one
  // of the two marks of a "||" range.
  const fromFileStart = pipeMark.char === '^' || pipeMark.char2 === '^';
  const text = sourceRangeText(lo, hi, fromFileStart) ??
    session.content.slice(lo, hi).join('\n') + '\n';
  runShell(cmd, doneMsg, text);
}

// ---- the streaming pipe, like og's lazy non-seekable reads ----

/** Bytes of pipe data currently held, past recycles excluded. */
/**
 * Edits the current file with $VISUAL or $EDITOR at the middle
 * displayed line, then re-examines it, like less's LESSEDIT proto.
 */
export function runEditor(): void {
  if (optNoShell()) {
    search.message = NO_SHELL_MESSAGE;
    return;
  }

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

  // the lesskey work happens while the EDITOR's screen is still up,
  // so its messages print under the text they are about, the way a
  // scan error prints before the pager takes the terminal at startup
  runShell(editCommand(session.content), null, undefined, () => {
    if (!inLesskeyView()) return false;

    // switchToFile returns at once for the file it already holds,
    // exactly like og's edit_ifile - and og really does leave the old
    // text up after v, until R flushes the buffers (clear_buffers,
    // command.c:1846). The lesskey view is not a file being read
    // though: an editor was opened to change what the keys DO, so the
    // screen has to show what was written and the bindings have to be
    // live before the user quits to find out
    const index = files.index;

    saveFilePosition();
    files.index = -1;
    switchToFile(index);

    const failed = refreshLesskeyView(LESS_VERSION);

    if (!failed.length) return false;

    // on the pager's OWN screen. The editor left us on the primary
    // one - under a shell prompt and the command that started the
    // session, which is no backdrop for a message about a lesskey -
    // and its own screen cannot be borrowed: an editor that switched
    // has switched back by now, and re-entering the alternate buffer
    // clears it (1049h "switches to the Alternate Screen Buffer,
    // clearing it first")
    enterScreen();

    // 1049h restores a saved cursor rather than homing, so say where
    // this starts
    putstr(CONSOLE_CLEAR + CURSOR_TO(1, 1));

    // og's main errmsgs gate: every message on a line of its own,
    // then one prompt, and nothing drawn until the key
    for (const message of failed) putstr(message + '\n');

    putstr('Press RETURN to continue ');

    // 'pager' rather than 'shell': the screen is already ours, so the
    // key only has to forget the frame and repaint
    session.shellPause = 'pager';
    return true;
  });

  // the file may have changed: re-examine it, like less's reedit
  switchToFile(files.index);
}

export function runMiscInput(
  kind: '!' | '#' | '|' | 's' | 'S' | '+',
  text: string
): void {
  if ((kind === '!' || kind === '#' || kind === '|') && optNoShell()) {
    search.message = NO_SHELL_MESSAGE;
    return;
  }

  // ^P prefixed commands still join the history bare, like og
  const bare = text.replace(/^\x10/, '');

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
  // og's cmd_accept runs at the top of the NEXT command iteration:
  // the shell mlist accepts after the command ran, so its autosave
  // attempt sees lsystem's reedit lastmark having dirtied the file
  if (kind === '!' || kind === '#' || kind === '|') {
    addShellHistory(bare);
  }

}

export function applyFilter(): void {
  const filter = execFilter();
  if (filter === undefined) return;

  session.lastFilter = filter;

  // og clears soft_eof when the filter changes (command.c:282)
  session.softEofSeen = false;

  // og's is_filtering() is FALSE on the helpfile (search.c:2409):
  // the & pattern stores, the help view stays unfiltered, and the
  // filtered file waits behind the help exit
  if (mode.HELP) {
    session.prevContent = deriveContent();
    session.prevConfig.row = 0;
    session.prevConfig.subRow = 0;
    return;
  }

  session.content = deriveContent();
  config.row = 0;
  config.subRow = 0;
  config.blankTop = 0;
  calculateEOF(session.content);

  // og's set_filter_pattern ends with screen_trashed() (search.c), and
  // a trashed screen is answered by repaint(): the screen comes back
  // top-anchored with tilde fill. A short filtered result was instead
  // left in the SQUISHED layout of a first paint -- blank rows above,
  // the matching lines pushed to the bottom -- because nothing cleared
  // mode.INIT, which is what repaint() undoes (the same unsquish the
  // r/^L/^R repaints and repaint_hilite do).
  if (mode.INIT) mode.INIT = false;
}
