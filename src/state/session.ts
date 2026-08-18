import { Readable } from 'stream';

import { config, mode } from './config';

import { Config, Mode } from './interfaces';

import { transformContent } from '../lines/helpers';

import { filterLines } from '../features/searching';

import { lgetenv } from '../startup/environment';

/**
 * The pager session state, like less's globals spread across its C
 * files: one live session at a time, reset by resetSession() when a
 * pager entry starts. Module scope (rather than contentPager's
 * closure) keeps every field initialized before any key can arrive
 * and lets feature modules share the state without threading it.
 */
export const session = {
  /** The displayed lines; the help screen swaps them out. */
  content: [] as string[],
  /** The raw input lines; pipes and streamed files append here. */
  fullContent: [] as string[],

  /** The main content parked while the help screen displays. */
  prevContent: [] as string[],
  /** The main config parked while the help screen displays. */
  prevConfig: config as Config,
  /** The main mode flags parked while the help screen displays. */
  prevMode: mode as Record<Mode, boolean>,
  /** The SOURCE lines of the help page on screen: an O_REPAINT option
   *  toggled inside it re-transforms the page being looked at, and
   *  there is more than one (the commands help, --lesskey-help). */
  helpSource: [] as string[],

  /** The key sequence being dispatched. */
  key: '',
  /** Pending ESC count while a sequence collects. */
  escCount: 0,
  /** The digit-prefix buffer, like less's cmdbuf number. */
  buffer: [] as string[],

  /** Queued + commands for the first prompt (less's ungotten input). */
  pendingFirstCmds: [] as string[],
  /** The errmsgs gate's ungot key, ordinary input after the +cmds. */
  ungotStartKey: '',

  /** Waiting after !/| with the terminal handed to the shell. */
  shellPause: false as false | 'shell' | 'pager',
  /** True once the session ended; exit() resolves the main loop. */
  exited: false,
  exit: (() => {}) as () => void,

  /** True when the help screen IS the input (--help/-?), like less's
   *  dohelp FAKE_HELPFILE: q then quits instead of restoring. */
  startupHelp: false,

  /** Inside bracketed paste markers, text accepted (--no-paste). */
  pasting: false,
  /** Dropping pasted input until the end marker or the timeout. */
  ignoringPaste: false,
  ignoreStart: 0,

  /** The F command's polling timer. */
  followTimer: null as ReturnType<typeof setInterval> | null,
  /** A LESSOPEN edit warning waiting for RETURN before v runs. */
  pendingEditWarn: false,
  /** Collected keys of a partially matched lesskey user binding. */
  userSeq: '',

  /** The last --emouse click row, and hdrag/vdrag origins, like
   *  less's last_drag_x/y. */
  lastClickY: -1,
  lastDragX: -1,
  lastDragY: -1,

  /** The active & display filter over fullContent. */
  lastFilter: null as ((line: string) => boolean) | null,
  /** True when a & filter is hiding lines BELOW the bottom line.
   *  less's eof_displayed asks where the bottom line ends in the FILE
   *  (forwback.c:76), which is not the same question as mode.EOF -
   *  "is anything left to display". They differ only here. */
  filterHidesTail: false,
  /** less's soft_eof, as a flag: a forward read has RETURNED EOF since
   *  the filter was set (forwback.c:310), or a jump to the end walked
   *  back through it (jump.c:62). Either makes the bottom line count
   *  as the end even with a filtered tail behind it. Cleared when a
   *  new filter is set, like command.c:282. */
  softEofSeen: false,

  /** The process title to restore at exit. */
  processTitle: '',

  // the still-delivering pipe state (less's lazy non-seekable reads)
  pipeStream: null as Readable | null,
  pipePaused: false,
  pipeDrainTo: null as (() => void) | null,
  detachPipe: (() => {}) as () => void,

  /** Bytes of pipe data kept before the oldest recycle away: -B
   *  limits it to the -b buffer space up front (ch.c's maxbufs for
   *  pipes); otherwise the budget locks in at the first sign of
   *  heap pressure, less's failed-allocation moment. */
  pipeBudget: Infinity,

  /** less paints arriving lines only while the initial forw() fills
   *  the first screenful; afterwards an idle pager never repaints
   *  on new pipe data (F is the follow command). */
  pipeFirstFill: true,

  /** Keys typed during the initial fill wait like less's check_poll
   *  queuing tty chars (ungetcc_back) until the read completes. */
  fillKeys: [] as string[],
  /** The "Waiting for data..." state, less's waiting_for_data. */
  pipeWaiting: false,
  /** less's pending S_INTERRUPT: the next gate's ungot key clears. */
  intrPending: false,
  /** Feeds deferred keys back through the session's key handler. */
  feedKeys: (() => {}) as (data: string) => void,

  /** -F reads the pipe before any terminal init, like less's
   *  get_one_screen: nothing reaches the screen while it decides. */
  pipeProbing: false,
};

/**
 * Starts a fresh session over the given content, like a new less
 * process resetting its globals.
 */
export function resetSession(content: string[]): void {
  session.content = content;
  session.fullContent = content;
  session.prevContent = content;
  session.prevConfig = config;
  session.prevMode = mode;

  session.key = '';
  session.escCount = 0;
  session.buffer = [];

  session.pendingFirstCmds = [];
  session.ungotStartKey = '';

  session.shellPause = false;
  session.exited = false;
  session.exit = () => {};

  session.startupHelp = false;
  session.helpSource = [];

  session.pasting = false;
  session.ignoringPaste = false;
  session.ignoreStart = 0;

  session.followTimer = null;
  session.pendingEditWarn = false;
  session.userSeq = '';

  session.lastClickY = -1;
  session.lastDragX = -1;
  session.lastDragY = -1;

  session.lastFilter = null;
  session.filterHidesTail = false;
  session.softEofSeen = false;
  session.processTitle = process.title;

  session.pipeStream = null;
  session.pipePaused = false;
  session.pipeDrainTo = null;
  session.detachPipe = () => {};
  session.pipeBudget = Infinity;
  session.pipeFirstFill = true;
  session.pipeProbing = false;
  session.fillKeys = [];
  session.pipeWaiting = false;
  session.intrPending = false;
  session.feedKeys = () => {};
}

/**
 * Derives the display lines from the raw input: the & filter
 * applies first, then the -s/-x/-r transform pipeline.
 */
export function deriveContent(): string[] {
  if (!session.lastFilter) return transformContent(session.fullContent);

  // filters run in guarded slices; a catastrophic pattern (or an
  // interrupt) drops the filter instead of hanging the pager
  const filtered = filterLines(session.fullContent, session.lastFilter);

  if (!filtered) {
    session.lastFilter = null;
    return transformContent(session.fullContent);
  }

  return transformContent(filtered);
}


/**
 * $LESS_SHELL_LINES reserves shell rows in one-screen tests, like
 * less get_one_screen's `nlines + shell_lines <= sc_height`.
 */
export function shellReserveLines(): number {
  const env = lgetenv('LESS_SHELL_LINES');
  const lines = env ? parseInt(env, 10) || 0 : 1;
  return lines >= config.window ? config.window - 1 : lines;
}
