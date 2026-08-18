import fs from 'fs';
import { Worker } from 'worker_threads';

/**
 * Runs a host RegExp somewhere it can be killed, and watches the
 * keyboard from somewhere that is not blocked.
 *
 * A JavaScript regex is one synchronous call into the engine: nothing
 * on that thread runs again until it returns, so the interrupt poll
 * that stops every other long search never gets a turn. og has the
 * same limit with regexec, which is why it checks for the interrupt
 * BETWEEN lines (search.c) and can never break into one.
 *
 * Killing the thread is the only thing that stops a running regex, so
 * the match runs in a worker. But the thread that WAITS for it is
 * just as stuck: a setTimeout cannot fire on it, a keypress is never
 * delivered to it, and the only way it could notice anything was to
 * wake on a timer and poll - which is a busy loop wearing a hat.
 *
 * So there are two workers. One matches; one reads the terminal. Both
 * signal the same word in shared memory, and the waiting thread sleeps
 * with no timeout at all until one of them does. An interrupt arrives
 * as fast as the kernel hands over the byte, and nothing polls.
 *
 * This is for --use-js-regexp alone. The POSIX engine underneath the
 * default does not backtrack: (a+)+b against a million characters
 * returns in under a millisecond, and there is nothing to abort.
 */

/** Header words: what is happening, and the sizes that go with it. */
const HEADER = 10;
const STATE = 0;
const LENGTH = 1;
/** 1 while ANY key should end the wait, 0 for an interrupt only. */
const MODE = 2;
/** Bytes the watcher has taken from the terminal and not used. */
const KEYLEN = 3;
/** 1 once the watcher has said this is taking a while. */
const NOTICED = 4;
/** Milliseconds from now until the watcher should say something. */
const NOTICE_IN = 5;
/** 1 while a message is on the bottom row, waiting to be dismissed. */
const MSG_UP = 6;
/** 1 when what stopped the match was an interrupt, not another key. */
const BY_INTR = 7;
/** 1 while a run is open, so the watcher reads between matches too. */
const WATCHING = 8;
/** 1 when the watcher saw an interrupt with no match out to stop. */
const PENDING = 9;

const IDLE = 0;
const REQUEST = 1;
const REPLY = 2;
const ABORT = 3;

/** Payload for the request and the reply that replaces it. */
const PAYLOAD = 1 << 20;

/** Room for keys the watcher read and the command loop still wants. */
const KEYROOM = 256;

/** How long before the watcher says something. */
const NOTICE_MS = 2000;

/**
 * When the RUN this call belongs to began, and whether it was given
 * up on.
 *
 * A frame is one piece of work to the person watching it, and a dozen
 * separate calls to this - one per line on screen. Timing each call on
 * its own means a frame that grinds for seven seconds never reaches
 * two on any single line, so it never says anything; and abandoning
 * one line leaves the other eleven still to be abandoned, each
 * wanting its own keypress. Both are the same mistake: the run is the
 * unit, not the call.
 */
let runStarted = 0;
let runAbandoned = false;

/**
 * Opens a run: a search, or one frame's highlighting.
 *
 * Declared rather than guessed. A gap between calls would have to
 * stand in for "the user got their screen back", and the difference
 * between a frame's twelfth line and the next frame's first is
 * microseconds either way.
 */
export function beginGuardedRun(): void {
  runStarted = Date.now();
  runAbandoned = false;
  trace('run');

  const state = shared;

  if (!state?.watcher) return;

  Atomics.store(state.header, PENDING, 0);
  Atomics.store(state.header, WATCHING, 1);
  Atomics.notify(state.header, WATCHING);
}

/** Closes a run, so the watcher stops taking keys nobody asked it to. */
export function endGuardedRun(): void {
  runStarted = 0;

  const state = shared;

  if (!state?.watcher) return;

  Atomics.store(state.header, WATCHING, 0);
  Atomics.notify(state.header, WATCHING);
}

/**
 * The watcher's verdict, for the scan between matches.
 *
 * Reading this is a shared word rather than a read(2) on the tty: one
 * thread watches the terminal for the whole run, and everything else
 * asks it. The keys it took come back through takeGuardedKeys.
 */
export function watcherSawInterrupt(): boolean {
  // the JS flag first: an interrupt that stopped a MATCH is answered
  // by killing the workers, which drops the shared buffer and the
  // verdict with it. The search around that match still has to learn
  // it was interrupted, or it walks on and the next ^C is the one
  // that appears to work
  if (sawInterrupt) {
    sawInterrupt = false;
    return true;
  }

  const state = shared;

  if (!state?.watcher) return false;

  return Atomics.compareExchange(state.header, PENDING, 1, 0) === 1;
}

/** True while a watcher is doing the reading for this run. */
export const watcherActive = (): boolean =>
  shared?.watcher != null && Atomics.load(shared.header, WATCHING) === 1;

/** Whatever the watcher took off the terminal and has not handed back. */
export function takeGuardedKeys(): string {
  const state = shared;

  if (!state) return '';

  const taken = Atomics.exchange(state.header, KEYLEN, 0);

  return taken > 0
    ? Buffer.from(state.keys.subarray(0, taken)).toString('binary')
    : '';
}

/** $LMN_GUARD_TRACE names a file to log what the guard did, and when. */
export function trace(what: string): void {
  const file = process.env.LMN_GUARD_TRACE;

  if (file) {
    fs.appendFileSync(file, Date.now() + ' ' + what + '\n');
  }
}

/** The matcher: takes a request, answers with a result. */
const MATCHER = `
const { workerData } = require('worker_threads');
const header = new Int32Array(workerData.memory, 0, ${HEADER});
// the WHOLE payload, not a fixed size: the buffer grows for a subject
// that does not fit, and a view left at the old size would hand this
// a length it cannot reach - truncated JSON, and a throw where a
// reply was owed
const room = workerData.memory.byteLength - ${HEADER} * 4 - ${KEYROOM};
const payload = new Uint8Array(workerData.memory, ${HEADER} * 4, room);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

for (;;) {
  Atomics.wait(header, ${STATE}, ${IDLE});

  if (Atomics.load(header, ${STATE}) !== ${REQUEST}) continue;

  let answer;

  // everything inside, the parse included. A throw out here would end
  // the thread with an 'error' event, and that event is a callback on
  // the loop of a thread that is blocked waiting for this reply - so
  // nobody would ever run it, and the wait would never end
  try {
    const length = Atomics.load(header, ${LENGTH});
    const { source, flags, text, test } = JSON.parse(
      decoder.decode(payload.subarray(0, length)));
    const re = new RegExp(source, flags);

    if (test) {
      answer = { test: re.test(text) };
    } else {
      const m = re.exec(text);
      answer = m === null ? { match: null }
        : { match: { index: m.index, groups: Array.from(m) } };
    }
  } catch (error) {
    answer = { failed: String(error) };
  }

  // the watcher may have got there first; whoever is second leaves
  // the answer alone
  const bytes = encoder.encode(JSON.stringify(answer));
  payload.set(bytes.subarray(0, room));
  Atomics.store(header, ${LENGTH}, Math.min(bytes.length, room));

  if (Atomics.compareExchange(header, ${STATE}, ${REQUEST}, ${REPLY}) ===
      ${REQUEST}) {
    Atomics.notify(header, ${STATE});
  }
}
`;

/**
 * The watcher: reads the terminal while a match is out, and says so
 * when one has been out too long.
 *
 * It writes with fs.writeSync rather than console: a worker's stdout
 * is forwarded through the PARENT's event loop, which is the very
 * thing that is not running.
 */
const WATCHER = `
const fs = require('fs');
const { workerData } = require('worker_threads');
const header = new Int32Array(workerData.memory, 0, ${HEADER});
const keys = new Uint8Array(workerData.memory,
  ${HEADER} * 4 + ${PAYLOAD}, ${KEYROOM});
const buf = Buffer.alloc(64);
const notice = Buffer.from(workerData.notice, 'binary');
const clearRow = Buffer.from(workerData.clearRow, 'binary');
const intr = workerData.intr;

const keep = bytes => {
  const at = Atomics.load(header, ${KEYLEN});
  const room = Math.min(bytes.length, ${KEYROOM} - at);

  if (room > 0) {
    keys.set(bytes.subarray(0, room), at);
    Atomics.store(header, ${KEYLEN}, at + room);
  }
};

for (;;) {
  // nothing is out: sleep until something is
  Atomics.wait(header, ${STATE}, ${IDLE});

  const started = Date.now();
  const sayAt = Atomics.load(header, ${NOTICE_IN});
  let said = false;

  while (Atomics.load(header, ${STATE}) === ${REQUEST}) {
    let n = 0;

    try {
      n = fs.readSync(workerData.fd, buf, 0, 64, null);
    } catch (error) {
      if (error.code !== 'EAGAIN') n = 0;
    }

    if (n > 0) {
      const text = buf.toString('binary', 0, n);
      const byIntr = text.includes('\\x03') || (intr && text.includes(intr));
      const stop = byIntr || Atomics.load(header, ${MODE}) === 1;

      keep(buf.subarray(0, n));

      // a key pressed at a message answers it, and the answer should
      // show now rather than when the work happens to end. The row is
      // cleared from here because here is the only thread awake; the
      // main one dismisses the message properly when it picks the key
      // up, and by then this row is already blank
      if (!stop && Atomics.compareExchange(header, ${MSG_UP}, 1, 0) === 1) {
        fs.writeSync(1, clearRow);
      }

      if (stop) {
        Atomics.store(header, ${BY_INTR}, byIntr ? 1 : 0);

        // a match is out: end it. Nothing out: leave the verdict where
        // the scan between matches will find it, which is a shared
        // word rather than a syscall of its own
        if (Atomics.compareExchange(
          header, ${STATE}, ${REQUEST}, ${ABORT}) === ${REQUEST}) {
          Atomics.notify(header, ${STATE});
        } else {
          Atomics.store(header, ${PENDING}, 1);
        }
      }
    }

    // not while a message is holding the row: that message is waiting
    // for an answer, and talking over it loses the question. It goes
    // out the moment the row is free, however long ago the two
    // seconds passed
    if (!said && Atomics.load(header, ${STATE}) === ${REQUEST} &&
        Date.now() - started >= sayAt &&
        Atomics.load(header, ${MSG_UP}) === 0) {
      said = true;
      Atomics.store(header, ${NOTICED}, 1);
      fs.writeSync(1, notice);
    }

    // the sleep between reads; it ends early when the run does
    Atomics.wait(header, ${WATCHING}, 1, 1);
  }
}
`;

interface Shared {
  matcher: Worker;
  watcher: Worker | null;
  header: Int32Array;
  payload: Uint8Array;
  keys: Uint8Array;
}

let shared: Shared | null = null;

/** What the watcher writes after NOTICE_MS, styled by the caller. */
let noticeBytes = '';

/** What clears the bottom row, for the key that dismisses a message. */
let clearBytes = '';

/** The fd the watcher reads, and the --intr char to look for. */
let watchFd: number | null = null;
let intrChar = '';

/**
 * Tells the guard how to watch the terminal, and what to say when a
 * match has been out too long.
 *
 * The styling belongs to the caller - this is the same message the
 * line-number walk writes, and it should not be spelled twice - but
 * the writing has to happen on a thread that is awake, so the bytes
 * are handed over rather than a callback.
 */
export function watchWith(fd: number | null, intr: string, notice: string,
  clearRow: string): void {
  if (fd === watchFd && intr === intrChar && notice === noticeBytes &&
      clearRow === clearBytes) {
    return;
  }

  watchFd = fd;
  intrChar = intr;
  noticeBytes = notice;
  clearBytes = clearRow;

  // the watcher carries these; a new set means a new watcher
  if (shared?.watcher) {
    void shared.watcher.terminate();
    shared.watcher = null;
  }
}

/** Builds whichever workers are missing, with room for this request. */
function ensureWorkers(need: number): Shared {
  if (shared && shared.payload.length < need) killWorkers();

  if (!shared) {
    let room = PAYLOAD;
    while (room < need) room *= 2;

    const memory = new SharedArrayBuffer(HEADER * 4 + room + KEYROOM);
    const header = new Int32Array(memory, 0, HEADER);
    const payload = new Uint8Array(memory, HEADER * 4, room);
    const keys = new Uint8Array(memory, HEADER * 4 + room, KEYROOM);

    const matcher = new Worker(MATCHER, { eval: true,
      workerData: { memory } });

    // a last resort only. This runs on the event loop, and the thread
    // that waits for a reply is not running one - so it fires for a
    // worker that dies BETWEEN requests, and never for one that dies
    // during the wait it would rescue. The matcher not throwing is
    // what actually keeps that wait finite
    matcher.on('error', error => {
      lastFailure = String(error);

      if (Atomics.compareExchange(header, STATE, REQUEST, ABORT) === REQUEST) {
        Atomics.notify(header, STATE);
      }
    });

    matcher.unref();
    shared = { matcher, watcher: null, header, payload, keys };
  }

  if (!shared.watcher && watchFd !== null) {
    Atomics.store(shared.header, WATCHING, 1);

    shared.watcher = new Worker(WATCHER, {
      eval: true,
      workerData: {
        memory: shared.header.buffer,
        fd: watchFd,
        intr: intrChar,
        notice: noticeBytes,
        clearRow: clearBytes,
      },
    });

    shared.watcher.on('error', error => { lastFailure = String(error); });
    shared.watcher.unref();
  }

  return shared;
}

/** Kills both, for a match that must stop or a buffer that must grow. */
function killWorkers(): void {
  if (!shared) return;

  void shared.matcher.terminate();
  if (shared.watcher) void shared.watcher.terminate();
  shared = null;
}

/** Drops the workers, for a session that is closing down. */
export function endJsRegexGuard(): void {
  killWorkers();
}

let aborted = false;
let noticed = false;
let byInterrupt = false;

/** An interrupt that ended a match, still owed to whoever asked for it. */
let sawInterrupt = false;

/** Whatever a worker said on its way down, for a caller that asks. */
let lastFailure = '';

/** The last worker error, empty when there has not been one. */
export const jsRegexFailure = (): string => lastFailure;

/** Whether the last guarded call was interrupted rather than answered. */
export const jsRegexAborted = (): boolean => aborted;

/** Whether the last guarded call announced itself before finishing. */
export const jsRegexNoticed = (): boolean => noticed;

/**
 * Whether an interrupt stopped it, rather than some other key.
 *
 * The watcher makes that call, and it is the only one who can: the
 * poll on this side never runs while a watcher is attached, so the
 * flag it would have set stays as it was. An abort that read as "some
 * other key" is why ^C stopped raising the offer to try POSIX.
 */
export const jsRegexAbortedByInterrupt = (): boolean => byInterrupt;

/** Clears both, at the start of a new search. */
export function clearJsRegexAbort(): void {
  aborted = false;
  noticed = false;
  byInterrupt = false;
  sawInterrupt = false;
}

/**
 * Runs one match in the matcher, waiting until it or the watcher says
 * otherwise.
 *
 * @param request - Pattern, flags, subject, and which call to make.
 * @param anyKey - True when any keypress should end the wait, not
 *   only an interrupt: a repaint runs behind whatever the user does
 *   next, a search is what they are waiting for.
 * @param fallbackPoll - Used only when there is no terminal to watch,
 *   in slices, because a wait with nothing to wake it never returns.
 * @returns The worker's answer, and any keys the watcher took.
 */
export function guardedMatch(
  request: { source: string, flags: string, text: string, test: boolean },
  anyKey: boolean,
  fallbackPoll?: () => boolean,
  messageUp = false
): { answer: { test?: boolean,
  match?: { index: number, groups: string[] } | null } | null,
  keys: string } {
  const now = Date.now();

  // the two seconds are counted from the first match of this burst,
  // not from whenever a run was last declared. A search does not
  // always open one, so the clock could be left over from a render
  // minutes ago - already past two seconds, and the notice arrived
  // with no grace at all
  if (runStarted === 0) runStarted = now;

  // already given up on: the rest of the frame is not worth another
  // wait, and certainly not another keypress each
  if (runAbandoned) {
    trace('  skip (run abandoned)');
    return { answer: null, keys: '' };
  }

  const bytes = Buffer.from(JSON.stringify(request));
  const state = ensureWorkers(bytes.length);

  trace('  call anyKey=' + anyKey + ' watcher=' + (state.watcher !== null) +
    ' len=' + request.text.length +
    ' noticeIn=' + Math.max(0, NOTICE_MS - (now - runStarted)));

  state.payload.set(bytes);
  Atomics.store(state.header, LENGTH, bytes.length);
  Atomics.store(state.header, KEYLEN, 0);
  Atomics.store(state.header, NOTICED, 0);

  // what is left of the run's two seconds, not this call's: the
  // notice belongs to the work as a whole
  Atomics.store(state.header, NOTICE_IN,
    Math.max(0, NOTICE_MS - (now - runStarted)));
  Atomics.store(state.header, MODE, anyKey ? 1 : 0);
  Atomics.store(state.header, MSG_UP, messageUp ? 1 : 0);
  Atomics.store(state.header, BY_INTR, 0);
  Atomics.store(state.header, STATE, REQUEST);
  Atomics.notify(state.header, STATE);

  // with a watcher there is nothing to wake up FOR: it sleeps until
  // the answer or the interrupt arrives. Without one - no terminal,
  // so no interrupt to arrive - it falls back to slices, since a wait
  // nothing can end is a hang
  if (state.watcher) {
    Atomics.wait(state.header, STATE, REQUEST);
  } else {
    while (Atomics.load(state.header, STATE) === REQUEST) {
      Atomics.wait(state.header, STATE, REQUEST, 20);

      if (fallbackPoll?.()) {
        Atomics.store(state.header, STATE, ABORT);
        break;
      }
    }
  }

  const taken = Atomics.load(state.header, KEYLEN);
  const keys = taken > 0
    ? Buffer.from(state.keys.subarray(0, taken)).toString('binary')
    : '';

  noticed = Atomics.load(state.header, NOTICED) === 1;
  byInterrupt = Atomics.load(state.header, BY_INTR) === 1;

  trace('  end state=' + Atomics.load(state.header, STATE) +
    ' keys=' + JSON.stringify(keys) + ' noticed=' + noticed +
    ' ms=' + (Date.now() - now));

  if (Atomics.load(state.header, STATE) === ABORT) {
    aborted = true;
    runAbandoned = true;
    if (byInterrupt) sawInterrupt = true;
    killWorkers();
    return { answer: null, keys };
  }

  const length = Atomics.load(state.header, LENGTH);
  const text = Buffer.from(state.payload.subarray(0, length)).toString();

  Atomics.store(state.header, STATE, IDLE);
  Atomics.notify(state.header, STATE);

  return { answer: JSON.parse(text), keys };
}
