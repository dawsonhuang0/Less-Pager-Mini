import fs from 'fs';
import os from 'os';
import tty from 'tty';

import { execFileSync } from 'child_process';

/**
 * The keyboard stream, like og's ttyin.c: keys come from the
 * controlling terminal, not stdin, so piped input (`cmd | lmn`)
 * still leaves an interactive keyboard.
 */

let stream: tty.ReadStream =
  process.stdin as unknown as tty.ReadStream;

/** The current keyboard stream (process.stdin by default). */
export const keyboard = (): tty.ReadStream => stream;

/**
 * Opens /dev/tty as the keyboard, like open_getchr when stdin is a
 * pipe. Returns false when no controlling terminal exists.
 */
// the /dev/tty fd behind a piped session's keyboard: tty.ReadStream
// hides it, but the interrupt poll must readSync the real terminal
let ttyFd: number | null = null;

/** The keyboard's file descriptor, for synchronous interrupt polls. */
export const keyboardFd = (): number => ttyFd ?? 0;

export function openTtyKeyboard(): boolean {
  // og's ttyin.c opens "CON" on Windows, /dev/tty elsewhere
  const device = process.platform === 'win32' ? 'CONIN$' : '/dev/tty';

  try {
    const fd = fs.openSync(device, 'r');
    stream = new tty.ReadStream(fd);
    ttyFd = fd;
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the terminal lacks cursor capabilities, like og's
 * missing_cap: on unix a missing $TERM loads the "unknown" termcap
 * entry (screen.c's DEFAULT_TERM), which turns up dumb. og's Windows
 * build never consults $TERM — it drives the console API directly —
 * so a Windows console only degrades when it predates the VT
 * processing that node enables on its tty streams (Windows 10 build
 * 10586), or when $TERM names dumb explicitly.
 */
export function dumbTerminal(): boolean {
  const term = process.env.TERM;

  if (process.platform === 'win32') {
    if (term === 'dumb' || term === 'unknown') return true;

    const [major, , build] = os.release().split('.').map(Number);
    return major < 10 || (major === 10 && (build || 0) < 10586);
  }

  return !term || term === 'dumb' || term === 'unknown';
}

// og's ungot queue (ungetcc_back): keys the interrupt poll consumed
// during a blocking scan, replayed by the command loop afterwards —
// never fed back through the stream, whose flowing-mode unshift
// would re-enter the key handler synchronously mid-scan
let ungot: Buffer[] = [];

/** Queues a polled key for after the blocking read (ungetcc_back). */
export function pushUngot(data: Buffer): void {
  ungot.push(data);
}

/** Takes all queued keys, oldest first; null when none wait. */
export function takeUngot(): Buffer | null {
  if (!ungot.length) return null;

  const all = ungot.length === 1 ? ungot[0] : Buffer.concat(ungot);
  ungot = [];
  return all;
}

/**
 * Discards the queued keys, like og's iread on READ_INTR running
 * `getcc_clear()` (os.c): keys typed before the interrupt — the
 * aborting ^C included — never run as commands. Keys still unread
 * in the kernel's tty buffer survive, exactly like og's.
 */
export function consumeInterrupt(): void {
  ungot = [];
}

// og keeps ISIG on in raw mode, so a typed ^C is a kernel SIGINT to
// the WHOLE foreground process group — a pipe's writer dies with it
// (`cmd | less` + ^C kills cmd; the pipe closes and EOF is real).
// node's setRawMode clears ISIG, so the ^C reaches us as a bare
// byte and the writer would live on: raiseSigint restores the
// driver's semantics by signalling our own process group.
let selfSigint = false;

/** Emulates ISIG for a typed ^C: SIGINT to our process group. */
export function raiseSigint(): void {
  if (process.platform === 'win32' || !keyboard().isTTY) return;

  selfSigint = true;

  try {
    // pid 0 signals every process in the caller's group, exactly
    // the set the tty driver would have signalled with ISIG on
    process.kill(0, 'SIGINT');
  } catch {
    selfSigint = false;
  }
}

/** Consumes the self-signal mark: true when the SIGINT now being
 *  handled came from raiseSigint (the ^C byte path already acted). */
export function wasSelfSigint(): boolean {
  const was = selfSigint;
  selfSigint = false;
  return was;
}

/**
 * The terminal size straight from the kernel, like og's scrsize
 * ioctl: node caches the winsize and refreshes it only in its own
 * SIGWINCH processing — a blocking scan delays that past og's
 * update_term moment, and a raw SIGWINCH handler can run before
 * the refresh. Returns [columns, rows], falling back to node's
 * cache when stty is unavailable (Windows).
 */
export function freshWindowSize(): [number, number] | null {
  try {
    // a freshly opened fd: spawning with our raw keyboard fd would
    // flip its shared file description to blocking, hanging the
    // interrupt poll's readSync
    const fd = fs.openSync('/dev/tty', 'r');

    try {
      const out = execFileSync('stty', ['size'], {
        stdio: [fd, 'pipe', 'ignore'],
      }).toString().trim().split(/\s+/);

      const rows = parseInt(out[0], 10);
      const cols = parseInt(out[1], 10);
      if (rows > 0 && cols > 0) return [cols, rows];
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // no stty or /dev/tty (Windows): node's cache is the best left
  }

  return (process.stdout.getWindowSize?.() as [number, number]) ?? null;
}

/**
 * Watches window changes like og's lwinch: the handler fires on the
 * SIGNAL itself — og's psignals runs screen_trashed() even when the
 * size did not change, and the longjmp dismisses get_return waits —
 * while node's 'resize' event only fires when the dimensions
 * differ. Windows has no SIGWINCH, so 'resize' covers it, like og
 * polling the console size.
 */
export function watchWinch(fn: () => void): void {
  if (process.platform === 'win32') process.stdout.on('resize', fn);
  else process.on('SIGWINCH', fn);
}

/** Removes a watchWinch handler. */
export function unwatchWinch(fn: () => void): void {
  if (process.platform === 'win32') process.stdout.off('resize', fn);
  else process.off('SIGWINCH', fn);
}

/**
 * Releases a /dev/tty keyboard, like close_getchr: the open tty
 * handle would otherwise keep the process alive after the pager
 * quits.
 */
export function closeTtyKeyboard(): void {
  const stdin = process.stdin as unknown as tty.ReadStream;

  if (stream !== stdin) {
    stream.destroy();
    stream = stdin;
    ttyFd = null;
  }
}
