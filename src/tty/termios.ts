import { spawnSync } from 'child_process';

/**
 * The terminal modes, set the way og sets them (screen.c raw_mode).
 *
 * og's raw mode is a SMALL edit to whatever the terminal already is:
 * set_termio_flags clears exactly ICANON|ECHO|ECHOE|ECHOK|ECHONL and
 * nothing else, so ISIG, IEXTEN, IXON and c_cc[VINTR] survive
 * untouched. That is why ^C in less is whatever the user's terminal
 * says it is - a kernel SIGINT where ISIG is on, an ordinary byte
 * where it is off - and why less never has to emulate a signal.
 *
 * node's setRawMode is a much bigger hammer: it clears
 * ISIG|IEXTEN|IXON|ICRNL|OPOST on top of og's five bits and offers no
 * termios API to put them back. Under it a typed ^C could never be a
 * signal, so we synthesised one from the byte - which is right on a
 * terminal that has ISIG on and wrong on one that does not. MEASURED
 * on a pty: less runs with ISIG on, we ran with it off, and clearing
 * ISIG on the pty makes less stop aborting F on ^C, exactly as
 * reported by hand.
 *
 * So we set the modes ourselves, through stty, with og's mask. There
 * is no termios binding in node and no way to reach tcsetattr from
 * JS, and stty is the interface every unix already ships. It costs
 * one fork per raw-mode TRANSITION - startup, a shell escape, a
 * resume - and none at all per keystroke, paint or resize.
 */

/** og's set_termio_flags plus the c_cc it zeroes, as stty operands. */
const OG_MASK = [
  // s->c_lflag &= ~(ICANON | ECHO | ECHOE | ECHOK | ECHONL)
  '-icanon', '-echo', '-echoe', '-echok', '-echonl',
  // s->c_oflag |= (OPOST | ONLCR)
  'opost', 'onlcr',
  // s->c_oflag &= ~(ONOEOT | OCRNL | ONOCR | ONLRET)
  // ONOEOT is a BSD bit with no stty operand; it only suppresses an
  // EOT we never write
  '-ocrnl', '-onocr', '-onlret',
  // s->c_iflag &= ~(ICRNL | INLCR)
  '-icrnl', '-inlcr',
  // s->c_cc[VMIN] = 1; s->c_cc[VTIME] = 0
  'min', '1', 'time', '0',
  // s->c_cc[VLNEXT|VSTOP|VSTART|VDISCARD] = 0
  'lnext', 'undef', 'stop', 'undef', 'start', 'undef', 'discard', 'undef',
];

// og guards this one with #ifdef VDSUSP: a BSD bit, and BSD stty is
// where the operand exists
const OG_MASK_BSD = [...OG_MASK, 'dsusp', 'undef'];

// og's `save_term`, captured under its `saved_term` guard on the FIRST
// raw_mode(TRUE) and never overwritten: a shell escape's raw_mode
// pair must restore the mode the SESSION started in, not the one the
// child left behind
let savedTerm: string | null = null;

// false once stty has proved unusable here - a platform without it,
// or an fd it will not take - after which the caller falls back to
// node's raw mode and its emulated interrupt
let usable = true;

/** Whether the terminal modes are ours to set, og's way. */
export const termiosOwned = (): boolean => usable && savedTerm !== null;

/** Runs stty against the terminal, returning its exit status. */
function stty(fd: number, args: string[]): number | null {
  try {
    const run = spawnSync('stty', args, { stdio: [fd, 'ignore', 'ignore'] });
    return run.error ? null : run.status;
  } catch {
    return null;
  }
}

/**
 * Captures the terminal's modes, like raw_mode's first tcgetattr.
 *
 * `stty -g` is the whole termios in a form stty itself takes back,
 * which is what restoring needs: og restores the SAVED struct, not a
 * list of flags it believes were set, so a terminal that arrived with
 * ISIG off leaves with ISIG off.
 */
function capture(fd: number): boolean {
  if (savedTerm !== null) return true;
  if (!usable) return false;

  try {
    const run = spawnSync('stty', ['-g'], { stdio: [fd, 'pipe', 'ignore'] });
    const out = run.error ? '' : run.stdout.toString().trim();

    if (!out) {
      usable = false;
      return false;
    }

    savedTerm = out;
    return true;
  } catch {
    usable = false;
    return false;
  }
}

/**
 * Sets or restores the terminal modes, like og's raw_mode.
 *
 * @param fd - The terminal, less's `tty` descriptor.
 * @param on - True for raw, false to restore the captured modes.
 * @returns False when stty could not do it and node's raw mode must.
 */
export function rawMode(fd: number, on: boolean): boolean {
  if (process.platform === 'win32' || !usable) return false;

  if (!on) {
    // nothing was ever captured, so there is nothing of ours to undo
    if (savedTerm === null) return false;

    return stty(fd, [savedTerm]) === 0;
  }

  if (!capture(fd)) return false;

  // og applies its mask to the mode the terminal is in NOW - it
  // tcgetattrs on every raw_mode(TRUE) - so a child that changed the
  // terminal is masked, not overwritten. Applying operands to the
  // live mode is that same edit
  const bsd = process.platform !== 'linux';

  if (stty(fd, bsd ? OG_MASK_BSD : OG_MASK) === 0) return true;

  // a platform whose stty lacks one of the operands: og drops those
  // the same way, behind #ifdef
  if (bsd && stty(fd, OG_MASK) === 0) return true;

  usable = false;
  return false;
}

/**
 * Turns the terminal's signal generation on or off.
 *
 * og never does this, and neither does anything here except the
 * --use-js-regexp guard. og's scanning loops test ABORT_SIGS(), and a
 * C signal handler runs the instant the kernel delivers - mid-loop,
 * mid-regex, anywhere. Node runs ours on the event loop, so a thread
 * stopped inside one synchronous RegExp call cannot be told anything,
 * which is why that guard watches the TERMINAL from a worker instead.
 * With ISIG on the driver takes the ^C before the worker can read it,
 * so for as long as the wait is actually blocking - from the two
 * second notice until the run ends - the driver is asked to stop,
 * and then asked to resume.
 *
 * Nothing else calls it: the terminal spends the rest of the session
 * exactly as og leaves it, which is exactly as the user set it.
 */
export function setIsig(fd: number, on: boolean): boolean {
  if (!termiosOwned()) return false;

  return stty(fd, [on ? 'isig' : '-isig']) === 0;
}
