/**
 * Whether the source was actually READ for the command being run -
 * less's `ch_get` reaching an `iread` rather than answering from its
 * buffer pool.
 *
 * This is the whole of less's poll condition. check_poll (os.c:303) runs
 * before every iread and nowhere else: it reads a waiting key and
 * pushes it back with ungetcc_back (os.c:164), which makes the next
 * prompt() return early on `ungot != NULL` (command.c:924). No read,
 * no poll, no unget, and the ":" is written on every key however hard
 * the user bursts.
 *
 * That is why less keeps its ":" on short content and drops it on a big
 * file: once the file is inside ch's pool there is nothing left to
 * read, so scrolling it never polls. The pool, not the keyboard, is
 * what decides.
 *
 * A leaf module on purpose - the block layer and the renderer both
 * need it, and routing it through either of them would build an
 * import cycle.
 */

/** Reads during the command now running. */
let readNow = false;

/** Reads during the command before it, for decisions taken before
 *  this one has had the chance to read (cmd_exec's clear). */
let readLast = false;

/** less's iread: the source was touched, so less would have polled here. */
export function sourceRead(): void {
  readNow = true;
}

/** Starts a new command's watch, like less entering commands(). */
export function armReadWatch(): void {
  readLast = readNow;
  readNow = false;
}

/**
 * Whether less would have polled the tty for this command or the one
 * before it.
 *
 * Both, because the decisions hang off different moments: cmd_exec
 * clears the command line BEFORE the work that would read, and the
 * paint happens after. During a scroll that reads, both are true; on
 * content that never reads, neither ever is.
 */
export const sawSourceRead = (): boolean => readNow || readLast;
