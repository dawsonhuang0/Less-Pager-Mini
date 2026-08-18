import { Worker } from 'worker_threads';

import { putstr, flush } from '../tty/output';

import { config } from '../state/config';

import { CURSOR_TO, CLEAR_LINE } from '../state/constants';

/**
 * Runs a host RegExp somewhere it can be killed.
 *
 * A JavaScript regex is one synchronous call into the engine: nothing
 * on this thread runs again until it returns, so the interrupt poll
 * that stops every other long search never gets a turn. og has the
 * same limit with regexec, which is why it checks for the interrupt
 * BETWEEN lines (search.c) and can never break into one - and on a
 * line long enough, or a pattern shaped like (a+)+b, "between lines"
 * is a promise it cannot keep either.
 *
 * The only thing that stops a running regex is killing the thread it
 * runs on. So a catastrophic pattern runs in a worker, and the main
 * thread waits in slices it can be interrupted between.
 *
 * This is for --use-js-regexp alone. The POSIX engine underneath the
 * default does not backtrack: (a+)+b against a million characters
 * returns in under a millisecond, and there is nothing to abort.
 */

/** How long to wait per slice before looking for an interrupt. */
const SLICE_MS = 20;

/** When to admit that this is taking a while. */
const NOTICE_MS = 2000;

/** Header: [state, byte length]; the payload follows it. */
const HEADER = 2;
const STATE = 0;
const LENGTH = 1;

/** Idle, a request is waiting, a reply is waiting. */
const IDLE = 0;
const REQUEST = 1;
const REPLY = 2;

/** Where the payload starts, and grows from. */
const PAYLOAD = 1 << 20;

/**
 * The worker's whole program.
 *
 * It cannot answer with postMessage: the thread that asked is blocked
 * in Atomics.wait and will not run a callback until it is let go. So
 * both directions go through the shared buffer.
 */
const PROGRAM = `
const { workerData } = require('worker_threads');
const header = new Int32Array(workerData, 0, ${HEADER});
const payload = new Uint8Array(workerData, ${HEADER} * 4);
const room = payload.length;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const reply = value => {
  const bytes = encoder.encode(JSON.stringify(value));
  payload.set(bytes.subarray(0, room));
  Atomics.store(header, ${LENGTH}, Math.min(bytes.length, room));
  Atomics.store(header, ${STATE}, ${REPLY});
  Atomics.notify(header, ${STATE});
};

for (;;) {
  Atomics.wait(header, ${STATE}, ${IDLE});

  if (Atomics.load(header, ${STATE}) !== ${REQUEST}) continue;

  const length = Atomics.load(header, ${LENGTH});
  const { source, flags, text, test } = JSON.parse(
    decoder.decode(payload.subarray(0, length)));

  try {
    const re = new RegExp(source, flags);

    if (test) {
      reply({ test: re.test(text) });
    } else {
      const m = re.exec(text);
      reply(m === null ? { match: null }
        : { match: { index: m.index, groups: Array.from(m) } });
    }
  } catch (error) {
    reply({ failed: String(error) });
  }
}
`;

interface Shared {
  worker: Worker;
  header: Int32Array;
  payload: Uint8Array;
  memory: SharedArrayBuffer;
}

let shared: Shared | null = null;

/**
 * Starts the worker, or hands back the one already running - unless
 * the one running has too small a buffer for what is being asked, in
 * which case it is replaced by one that fits.
 *
 * A SharedArrayBuffer cannot grow, and a subject that does not fit
 * cannot be handed over at all. Running it here instead would be the
 * one case that most needs killing, run somewhere unkillable, so the
 * buffer moves rather than the work.
 *
 * @param need - Bytes the next request occupies.
 */
function ensureWorker(need: number): Shared {
  if (shared && shared.payload.length >= need) return shared;

  if (shared) killWorker();

  let room = PAYLOAD;
  while (room < need) room *= 2;

  const memory = new SharedArrayBuffer(HEADER * 4 + room);
  const header = new Int32Array(memory, 0, HEADER);
  const payload = new Uint8Array(memory, HEADER * 4);

  const worker = new Worker(PROGRAM, { eval: true, workerData: memory });

  // it outlives every search; nothing should wait on it at exit
  worker.unref();

  shared = { worker, header, payload, memory };
  return shared;
}

/** Kills the worker mid-regex, which is the only thing that stops one. */
function killWorker(): void {
  if (!shared) return;

  void shared.worker.terminate();
  shared = null;
}

/** Drops the worker, for a session that is closing down. */
export function endJsRegexGuard(): void {
  killWorker();
}

/** True while a guarded run was cut short, so callers can tell. */
let aborted = false;

/** Whether the last guarded call was interrupted rather than answered. */
export const jsRegexAborted = (): boolean => aborted;

/** Clears the flag, at the start of a new search. */
export function clearJsRegexAbort(): void {
  aborted = false;
}

/**
 * Waits for the worker, letting the interrupt poll run between slices.
 *
 * @param interrupted - The poll; true means the user wants out.
 * @returns The reply, or null when it was killed.
 */
function waitForReply(
  state: Shared,
  interrupted: () => boolean
): unknown | null {
  const started = Date.now();
  let noticed = false;

  for (;;) {
    Atomics.wait(state.header, STATE, REQUEST, SLICE_MS);

    if (Atomics.load(state.header, STATE) === REPLY) {
      const length = Atomics.load(state.header, LENGTH);
      const text = Buffer.from(state.payload.subarray(0, length)).toString();

      Atomics.store(state.header, STATE, IDLE);

      if (noticed) {
        putstr(CURSOR_TO(config.window, 1) + CLEAR_LINE);
        flush();
      }

      return JSON.parse(text);
    }

    if (interrupted()) {
      killWorker();
      aborted = true;
      return null;
    }

    // og says nothing while a search runs, because og's searches
    // return. This one may not, and a pager that looks hung without
    // saying why is the thing to avoid
    if (!noticed && Date.now() - started >= NOTICE_MS) {
      noticed = true;
      putstr(CURSOR_TO(config.window, 1) + CLEAR_LINE +
        'Searching... (interrupt to abort)');
      flush();
    }
  }
}

/**
 * Runs one match in the worker.
 *
 * @param request - Pattern, flags, subject, and which call to make.
 * @param interrupted - Polled between slices; true aborts.
 * @returns The worker's answer, or null when aborted or unusable.
 */
export function guardedMatch(
  request: { source: string, flags: string, text: string, test: boolean },
  interrupted: () => boolean
): { test?: boolean, match?: { index: number, groups: string[] } | null,
  failed?: string } | null {
  const bytes = Buffer.from(JSON.stringify(request));
  const state = ensureWorker(bytes.length);

  state.payload.set(bytes);
  Atomics.store(state.header, LENGTH, bytes.length);
  Atomics.store(state.header, STATE, REQUEST);
  Atomics.notify(state.header, STATE);

  return waitForReply(state, interrupted) as ReturnType<typeof guardedMatch>;
}
