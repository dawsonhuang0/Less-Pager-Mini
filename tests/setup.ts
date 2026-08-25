import fs from 'fs';

/**
 * Keeps a test run off the developer's terminal.
 *
 * Some display paths write straight to fd 1 with fs.writeSync — the
 * command-line clear before a blocking search, the pipe's wait
 * message, the keyboard's prompt erase — because less flushes those
 * synchronously. A vi.spyOn over process.stdout.write cannot see
 * them, so they used to land on the real screen and scramble it
 * (cursor jumps, cleared rows) while `npm t` ran.
 *
 * Only fd 1 is swallowed: fd 2 keeps carrying diagnostics, and a
 * write to any real file descriptor (the block-file fixtures, the
 * spool) must still happen for the test to mean anything.
 */
const realWriteSync = fs.writeSync.bind(fs);

fs.writeSync = ((fd: number, ...args: unknown[]): number => {
  if (fd !== 1) {
    return (realWriteSync as unknown as
      (...a: unknown[]) => number)(fd, ...args);
  }

  const data = args[0];

  if (typeof data === 'string') return Buffer.byteLength(data);
  return data instanceof Uint8Array ? data.length : 0;
}) as typeof fs.writeSync;

/**
 * Pins the terminal size to whatever a test stubs.
 *
 * detectedDimensions() reads node's own columns/rows, which a test
 * stubs directly - it no longer spawns `stty` on /dev/tty to ask the
 * kernel, so a suite run FROM a terminal no longer measures the
 * developer's real window and drifts with it.
 *
 * Opening /dev/tty is still refused here: the keyboard opens it too,
 * and a test must not take the developer's terminal.
 */
const realOpenSync = fs.openSync.bind(fs);

fs.openSync = ((path: unknown, ...args: unknown[]): number => {
  if (path === '/dev/tty') throw new Error('no tty in tests');

  return (realOpenSync as unknown as
    (...a: unknown[]) => number)(path, ...args);
}) as typeof fs.openSync;

process.stdout.getWindowSize = ((): [number, number] =>
  [process.stdout.columns, process.stdout.rows]) as
  typeof process.stdout.getWindowSize;

/**
 * Gives the faked terminal a capable $TERM.
 *
 * The harnesses drive an INTERACTIVE pager: they fake a tty on stdin
 * and stdout, so the environment has to look like one too. A runner
 * has no $TERM (or sets it to 'dumb'), which makes dumbTerminal()
 * true; startup then prints less's missing_cap warning and holds the
 * screen at its "Press RETURN to continue" gate, which swallows the
 * keys the test sends. Locally $TERM is set, so the suite passed
 * while CI failed on eight tests.
 *
 * Tests about dumb terminals set $TERM themselves and restore it.
 */
if (!process.env.TERM || process.env.TERM === 'dumb' ||
    process.env.TERM === 'unknown') {
  process.env.TERM = 'xterm';
}
