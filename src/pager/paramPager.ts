import { inputToString } from '../helpers';

import { initContent } from '../features/files';

import { initInvocationOptions } from '../startup/invocation';

import { freshSession } from '../startup/freshSession';

import { keyboard, openTtyKeyboard } from '../tty/keyboard';

import { contentPager } from './core';

/**
 * Pages values already owned by the JavaScript caller. Converting that value
 * to lines is source-specific; terminal behavior lives in the shared core.
 */
export default async function paramPager(
  input: unknown,
  tabObject: boolean = false
): Promise<void> {
  freshSession();
  initInvocationOptions();

  // less never refuses to start over the keyboard: open_getchr takes
  // whatever open_tty hands it - the device stderr is on, then
  // /dev/tty, then stderr itself (ttyin.c:67) - and pages either way.
  // If that turns out to have no input, getchr sees EOF and quits
  // AFTER the first screen is on the terminal. Throwing here refused
  // to page at all for a caller whose stdin happens to be redirected,
  // which is the ordinary case for `cmd | lmn`.
  if (!keyboard().isTTY) openTtyKeyboard();

  const content = inputToString(input, tabObject);

  initContent(content);
  await contentPager(content);
}
