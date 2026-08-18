import fs from 'fs';
import os from 'os';
import tty from 'tty';

import { execFileSync } from 'child_process';

import { terminalEnv } from '../startup/environment';

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

/** Opens a device by name, or -1. */
function openDevice(path: string): number {
  try {
    return fs.openSync(path, 'r');
  } catch {
    return -1;
  }
}

/** Makes an open descriptor the keyboard. */
function attach(fd: number): boolean {
  try {
    stream = new tty.ReadStream(fd);
    ttyFd = fd;
    return true;
  } catch {
    return false;
  }
}

export function openTtyKeyboard(): boolean {
  // og's ttyin.c opens "CON" on Windows
  if (process.platform === 'win32') {
    const con = openDevice('CONIN$');
    return con >= 0 && attach(con);
  }

  // og's open_tty (ttyin.c:67) tries THREE things in order and cannot
  // come away empty:
  //
  //   1. ttyname(2) - the device STDERR is on - opened afresh
  //   2. "/dev/tty"
  //   3. failing both, file descriptor 2 itself
  //
  // Only the second needs a controlling terminal, and we had only the
  // second: a session that has none (setsid, some CI runners and
  // container shells) got no keyboard at all where less has one.
  // "/dev/fd/2" reopens exactly what ttyname(2) names.
  let fd = tty.isatty(2) ? openDevice('/dev/fd/2') : -1;

  if (fd < 0) fd = openDevice('/dev/tty');

  // og takes fd 2 here unconditionally, terminal or not: raw_mode's
  // tcsetattr simply fails on it and getchr finds out one read later,
  // at EOF. That is not a dead end - it is how less still PAINTS its
  // first screen before it gives up
  if (fd >= 0) return attach(fd);
  if (tty.isatty(2)) return attach(2);

  return attachPlain(2);
}

/**
 * Takes a descriptor that is NOT a terminal as the keyboard, which is
 * og's last resort (fd 2, ttyin.c:71).
 *
 * Node's tty.ReadStream refuses a non-tty fd, so the descriptor is
 * wrapped in the same shape with the terminal calls as the no-ops
 * they effectively are there - og's raw_mode on such an fd fails and
 * is ignored. Reading it yields EOF, which is the point.
 */
function attachPlain(fd: number): boolean {
  try {
    const plain = fs.createReadStream('', { fd, autoClose: false });
    const shim = plain as unknown as tty.ReadStream;

    shim.isTTY = false;
    shim.setRawMode = () => shim;

    stream = shim;
    ttyFd = fd;
    return true;
  } catch {
    return false;
  }
}

// og's check_poll (os.c) peeks the tty with a zero-timeout poll; a
// readSync on the keyboard fd can BLOCK when that fd is in blocking
// mode (fs.openSync default; fd 0's state is whatever the shell
// left), freezing a scan at its first poll — so interrupt polls use
// a dedicated O_NONBLOCK tty fd sharing the same input queue
let pollFd: number | null = null;

/** A never-blocking tty fd for mid-scan interrupt polls, or null
 *  when the platform has no pollable terminal device. */
export function keyboardPollFd(): number | null {
  if (pollFd !== null) return pollFd < 0 ? null : pollFd;
  if (process.platform === 'win32') {
    pollFd = -1;
    return null;
  }

  try {
    pollFd = fs.openSync(
      '/dev/tty', fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    return pollFd;
  } catch {
    pollFd = -1;
    return null;
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
  const term = terminalEnv();

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

/**
 * True when a queued key was typed while the screen it will act on
 * was already up.
 *
 * Queued keys wait behind a message, because og's get_return reads
 * the raw tty and a key typed BEFORE a message appeared must not
 * dismiss it. A key taken off the terminal mid-work is the opposite
 * case: the message was on screen for the whole wait, so the user was
 * answering it - and holding it back meant they had to press it twice.
 */
let ungotLive = false;

/** Queues a key that was typed with the current screen already up. */
export function pushUngotLive(data: Buffer): void {
  ungotLive = true;
  ungot.push(data);
}

/** Whether the queue holds a key typed against the current screen. */
export const ungotIsLive = (): boolean => ungotLive;

/** Takes all queued keys, oldest first; null when none wait. */
export function takeUngot(): Buffer | null {
  ungotLive = false;

  if (!ungot.length) return null;

  const all = ungot.length === 1 ? ungot[0] : Buffer.concat(ungot);
  ungot = [];
  return all;
}

/**
 * og's `sigs` (signal.c:29) and ABORT_SIGS().
 *
 *     static void u_interrupt(int type) { ... sigs |= S_INTERRUPT; ... }
 *     #define ABORT_SIGS()  (sigs & (S_INTERRUPT|S_STOP))
 *
 * A volatile flag the SIGNAL handler sets, so every loop that draws
 * can check it for free: put_line_hilite returns without output
 * (output.c:64) and forw()/back() break where they stand
 * (forwback.c:312, :412). That is why og stops the instant you press
 * ^C, wherever it happens to be.
 *
 * We cannot get a signal delivered mid-work - node runs its handlers
 * on the event loop - so this flag is raised by whoever first SEES
 * the ^C: the key scan, the interrupt poll, or the SIGINT handler.
 * The loops then behave like og's.
 */
let sigs = false;

/** og's ABORT_SIGS(). */
export const abortSigs = (): boolean => sigs;

/** og's `sigs |= S_INTERRUPT`, from wherever the ^C was noticed. */
export function raiseAbort(): void {
  sigs = true;
}

/** og's psignals clearing the flag once it has been handled. */
export function clearAbort(): void {
  sigs = false;
}

/**
 * Discards the queued keys, like og's iread on READ_INTR running
 * `getcc_clear()` (os.c): keys typed before the interrupt — the
 * aborting ^C included — never run as commands. Keys still unread
 * in the kernel's tty buffer survive, exactly like og's.
 */
export function consumeInterrupt(): void {
  ungot = [];
  ungotLive = false;
}

/** True while ungot input pends, og's prompt() early-return test. */
export function hasUngot(): boolean {
  return ungot.length > 0;
}

/**
 * og's error()/get_return inline gate: prints the message on the
 * prompt line, BLOCKS for one raw key (output.c:696 - RETURN, space
 * or an interrupt dismiss; any other key ungets to run as the next
 * command), then clears the line so the interrupted action continues.
 */
// how the last gateReturn ended: a dismissing key, an ungot command
// key, or og's lwinch resize longjmp
type GateRelease = 'dismiss' | 'unget' | 'winch';
let gateKind: GateRelease = 'dismiss';

/** The last gate's release kind. */
export function gateReleaseKind(): GateRelease {
  return gateKind;
}

/** Reads whether the last gate was released by a resize. */
export function gateReleasedByWinch(): boolean {
  return gateKind === 'winch';
}

// where the last gate's message ended, og's error() col: the standout
// widths (zero on any terminal whose sequences take no columns), the
// message, and the whole "  (press RETURN)" array INCLUDING its
// terminating NUL, which og counts with sizeof (output.c:730)
let gateCol = 0;

/** The column the last gate's message reached. */
export function gateEndColumn(): number {
  return gateCol;
}

export function gateReturn(message: string): void {
  gateKind = 'dismiss';
  gateCol = message.length + '  (press RETURN)'.length + 1;

  if (!process.stdout.isTTY || !keyboard().isTTY) {
    // og's non-interactive error() prints plainly with no gate
    fs.writeSync(1, message + '\n');
    return;
  }

  fs.writeSync(1, '\r\x1b[K\x1b[7m' + message +
    '  (press RETURN)\x1b[27m');

  keyboard().pause();

  // node's tty fd is non-blocking: og's getchr blocks, so spin on
  // EAGAIN with a short sleep until a key arrives. A resize during
  // the wait dismisses like og's lwinch longjmp out of the blocked
  // read (READ_INTR at a tty read) - node can't deliver SIGWINCH
  // while we spin, so poll the real ioctl size instead
  const buf = Buffer.alloc(64);
  const lock = new Int32Array(new SharedArrayBuffer(4));
  const size0 = freshWindowSize();
  let spins = 0;
  let n = 0;

  for (;;) {
    try {
      n = fs.readSync(keyboardFd(), buf, 0, 64, null);
      if (n > 0) break;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EAGAIN') {
        n = 0;
        break;
      }
    }

    if ((++spins & 15) === 0) {
      const size = freshWindowSize();
      if (size && size0 &&
          (size[0] !== size0[0] || size[1] !== size0[1])) {
        gateKind = 'winch';
        break;
      }
    }

    Atomics.wait(lock, 0, 0, 20);
  }

  const key = n > 0 ? buf.toString('utf8', 0, n)[0] : '';

  if (key && key !== '\r' && key !== '\n' && key !== ' ' &&
      key !== '\x03') {
    pushUngot(buf.subarray(0, n));
    gateKind = 'unget';
  }

  keyboard().resume();
  fs.writeSync(1, '\r\x1b[K');
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

  if (pollFd !== null && pollFd >= 0) {
    try {
      fs.closeSync(pollFd);
    } catch {
      // already gone
    }
  }
  pollFd = null;
}
