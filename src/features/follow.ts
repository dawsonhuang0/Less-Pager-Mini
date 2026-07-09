import fs from 'fs';

import { search } from "./searching";

import { files, errorText } from "./files";

import { optFollowName, optExitFollowOnClose } from "../options";

/** The three F flavors, like less's A_F_FOREVER/_BELL/_UNTIL_HILITE. */
export type FollowKind = 'forever' | 'bell' | 'hilite';

/** What one follow poll found. */
export type FollowPoll =
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
 * partial-line bytes, and keys typed during the wait (og ungets them
 * for after the loop).
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

/**
 * Opens the current file for the F command, like forw_loop entering
 * ignore_eoi mode. The in-memory pseudo-file has no descriptor and can
 * never grow, so it waits like og at the end of a closed pipe.
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
  // starts at the real end (og warns that F "may not work correctly")
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
 * - --exit-follow-on-close leaves the wait when the file is removed or
 *   truncated, our analog of og's pipe writer closing.
 */
export function pollFollow(): FollowPoll {
  const entry = files.list[files.index];
  if (!entry) return { kind: 'close' };

  // the in-memory pseudo-file is a closed pipe: it never grows, and
  // --exit-follow-on-close leaves right away like og seeing the HUP
  if (entry.path === '-' || follow.fd < 0) {
    return optExitFollowOnClose() ? { kind: 'close' } : { kind: 'idle' };
  }

  if (optFollowName() && nameChanged(entry.path)) return { kind: 'rotate' };

  let size: number;

  try {
    size = fs.fstatSync(follow.fd).size;
  } catch {
    return { kind: 'close' };
  }

  if (size <= follow.readPos) {
    if (optExitFollowOnClose() && nameClosed(entry.path)) {
      return { kind: 'close' };
    }

    return { kind: 'idle' };
  }

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
 * True when the file was removed or truncated, standing in for og's
 * POLLHUP when the pipe writer closes.
 */
function nameClosed(path: string): boolean {
  try {
    return fs.statSync(path).size < follow.readPos;
  } catch {
    return true;
  }
}
