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
