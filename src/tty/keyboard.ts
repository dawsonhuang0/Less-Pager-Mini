import fs from 'fs';
import os from 'os';
import tty from 'tty';

import { terminalEnv } from '../startup/environment';

import { flush } from './output';

/**
 * The keyboard stream, like less's ttyin.c: keys come from the
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

/**
 * Enters or leaves raw mode, through node and nothing else.
 *
 * less sets the terminal modes itself and touches only the five lflag
 * bits it needs, leaving ISIG - and therefore what a typed ^C means -
 * to the terminal. We used to match that by driving termios through
 * `stty`, which is a unix idea in a cross-platform pager: it cost a
 * process per change, did nothing at all on Windows, and left the
 * pager with two models of the same key.
 *
 * There is one model now. node's setRawMode clears ISIG and offers no
 * way back, so a typed ^C is a BYTE on every platform, decided from
 * the raw input by signalForKey (core.ts) rather than from what the
 * kernel happened to deliver.
 */
export function setKeyboardRaw(on: boolean): void {
  keyTrace(`raw ${on} isTTY=${stream.isTTY} ` +
    `isStdin=${(stream as unknown) === process.stdin} ` +
    `hasSetRawMode=${typeof stream.setRawMode}`);

  // node's, and only node's. We used to drive termios through `stty`
  // to keep ISIG the way less keeps it, so a typed ^C stayed a kernel
  // signal; that is a unix idea, it cost a process per change, and it
  // gave the pager two models of the same key. There is one now: the
  // ^C arrives as a BYTE everywhere, and raiseSigint gives it the
  // signal's reach.
  //
  // A keyboard that is not a terminal has no modes to set, and node's
  // ReadStream shim makes this the no-op it should be there.
  stream.setRawMode?.(on);
}


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

/**
 * A trail through the key path, for a platform this repo cannot be run
 * on. Writes to the file $LMN_KEY_TRACE names, and does nothing at all
 * when it names none - a terminal we cannot see is the one place where
 * a printf beats any amount of reading.
 */
export function keyTrace(what: string): void {
  const file = process.env.LMN_KEY_TRACE;

  if (!file) return;

  try {
    fs.appendFileSync(file, what + '\n');
  } catch {
    // a trace that cannot be written is not worth an error
  }
}

export function openTtyKeyboard(): boolean {
  // Windows is node's own from end to end, and deliberately so.
  //
  // less CreateFile()s "CONIN$" (ttyin.c) because C can. node cannot:
  // libuv hands CreateFileW a \\?\-prefixed path, and that prefix turns
  // the DOS device namespace OFF, so the name never resolves. MEASURED
  // on Windows 11 / node 22, in Windows Terminal and VS Code alike -
  // "CONIN$" and "CON" come back ENOENT, and the \\.\ and \\?\ forms
  // with a Win32 error libuv could not even map. We were copying less's
  // MECHANISM where node has its own, and the session would not start.
  //
  // It does not need one. The console is already on the descriptors
  // node was handed, and tty.ReadStream is the provider for it.
  //
  // fds 1 and 2 are not offered here even though both are consoles.
  // They are console OUTPUT: a ReadStream over either constructs
  // happily and then delivers no key, which would hang the pager with
  // nothing that could quit it - worse than saying so. So a Windows
  // session whose stdin is a PIPE has no keyboard to be had, where
  // less has one.
  if (process.platform === 'win32') {
    keyTrace(`open win32 stdin.isTTY=${process.stdin.isTTY} ` +
      `isatty0=${tty.isatty(0)} TERM=${process.env.TERM ?? '(unset)'}`);

    // and node's console reader IS process.stdin. A SECOND
    // tty.ReadStream over the same descriptor is not: libuv gives an
    // fd one handle, so the new one constructs happily and then reads
    // nothing - the pager opened and no key ever arrived.
    if (process.stdin.isTTY !== true) return false;

    stream = process.stdin as tty.ReadStream;
    ttyFd = 0;

    return true;
  }

  // less's open_tty (ttyin.c:67) tries THREE things in order and cannot
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

  // less takes fd 2 here unconditionally, terminal or not: raw_mode's
  // tcsetattr simply fails on it and getchr finds out one read later,
  // at EOF. That is not a dead end - it is how less still PAINTS its
  // first screen before it gives up
  if (fd >= 0) return attach(fd);
  if (tty.isatty(2)) return attach(2);

  return attachPlain(2);
}

/**
 * Takes a descriptor that is NOT a terminal as the keyboard, which is
 * less's last resort (fd 2, ttyin.c:71).
 *
 * Node's tty.ReadStream refuses a non-tty fd, so the descriptor is
 * wrapped in the same shape with the terminal calls as the no-ops
 * they effectively are there - less's raw_mode on such an fd fails and
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

// less's check_poll (os.c) peeks the tty with a zero-timeout poll; a
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
 * True when the terminal lacks cursor capabilities, like less's
 * missing_cap: on unix a missing $TERM loads the "unknown" termcap
 * entry (screen.c's DEFAULT_TERM), which turns up dumb. less's Windows
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

// less's ungot queue (ungetcc_back): keys the interrupt poll consumed
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
 * Queued keys wait behind a message, because less's get_return reads
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
 * less's `sigs` (signal.c:29) and ABORT_SIGS().
 *
 *     static void u_interrupt(int type) { ... sigs |= S_INTERRUPT; ... }
 *     #define ABORT_SIGS()  (sigs & (S_INTERRUPT|S_STOP))
 *
 * A volatile flag the SIGNAL handler sets, so every loop that draws
 * can check it for free: put_line_hilite returns without output
 * (output.c:64) and forw()/back() break where they stand
 * (forwback.c:312, :412). That is why less stops the instant you press
 * ^C, wherever it happens to be.
 *
 * We cannot get a signal delivered mid-work - node runs its handlers
 * on the event loop - so this flag is raised by whoever first SEES
 * the ^C: the key scan, the interrupt poll, or the SIGINT handler.
 * The loops then behave like less's.
 */
let sigs = false;

/** less's ABORT_SIGS(). */
export const abortSigs = (): boolean => sigs;

/** less's `sigs |= S_INTERRUPT`, from wherever the ^C was noticed. */
export function raiseAbort(): void {
  sigs = true;
}

/** less's psignals clearing the flag once it has been handled. */
export function clearAbort(): void {
  sigs = false;
}

/**
 * Discards the queued keys, like less's iread on READ_INTR running
 * `getcc_clear()` (os.c): keys typed before the interrupt — the
 * aborting ^C included — never run as commands. Keys still unread
 * in the kernel's tty buffer survive, exactly like less's.
 */
export function consumeInterrupt(): void {
  ungot = [];
  ungotLive = false;
}

/** True while ungot input pends, less's prompt() early-return test. */
export function hasUngot(): boolean {
  return ungot.length > 0;
}

/**
 * less's error()/get_return inline gate: prints the message on the
 * prompt line, BLOCKS for one raw key (output.c:696 - RETURN, space
 * or an interrupt dismiss; any other key ungets to run as the next
 * command), then clears the line so the interrupted action continues.
 */
// how the last gateReturn ended: a dismissing key, an ungot command
// key, or less's lwinch resize longjmp
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

// where the last gate's message ended, less's error() col: the standout
// widths (zero on any terminal whose sequences take no columns), the
// message, and the whole "  (press RETURN)" array INCLUDING its
// terminating NUL, which less counts with sizeof (output.c:730)
let gateCol = 0;

/** The column the last gate's message reached. */
export function gateEndColumn(): number {
  return gateCol;
}

/**
 * True while a gate is waiting, so the pager's own key handler stands
 * aside: both listen to the same stream, and only one of them may
 * answer the question on screen.
 */
let gateOpen = false;

/** Whether a (press RETURN) gate currently owns the keyboard. */
export function gateIsOpen(): boolean {
  return gateOpen;
}

// ends the gate that is open, if one is: less's get_return returning
// READ_INTR when a signal reaches the read it is blocked in
let releaseGate: () => void = () => {};

/** Ends an open (press RETURN) gate, like get_return's READ_INTR. */
export function releaseGateOnInterrupt(): void {
  releaseGate();
}

export async function gateReturn(message: string): Promise<void> {
  gateKind = 'dismiss';
  gateCol = message.length + '  (press RETURN)'.length + 1;

  if (!process.stdout.isTTY || !keyboard().isTTY) {
    // less's non-interactive error() prints plainly with no gate
    fs.writeSync(1, message + '\n');
    return;
  }

  // Everything the command has drawn so far goes out FIRST. The
  // renderer buffers and empties itself on the next turn of the event
  // loop, on the stated assumption that "a command runs to completion
  // inside a single turn" - which stopped being true the moment this
  // gate started awaiting. The turn happens during the wait now, so a
  // frame still sitting in that buffer was written straight over the
  // message: the question vanished and only the blocking was left.
  flush();

  fs.writeSync(1, '\r\x1b[K\x1b[7m' + message +
    '  (press RETURN)\x1b[27m');

  // The wait leaves the event loop TURNING, which is the whole point:
  // a synchronous one cannot be woken by SIGWINCH - node dispatches
  // signals through the loop - so it had to spawn stty on a timer to
  // notice a resize. Measured, that was 1.57ms of forking against an
  // ioctl's 0.04ms, and it is gone: the ordinary handler fires here.
  gateOpen = true;

  const bytes = await new Promise<Buffer>(resolve => {
    const onKey = (data: Buffer): void => {
      finish();
      resolve(data);
    };

    // less's lwinch longjmps out of get_return, so a resize dismisses
    // the message without a key (output.c)
    const onWinch = (): void => {
      gateKind = 'winch';
      finish();
      resolve(Buffer.alloc(0));
    };

    // and an interrupt IS how get_return ends on a signal: getchr
    // returns READ_INTR (ttyin.c:217), which get_return neither ungets
    // nor waits past - the message goes and the interrupted command
    // carries on with S_INTERRUPT still pending
    releaseGate = (): void => {
      gateKind = 'dismiss';
      finish();
      resolve(Buffer.alloc(0));
    };

    const finish = (): void => {
      releaseGate = () => {};
      keyboard().off('data', onKey);
      unwatchWinch(onWinch);
    };

    keyboard().on('data', onKey);
    watchWinch(onWinch);
  });

  gateOpen = false;

  const key = bytes.length > 0 ? bytes.toString('utf8')[0] : '';

  // og's get_return ungets anything that is not RETURN, space or
  // READ_INTR (output.c:696) - and READ_INTR on a tty read means a
  // SIGNAL, which is why the interrupt path above resolves this
  // promise instead of delivering a key. A 0x03 that arrives here as
  // a BYTE is an ordinary character, ungot like any other, unless we
  // could not take the terminal and are reading it as the interrupt
  // ourselves
  const intrByte = key === '\x03';

  if (key && key !== '\r' && key !== '\n' && key !== ' ' && !intrByte) {
    pushUngot(bytes);
    gateKind = 'unget';
  }

  // where no kernel raises it for us, the byte still has to mean what
  // the signal would have: S_INTERRUPT pending when the interrupted
  // command resumes, which is why F answered with ^C never runs an
  // iteration (forw_loop is `while (!sigs)`)
  if (intrByte) raiseAbort();

  fs.writeSync(1, '\r\x1b[K');
}

// less keeps ISIG on in raw mode, so a typed ^C is a kernel SIGINT to
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
 * Watches window changes like less's lwinch: the handler fires on the
 * SIGNAL itself — less's psignals runs screen_trashed() even when the
 * size did not change, and the longjmp dismisses get_return waits —
 * while node's 'resize' event only fires when the dimensions
 * differ. Windows has no SIGWINCH, so 'resize' covers it, like less
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
