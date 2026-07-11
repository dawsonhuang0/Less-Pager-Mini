import fs from 'fs';
import os from 'os';
import tty from 'tty';

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
export function openTtyKeyboard(): boolean {
  // og's ttyin.c opens "CON" on Windows, /dev/tty elsewhere
  const device = process.platform === 'win32' ? 'CONIN$' : '/dev/tty';

  try {
    const fd = fs.openSync(device, 'r');
    stream = new tty.ReadStream(fd);
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
  }
}
