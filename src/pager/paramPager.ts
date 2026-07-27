import { inputToString } from '../helpers';

import { initContent } from '../features/files';

import { initInvocationOptions } from '../startup/invocation';

import { freshSession } from '../startup/freshSession';

import { keyboard } from '../tty/keyboard';

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

  if (!keyboard().isTTY) {
    throw new Error('Less-pager-mini requires interactive terminal (TTY).');
  }

  const content = inputToString(input, tabObject);

  initContent(content);
  await contentPager(content);
}
