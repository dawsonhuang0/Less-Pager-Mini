import { strWidth } from 'char-width';

import { config } from "../config";

import { ringBell } from "../helpers";

/**
 * The shared editable command line under every text prompt, ported
 * from less's cmdbuf.c: a buffer of grapheme clusters with a cursor,
 * a horizontal display offset and history recall.
 */

/** cmd_char results, like CC_OK / CC_QUIT / CC_ERROR / CC_PASS. */
export type CmdResult = 'ok' | 'quit' | 'error' | 'pass';

/** Line-editing actions, like decode.c's EC_ codes. */
type EditAction =
  | 'right' | 'left' | 'wordRight' | 'wordLeft' | 'home' | 'end'
  | 'backspace' | 'delete' | 'wordBackspace' | 'wordDelete'
  | 'kill' | 'abort' | 'up' | 'down' | 'literal'
  | 'complete' | 'reverseComplete' | 'expand' | 'noAction';

// the edit-key table, like decode.c's edittable: hardwired ESC
// combos plus the xterm sequences og reads from terminfo
const EDIT_KEYS: Record<string, EditAction> = {
  '\t': 'complete',
  '\x0F': 'reverseComplete', // ^O BACKTAB
  '\x1B[Z': 'reverseComplete', // SHIFT-TAB
  '\x1B\t': 'reverseComplete',
  '\x0C': 'expand', // ^L
  '\x16': 'literal', // ^V
  '\x01': 'literal', // ^A
  '\x1Bl': 'right',
  '\x1B[C': 'right',
  '\x1BOC': 'right',
  '\x1Bh': 'left',
  '\x1B[D': 'left',
  '\x1BOD': 'left',
  '\x1Bw': 'wordRight',
  '\x1B\x1B[C': 'wordRight', // ESC RIGHTARROW
  '\x1B\x1BOC': 'wordRight', // ESC RIGHTARROW (keypad mode)
  '\x1B[1;5C': 'wordRight', // CTRL-RIGHTARROW
  '\x1B[1;3C': 'wordRight', // ALT-RIGHTARROW
  '\x1Bb': 'wordLeft',
  '\x1B\x1B[D': 'wordLeft',
  '\x1B\x1BOD': 'wordLeft', // ESC LEFTARROW (keypad mode)
  '\x1B[1;5D': 'wordLeft',
  '\x1B[1;3D': 'wordLeft', // ALT-LEFTARROW
  '\x1Bx': 'delete',
  '\x1B[3~': 'delete',
  '\x1BX': 'wordDelete',
  '\x1B\x1B[3~': 'wordDelete',
  '\x1B[3;5~': 'wordDelete',
  '\x1B\x7F': 'wordBackspace', // ESC BACKSPACE
  '\x1B\x08': 'wordBackspace',
  '\x1B0': 'home',
  '\x1B[H': 'home',
  '\x1BOH': 'home',
  '\x1B[1~': 'home',
  '\x1B$': 'end',
  '\x1B[F': 'end',
  '\x1BOF': 'end',
  '\x1B[4~': 'end',
  '\x1Bk': 'up',
  '\x1B[A': 'up',
  '\x1BOA': 'up',
  '\x1Bj': 'down',
  '\x1B[B': 'down',
  '\x1BOB': 'down',
  '\x07': 'abort', // ^G
  '\x1Bi': 'noAction', // EC_INSERT: insert mode is compiled out
  '\x1B[2~': 'noAction',
};

// og's CMDBUF_SIZE guard
const CMDBUF_LIMIT = 2000;

const segmenter = new Intl.Segmenter();

/** A completion hook, run for TAB / SHIFT-TAB / ^L when allowed. */
export type Completer = (
  action: 'complete' | 'reverseComplete' | 'expand'
) => void;

interface CmdState {
  /** True while a prompt is being edited through cmdbuf. */
  active: boolean;
  /** The buffer, one grapheme cluster per entry. */
  steps: string[];
  /** Cursor position: index into steps, like cp. */
  cur: number;
  /** First displayed step, like cmd_offset. */
  offset: number;
  /** Column just after the prompt, like prompt_col. */
  promptCol: number;
  /** Next char inserts literally (^V / ^A), like `literal`. */
  literal: boolean;
  /** Pending multi-char edit sequence (ESC combos typed slowly). */
  prefix: string;
  /** Prefix length latched by the first up/down, like updown_match;
   *  -1 when unset. */
  updownMatch: number;
  /** The current history list, like curr_mlist; null = no history. */
  history: string[] | null;
  /** Recall position, like curr_mp: history.length is the sentinel. */
  histPos: number;
  /** Abort the command when it is entirely erased (CF_QUIT_ON_ERASE). */
  quitOnErase: boolean;
  /** Filename completion is allowed at this prompt. */
  complete: Completer | null;
  /** True while TAB cycling, like in_completion. */
  inCompletion: boolean;
}

export const cmd: CmdState = {
  active: false,
  steps: [],
  cur: 0,
  offset: 0,
  promptCol: 0,
  literal: false,
  prefix: '',
  updownMatch: -1,
  history: null,
  histPos: 0,
  quitOnErase: false,
  complete: null,
  inCompletion: false,
};

/** Splits text into grapheme clusters. */
const clusters = (text: string): string[] =>
  Array.from(segmenter.segment(text), s => s.segment);

/**
 * A cluster's display form, like cmd_step_common: caret notation for
 * controls (ESC spelled out, like og's prchar), everything else as-is.
 */
export function stepText(step: string): string {
  const code = step.charCodeAt(0);

  if (step.length === 1 && (code < 0x20 || code === 0x7F)) {
    if (code === 0x1B) return 'ESC';
    return '^' + String.fromCharCode(code === 0x7F ? '?'.charCodeAt(0)
      : code ^ 0x40);
  }

  return step;
}

/** A cluster's display width. */
const stepWidth = (step: string): number => strWidth(stepText(step));

/**
 * Opens the command buffer for a prompt, like start_mca calling
 * cmd_reset and set_mlist: the recall spot returns to the newest
 * entry so up-arrow retrieves the previous command.
 */
export function cmdOpen(prompt: string, opts: {
  history?: string[] | null,
  quitOnErase?: boolean,
  complete?: Completer | null,
  text?: string,
} = {}): void {
  cmd.active = true;
  cmd.steps = clusters(opts.text ?? '');
  cmd.cur = 0;
  cmd.offset = 0;
  cmd.promptCol = strWidth(prompt);
  cmd.literal = false;
  cmd.prefix = '';
  cmd.updownMatch = -1;
  cmd.history = opts.history ?? null;
  cmd.histPos = cmd.history?.length ?? 0;
  cmd.quitOnErase = opts.quitOnErase ?? false;
  cmd.complete = opts.complete ?? null;
  cmd.inCompletion = false;

  while (cmd.cur < cmd.steps.length) cmdRight();
}

/** Closes the buffer when its prompt ends. */
export function cmdClose(): void {
  cmd.active = false;
  cmd.steps = [];
  cmd.cur = 0;
  cmd.offset = 0;
  cmd.prefix = '';
  cmd.history = null;
  cmd.complete = null;
  ungot = [];
}

/**
 * Updates the prompt width when the prompt text changes mid-edit
 * (search modifier toggles), like mca_search repainting.
 */
export function cmdPrompt(prompt: string): void {
  cmd.promptCol = strWidth(prompt);
}

/** The buffer contents, like get_cmdbuf. */
export const cmdText = (): string => cmd.steps.join('');

/** Replaces the buffer, cursor to the end, like cmd_setstring. */
export function cmdSetText(text: string): void {
  cmd.steps = clusters(text);
  cmd.cur = 0;
  cmd.offset = 0;
  cmd.updownMatch = -1;
  while (cmd.cur < cmd.steps.length) cmdRight();
}

/**
 * Replaces the clusters from `start` to the cursor with new text,
 * cursor landing at its end, like cmd_complete erasing back to the
 * word start and inserting the trial with cmd_istr.
 */
export function cmdReplaceRange(start: number, text: string): void {
  const before = cmd.steps.slice(0, start).join('');
  const after = cmd.steps.slice(cmd.cur).join('');

  cmd.steps = clusters(before + text + after);
  cmd.offset = 0;
  cmd.cur = 0;
  cmd.updownMatch = -1;

  const target = Math.min(
    clusters(before + text).length, cmd.steps.length
  );

  while (cmd.cur < target) cmdRight();
}

/** The cursor's screen column (0-based), like cmd_col. */
export function cmdCol(): number {
  let col = cmd.promptCol;
  for (let i = cmd.offset; i < cmd.cur; i++) col += stepWidth(cmd.steps[i]);
  return col;
}

/**
 * The visible slice of the buffer, like cmd_repaint's draw loop:
 * chars paint while they fit strictly inside the screen width.
 */
export function cmdDisplay(): string {
  let out = '';
  let col = cmd.promptCol;

  for (let i = cmd.offset; i < cmd.steps.length; i++) {
    const width = stepWidth(cmd.steps[i]);
    if (col + width >= config.screenWidth) break;

    out += stepText(cmd.steps[i]);
    col += width;
  }

  return out;
}

/**
 * Shifts the display left a half usable screen, like cmd_lshift.
 */
function cmdLshift(): void {
  const half = Math.floor((config.screenWidth - cmd.promptCol) / 2);
  let s = cmd.offset;
  let cols = 0;

  while (cols < half && s < cmd.steps.length) {
    cols += stepWidth(cmd.steps[s++]);
  }

  cmd.offset = s;
}

/**
 * Shifts the display right a half usable screen, like cmd_rshift.
 */
function cmdRshift(): void {
  const half = Math.floor((config.screenWidth - cmd.promptCol) / 2);
  let s = cmd.offset;
  let cols = 0;

  while (cols < half && s > 0) {
    cols += stepWidth(cmd.steps[--s]);
  }

  cmd.offset = s;
}

/** Moves the cursor right one cluster, like cmd_right. */
export function cmdRight(): void {
  if (cmd.cur >= cmd.steps.length) return;

  const width = stepWidth(cmd.steps[cmd.cur]);
  const col = cmdCol();

  if (
    col + width >= config.screenWidth ||
    (col + width === config.screenWidth - 1 &&
      cmd.cur + 1 < cmd.steps.length)
  ) {
    cmdLshift();
  }

  cmd.cur++;
}

/** Moves the cursor left one cluster, like cmd_left. */
export function cmdLeft(): void {
  if (cmd.cur <= 0) return;

  const width = stepWidth(cmd.steps[cmd.cur - 1]);

  if (cmdCol() < cmd.promptCol + width) cmdRshift();

  cmd.cur--;
}

/** Deletes the cluster left of the cursor, like cmd_erase. */
function cmdErase(): CmdResult {
  // backspace past the beginning aborts the command
  if (cmd.cur === 0) return 'quit';

  cmdLeft();
  cmd.steps.splice(cmd.cur, 1);
  cmd.updownMatch = -1;

  if (cmd.quitOnErase && cmd.steps.length === 0) return 'quit';
  return 'ok';
}

/** Deletes the cluster under the cursor, like cmd_delete. */
function cmdDelete(): CmdResult {
  if (cmd.cur >= cmd.steps.length) return 'ok';

  cmdRight();
  cmdErase();
  return 'ok';
}

/** Inserts text at the cursor, like cmd_ichar. */
function cmdIchar(text: string): CmdResult {
  if (cmdText().length + text.length >= CMDBUF_LIMIT) {
    ringBell();
    return 'error';
  }

  // recluster the whole line so combining marks merge with the
  // cluster before them, like og's zero-width composing chars
  const before = cmd.steps.slice(0, cmd.cur).join('');
  const after = cmd.steps.slice(cmd.cur).join('');

  cmd.steps = clusters(before + text + after);
  cmd.updownMatch = -1;

  const target = Math.min(
    clusters(before + text).length, cmd.steps.length
  );

  cmd.cur = Math.min(clusters(before).length, target);
  while (cmd.cur < target) cmdRight();

  return 'ok';
}

/** Deletes the word left of the cursor, like cmd_werase. */
function cmdWerase(): CmdResult {
  if (cmd.cur > 0 && cmd.steps[cmd.cur - 1] === ' ') {
    while (cmd.cur > 0 && cmd.steps[cmd.cur - 1] === ' ') cmdErase();
  } else {
    while (cmd.cur > 0 && cmd.steps[cmd.cur - 1] !== ' ') cmdErase();
  }

  return 'ok';
}

/** Deletes the word under the cursor, like cmd_wdelete. */
function cmdWdelete(): CmdResult {
  if (cmd.steps[cmd.cur] === ' ') {
    while (cmd.steps[cmd.cur] === ' ') cmdDelete();
  } else {
    while (cmd.cur < cmd.steps.length && cmd.steps[cmd.cur] !== ' ') {
      cmdDelete();
    }
  }

  return 'ok';
}

/** Empties the buffer, like cmd_kill. */
function cmdKill(): CmdResult {
  if (cmd.steps.length === 0) return 'quit';

  cmd.offset = 0;
  cmd.cur = 0;
  cmd.steps = [];
  cmd.updownMatch = -1;

  if (cmd.quitOnErase) return 'quit';
  return 'ok';
}

/**
 * Recalls a history entry, like cmd_updown: only entries whose
 * first updown_match clusters equal the buffer's qualify, and the
 * latch freezes at the cursor on the first up/down.
 */
function cmdUpdown(dir: -1 | 1): CmdResult {
  if (!cmd.history) {
    ringBell();
    return 'ok';
  }

  if (cmd.updownMatch < 0) cmd.updownMatch = cmd.cur;

  const prefix = cmd.steps.slice(0, cmd.updownMatch).join('');

  // og's mlist is circular with a sentinel: walking off either end
  // stops there, but DOWN from a fresh prompt wraps to the oldest
  const sentinel = cmd.history.length;
  let pos = cmd.histPos;

  for (;;) {
    pos = dir === -1
      ? (pos === 0 ? sentinel : pos - 1)
      : (pos === sentinel ? 0 : pos + 1);

    if (pos === sentinel) break;

    if (cmd.history[pos].startsWith(prefix)) {
      cmd.histPos = pos;
      cmd.steps = clusters(cmd.history[pos]);
      cmd.offset = 0;
      cmd.cur = 0;
      while (cmd.cur < cmd.steps.length) cmdRight();
      return 'ok';
    }
  }

  ringBell();
  return 'ok';
}

// keys ungot by an unrecognized sequence, replayed through the
// prompt handler one char at a time, like decode.c's ungetcc
let ungot: string[] = [];

/**
 * Takes one ungot char for reprocessing; the prompt key handler
 * drains this after every cmdChar call.
 */
export function cmdUngot(): string | null {
  return ungot.shift() ?? null;
}

type Decoded =
  | { kind: 'action', action: EditAction }
  | { kind: 'pending' }
  | { kind: 'insert', text: string };

/**
 * The longest N where the last N chars of `str` equal the first N of
 * `goal`, like decode.c's cmd_match.
 */
function suffixMatch(str: string, goal: string): number {
  for (let n = Math.min(str.length, goal.length); n > 0; n--) {
    if (str.endsWith(goal.slice(0, n))) return n;
  }

  return 0;
}

// og collects at most this many chars for one command (MAX_CMDLEN)
const MAX_CMDLEN = 16;

/**
 * Decodes an edit key, like editchar over cmd_decode: the erase and
 * kill characters first, then og's SUFFIX matching — the collected
 * sequence resolves when its tail equals a whole table entry (any
 * garbage before it is discarded), stays pending while its tail is a
 * proper prefix of one, and otherwise inserts its first char and
 * replays the rest like CC_PASS + ungetcc. This is why an ESC flood
 * shows nothing until a following key settles it, like og.
 */
function editKey(key: string): Decoded {
  if (!cmd.prefix) {
    if (key === '\x7F' || key === '\x08') {
      return { kind: 'action', action: 'backspace' };
    }

    if (key === '\x15') return { kind: 'action', action: 'kill' }; // ^U
  }

  const candidate = cmd.prefix + key;
  let matchLen = 0;
  let action: EditAction | 'prefix' | null = null;

  // like cmd_decode: later entries win ties, full suffix match takes
  // the entry's action, partial keeps collecting
  for (const [seq, act] of Object.entries(EDIT_KEYS)) {
    const n = suffixMatch(candidate, seq);
    if (n === 0 || n < matchLen) continue;

    action = n === seq.length ? act : 'prefix';
    matchLen = n;
  }

  if (action !== null && action !== 'prefix') {
    cmd.prefix = '';
    return { kind: 'action', action };
  }

  if (action === 'prefix') {
    if (candidate.length < MAX_CMDLEN) {
      cmd.prefix = candidate;
      return { kind: 'pending' };
    }

    // og's editchar stops collecting at MAX_CMDLEN and the tail is
    // simply lost: only the first char inserts
    cmd.prefix = '';
    return { kind: 'insert', text: candidate[0] };
  }

  cmd.prefix = '';

  if (candidate.length > 1) {
    // dead sequence: insert the first char, replay the rest
    ungot.push(...candidate.slice(1));
    return { kind: 'insert', text: candidate[0] };
  }

  return { kind: 'insert', text: candidate };
}

export function cmdChar(key: string): CmdResult {
  if (cmd.literal) {
    cmd.literal = false;
    return cmdIchar(key);
  }

  const decoded = editKey(key);
  if (decoded.kind === 'pending') return 'ok';

  if (decoded.kind === 'insert') {
    // og's cmd_edit default runs not_in_completion before CC_PASS
    cmd.inCompletion = false;
    return cmdIchar(decoded.text);
  }

  const action = decoded.action;
  const notInCompletion = () => { cmd.inCompletion = false; };

  switch (action) {
    case 'noAction': return 'ok';
    case 'right': notInCompletion(); cmdRight(); return 'ok';
    case 'left': notInCompletion(); cmdLeft(); return 'ok';
    case 'wordRight':
      notInCompletion();
      while (cmd.cur < cmd.steps.length && cmd.steps[cmd.cur] !== ' ') {
        cmdRight();
      }
      while (cmd.steps[cmd.cur] === ' ') cmdRight();
      return 'ok';
    case 'wordLeft':
      notInCompletion();
      while (cmd.cur > 0 && cmd.steps[cmd.cur - 1] === ' ') cmdLeft();
      while (cmd.cur > 0 && cmd.steps[cmd.cur - 1] !== ' ') cmdLeft();
      return 'ok';
    case 'home':
      notInCompletion();
      cmd.offset = 0;
      cmd.cur = 0;
      return 'ok';
    case 'end':
      notInCompletion();
      while (cmd.cur < cmd.steps.length) cmdRight();
      return 'ok';
    case 'backspace': notInCompletion(); return cmdErase();
    case 'delete': notInCompletion(); return cmdDelete();
    case 'wordBackspace': notInCompletion(); return cmdWerase();
    case 'wordDelete': notInCompletion(); return cmdWdelete();
    case 'kill': notInCompletion(); return cmdKill();
    case 'abort':
      notInCompletion();
      cmdKill();
      return 'quit';
    case 'literal':
      cmd.literal = true;
      return 'ok';
    case 'up':
    case 'down':
      notInCompletion();
      // og rejects history actions at history-less prompts
      if (!cmd.history) {
        ringBell();
        return 'ok';
      }
      return cmdUpdown(action === 'up' ? -1 : 1);
    case 'complete':
    case 'reverseComplete':
    case 'expand':
      if (!cmd.complete) {
        ringBell();
        return 'ok';
      }
      cmd.complete(action);
      return 'ok';
  }

  return 'pass';
}
