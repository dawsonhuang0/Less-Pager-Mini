import { config, mode } from './config';

import { Config, Mode } from './interfaces';

/**
 * The pager session state, like og's globals spread across its C
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

  /** The key sequence being dispatched. */
  key: '',
  /** Pending ESC count while a sequence collects. */
  escCount: 0,
  /** The digit-prefix buffer, like og's cmdbuf number. */
  buffer: [] as string[],

  /** Queued + commands for the first prompt (og's ungotten input). */
  pendingFirstCmds: [] as string[],
  /** The errmsgs gate's ungot key, ordinary input after the +cmds. */
  ungotStartKey: '',

  /** Waiting after !/| with the terminal handed to the shell. */
  shellPause: false as false | 'shell' | 'pager',
  /** True once the session ended; exit() resolves the main loop. */
  exited: false,
  exit: (() => {}) as () => void,

  /** True when the help screen IS the input (--help/-?), like og's
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
   *  og's last_drag_x/y. */
  lastClickY: -1,
  lastDragX: -1,
  lastDragY: -1,

  /** The active & display filter over fullContent. */
  lastFilter: null as ((line: string) => boolean) | null,

  // the still-delivering pipe state (og's lazy non-seekable reads)
  pipeStream: null as NodeJS.ReadableStream | null,
  pipePaused: false,
  pipeDrainTo: null as (() => void) | null,
  detachPipe: (() => {}) as () => void,

  /** Bytes of pipe data kept before the oldest recycle away: -B
   *  limits it to the -b buffer space up front (ch.c's maxbufs for
   *  pipes); otherwise the budget locks in at the first sign of
   *  heap pressure, og's failed-allocation moment. */
  pipeBudget: Infinity,

  /** og paints arriving lines only while the initial forw() fills
   *  the first screenful; afterwards an idle pager never repaints
   *  on new pipe data (F is the follow command). */
  pipeFirstFill: true,

  /** -F reads the pipe before any terminal init, like og's
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

  session.pipeStream = null;
  session.pipePaused = false;
  session.pipeDrainTo = null;
  session.detachPipe = () => {};
  session.pipeBudget = Infinity;
  session.pipeFirstFill = true;
  session.pipeProbing = false;
}
