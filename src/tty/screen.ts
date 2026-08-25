import { keyboard, setKeyboardRaw } from './keyboard';
import { putstr, flush } from './output';

import { config, mode, setFullScreen } from '../state/config';

import { opt, optMouse, optNoInit, optNoKeypad, optNoPaste,
  optClearRepaint, reserveGutter, hook } from '../options';

import { resetRender, screenEntered } from '../helpers';

import {
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF,
  KEYPAD_ON,
  KEYPAD_OFF,
  MOUSE_ON,
  MOUSE_OFF,
  MOUSE_SGR_ON,
  MOUSE_SGR_OFF,
  BRACKETED_PASTE_ON,
  BRACKETED_PASTE_OFF
} from '../state/constants';

import { DEFAULT_WINDOW, DEFAULT_COLUMN } from '../state/config';

import { lgetenv } from '../startup/environment';

import { terminalNumber } from './terminal';

const atoi = (value: string): number => parseInt(value, 10) || 0;

/**
 * less scrsize precedence, before gutters are reserved.
 *
 * The size comes from node's own, which it refreshes from the ioctl
 * BEFORE dispatching SIGWINCH - measured: inside the handler
 * process.stdout.columns already reads the new width. So the resize
 * path knows the size the moment it is woken and has nothing to ask.
 *
 * It used to ask anyway, through freshWindowSize, which opens
 * /dev/tty and SPAWNS stty: 1.57ms of forking against the ioctl's
 * 0.04ms, and execFileSync blocks the whole event loop while it runs.
 * applyResize called it twice, so every resize stopped the process
 * dead for 3ms before drawing anything - and a drag is a resize per
 * movement of the hand. That is the lag, and no byte count could see
 * it: the output was the same, the time went into fork and exec.
 *
 * The live probe is still right where the loop CANNOT turn - the
 * press-RETURN gate spins inside readSync, where no SIGWINCH can be
 * delivered and the cache really would go stale - and that is the one
 * place still calling it.
 */
export function detectedDimensions(): [number, number] {
  const sysWidth = process.stdout.columns || 0;
  const sysHeight = process.stdout.rows || 0;

  let rows = sysHeight > 0
    ? sysHeight
    : lgetenv('LINES') !== undefined
      ? atoi(lgetenv('LINES') ?? '')
      : terminalNumber('lines', 'li') ?? 0;

  let columns = sysWidth > 0
    ? sysWidth
    : lgetenv('COLUMNS') !== undefined
      ? atoi(lgetenv('COLUMNS') ?? '')
      : terminalNumber('cols', 'co') ?? 0;

  // less's full_screen goes FALSE here and never back (screen.c:966);
  // the variable cannot change inside one process, so recomputing it
  // on every scrsize - resize included - is the same thing
  const lessRows = lgetenv('LESS_LINES');
  setFullScreen(lessRows === undefined);

  if (lessRows !== undefined) {
    const value = atoi(lessRows);
    rows = value < 0 ? rows + value : value;
  }

  const lessColumns = lgetenv('LESS_COLUMNS');
  if (lessColumns !== undefined) {
    const value = atoi(lessColumns);
    columns = value < 0 ? columns + value : value;
  }

  return [
    columns > 0 ? columns : DEFAULT_COLUMN,
    rows > 0 ? rows : DEFAULT_WINDOW,
  ];
}

/**
 * The escape sequences that undo enterScreen, like less's term_deinit.
 *
 * Both ways out of the screen need these in this order, and they were
 * written twice: here and inline in the quit path. Two copies of an
 * exit path is how one of them silently stops matching less.
 */
export function leaveScreenCodes(): void {
  // less's mouse and paste strings are hardcoded, not termcap: even
  // a dumb terminal receives them when the options are on
  if (optMouse() || opt.emouse) {
    putstr(MOUSE_OFF + MOUSE_SGR_OFF);
  }

  if (optNoPaste()) putstr(BRACKETED_PASTE_OFF);

  if (!mode.DUMB) {
    if (!optNoKeypad()) putstr(KEYPAD_OFF);

    if (!optNoInit()) {
      putstr(ALTERNATE_CONSOLE_OFF);
    }
  }
}

/**
 * Leaves the alternate screen and raw mode so a child process can use
 * the terminal, like less de-initializing before running a command.
 */
export function suspendTerminal(): void {
  leaveScreenCodes();

  // less's lsystem: `term_deinit(); flush(); /* Make sure the deinit
  // chars get out */` (lsystem.c:97). The child writes to fd 1
  // directly, so anything of ours still in obuf arrives AFTER it -
  // including the alternate-screen exit. `!echo hi` then printed hi
  // inside the alt screen, and leaving it a moment later threw the
  // line away: less showed "hi", we showed nothing.
  flush();

  setKeyboardRaw(false);
  keyboard().pause();
  hook.screenActive = false;
}

export function enterScreen(): void {
  if (!mode.DUMB) {
    if (!optNoInit()) {
      putstr(ALTERNATE_CONSOLE_ON);
    }

    if (!optNoKeypad()) putstr(KEYPAD_ON);
  }

  if (optMouse() || opt.emouse) {
    putstr(MOUSE_SGR_ON + MOUSE_ON);
  }

  if (optNoPaste()) putstr(BRACKETED_PASTE_ON);

  termInitTail();

  hook.screenActive = true;

  // less's first_time is a static set at STARTUP and never again
  // (forwback.c:22, cleared at :381) - term_init does not touch it,
  // and lsystem, pipe_data and psignals all come back through
  // term_init. So a screen RE-entered still counts as having painted,
  // and its first repaint prints "...skipping..." like less's. Clearing
  // the flag here is what swallowed the marker after every ! and ^Z.
  // A genuinely fresh session clears it in freshSession instead.
  resetRender(true);
  screenEntered();
}

/**
 * The last thing less's term_init does (screen.c:2071): park the cursor
 * at the start of the line.
 *
 * It belongs to the TERMINAL setup, not to the paint that happens to
 * come next, and the difference shows the moment something else comes
 * first: a `+cmd` is ungotten before the first prompt, so less echoes
 * the command behind this CR and paints afterwards. Folding the CR
 * into the first frame instead lost it whenever the first frame was
 * not the first output.
 */
export function termInitTail(): void {
  // with -c less instead scrolls a whole screen in, so the first paint
  // has the terminal to itself without losing any scrollback
  if (optClearRepaint()) {
    putstr('\n'.repeat(Math.max(config.window - 1, 0)));
    return;
  }

  putstr('\r');
}

export function calculateDimensions(): void {
  // less's scrsize queries the terminal itself: node's cached
  // winsize lags blocked loops and raw SIGWINCH handlers; a zero
  // size (some pseudo-terminals) falls back like less
  const [columns, rows] = detectedDimensions();
  config.window = rows;
  config.screenWidth = columns;

  // -N and -J reserve gutter columns inside the screen width
  reserveGutter();

  // less rounds UP: wscroll = (sc_height + 1) / 2 in C integer division
  // (screen.c:998), so a 45-row screen scrolls 23 lines, not 22
  config.halfWindow = Math.floor((config.window + 1) / 2);
}
