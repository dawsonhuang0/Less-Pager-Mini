import { inputToString } from '../helpers';

import { initContent } from '../features/files';

import { initInvocationOptions } from '../startup/invocation';

import { keyboard } from '../tty/keyboard';

import { contentPager } from './core';

/**
 * Pages values already owned by the JavaScript caller. Converting that value
 * to lines is source-specific; terminal behavior lives in the shared core.
 */
export default async function paramPager(
  input: unknown,
  preserveFormat: boolean = false
): Promise<void> {
  initInvocationOptions();

  if (!keyboard().isTTY) {
    throw new Error('Less-pager-mini requires interactive terminal (TTY).');
  }

  const content = inputToString(input, preserveFormat);
  if (!content.length) return;

  initContent(content);
  await contentPager(content);
}
