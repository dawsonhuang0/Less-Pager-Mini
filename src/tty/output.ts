import fs from 'fs';
/**
 * The one place bytes reach the terminal, like less's output.c.
 *
 * less never writes to the tty as it goes: every putchr appends to an
 * 8K obuf (output.c:117) and only flush() hands it over, at the few
 * points where the user is about to be kept waiting — cmd_exec before
 * a command runs (command.c:128), the prompts that read a key, and
 * term_deinit. Everything a command emits therefore lands in ONE
 * write, and the intermediate states are never drawn.
 *
 * Node's process.stdout.write on a tty is the opposite: synchronous
 * and unbuffered, one syscall per call, each one rendered. Writing
 * directly meant a single arrow key reached the terminal as five
 * separate writes — clear, "ESC", backspaces, "[", "B" — and the
 * terminal drew every one of them. A trackpad fling delivers hundreds
 * of those: the prompt flickers and the escape sequence is visible as
 * it forms. The bytes were right the whole time, which is why every
 * byte-level corpus passed; only the write BOUNDARIES were wrong.
 */

/** less's OUTBUF_SIZE (output.c). */
const OUTBUF_SIZE = 8192;

let obuf = '';
let scheduled = false;

/**
 * Appends to the output buffer, like less's putstr/putchr.
 *
 * A full buffer flushes itself, as less's putchr does — that bounds the
 * memory and is the only flush the caller does not choose.
 */
/**
 * Every byte the pager writes, for a terminal this repo cannot run on.
 *
 * $LMN_OUT_TRACE names a file and every putstr lands in it, escapes
 * spelled out; unset, it does nothing. The key trace answers "did the
 * keystroke arrive"; this answers the other half, "what did we draw" -
 * and the two together are the whole of what a terminal we cannot see
 * could be doing differently.
 */
function outTrace(text: string): void {
  const file = process.env.LMN_OUT_TRACE;

  if (!file) return;

  try {
    fs.appendFileSync(file, JSON.stringify(text) + '\n');
  } catch {
    // a trace that cannot be written is not worth an error
  }
}

export function putstr(text: string): void {
  if (!text) return;

  outTrace(text);

  // The buffer exists to control what a TERMINAL draws. Off a tty
  // there is nothing rendering intermediate states — a pipe or a file
  // sees the same bytes in the same order either way — so writing
  // through costs nothing and keeps the stream observable as it is
  // produced, which the cat loop and anything watching us rely on.
  if (!process.stdout.isTTY) {
    process.stdout.write(text);
    return;
  }

  obuf += text;
  if (obuf.length >= OUTBUF_SIZE) {
    flush();
    return;
  }

  // A paint is not always a keypress: a resize, a pipe delivering
  // more input, F following a growing file and the signal handlers
  // all repaint on their own, and less's output reaches the terminal at
  // each of them. Flushing only from the command loop left those
  // sitting here until the user happened to type something - a resize
  // kept the screen at the old size until a key arrived.
  //
  // So the buffer empties itself once the current turn of the event
  // loop is done. Everything one command writes is still ONE write,
  // because a command runs to completion inside a single turn;
  // flushing per PAINT instead split the echo from the frame and cost
  // four extra writes on a five-key burst.
  if (!scheduled) {
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      flush();
    });
  }
}

/**
 * Hands the buffer to the terminal, like less's flush().
 *
 * Call before anything that makes the user wait — reading a key,
 * running a command, leaving the pager. Cheap when empty, so an
 * over-eager call costs nothing but a branch; a MISSING one is what
 * hurts, since output then sits until the buffer fills.
 */
export function flush(): void {
  if (!obuf) return;

  const pending = obuf;
  obuf = '';
  process.stdout.write(pending);
}

// Nothing may be lost because a path forgot to flush: the cat loop,
// --help and -V all print and exit without ever reaching the command
// loop. Registered by the sink itself rather than at each of those
// exits, so a new one cannot get it wrong.
process.on('exit', flush);

/** Drops anything unwritten, for a teardown that must not emit. */
export function discardOutput(): void {
  obuf = '';
}

/** What is waiting to go out, for tests. */
export const pendingOutput = (): string => obuf;
