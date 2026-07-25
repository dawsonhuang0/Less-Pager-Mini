import fs from 'fs';

/**
 * Keeps a test run off the developer's terminal.
 *
 * Some display paths write straight to fd 1 with fs.writeSync — the
 * command-line clear before a blocking search, the pipe's wait
 * message, the keyboard's prompt erase — because og flushes those
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
 * freshWindowSize() asks the kernel through `stty size` on /dev/tty,
 * like og's scrsize ioctl, and falls back to node's cached window.
 * Neither route sees a test's stubbed process.stdout.columns/rows, so
 * a suite run FROM a terminal measured the developer's real window
 * and every screen assertion drifted with it — a chopped line stopped
 * being chopped on a wide screen, a squished screen came back the
 * wrong height. Piping the run hid it, because /dev/tty then failed.
 *
 * Opening /dev/tty is refused here so the probe falls through, and
 * the cached-window fallback reports the stubbed values.
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
