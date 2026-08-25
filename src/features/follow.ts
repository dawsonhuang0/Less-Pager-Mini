import fs from 'fs';

import { search } from "./searching";

import { files, errorText } from "./files";

import { optFollowName, optExitFollowOnClose } from "../options";

import { POLLHUP_EXITS_F } from "../tty/platform";

import { gateReturn, gateEndColumn } from "../tty/keyboard";

import { session, deriveContent } from '../state/session';

import { render, ringBell, calculateEOF, squishCheck, markFullRepaint }
  from '../helpers';

import { lastLine, endPad } from './jumping';

import { loadFile, bottomRow, revealPipeEnd } from './files';

import { config, mode } from '../state/config';

import { lineMatches } from './searching';

import { optShowAttn } from '../options';

/** The three F flavors, like less's A_F_FOREVER/_BELL/_UNTIL_HILITE. */
type FollowKind = 'forever' | 'bell' | 'hilite';

/** What one follow poll found. */
type FollowPoll =
  /** No new data. */
  | { kind: 'idle' }
  /** New complete lines; the first extends a partial last line. */
  | { kind: 'data', lines: string[], extendTail: boolean }
  /** --follow-name: the name points to a new file; reopen it. */
  | { kind: 'rotate' }
  /** --exit-follow-on-close: the input closed; leave the F wait. */
  | { kind: 'close' };

/**
 * F command state: the followed descriptor, the read offset, undisplayed
 * partial-line bytes, and keys typed during the wait (less ungets them;
 * they run as commands only when the loop ends without a signal —
 * READ_INTR exits run getcc_clear and discard them).
 */
export const follow = {
  active: null as FollowKind | null,
  fd: -1,
  readPos: 0,
  carry: Buffer.alloc(0),

  /** True while the displayed last line misses its newline. */
  tailPartial: false,

  queued: [] as string[],
};

interface SourceFollowHooks {
  /** Pins the active source to its current physical end. */
  pinEnd(entering: boolean): boolean;
  /** Refreshes the source after pollFollow observed new bytes. */
  refresh(): boolean;
}

let sourceFollowHooks: SourceFollowHooks | null = null;

/** Registers the active seekable input with the shared follow loop. */
export function onSourceFollow(hooks: SourceFollowHooks | null): void {
  sourceFollowHooks = hooks;
}

/**
 * Opens the current file for the F command, like forw_loop entering
 * ignore_eoi mode. The in-memory pseudo-file has no descriptor and can
 * never grow, so it waits like less at the end of a closed pipe.
 *
 * @param kind - Which F flavor runs.
 * @returns True when following started; false with a message set.
 */
export function startFollow(kind: FollowKind): boolean {
  const entry = files.list[files.index];
  if (!entry) return false;

  if (entry.path === '-') {
    follow.active = kind;
    follow.fd = -1;
    follow.carry = Buffer.alloc(0);
    follow.queued = [];
    return true;
  }

  try {
    follow.fd = fs.openSync(entry.path, 'r');
  } catch (error) {
    search.message = `${entry.path}: ${errorText(error)}`;
    return false;
  }

  follow.active = kind;
  follow.readPos = entry.size;
  follow.carry = Buffer.alloc(0);
  follow.queued = [];

  // a $LESSOPEN replacement's size is not the file's: new raw data
  // starts at the real end (less warns that F "may not work correctly")
  if (entry.alt) {
    try {
      follow.readPos = fs.fstatSync(follow.fd).size;
    } catch {
      // keep the entry size
    }
  }

  // a loaded file without a final newline shows a partial last line;
  // new data continues that line
  follow.tailPartial = false;

  if (follow.readPos > 0 && !entry.alt) {
    const last = Buffer.alloc(1);

    try {
      fs.readSync(follow.fd, last, 0, 1, follow.readPos - 1);
      follow.tailPartial = last[0] !== 0x0A;
    } catch {
      // unreadable tails follow as complete lines
    }
  }

  return true;
}

/**
 * Leaves the F wait, like forw_loop returning to the command prompt.
 *
 * @returns The keys typed during the wait, to run as commands.
 */
export function stopFollow(): string[] {
  const queued = follow.queued;

  if (follow.fd >= 0) {
    try {
      fs.closeSync(follow.fd);
    } catch {
      // already gone
    }
  }

  follow.active = null;
  follow.fd = -1;
  follow.carry = Buffer.alloc(0);
  follow.queued = [];

  return queued;
}

/**
 * Checks the followed file for new data, like the ch.c read layer
 * waiting for data every 50ms.
 *
 * - Complete new lines are returned; a trailing partial line waits in
 *   the carry until its newline arrives.
 * - --follow-name reopens when the name points to a different file or
 *   the file shrank, like curr_ifile_changed.
 * - --exit-follow-on-close leaves the wait when a pipe's writer has
 *   closed and its data is drained (less's POLLHUP-without-POLLIN);
 *   like less it never fires for a regular file, which cannot HUP.
 */
export function pollFollow(): FollowPoll {
  const entry = files.list[files.index];
  if (!entry) return { kind: 'close' };

  // less's check_poll exits only on POLLHUP without POLLIN (os.c):
  // the writer has closed AND every buffered byte is drained; a
  // still-open pipe keeps waiting no matter how idle it is — and
  // only Linux's poll ever reports that bare POLLHUP, so less's F on
  // macOS keeps waiting on a closed pipe too
  if (entry.path === '-' || follow.fd < 0) {
    if (entry.streaming) return { kind: 'idle' };
    return optExitFollowOnClose() && POLLHUP_EXITS_F
      ? { kind: 'close' }
      : { kind: 'idle' };
  }

  if (optFollowName() && nameChanged(entry.path)) return { kind: 'rotate' };

  let size: number;

  try {
    size = fs.fstatSync(follow.fd).size;
  } catch {
    return { kind: 'close' };
  }

  // a regular file never raises POLLHUP, so less's
  // --exit-follow-on-close has no effect here: a removed or
  // truncated file just waits like any other unchanged one
  if (size <= follow.readPos) return { kind: 'idle' };

  let chunk: Buffer;

  try {
    chunk = Buffer.alloc(size - follow.readPos);
    const n = fs.readSync(follow.fd, chunk, 0, chunk.length, follow.readPos);
    chunk = chunk.subarray(0, n);
  } catch {
    return { kind: 'close' };
  }

  if (!chunk.length) return { kind: 'idle' };

  follow.readPos += chunk.length;
  entry.size = follow.readPos;

  const data = Buffer.concat([follow.carry, chunk]);
  const lastNewline = data.lastIndexOf(0x0A);

  if (lastNewline < 0) {
    follow.carry = data;
    return { kind: 'idle' };
  }

  follow.carry = data.subarray(lastNewline + 1);

  const lines = data.subarray(0, lastNewline).toString('utf8').split('\n');
  const extendTail = follow.tailPartial;
  follow.tailPartial = false;

  return { kind: 'data', lines, extendTail };
}

/**
 * True when the file name resolves to another file or shrank, like
 * filename.c's curr_ifile_changed: a vanished name is not a change.
 */
function nameChanged(path: string): boolean {
  try {
    const named = fs.statSync(path);
    const followed = fs.fstatSync(follow.fd);

    return named.ino !== followed.ino ||
      named.dev !== followed.dev ||
      named.size < follow.readPos;
  } catch {
    return false;
  }
}

/**
 * Starts the F command, like forw_loop: jump to the end of the file,
 * then wait for new data, polling every 50ms like less's read layer.
 *
 * @param kind - `forever` (F), `bell` (ESC-f) or `hilite` (ESC-F).
 */
export async function beginFollow(kind: FollowKind): Promise<void> {
  // less's forw_loop is a no-op on the help file
  if (mode.HELP || follow.active) return;

  // less warns BEFORE forw_loop, and error() is a get_return gate: the
  // screen holds where it is until RETURN, and only then does the
  // jump-to-end happen. The script has already exited by now, so
  // further changes to the real file will not be seen (command.c:1813)
  if (files.list[files.index]?.alt) {
    squishCheck();
    await gateReturn('Warning: command may not work correctly ' +
      'when file is viewed via LESSOPEN');

    // "Printing the message has probably scrolled the screen"
    // (output.c:733): a message that reaches the right margin wraps,
    // and less answers that with screen_trashed, so the repaint lands
    // once the gate is dismissed rather than a scroll off the old rows
    if (gateEndColumn() >= config.screenWidth) markFullRepaint();
  }

  if (!startFollow(kind)) {
    ringBell();
    return;
  }

  // less's forw_loop reads immediately: a completed pipe returns
  // its EOI before the wait prompt shows
  revealPipeEnd();

  // less marks the pre-follow bottom line for -w before jumping
  if (optShowAttn()) {
    const next = bottomRow(session.content) + 1;
    config.attnRow = next < session.content.length ? next : -1;
  }

  // less's forw_loop enters through jump_forw_buffered: re-entering
  // F while already at the end rings the at-end bell (jump_loc's
  // back(0) hitting eof_bell); the first F just moves there
  if (!sourceFollowHooks?.pinEnd(true)) lastLine(session.content, 0);
  session.followTimer = setInterval(followTick, 50);
}

/**
 * Jumps to the end of the file without the at-end bell, like
 * forw_loop's jump_forw_buffered.
 */
function pinToEnd(): void {
  if (sourceFollowHooks?.pinEnd(false)) return;

  // short content that grew needs its over-BOF pad re-derived even
  // when the top position is unchanged (row 0 while under a screen)
  if (config.row !== config.endRow || config.subRow !== config.endSubRow ||
      config.blankTop !== endPad(session.content)) {
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
    // less's close-exit is the READ_INTR path: iread runs getcc_clear,
    // so keys typed during the wait are discarded, and no bell rings
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

  if (!sourceFollowHooks?.refresh()) {
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
  }

  // ESC-f bells when the search pattern matches new data, ESC-F
  // stops there, like forw_loop watching highest_hilite
  if (follow.active !== 'forever' && matchLines.some(lineMatches)) {
    ringBell();

    if (follow.active === 'hilite') {
      // a signal-less break: less keeps the ungot queue, so keys
      // typed during the wait now run as commands
      const queued = endFollow();
      render(session.content, session.buffer);
      for (const sequence of queued) session.feedKeys(sequence);
      return;
    }
  }

  render(session.content, session.buffer);
}

/**
 * Reopens a rotated file under --follow-name and keeps following,
 * like less's screen_trashed=2 reopen after curr_ifile_changed.
 */
function rotateFollow(): void {
  const kind = follow.active as FollowKind;

  // less's reopen (screen_trashed=2) never leaves forw_loop: the
  // ungot queue survives the rotation
  const queued = endFollow();

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
  follow.queued = queued;
  render(session.content, session.buffer);
}

/**
 * Leaves the F wait, like forw_loop returning to the command loop.
 *
 * @returns Queued keys when the caller replays them itself (only a
 *   signal-less exit does; interrupts discard them, getcc_clear).
 */
export function endFollow(): string[] {
  if (session.followTimer) {
    clearInterval(session.followTimer);
    session.followTimer = null;
  }

  // less's prompt recomputes eof_displayed after the loop: the follow
  // pinned the view to the end, but calculateEOF on arriving data
  // cleared the sticky flag movements normally set
  if (!mode.EOF) {
    mode.EOF = config.row > config.endRow || (
      config.row === config.endRow && config.subRow >= config.endSubRow
    );
  }

  return stopFollow();
}
