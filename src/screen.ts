import { keyboard } from './keyboard';

import { config, mode } from './config';

import { opt, optMouse, optNoInit, optNoKeypad, optNoPaste,
  reserveGutter, hook } from './options';

import { resetRender, screenEntered } from './helpers';

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
  // a zero size (some pseudo-terminals) falls back like og's scrsize
  config.window = process.stdout.rows || DEFAULT_WINDOW;
  config.screenWidth = process.stdout.columns || DEFAULT_COLUMN;

  // LESS_LINES / LESS_COLUMNS override the detected size, like
  // scrsize: a negative value is relative to the real size
  const lines = parseInt(process.env.LESS_LINES ?? '', 10);
  const cols = parseInt(process.env.LESS_COLUMNS ?? '', 10);

  if (!isNaN(lines)) {
    config.window = lines < 0 ? config.window + lines : lines;
    if (config.window <= 0) config.window = DEFAULT_WINDOW;
  }

  if (!isNaN(cols)) {
    config.screenWidth = cols < 0 ? config.screenWidth + cols : cols;
    if (config.screenWidth <= 0) config.screenWidth = DEFAULT_COLUMN;
  }

  // -N and -J reserve gutter columns inside the screen width
  reserveGutter();

  config.halfWindow = Math.floor(config.window / 2);
  config.halfScreenWidth = Math.floor(config.screenWidth / 2);
}
