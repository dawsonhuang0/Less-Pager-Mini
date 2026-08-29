import { textToLines, inputToText } from '../helpers';

import { initContent } from '../features/files';


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

  // less never refuses to start over the keyboard: open_getchr takes
  // whatever open_tty hands it - the device stderr is on, then
  // /dev/tty, then stderr itself (ttyin.c:67) - and pages either way.
  // If that turns out to have no input, getchr sees EOF and quits
  // AFTER the first screen is on the terminal. Throwing here refused
  // to page at all for a caller whose stdin happens to be redirected,
  // which is the ordinary case for `cmd | lmn`.
  if (!keyboard().isTTY) openTtyKeyboard();

  // converted ONCE: a value JSON cannot hold says so on stderr, and
  // doing this twice said it twice
  const text = inputToText(input, tabObject);
  const content = textToLines(text);

  // the caller handed us the whole value, so its length is known at
  // once - there is no read here that could still be outstanding, and
  // the text it came from still has the trailing newline the lines no
  // longer remember
  initContent(content, true, text === null ? undefined
    : Buffer.byteLength(text));
  await contentPager(content);
}
