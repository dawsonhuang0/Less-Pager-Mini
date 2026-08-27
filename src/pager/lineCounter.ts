import { Worker } from 'worker_threads';

/**
 * Counts a long stretch of newlines somewhere the event loop can keep
 * turning.
 *
 * less counts lines by WALKING them: find_linenum calls forw_raw_line
 * once per line through ch_forw_get (linenum.c). It can afford a
 * synchronous walk because a C signal handler runs wherever the kernel
 * delivers it, so ABORT_SIGS() is a volatile flag read once per line
 * and the walk is interruptible for free.
 *
 * Ours is not. node runs a JS signal handler on the event loop, and a
 * synchronous walk IS the event loop, stopped - a ^C is delivered,
 * queued, and not run until the walk it was meant to stop has
 * finished. The machinery around the old walk exists to work around
 * exactly that: ISIG dipped through `stty` so the driver hands the
 * byte over instead of raising a signal, and a non-blocking descriptor
 * polled once a megabyte to catch it.
 *
 * Counting off the loop removes the cause instead of the symptoms.
 */

/** Bytes per read, matching the walk's own chunk. */
const CHUNK = 64 * 1024;

/** 1 while the caller wants the count abandoned. */
const ABORT = 0;

/** The worker's whole program: read a range, count it, report. */
const COUNTER = `
const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');

const flags = new Int32Array(workerData.flags);
const ab = new ArrayBuffer(${CHUNK});
const buf = Buffer.from(ab);
const u32 = new Uint32Array(ab);

// the same word test the inline walk uses, with the horizontal sum
// deferred into a per-lane accumulator: one add per word rather than a
// branch, flushed before any lane can overflow
function count(len) {
  let n = 0;
  const words = len >>> 2;
  let w = 0;

  while (w < words) {
    const stop = Math.min(w + 63, words);
    let acc = 0;

    for (; w < stop; w++) {
      const x = u32[w] ^ 0x0a0a0a0a;
      acc += (~(((x & 0x7f7f7f7f) + 0x7f7f7f7f) | x | 0x7f7f7f7f) &
        0x80808080) >>> 7;
    }

    n += (acc & 0xff) + ((acc >>> 8) & 0xff) + ((acc >>> 16) & 0xff) +
      (acc >>> 24);
  }

  for (let i = words << 2; i < len; i++) if (buf[i] === 0x0a) n++;

  return n;
}

parentPort.on('message', job => {
  let fd = -1;

  try {
    fd = fs.openSync(job.path, 'r');

    let pos = job.from;
    let n = 0;

    while (pos < job.to) {
      // a worker cannot receive a signal, so the interrupt arrives as
      // a shared word - set by a main thread that is free to run its
      // own SIGINT handler, which is the whole point of being here
      if (Atomics.load(flags, ${ABORT}) === 1) {
        parentPort.postMessage({ id: job.id, aborted: true });
        return;
      }

      const got = fs.readSync(fd, buf, 0, Math.min(${CHUNK}, job.to - pos),
        pos);

      if (got <= 0) break;

      pos += got;
      n += count(got);
    }

    parentPort.postMessage({ id: job.id, at: pos, lines: n });
  } catch (error) {
    parentPort.postMessage({ id: job.id, at: undefined });
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch (error) {} }
  }
});
`;

interface Job {
  id: number;
  settle: (result: { at: number, lines: number } | null) => void;
}

let worker: Worker | null = null;
let flags: Int32Array | null = null;
let pending: Job | null = null;
let nextId = 1;
let bySigint = false;

/** Whether a count is out, so a key that ends one can be recognised. */
export const counting = (): boolean => pending !== null;

function settle(result: { at: number, lines: number } | null): void {
  const job = pending;

  pending = null;

  // idle again, and it must not hold the process open
  worker?.unref();
  job?.settle(result);
}

function ensure(): Worker {
  if (worker) return worker;

  const shared = new SharedArrayBuffer(4);

  flags = new Int32Array(shared);
  worker = new Worker(COUNTER, { eval: true, workerData: { flags: shared } });

  worker.on('message', (reply: {
    id: number, at?: number, lines?: number, aborted?: boolean
  }) => {
    if (pending?.id !== reply.id) return;

    settle(reply.aborted || reply.at === undefined
      ? null
      : { at: reply.at, lines: reply.lines ?? 0 });
  });

  // a worker error with no listener is an unhandled event and ends the
  // process; and whoever is waiting is owed an answer
  worker.on('error', () => settle(null));

  worker.unref();

  return worker;
}

/**
 * Counts the newlines between two positions, off the event loop.
 *
 * Resolves null when the count was abandoned, which every caller of
 * the walk already treats as "the number is not known" - the same
 * answer less gives when find_linenum returns 0 (linenum.c:463).
 */
export function countRange(
  path: string,
  from: number,
  to: number
): Promise<{ at: number, lines: number } | null> {
  const w = ensure();

  if (flags) Atomics.store(flags, ABORT, 0);

  return new Promise(resolve => {
    const id = nextId++;

    pending = { id, settle: resolve };

    // ref'd for as long as a job is out: unref'd throughout, node sees
    // nothing left to wait for and exits before the reply arrives
    w.ref();
    w.postMessage({ id, path, from, to });
  });
}

/**
 * Abandons a count in flight, like ABORT_SIGS ending less's walk.
 *
 * `sigint` separates a ^C from the --intr char, because less does. A
 * ^C is a SIGNAL: it lands wherever the process happens to be, so it
 * can catch forw() with pos_clear() already run and no line put up -
 * an empty position table, and make_display then goes to
 * jump_loc(ch_zero(), 1) (command.c:852). check_poll only compares the
 * --intr char BETWEEN reads (os.c:161), a boundary less chose, so it
 * leaves the screen alone. MEASURED: G then ^X leaves less at (END),
 * G then ^C at line 1.
 *
 * Taken from the CALLER rather than sniffed off the terminal: the two
 * arrive at different places in the key path, so each says which it is.
 */
export function abortCount(sigint = false): void {
  bySigint = sigint;
  if (flags) Atomics.store(flags, ABORT, 1);
}

/** Whether the abandoned count was ended by a ^C. */
export const countAbortedBySigint = (): boolean => bySigint;

/** Ends the worker with the session, like the guard's teardown. */
export function endLineCounter(): void {
  // NOT while a count is out: cleanUp() is not once per process -
  // blockFirstFile runs a contentPager of its own and tears down
  // mid-session - and cancelling there kills a count the session is
  // still waiting on. Nothing leaks by waiting: the worker is unref'd.
  if (pending || !worker) return;

  void worker.terminate();
  worker = null;
  flags = null;
}
