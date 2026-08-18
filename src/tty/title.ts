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

/**
 * The title this session should be showing.
 *
 * A name appears whenever one is being PAGED, which is less's own `?f`
 * test and needs no idea of who called: `lmn foo` and a library call
 * under --examine-file both open foo and both say so, while standard
 * input (path "-") and a library call over its own data have no name
 * to show and get the product alone.
 */
export function windowTitle(): string {
  const entry = files.list[files.index];
  const named = entry !== undefined && entry.path !== '' &&
    entry.path !== '-';

  return named ? `${PRODUCT} ${entry.path}` : PRODUCT;
}

/**
 * Renames the process, so the terminal retitles itself.
 *
 * less's Windows build re-sets its title at every prompt; its own source
 * says the right place is the file switch ("{{ Seems like this should
 * be done in edit_ifile }}", command.c:969), which is where the name
 * can actually change.
 */
export function refreshWindowTitle(): void {
  const title = windowTitle();
  if (process.title !== title) process.title = title;
}
