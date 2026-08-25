import fs from 'fs';
import { Readable } from 'stream';

import v8 from 'v8';

import { session, deriveContent, shellReserveLines } from '../state/session';

import { config, mode } from '../state/config';

import { opt, optSqueeze, optQuitOnIntr, optExitFollowOnClose,
  onTrimBufSpace, hook } from '../options';

import { render, calculateEOF, markBareRepaint, markClearHome,
  ringBell } from '../helpers';

import { lineForward } from './moving';

import { searchInterrupted } from './searching';

import { appendLogLines } from './misc';

import { consumeInterrupt, setKeyboardRaw } from '../tty/keyboard';

import { startupErrors } from '../startup/startup';

import { CLEAR_LINE, INVERSE_ON, INVERSE_OFF } from '../state/constants';

import { transformContent, maxSubRow } from '../lines/helpers';

import { files, revealSize, pipeDraining, pendingScroll, sizeIsKnown }
  from './files';

import { shiftMarkRows } from './jumping';

import { follow } from './follow';

import { POLLHUP_EXITS_F } from '../tty/platform';

import { PipeDecoder } from './charset';

import { envDelay } from '../startup/environment';

/**
 * The still-delivering input, like less's non-seekable ch file: the
 * entry paths set it before contentPager attaches it.
 */
export const pipeInput = {
  source: null as Readable | null,
  decoder: null as PipeDecoder | null,
};

// less recycles pipe buffers when allocation fails; v8 aborts instead,
// so nearing the heap ceiling is our failed-allocation moment
const HEAP_LIMIT = v8.getHeapStatistics().heap_size_limit;

const heapPressed = (): boolean =>
  process.memoryUsage().heapUsed > HEAP_LIMIT * 0.7;

// how many lines past the view a pipe reads before pausing, like
// less's ch reading on demand
const PIPE_AHEAD = 1000;

// a runtime -b or -B change re-bounds the pipe like less's opt_b
// calling ch_setbufspace: existing data stays (less recycles only
// at the next allocation), new arrivals shed against the bound
onTrimBufSpace(() => {
  if (session.pipeStream) session.pipeBudget = pipeBudgetBytes();
});

export function pipeRetained(): number {
  const entry = files.list[files.index];
  if (!entry) return 0;
  return entry.size - (entry.discardedBytes ?? 0);
}

/**
 * True while less's initial forw() would still be blocked reading the
 * input: the first screenful is not painted and the length is not
 * learned. Keys arriving now queue like less's check_poll ungetting
 * tty chars, and the prompt row stays unwritten.
 */
export function pipeFilling(): boolean {
  return session.pipeStream !== null && session.pipeFirstFill &&
    !session.pipeProbing && !sizeIsKnown();
}

// less's waiting_for_data_delay: a fill stalled this long (or poked by
// a typed key) shows wait_message() once, via ixerror (ch.c:331)
let stallTimer: ReturnType<typeof setTimeout> | null = null;

function armStallTimer(): void {
  if (stallTimer) clearTimeout(stallTimer);

  stallTimer = setTimeout(() => {
    stallTimer = null;

    // any blocked pipe read stalls into the message — the initial
    // fill, a G/% drain and a blocked forward move alike (ch.c
    // shows it on the first READ_AGAIN, one poll timeout without
    // data)
    if ((pipeFilling() || session.pipeDrainTo || pendingScroll.rows) &&
        !session.pipeWaiting && !session.exited) {
      session.pipeWaiting = true;
      render(session.content, session.buffer);
    }
  }, envDelay('LESS_DATA_DELAY', 4000));

  stallTimer.unref?.();
}

function clearStallTimer(): void {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = null;
}

/**
 * The fill is over (screenful, EOI, or an interrupt): replay the
 * keys less would now pull from its ungot queue.
 */
function finishFill(): void {
  clearStallTimer();
  session.pipeWaiting = false;

  const keys = session.fillKeys.splice(0);
  for (const data of keys) session.feedKeys(data);
}

/**
 * The --intr char (or ^C) breaks out of the wait, like less's
 * check_poll returning READ_INTR: the fill stops, the queued keys
 * are discarded (getcc_clear), and less lands at the bottom of the
 * buffered data — clear + home, null-line tildes above BOF, the
 * partial content bottom-anchored (jump_loc's !full_screen lclear
 * + forw painting nblank lines first).
 */
export function abortPipeFill(): void {
  session.pipeFirstFill = false;
  session.fillKeys.length = 0;
  clearStallTimer();
  session.pipeWaiting = false;

  mode.INIT = false;
  config.row = 0;
  config.subRow = 0;

  let shown = 0;
  for (const line of session.content) {
    shown += maxSubRow(line) + 1;
    if (shown >= config.window - 1) break;
  }
  config.blankTop = Math.max(config.window - 1 - shown, 0);

  markBareRepaint(CLEAR_LINE);
  markClearHome();
  render(session.content, session.buffer);
}

/** Wires the still-delivering pipe into the session. */
/**
 * The -b bound in bytes, like less's ch_setbufspace: the kilobytes
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

  // the first chunk may already hold a screenful: less's initial
  // forw(sc_height-1) counts forw_line screen rows and returns once
  // they are available, so the fill is not pending
  session.pipeFirstFill = screenPastEnd();

  // -B bounds a pipe to the -b buffer space, like less's maxbufs
  // applying to non-seekable input when autobuf is off
  session.pipeBudget = pipeBudgetBytes();

  let chunks = 0;

  const onData = (chunk: Buffer): void => {
    growPipe(decoder.push(chunk));

    if (pipeRetained() > session.pipeBudget) {
      shedPipe();
    } else if (session.pipeBudget === Infinity && (++chunks & 31) === 0 &&
               heapPressed()) {
      // less's allocation failure moment: from here on the oldest
      // data recycles away instead of the process dying (ch_addbuf
      // falling back to the tail buffer)
      session.pipeBudget = Math.max(pipeRetained() / 2, 64 * 1024 * 1024);
      shedPipe();
    }

    // less reads a pipe only on demand: pause once far enough ahead
    // of the view, which blocks the writer (`yes` stops producing)
    if (!session.pipeDrainTo &&
        session.content.length - config.row > config.window + PIPE_AHEAD) {
      session.pipePaused = true;
      stream.pause();
    }

    // a draining read's 4s stall window restarts with each chunk
    // (less's poll timeout is per read); a message already shown
    // stays, like less never repainting mid-drain
    if (session.pipeDrainTo) armStallTimer();
  };

  const onEnd = (): void => {
    growPipe(decoder.flush());

    // no more data will come, but less's ch_length stays unknown
    // until a read returns EOI: a drain or follow is such a read,
    // and so was the screen fill if the input ran out mid-screen —
    // except a follow that --exit-follow-on-close will end, whose
    // READ_INTR fires on the bare POLLHUP before any read could
    // return 0 (os.c check_poll, Linux only), leaving the length
    // unknown; elsewhere less's F reads the 0 and learns it
    const entry = files.list[files.index];
    if (entry) entry.streaming = false;

    if (session.pipeDrainTo || pendingScroll.rows ||
        (follow.active
          ? !(optExitFollowOnClose() && POLLHUP_EXITS_F)
          : !mode.HELP && screenPastEnd())) {
      revealSize();
    }

    // a blocked forward move ends at the EOI, like less's forw_line
    // returning NULL and breaking the loop: with no line painted
    // forw's nlines == 0 rings the eof bell
    if (pendingScroll.rows) {
      if (!pendingScroll.moved) ringBell('eof');
      pendingScroll.rows = 0;
      pendingScroll.moved = false;
    }

    calculateEOF(session.content);

    const jump = session.pipeDrainTo;
    session.pipeDrainTo = null;
    pipeDraining.active = false;

    if (jump) jump();

    session.pipeWaiting = false;

    if (!session.exited && !session.shellPause) {
      render(session.content, session.buffer);
    }

    // end-of-input completes less's blocked read: queued keys process
    finishFill();
  };

  stream.on('data', onData);
  stream.on('end', onEnd);
  stream.resume();

  // the input may have been consumed to its end before this attach
  // (a startup error gate held the session while the writer
  // finished): 'end' has already been emitted and will not repeat,
  // so run its bookkeeping now — less's reads at EOF would learn this
  // naturally on the first forward past the data
  if (stream.readableEnded) {
    onEnd();
  }

  if (pipeFilling()) armStallTimer();

  session.detachPipe = () => {
    clearStallTimer();
    stream.off('data', onData);
    stream.off('end', onEnd);

    // quitting closes the pipe so the writer sees EPIPE, like less
    (stream as unknown as { destroy?: () => void }).destroy?.();

    session.pipeStream = null;
    session.pipeDrainTo = null;
    pipeDraining.active = false;
    session.detachPipe = () => {};
  };
}

/**
 * --file-size reads the whole pipe before the terminal initializes,
 * like edit() calling scan_eof under want_filesize: less blocks the
 * first paint until the length is known, painting "Determining
 * length of file" on the main screen once the scan runs LONGTIME
 * (2s); ^X or ^C abandons the scan and pages with it unknown.
 */
export function pipeFullProbe(): Promise<void> {
  return new Promise(resolve => {
    const stream = pipeInput.source!;
    const decoder = pipeInput.decoder!;
    let messaged = false;
    let ticks = 0;

    // less's raw mode is on from startup, so ^C reaches the scan as
    // an interrupt instead of killing the process; the keyboard
    // stays paused, leaving its bytes to the readSync poll
    setKeyboardRaw(true);

    // huge pipes recycle their oldest data while scanning, like
    // less's ch buffers under -B during scan_eof
    session.pipeBudget = pipeBudgetBytes();

    const timer = setTimeout(() => {
      messaged = true;
      fs.writeSync(1, '\r' + CLEAR_LINE + INVERSE_ON +
        'Determining length of file... (interrupt to abort)' +
        INVERSE_OFF);
    }, 2000);
    timer.unref?.();

    const finish = (): void => {
      clearTimeout(timer);
      // less clears its ierror line before the alt screen enters
      if (messaged) fs.writeSync(1, '\r' + CLEAR_LINE);
      stream.off('data', onData);
      stream.off('end', onEnd);
      session.pipeProbing = false;
      session.pipeFirstFill = screenPastEnd();
      resolve();
    };

    const onData = (chunk: Buffer): void => {
      growPipe(decoder.push(chunk));

      if (pipeRetained() > session.pipeBudget) {
        shedPipe();
      } else if (session.pipeBudget === Infinity && (++ticks & 31) === 0 &&
                 heapPressed()) {
        session.pipeBudget = Math.max(pipeRetained() / 2, 64 * 1024 * 1024);
        shedPipe();
      }

      // ABORT_SIGS in less's scan_eof loop: stop where we are; an
      // interrupt after the message showed turns line numbers off
      // (abort_delayed_msg) — the pre-init error prints plainly and
      // joins the startup RETURN gate, like less's errmsgs check
      if ((ticks & 7) === 0 && searchInterrupted()) {
        // the aborting ^C is less's consumed signal, never a key —
        // except under -K, where less's psignals quits on it (the
        // requeued byte reaches the key loop and quits there); the
        // pending S_INTERRUPT clears the startup gate's key too
        if (!optQuitOnIntr()) {
          consumeInterrupt();
          session.intrPending = true;
        }

        if (messaged) {
          opt.linenums = 0;
          fs.writeSync(1,
            '\r' + CLEAR_LINE + 'Line numbers turned off\n');
          startupErrors.count++;
          messaged = false;
        }

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
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.resume();
  });
}

// a runtime --file-size toggle, like less's opt_filesize: scan_eof
// runs only while a file is open and its length is unknown
// (`curr_ifile != NULL && ch_length() == NULL_POSITION`) — a
// completed input reveals from its buffers at once, and a
// still-delivering pipe drains
hook.scanFileSize = () => {
  const entry = files.list[files.index];
  if (!entry || entry.sizeKnown) return;

  if (!entry.streaming || !session.pipeStream) {
    revealSize();
    return;
  }

  if (pipeDraining.active) return;
  if (!pipeDrain(() => {}, '', '')) return;

  // the note appears once the drain runs less's LONGTIME
  const timer = setTimeout(() => {
    if (pipeDraining.active && session.pipeDrainTo) {
      pipeDraining.note = 'Determining length of file';
      render(session.content, session.buffer);
    }
  }, 2000);
  timer.unref?.();
};

/**
 * Reads the pipe until the content exceeds one screen or it ends,
 * growing the session silently, like less's get_one_screen blocking
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

      // a screenful of rows is already buffered, so the initial
      // fill's arrival-by-arrival painting is over before it begins
      session.pipeFirstFill = screenPastEnd();
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
 * less's fill requested window-1 rows, so the input ending before
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

  // less's ch.c writes the log file as each pipe buffer is read: an
  // active -o/s log receives streamed lines live, not just the
  // content buffered when it opened
  appendLogLines(raw);

  // a pipe's byte count grows with the data, for %b and = (one
  // newline per line, like byteOffset); a streamed file's size is
  // already known from stat, like less's CH_CANSEEK ch_length
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

  // a forward move blocked in less's forw_line advances as its lines
  // arrive, painting each one; a shown wait message stays put until
  // the move completes (less reprints it at every keypress, which on
  // a live keyboard reads as continuous)
  if (pendingScroll.rows && !session.pipeFirstFill &&
      !session.pipeDrainTo && !session.exited && !session.shellPause) {
    const owed = pendingScroll.rows;
    pendingScroll.rows = 0;

    lineForward(session.content, owed);

    const done = !pendingScroll.rows;

    if (!done) {
      pendingScroll.moved = true;
      if (session.pipeStream) armStallTimer();
    } else {
      session.pipeWaiting = false;
    }

    render(session.content, session.buffer);

    // the move completed: the prompt is back, and the queued keys
    // run like less's command loop draining the ungot chars
    if (done) {
      pendingScroll.moved = false;
      finishFill();
    }
  }

  // less displays lines only while the first screenful is filling;
  // once it completes, new pipe data never repaints an idle screen.
  // A shown wait message stays through arriving lines until the
  // fill completes (less reprints it at every keypress, which on a
  // live keyboard reads as continuous)
  if (session.pipeFirstFill && !session.pipeProbing && !session.exited &&
      !session.shellPause &&
      !session.pipeDrainTo) {
    // less's forw counts screen rows (forw_line per row, so wrapped
    // lines fill faster), not input lines
    const done = !screenPastEnd();

    if (done) {
      session.pipeFirstFill = false;
      session.pipeWaiting = false;
    }

    render(session.content, session.buffer);

    // the screenful completed the read: queued keys process now
    if (done) finishFill();
    else if (session.pipeStream) armStallTimer();
  }
}

/**
 * Recycles the oldest half of the buffered pipe data, like less's
 * ch_addbuf failure reusing the tail buffer: the early lines become
 * unreachable (marks there are lost, like less's unreadable blocks),
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

/**
 * Wakes the pipe for a forward move that clamped short, like less's
 * forw_line starting its blocking read: the stream resumes (it may
 * have paused on back-pressure) and a 4s data stall shows the wait
 * message on the cleared command line.
 */
export function startPendingScroll(): void {
  if (!session.pipeStream) {
    pendingScroll.rows = 0;
    pendingScroll.moved = false;
    return;
  }

  session.pipePaused = false;
  session.pipeStream.resume();
  armStallTimer();
}

/**
 * Abandons a blocked forward move, like less's READ_INTR breaking the
 * forw loop: queued keys are discarded (getcc_clear), and with no
 * line painted forw's nlines == 0 rings the eof bell.
 *
 * @param sigint - True for ^C, whose u_interrupt handler also bells.
 */
export function abortPendingScroll(sigint: boolean): void {
  if (sigint) ringBell();
  if (!pendingScroll.moved) ringBell('eof');

  pendingScroll.rows = 0;
  pendingScroll.moved = false;
  session.fillKeys.length = 0;
  clearStallTimer();
  session.pipeWaiting = false;

  render(session.content, session.buffer);
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
 * G and % on a streaming pipe read to end-of-file first, like less's
 * ch_end_seek loop; the interrupt key cancels it. less's G runs with
 * a blank command line, % with ierror's "Determining length" note.
 *
 * @param jump - The jump to run once the pipe ends.
 * @param note - The ierror text shown while reading (less's %).
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

  // the drain blocks reading like less's ch_end_seek: a 4s data
  // stall shows wait_message on the blank command line
  armStallTimer();
  return true;
}
