import v8 from 'v8';

import { session, deriveContent, shellReserveLines } from '../session';

import { config, mode } from '../config';

import { opt, optSqueeze, onTrimBufSpace } from '../options';

import { render, calculateEOF } from '../helpers';

import { transformContent, maxSubRow } from '../lines/helpers';

import { files, revealSize, pipeDraining } from './files';

import { shiftMarkRows } from './jumping';

import { follow } from './follow';

import { PipeDecoder } from './charset';

/**
 * The still-delivering input, like og's non-seekable ch file: the
 * entry paths set it before contentPager attaches it.
 */
export const pipeInput = {
  source: null as NodeJS.ReadableStream | null,
  decoder: null as PipeDecoder | null,
};

// og recycles pipe buffers when allocation fails; v8 aborts instead,
// so nearing the heap ceiling is our failed-allocation moment
const HEAP_LIMIT = v8.getHeapStatistics().heap_size_limit;

const heapPressed = (): boolean =>
  process.memoryUsage().heapUsed > HEAP_LIMIT * 0.7;

// how many lines past the view a pipe reads before pausing, like
// og's ch reading on demand
const PIPE_AHEAD = 1000;

// a runtime -b or -B change re-bounds the pipe like og's opt_b
// calling ch_setbufspace: existing data stays (og recycles only
// at the next allocation), new arrivals shed against the bound
onTrimBufSpace(() => {
  if (session.pipeStream) session.pipeBudget = pipeBudgetBytes();
});

export function pipeRetained(): number {
  const entry = files.list[files.index];
  if (!entry) return 0;
  return entry.size - (entry.discardedBytes ?? 0);
}

/** Wires the still-delivering pipe into the session. */
/**
 * The -b bound in bytes, like og's ch_setbufspace: the kilobytes
 * round up to 8K LBUFSIZE buffers, at least one; unlimited while
 * -B keeps autobuf on or the space is negative.
 */
function pipeBudgetBytes(): number {
  if (opt.autoBuffers || opt.bufSpace < 0) return Infinity;
  return Math.max(Math.ceil(opt.bufSpace / 8), 1) * 8 * 1024;
}

export function attachPipe(): void {
  const stream = pipeInput.source!;
  const decoder = pipeInput.decoder!;
  session.pipeStream = stream;

  // -B bounds a pipe to the -b buffer space, like og's maxbufs
  // applying to non-seekable input when autobuf is off
  session.pipeBudget = pipeBudgetBytes();

  let chunks = 0;

  const onData = (chunk: Buffer): void => {
    growPipe(decoder.push(chunk));

    if (pipeRetained() > session.pipeBudget) {
      shedPipe();
    } else if (session.pipeBudget === Infinity && (++chunks & 31) === 0 &&
               heapPressed()) {
      // og's allocation failure moment: from here on the oldest
      // data recycles away instead of the process dying (ch_addbuf
      // falling back to the tail buffer)
      session.pipeBudget = Math.max(pipeRetained() / 2, 64 * 1024 * 1024);
      shedPipe();
    }

    // og reads a pipe only on demand: pause once far enough ahead
    // of the view, which blocks the writer (`yes` stops producing)
    if (!session.pipeDrainTo &&
        session.content.length - config.row > config.window + PIPE_AHEAD) {
      session.pipePaused = true;
      stream.pause();
    }
  };

  const onEnd = (): void => {
    growPipe(decoder.flush());

    // no more data will come, but og's ch_length stays unknown
    // until a read returns EOI: a drain or follow is such a read,
    // and so was the screen fill if the input ran out mid-screen
    const entry = files.list[files.index];
    if (entry) entry.streaming = false;

    if (session.pipeDrainTo || follow.active ||
        (!mode.HELP && screenPastEnd())) {
      revealSize();
    }

    calculateEOF(session.content);

    const jump = session.pipeDrainTo;
    session.pipeDrainTo = null;
    pipeDraining.active = false;

    if (jump) jump();

    if (!session.exited && !session.shellPause) render(session.content, session.buffer);
  };

  stream.on('data', onData);
  stream.on('end', onEnd);
  stream.resume();

  session.detachPipe = () => {
    stream.off('data', onData);
    stream.off('end', onEnd);

    // quitting closes the pipe so the writer sees EPIPE, like og
    (stream as unknown as { destroy?: () => void }).destroy?.();

    session.pipeStream = null;
    session.pipeDrainTo = null;
    pipeDraining.active = false;
    session.detachPipe = () => {};
  };
}

/**
 * Reads the pipe until the content exceeds one screen or it ends,
 * growing the session silently, like og's get_one_screen blocking
 * in forw_line before the terminal initializes.
 */
export function pipeOneScreenProbe(): Promise<void> {
  return new Promise(resolve => {
    const stream = pipeInput.source!;
    const decoder = pipeInput.decoder!;

    const overOneScreen = (): boolean => {
      let total = 0;

      for (const line of session.content) {
        total += maxSubRow(line) + 1;
        if (total + shellReserveLines() > config.window) return true;
      }

      return false;
    };

    const finish = (): void => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      session.pipeProbing = false;

      // a screenful is already buffered, so the initial fill's
      // arrival-by-arrival painting is over before it begins
      session.pipeFirstFill = session.content.length < config.window - 1;
      resolve();
    };

    const onData = (chunk: Buffer): void => {
      growPipe(decoder.push(chunk));

      if (overOneScreen()) {
        stream.pause();
        finish();
      }
    };

    const onEnd = (): void => {
      growPipe(decoder.flush());

      const entry = files.list[files.index];
      if (entry) entry.streaming = false;
      revealSize();
      finish();
    };

    session.pipeProbing = true;

    if (overOneScreen()) {
      finish();
      return;
    }

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.resume();
  });
}

/**
 * True when the current screen extends past the end of the input:
 * og's fill requested window-1 rows, so the input ending before
 * they arrived means a read already returned EOI.
 */
function screenPastEnd(): boolean {
  let rows = -config.subRow;

  for (let r = config.row; r < session.content.length; r++) {
    rows += maxSubRow(session.content[r]) + 1;
    if (rows >= config.window - 1) return false;
  }

  return true;
}

/** Appends decoded pipe lines to the session, like ch growing. */
function growPipe(raw: string[]): void {
  if (!raw.length) return;

  const entry = files.list[files.index];

  session.fullContent.push(...raw);

  // a pipe's byte count grows with the data, for %b and = (one
  // newline per line, like byteOffset); a streamed file's size is
  // already known from stat, like og's CH_CANSEEK ch_length
  if (entry && !entry.sizeKnown) {
    for (const line of raw) entry.size += Buffer.byteLength(line) + 1;
  }

  if (session.lastFilter) {
    // an active & filter re-derives over the grown input
    if (mode.HELP) {
      session.prevContent = deriveContent();
    } else {
      session.content = deriveContent();
    }
  } else {
    const add = transformContent(raw);
    const target = mode.HELP ? session.prevContent : session.content;

    // the -s squeeze run at the boundary keeps one blank line
    if (optSqueeze() && target[target.length - 1] === '') {
      while (add.length && add[0] === '') add.shift();
    }

    target.push(...add);
  }

  if (mode.HELP) return;

  calculateEOF(session.content);

  // sitting at the old end of the data is no longer end-of-file
  if (mode.EOF && (config.row < config.endRow ||
      (config.row === config.endRow &&
        config.subRow < config.endSubRow))) {
    mode.EOF = false;
  }

  // og displays lines only while the first screenful is filling;
  // once it completes, new pipe data never repaints an idle screen
  if (session.pipeFirstFill && !session.pipeProbing && !session.exited && !session.shellPause &&
      !session.pipeDrainTo) {
    if (session.content.length >= config.window - 1) session.pipeFirstFill = false;
    render(session.content, session.buffer);
  }
}

/**
 * Recycles the oldest half of the buffered pipe data, like og's
 * ch_addbuf failure reusing the tail buffer: the early lines become
 * unreachable (marks there are lost, like og's unreadable blocks),
 * while line numbers and byte offsets keep counting from the true
 * start via the entry's discarded bases.
 */
function shedPipe(): void {
  if (mode.HELP) return;

  const entry = files.list[files.index];
  if (!entry || !entry.streaming) return;

  const drop = Math.floor(session.fullContent.length / 2);
  if (drop < 1) return;

  let bytes = 0;
  for (let i = 0; i < drop; i++) {
    bytes += Buffer.byteLength(session.fullContent[i]) + 1;
  }

  session.fullContent.splice(0, drop);
  entry.discardedLines = (entry.discardedLines ?? 0) + drop;
  entry.discardedBytes = (entry.discardedBytes ?? 0) + bytes;

  let dropped = drop;

  if (session.lastFilter || optSqueeze()) {
    // squeezing and filters break the 1:1 raw-to-display mapping
    const before = session.content.length;
    session.content = deriveContent();
    dropped = Math.max(before - session.content.length, 0);
  } else {
    session.content.splice(0, drop);
  }

  config.row = Math.max(config.row - dropped, 0);
  if (config.attnRow >= 0) {
    config.attnRow = config.attnRow >= dropped
      ? config.attnRow - dropped
      : -1;
  }

  shiftMarkRows(dropped);
  calculateEOF(session.content);
}

/** Resumes a paused pipe when the view nears the buffered end. */
export function pipeDemand(): void {
  if (!session.pipeStream || !session.pipePaused) return;

  if (session.content.length - config.row < config.window + PIPE_AHEAD / 2) {
    session.pipePaused = false;
    session.pipeStream.resume();
  }
}

/**
 * G and % on a streaming pipe read to end-of-file first, like og's
 * ch_end_seek loop; the interrupt key cancels it. og's G runs with
 * a blank command line, % with ierror's "Determining length" note.
 *
 * @param jump - The jump to run once the pipe ends.
 * @param note - The ierror text shown while reading (og's %).
 * @param cancelMessage - The message an interrupt reports.
 * @returns True when the jump waits for the pipe to drain.
 */
export function pipeDrain(
  jump: () => void,
  note: string,
  cancelMessage: string
): boolean {
  const entry = files.list[files.index];
  if (!session.pipeStream || !entry || !entry.streaming || mode.HELP) {
    return false;
  }

  session.pipeDrainTo = jump;
  pipeDraining.active = true;
  pipeDraining.note = note;
  pipeDraining.cancelMessage = cancelMessage;
  session.pipePaused = false;
  session.pipeStream.resume();
  return true;
}
