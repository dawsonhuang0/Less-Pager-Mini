import { resetConfig, resetMode } from '../state/config';

import { resetOptions } from '../options/state';

import { resetRender, resetDumbPaint } from '../helpers';

import { resetSearch } from '../features/searching';

/**
 * Hands a session the clean slate og gets for free.
 *
 * og is one process per session: its opttbl.c globals, its screen
 * state and its position table all start at their defaults because
 * the process just started. Ours are module singletons that mirror
 * those globals deliberately — the mapping is how each option is
 * audited against og's source — so they outlive a pager() call and
 * the NEXT call inherits them.
 *
 * That leak is not theoretical: a `{ tabs: 4 }` call left the tab
 * stops behind for the following call, a squished first screen never
 * squished again because mode.INIT stayed false, and --no-shell
 * needed its own per-invocation dance to survive it.
 *
 * Runs BEFORE initInvocationOptions and the $LESS scan, so both write
 * onto defaults. Deliberately NOT reset: the queued CLI arguments
 * (the executable fills them before it calls in), and anything og
 * persists across invocations by design — the history file, and the
 * marks --save-marks restores.
 */
export function freshSession(): void {
  resetOptions();
  resetConfig();
  resetMode();
  resetRender();
  resetDumbPaint();
  resetSearch();
}
