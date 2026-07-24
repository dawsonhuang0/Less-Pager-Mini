import { keyboard } from './keyboard';

import { config, mode } from './config';

import { opt, optMouse, optNoInit, optNoKeypad, optNoPaste,
  reserveGutter, hook } from './options';

import { resetRender, screenEntered } from './helpers';

import { freshWindowSize } from './keyboard';

import {
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF,
  ALTERNATE_SCROLL_ON,
  ALTERNATE_SCROLL_OFF,
  KEYPAD_ON,
  KEYPAD_OFF,
  MOUSE_ON,
  MOUSE_OFF,
  MOUSE_SGR_ON,
  MOUSE_SGR_OFF,
  BRACKETED_PASTE_ON,
  BRACKETED_PASTE_OFF
} from './constants';

import { DEFAULT_WINDOW, DEFAULT_COLUMN } from './config';

import { lgetenv } from './environment';

import { terminalNumber } from './terminal';

const atoi = (value: string): number => parseInt(value, 10) || 0;

/** OG scrsize precedence, before gutters are reserved. */
export function detectedDimensions(): [number, number] {
  const size = freshWindowSize();
  const sysWidth = (size ? size[0] : process.stdout.columns) || 0;
  const sysHeight = (size ? size[1] : process.stdout.rows) || 0;

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

  const lessRows = lgetenv('LESS_LINES');
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
 * Leaves the alternate screen and raw mode so a child process can use
 * the terminal, like less de-initializing before running a command.
 */
export function suspendTerminal(): void {
  // og's mouse and paste strings are hardcoded, not termcap: even
  // a dumb terminal receives them when the options are on
  if (optMouse() || opt.emouse) {
    process.stdout.write(MOUSE_OFF + MOUSE_SGR_OFF);
  }

  if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_OFF);

  if (!mode.DUMB) {
    if (!optNoKeypad()) process.stdout.write(KEYPAD_OFF);

    if (!optNoInit()) {
      process.stdout.write(ALTERNATE_SCROLL_OFF);
      process.stdout.write(ALTERNATE_CONSOLE_OFF);
    }
  }

  keyboard().setRawMode(false);
  keyboard().pause();
  hook.screenActive = false;
}

export function enterScreen(): void {
  if (!mode.DUMB) {
    if (!optNoInit()) {
      process.stdout.write(ALTERNATE_CONSOLE_ON);
      process.stdout.write(ALTERNATE_SCROLL_ON);
    }

    if (!optNoKeypad()) process.stdout.write(KEYPAD_ON);
  }

  if (optMouse() || opt.emouse) {
    process.stdout.write(MOUSE_SGR_ON + MOUSE_ON);
  }

  if (optNoPaste()) process.stdout.write(BRACKETED_PASTE_ON);

  hook.screenActive = true;
  resetRender();
  screenEntered();
}

export function calculateDimensions(): void {
  // og's scrsize queries the terminal itself: node's cached
  // winsize lags blocked loops and raw SIGWINCH handlers; a zero
  // size (some pseudo-terminals) falls back like og
  const [columns, rows] = detectedDimensions();
  config.window = rows;
  config.screenWidth = columns;

  // -N and -J reserve gutter columns inside the screen width
  reserveGutter();

  config.halfWindow = Math.floor(config.window / 2);
}
