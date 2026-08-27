/**
 * What this session calls itself in the terminal's title bar.
 *
 * less sets a title only on Windows. Both of its title calls are behind
 * the same guard - SetConsoleTitleW at command.c:976 under
 * `#if MSDOS_COMPILER==WIN32C`, and the restore at main.c:609 under
 * `#ifdef WIN32` - so on unix it writes nothing at all, ever. It does
 * not have to: a unix terminal titles its window from the foreground
 * PROCESS, and less's process is `less foo`. Ours is
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
 * The name is set ONCE and never revised. That is less's own
 * behaviour and not a shortcut: since it writes nothing on unix, its
 * title is its argv, and :n and :e do not rewrite argv - so the bar
 * keeps saying whatever the command line said for the whole session.
 * The {{ Seems like this should be done in edit_ifile }} note at
 * command.c:969 is about the Windows build, which is the only one that
 * retitles at all.
 *
 * What less freezes there is the WHOLE command line, flags included -
 * `less -N -S +/pattern a b c`. We freeze the product name instead.
 * The file is already on the screen, through the prompt's %f, which is
 * less's own ?f; repeating it in the bar buys nothing that the pager
 * is not already saying.
 *
 * So there is one writer, it writes once, it needs no restoring, and
 * it goes away with the process - exactly like less's.
 */
const PRODUCT = 'less-pager-mini';

/** What this session is invoked as, which is what less's title IS. */
const COMMAND = 'lmn';

/** The names to try, best first. */
const FORMS = [PRODUCT, COMMAND];

/** Whether the name has been set, since it is set exactly once. */
let named = false;

/**
 * Names the process, so the terminal titles itself.
 *
 * Called wherever a session begins; the second call onwards is a
 * no-op, which is what freezing the name means.
 *
 * The fallback exists because process.title overwrites the argv BLOCK
 * in place, so a title can never be longer than the command line that
 * started the process, and node cuts the excess without saying so.
 * MEASURED, byte for byte: `node b.js` gives 9, `node b.js one` 13,
 * `node b.js tests/editing` 23 - always argv joined with spaces. An
 * installed `lmn` is reached through its full path, so the budget is
 * `node ` plus that path plus the arguments and PRODUCT fits with room
 * over on every real install: /usr/bin/lmn, the shortest of them, is
 * 12 bytes against the 10 the name needs. Only a hand-placed shim or a
 * direct `node <short-script>` can come up short, and those get "lmn".
 */
export function refreshWindowTitle(): void {
  if (named) return;

  named = true;

  for (const form of FORMS) {
    process.title = form;

    // what comes back from a title that did not fit IS the budget, so
    // the one measurement both detects the problem and moves past it
    if (Buffer.byteLength(process.title) >= Buffer.byteLength(form)) return;
  }
}

/** Forgets that a name was set, for the tests. */
export function resetWindowTitle(): void {
  named = false;
}
