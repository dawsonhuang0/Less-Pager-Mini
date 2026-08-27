import path from 'path';

import { files } from '../features/files';

/**
 * What this session calls itself in the terminal's title bar.
 *
 * less sets a title only on Windows, through SetConsoleTitleW under
 * MSDOS_COMPILER==WIN32C (command.c:966), and sends nothing at all on
 * unix. It does not have to: a unix terminal titles its window from
 * the foreground PROCESS, and less's process is `less foo`. Ours is
 * `node /path/to/cli.js foo`, so the same mechanism reads "node".
 *
 * process.title is that mechanism, not an escape sequence. Writing an
 * OSC title instead put a SECOND name in the bar beside the process
 * one, and left it there on quit - a terminal that ignores the xterm
 * title stack has nothing to restore from, and Terminal.app does
 * ignore it. Measured there: "package - less-pager-mini a - <the OSC
 * copy> - 208x65" while running, and the OSC copy still sitting in
 * the bar afterwards.
 *
 * So there is one writer, it needs no restoring, and it goes away
 * with the process - exactly like less's.
 */
const PRODUCT = 'less-pager-mini';

/** What this session is invoked as, which is what less's title IS. */
const COMMAND = 'lmn';

/**
 * How much of a title the process can actually carry.
 *
 * process.title overwrites the argv BLOCK in place, so a title can
 * never be longer than the command line that started the process, and
 * node cuts the excess without saying so. MEASURED here, byte for
 * byte: `node b.js` gives 9, `node b.js one` 13, `node b.js
 * tests/editing` 23 - always argv joined with spaces. `node
 * dist/cli.js a` gives 18, which is exactly where "less-pager-mini
 * tests/editing" became "less-pager-mini te".
 *
 * less never meets this: its title is not something it writes, it IS
 * its argv, which the terminal reads directly and nothing rewrites.
 *
 * Infinity until a title comes back cut, because there is no portable
 * way to ASK - process.argv[1] has already been absolutised, so the
 * real command line is gone by the time we could look at it.
 */
let budget = Infinity;

/** The last form handed to node, so an unchanged title is not re-set. */
let shown: string | null = null;

/**
 * The names this session could go by, best first.
 *
 * A name appears whenever one is being PAGED, which is less's own `?f`
 * test and needs no idea of who called: `lmn foo` and a library call
 * under --examine-file both open foo and both say so, while standard
 * input (path "-") and a library call over its own data have no name
 * to show and get the product alone.
 *
 * The ladder exists because SOMETHING has to give when the budget is
 * short, and the branding is what should give: the file is the part
 * that changes and the part `?f` is about, so dropping "less-pager-mini
 * " for "lmn " degrades TOWARDS less's own shape rather than away from
 * it. A truncated title is the last resort, not the first.
 */
export function windowTitles(): string[] {
  const entry = files.list[files.index];
  const named = entry !== undefined && entry.path !== '' &&
    entry.path !== '-';

  if (!named) return [PRODUCT, COMMAND];

  const full = entry.path;
  const base = path.basename(full);
  const forms = [`${PRODUCT} ${full}`, `${COMMAND} ${full}`, full];

  // a path only sheds its directories once they are what does not fit
  if (base !== full) forms.push(`${COMMAND} ${base}`, base);

  return forms;
}

/** The title this session would show given room for it. */
export const windowTitle = (): string => windowTitles()[0];

/**
 * Renames the process, so the terminal retitles itself.
 *
 * less's Windows build re-sets its title at every prompt; its own source
 * says the right place is the file switch ("{{ Seems like this should
 * be done in edit_ifile }}", command.c:969), which is where the name
 * can actually change.
 */
export function refreshWindowTitle(): void {
  const forms = windowTitles();
  const want = fitting(forms);

  if (want === shown) return;

  process.title = want;
  shown = want;

  // what comes back from a title that did not fit IS the budget, so
  // the one measurement both diagnoses and repairs this call; only
  // ever downwards, since a cut multi-byte character can come back as
  // a longer replacement one
  if (Buffer.byteLength(process.title) < Buffer.byteLength(want)) {
    budget = Math.min(budget, Buffer.byteLength(process.title));

    const fits = fitting(forms);

    if (fits !== want) {
      process.title = fits;
      shown = fits;
    }
  }
}

/** The first form that fits, or the shortest if none does. */
function fitting(forms: string[]): string {
  return forms.find(form => Buffer.byteLength(form) <= budget) ??
    forms[forms.length - 1];
}

/** Forgets a measurement taken by another session, for the tests. */
export function resetWindowTitle(): void {
  budget = Infinity;
  shown = null;
}
