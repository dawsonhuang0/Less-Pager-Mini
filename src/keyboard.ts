import fs from 'fs';
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
  try {
    const fd = fs.openSync('/dev/tty', 'r');
    stream = new tty.ReadStream(fd);
    return true;
  } catch {
    return false;
  }
}
