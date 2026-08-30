import fs from 'fs';
import path from 'path';

import { homeDir, LESSKEYIN_NAME, LESSKEYIN_SYS, LESSKEYFILE_NAME,
  LESSKEYFILE_SYS }
  from "../tty/platform";

import { Actions } from "../state/interfaces";

import { search } from "../features/searching";

import { actualEnv, deleteLesskeyEnv, lgetenv, resetLesskeyEnvironment,
  setLesskeyEnv } from '../startup/environment';

import { terminalCapability } from '../tty/terminal';

import { hook } from '../options/shared';

import { SPECIAL_KEY_CODES } from './codes';

import { secureAllow } from '../features/secure';

/**
 * A #command binding: the pager action, an optional canonical key for
 * key-sensitive actions (`-`/`_`), and the "extra" input string fed
 * after the action, like lesskey's A_EXTRA.
 */
interface UserBinding {
  action: Actions | undefined;
  key?: string;
  extra?: string;
}

// this port replicates less 707x
export const LESS_VERSION = 707;

/** Command names from lesskey_parse.c mapped onto our actions; null
 *  names are accepted but unsupported (they ring like A_UINVALID). */
const CMD_ACTIONS: Record<string, Actions | null> = {
  'back-bracket': 'CUSTOM_BRACKET_LEFT',
  'back-line': 'LINE_BACKWARD',
  'back-line-force': 'LINE_BACKWARD',
  'back-newline': 'LINE_BACKWARD',
  'back-screen': 'WINDOW_BACKWARD',
  'back-screen-force': 'WINDOW_BACKWARD',
  'back-scroll': 'SET_HALF_WINDOW_BACKWARD',
  'back-search': 'SEARCH_BACKWARD',
  'back-window': 'SET_WINDOW_BACKWARD',
  'clear-mark': 'CLEAR_MARK',
  'clear-search': 'CLEAR_SEARCH',
  'debug': null,
  'digit': 'ADD_BUFFER',
  'display-flag': 'TAG_COMMAND',
  'display-option': 'TAG_COMMAND',
  'end': 'LAST_LINE',
  'end-scroll': 'LAST_COL',
  'examine': 'OPEN_FILE',
  'filter': 'PATTERN_ONLY',
  'first-cmd': 'ADD_COMMAND',
  'firstcmd': 'ADD_COMMAND',
  'flush-repaint': 'DROP_INPUT_REPAINT',
  'forw-bell-hilite': 'FOLLOW_BELL',
  'forw-bracket': 'CUSTOM_BRACKET_RIGHT',
  'forw-forever': 'FOLLOW',
  'forw-line': 'LINE_FORWARD',
  'forw-line-force': 'LINE_FORWARD',
  'forw-newline': 'LINE_FORWARD',
  'forw-screen': 'WINDOW_FORWARD',
  'forw-screen-force': 'NO_EOF_WINDOW_FORWARD',
  'forw-scroll': 'SET_HALF_WINDOW_FORWARD',
  'forw-search': 'SEARCH_FORWARD',
  'forw-until-hilite': 'FOLLOW_HILITE',
  'forw-window': 'SET_WINDOW_FORWARD',
  'goto-end': 'LAST_LINE',
  'goto-end-buffered': 'LAST_LINE',
  'goto-line': 'FIRST_LINE',
  'goto-mark': 'GO_MARK',
  'goto-pos': 'GO_POS',
  'help': 'HELP',
  'index-file': 'INDEX_FILE',
  'invalid': null,
  'left-scroll': 'SET_HALF_SCREEN_LEFT',
  'mouse': 'MOUSE_X11_IN',
  'mouse6': 'MOUSE_SGR_IN',
  'next-file': 'NEXT_FILE',
  'next-tag': 'NEXT_TAG',
  'no-scroll': 'FIRST_COL',
  'noaction': 'NOACTION',
  'osc8-forw-search': 'OSC8_FORWARD',
  'osc8-back-search': 'OSC8_BACKWARD',
  'osc8-jump': 'OSC8_JUMP',
  'osc8-open': 'OSC8_OPEN',
  'percent': 'PERCENT_LINE',
  'pipe': 'PIPE_COMMAND',
  'prev-file': 'PREV_FILE',
  'prev-tag': 'PREV_TAG',
  'pshell': 'PSHELL_COMMAND',
  'quit': 'EXIT',
  'remove-file': 'REMOVE_FILE',
  'repaint': 'REPAINT',
  'repaint-flush': 'DROP_INPUT_REPAINT',
  'repeat-search': 'REPEAT_SEARCH',
  'repeat-search-all': 'REPEAT_SEARCH',
  'reverse-search': 'REVERSE_SEARCH',
  'reverse-search-all': 'REVERSE_SEARCH',
  'right-scroll': 'SET_HALF_SCREEN_RIGHT',
  'set-mark': 'SET_MARK',
  'set-mark-bottom': 'SET_MARK_BOTTOM',
  'shell': 'SHELL_COMMAND',
  'status': 'CURRENT_INFO',
  'toggle-flag': 'TAG_COMMAND',
  'toggle-option': 'TAG_COMMAND',
  'undo-hilite': 'HIGHLIGHT_TOGGLE',
  'version': 'VERSION',
  'visual': 'EDIT_FILE',
};

/** The `-`/`_` option commands act on the pressed key, so their
 *  bindings carry a canonical key. */
const CMD_KEYS: Record<string, string> = {
  'display-flag': '_',
  'display-option': '_',
  'toggle-flag': '-',
  'toggle-option': '-',
};

/** Line-editing names from lesskey_parse.c; the canonical key is the
 *  built-in key our prompts already handle, null when the prompts have
 *  no such editing behavior. */
const EDIT_KEYS: Record<string, string | null> = {
  'back-complete': '\x1B[Z',
  'backspace': '\x7F',
  'delete': null,
  'down': '\x1B[B',
  'end': null,
  'expand': '\x0C',
  'forw-complete': '\x09',
  'home': null,
  'insert': null,
  'invalid': null,
  'kill-line': null,
  'abort': '\x03',
  'left': null,
  'literal': null,
  'mouse': null,
  'mouse6': null,
  'noaction': null,
  'right': null,
  'up': '\x1B[A',
  'word-backspace': null,
  'word-delete': null,
  'word-left': null,
  'word-right': null,
};

/** \k special key names resolved to the terminal sequences our key
 *  splitter produces, standing in for less's SK_SPECIAL_KEY codes. */
const SPECIAL_KEYS: Record<string, string> = {
  'b': '\x7F',
  'B': '\x08',
  'd': '\x1B[B',
  'D': '\x1B[6~',
  'e': '\x1B[F',
  'E': '\x1B[1;5F',
  'F': '\x1B[1;2F',
  'h': '\x1B[H',
  'H': '\x1B[1;5H',
  'I': '\x1B[1;2H',
  'i': '\x1B[2~',
  'l': '\x1B[D',
  'L': '\x1B[1;5D',
  'M': '\x1B[1;2D',
  'r': '\x1B[C',
  'R': '\x1B[1;5C',
  'S': '\x1B[1;2C',
  't': '\x1B[Z',
  'u': '\x1B[A',
  'U': '\x1B[5~',
  'x': '\x1B[3~',
  'X': '\x1B[3;5~',
  '1': '\x1BOP',
  '^D': '\x1B[6;5~',
  '^U': '\x1B[5;5~',
  '^b': '\x08',
  '^d': '\x1B[1;5B',
  '^e': '\x1B[1;5F',
  '^h': '\x1B[1;5H',
  '^l': '\x1B[1;5D',
  '^r': '\x1B[1;5C',
  '^u': '\x1B[1;5A',
  '^x': '\x1B[3;5~',
  '+D': '\x1B[6;2~',
  '+U': '\x1B[5;2~',
  '+d': '\x1B[1;2B',
  '+e': '\x1B[1;2F',
  '+h': '\x1B[1;2H',
  '+l': '\x1B[1;2D',
  '+r': '\x1B[1;2C',
  '+u': '\x1B[1;2A',
  '+x': '\x1B[3;2~',
};

const SPECIAL_CAPS: Record<string, [string, string | null]> = {
  d: ['kcud1', 'kd'], D: ['knp', 'kN'], e: ['kend', '@7'],
  h: ['khome', 'kh'], i: ['kich1', 'kI'], l: ['kcub1', 'kl'],
  r: ['kcuf1', 'kr'], t: ['kcbt', 'kB'], u: ['kcuu1', 'ku'],
  U: ['kpp', 'kP'], x: ['kdch1', 'kD'], '1': ['kf1', 'k1'],
  H: ['kHOM5', null], I: ['kHOM', '#2'], L: ['kLFT5', null],
  M: ['kLFT', null], R: ['kRIT5', null], S: ['kRIT', null],
  E: ['kEND5', null], F: ['kEND', '#7'],
  '^D': ['kNXT5', null], '^U': ['kPRV5', null],
  '+D': ['kNXT', null], '+U': ['kPRV', null],
  '^d': ['kDN5', null], '^e': ['kEND5', null],
  '^h': ['kHOM5', null], '^l': ['kLFT5', null],
  '^r': ['kRIT5', null], '^u': ['kUP5', null],
  '^x': ['kDC5', null],
  '+d': ['kDN', null], '+e': ['kEND', '#7'],
  '+h': ['kHOM', '#2'], '+l': ['kLFT', null],
  '+r': ['kRIT', null], '+u': ['kUP', null], '+x': ['kDC', null],
};

function specialKey(name: string): string | undefined {
  const cap = SPECIAL_CAPS[name];
  if (cap) {
    const value = terminalCapability(cap[0], cap[1]);
    if (value !== undefined) return value;
  }
  return SPECIAL_KEYS[name];
}

/** True for a \k name less's own tstr accepts, resolvable or not. */
const knownSpecialKey = (name: string): boolean =>
  name in SPECIAL_KEY_CODES;

/** Binary-file action codes (cmd.h A_*) mapped onto our actions. */
const ACTION_CODES: Record<number, Actions | null> = {
  2: 'LINE_BACKWARD',            // A_B_LINE
  3: 'WINDOW_BACKWARD',          // A_B_SCREEN
  4: 'SET_HALF_WINDOW_BACKWARD', // A_B_SCROLL
  5: 'SEARCH_BACKWARD',          // A_B_SEARCH
  6: 'ADD_BUFFER',               // A_DIGIT
  7: 'TAG_COMMAND',              // A_DISP_OPTION
  8: null,                       // A_DEBUG
  9: 'OPEN_FILE',                // A_EXAMINE
  10: 'ADD_COMMAND',             // A_FIRSTCMD
  11: 'DROP_INPUT_REPAINT',      // A_FREPAINT
  12: 'LINE_FORWARD',            // A_F_LINE
  13: 'WINDOW_FORWARD',          // A_F_SCREEN
  14: 'SET_HALF_WINDOW_FORWARD', // A_F_SCROLL
  15: 'SEARCH_FORWARD',          // A_F_SEARCH
  16: 'LAST_LINE',               // A_GOEND
  17: 'FIRST_LINE',              // A_GOLINE
  18: 'GO_MARK',                 // A_GOMARK
  19: 'HELP',                    // A_HELP
  20: 'NEXT_FILE',               // A_NEXT_FILE
  21: 'PERCENT_LINE',            // A_PERCENT
  22: 'WINDOW_BACKWARD',         // A_BF_SCREEN
  23: 'PREV_FILE',               // A_PREV_FILE
  24: 'EXIT',                    // A_QUIT
  25: 'REPAINT',                 // A_REPAINT
  26: 'SET_MARK',                // A_SETMARK
  27: 'SHELL_COMMAND',           // A_SHELL
  28: 'CURRENT_INFO',            // A_STAT
  29: 'LINE_FORWARD',            // A_FF_LINE
  30: 'LINE_BACKWARD',           // A_BF_LINE
  31: 'VERSION',                 // A_VERSION
  32: 'EDIT_FILE',               // A_VISUAL
  33: 'SET_WINDOW_FORWARD',      // A_F_WINDOW
  34: 'SET_WINDOW_BACKWARD',     // A_B_WINDOW
  35: 'CUSTOM_BRACKET_RIGHT',    // A_F_BRACKET
  36: 'CUSTOM_BRACKET_LEFT',     // A_B_BRACKET
  37: 'PIPE_COMMAND',            // A_PIPE
  38: 'INDEX_FILE',              // A_INDEX_FILE
  39: 'HIGHLIGHT_TOGGLE',        // A_UNDO_SEARCH
  40: 'NO_EOF_WINDOW_FORWARD',   // A_FF_SCREEN
  41: 'SET_HALF_SCREEN_LEFT',    // A_LSHIFT
  42: 'SET_HALF_SCREEN_RIGHT',   // A_RSHIFT
  43: 'REPEAT_SEARCH',           // A_AGAIN_SEARCH
  44: 'REPEAT_SEARCH',           // A_T_AGAIN_SEARCH
  45: 'REVERSE_SEARCH',          // A_REVERSE_SEARCH
  46: 'REVERSE_SEARCH',          // A_T_REVERSE_SEARCH
  47: 'TAG_COMMAND',             // A_OPT_TOGGLE
  48: null,                      // A_OPT_SET
  49: null,                      // A_OPT_UNSET
  50: 'FOLLOW',                  // A_F_FOREVER
  51: 'GO_POS',                  // A_GOPOS
  52: 'REMOVE_FILE',             // A_REMOVE_FILE
  53: 'NEXT_TAG',                // A_NEXT_TAG
  54: 'PREV_TAG',                // A_PREV_TAG
  55: 'PATTERN_ONLY',            // A_FILTER
  56: 'FOLLOW_HILITE',           // A_F_UNTIL_HILITE
  57: 'LAST_LINE',               // A_GOEND_BUF
  58: 'FIRST_COL',               // A_LLSHIFT
  59: 'LAST_COL',                // A_RRSHIFT
  60: 'LINE_FORWARD',            // A_F_NEWLINE
  61: 'LINE_BACKWARD',           // A_B_NEWLINE
  62: 'CLEAR_MARK',              // A_CLRMARK
  63: 'SET_MARK_BOTTOM',         // A_SETMARKBOT
  64: 'MOUSE_X11_IN',            // A_X11MOUSE_IN
  66: 'MOUSE_FORWARD',           // A_F_MOUSE
  67: 'MOUSE_BACKWARD',          // A_B_MOUSE
  68: 'MOUSE_SGR_IN',            // A_X116MOUSE_IN
  69: 'PSHELL_COMMAND',          // A_PSHELL
  70: 'CLEAR_SEARCH',            // A_CLR_SEARCH
  71: 'OSC8_FORWARD',            // A_OSC8_F_SEARCH
  72: 'OSC8_BACKWARD',           // A_OSC8_B_SEARCH
  73: 'OSC8_OPEN',               // A_OSC8_OPEN
  74: 'OSC8_JUMP',               // A_OSC8_JUMP
  77: 'FOLLOW_BELL',             // A_F_FOREVER_BELL
  78: 'MOUSE_LEFT',              // A_L_MOUSE
  79: 'MOUSE_RIGHT',             // A_R_MOUSE
  100: null,                     // A_INVALID
  101: 'NOACTION',               // A_NOACTION
  102: null,                     // A_UINVALID
};

/** Canonical keys for the key-sensitive binary action codes. */
const ACTION_CODE_KEYS: Record<number, string> = {
  7: '_',   // A_DISP_OPTION
  47: '-',  // A_OPT_TOGGLE
};

/** Binary edit codes (cmd.h EC_*) to the built-in editing keys. */
const EDIT_CODES: Record<number, string> = {
  1: '\x7F',     // EC_BACKSPACE
  13: '\x1B[A',  // EC_UP
  14: '\x1B[B',  // EC_DOWN
  15: '\x0C',    // EC_EXPAND
  17: '\x09',    // EC_F_COMPLETE
  18: '\x1B[Z',  // EC_B_COMPLETE
  20: '\x03',    // EC_ABORT
};

/** SK_* special key codes (cmd.h) to terminal sequences. */
const SK_CODES: Record<number, string> = {
  1: '\x1B[C',     // SK_RIGHT_ARROW
  2: '\x1B[D',     // SK_LEFT_ARROW
  3: '\x1B[A',     // SK_UP_ARROW
  4: '\x1B[B',     // SK_DOWN_ARROW
  5: '\x1B[5~',    // SK_PAGE_UP
  6: '\x1B[6~',    // SK_PAGE_DOWN
  7: '\x1B[H',     // SK_HOME
  8: '\x1B[F',     // SK_END
  9: '\x1B[3~',    // SK_DELETE
  10: '\x1B[2~',   // SK_INSERT
  11: '\x1B[1;5D', // SK_CTL_LEFT_ARROW
  12: '\x1B[1;5C', // SK_CTL_RIGHT_ARROW
  13: '\x1B[3;5~', // SK_CTL_DELETE
  14: '\x1BOP',    // SK_F1
  15: '\x1B[Z',    // SK_BACKTAB
  16: '\x08',      // SK_CTL_BACKSPACE
  17: '\x7F',      // SK_BACKSPACE
  34: '\x1B[1;2H', // SK_SHIFT_HOME
  35: '\x1B[1;2F', // SK_SHIFT_END
  36: '\x1B[1;5H', // SK_CTL_HOME
  37: '\x1B[1;5F', // SK_CTL_END
  38: '\x1B[1;2D', // SK_SHIFT_LEFT_ARROW
  39: '\x1B[1;2C', // SK_SHIFT_RIGHT_ARROW
  40: '\x0B',      // SK_CONTROL_K
  42: '\x1B[1;2A', // SK_SHIFT_UP_ARROW
  43: '\x1B[1;2B', // SK_SHIFT_DOWN_ARROW
  44: '\x1B[1;5A', // SK_CTL_UP_ARROW
  45: '\x1B[1;5B', // SK_CTL_DOWN_ARROW
  46: '\x1B[3;2~', // SK_SHIFT_DELETE
  47: '\x1B[5;2~', // SK_SHIFT_PAGE_UP
  48: '\x1B[6;2~', // SK_SHIFT_PAGE_DOWN
  49: '\x1B[5;5~', // SK_CTL_PAGE_UP
  50: '\x1B[6;5~', // SK_CTL_PAGE_DOWN
};

// the loaded user tables
/**
 * One lesskey a session loaded, in whatever shape it arrived.
 *
 * The loader takes up to six at once and merges them, so "the current
 * lesskey" is a list, not a file. --edit-lesskey needs to know which
 * ones were real to put them all in front of the user.
 */
export interface LesskeyForm {
  /** How it was stored: editable text, compiled bytes, or a variable. */
  kind: 'source' | 'binary' | 'content';
  /** The file path, or the variable name for a content form. */
  origin: string;
  /** System-wide rather than the user's own. */
  system: boolean;
}

const loadedForms: LesskeyForm[] = [];

/** The lesskey forms this session loaded, in ladder order. */
export const lesskeyForms = (): LesskeyForm[] => [...loadedForms];

/**
 * Notes a lesskey that loaded. The ladder records its own; the option
 * scan records what the command line added, since that arrives after
 * loadLesskey has already run (less's init_cmds precedes scan_option).
 */
export function recordLesskeyForm(form: LesskeyForm): void {
  loadedForms.push(form);
}

const bindings = new Map<string, UserBinding>();
const editKeys = new Map<string, string>();
const definedVars = new Set<string>();
let stopped = false;

// parse position state, like lesskey_parse.c's statics
let parseFile = '';
let parseLine = 0;
let lastVarName = '';
let lastVarRaw = '';
let lastVarApplied = false;
let varTableBroken = false;
let parsingSystem = false;
const currentVars = new Map<string, string>();

/** The #command binding for a key sequence, if the user made one. */
export const userBinding = (seq: string): UserBinding | undefined =>
  bindings.get(seq);

/**
 * The sequence a user bound to an action, for the two that are read as
 * the INTRODUCER of a longer report rather than matched whole: less's
 * A_X11MOUSE_IN and A_X116MOUSE_IN, which lesskey names "mouse" and
 * "mouse6" (lesskey_parse.c:72). Everything after the introducer is
 * the report's own bytes, so the dispatcher has to know the prefix.
 */
export function userBoundTo(action: Actions): string | undefined {
  for (const [seq, binding] of bindings) {
    if (binding.action === action) return seq;
  }

  return undefined;
}

/** True when #stop discards the built-in key bindings. */
export const userStop = (): boolean => stopped;

/**
 * Resolves a #line-edit binding to the built-in editing key it stands
 * for, leaving unbound keys alone.
 */
export const translateEditKey = (key: string): string =>
  editKeys.get(key) ?? key;

/** Forgets all lesskey state for a fresh session. */
export function resetLesskey(): void {
  loadedForms.length = 0;
  bindings.clear();
  editKeys.clear();
  definedVars.clear();
  currentVars.clear();
  resetLesskeyEnvironment();
  stopped = false;
}

/**
 * Loads the lesskey source at startup, like decode.c's init_cmds:
 * System source/binary, user source/binary, then inline system/user
 * content are added in decode.c order. $LESSKEYIN falls back through
 * $XDG_CONFIG_HOME/lesskey, ~/.config/lesskey and ~/.lesskey.
 * $LESSNOCONFIG skips everything.
 */
/**
 * less's opt_k -> lesskey(filename, 0): read a COMPILED lesskey file and
 * add its tables. Returns false where less's lesskey() returns nonzero -
 * blocked by SECURE or LESSNOCONFIG, unopenable, or shorter than the
 * 3 bytes a valid file must have (decode.c).
 */
hook.loadLesskeyFile = (path: string): boolean => {
  if (!secureAllow('lesskey') || actualEnv('LESSNOCONFIG')) return false;

  try {
    const buf = fs.readFileSync(path);
    if (buf.length < 3) return false;
    parseLesskeyBinary(buf);
    return true;
  } catch {
    return false;
  }
};

// less parses the lesskey files ONCE, in init_cmds, and reports each
// parse error once. We parse them TWICE for structural reasons: the
// CLI needs the #env lines before it can classify argv, and the
// session reset that follows clears the env table, so startupInit has
// to read them again. Only the second pass is less's - the first is an
// extra of ours, and it must not repeat the diagnostics.
let quietParse = false;

export function loadLesskey(quiet: boolean = false): void {
  quietParse = quiet;
  resetLesskey();

  if (actualEnv('LESSNOCONFIG')) return;

  // Tables are added in less's exact order. Later command definitions
  // win ties; environment lookup keeps user and system tables apart.
  const sysFile = lgetenv('LESSKEYIN_SYSTEM') || LESSKEYIN_SYS;
  let sysSourceLoaded = false;

  try {
    parseLesskey(fs.readFileSync(sysFile, 'utf8'), sysFile, true);
    sysSourceLoaded = true;
    recordLesskeyForm({ kind: 'source', origin: sysFile, system: true });
  } catch {
    // a missing system file is the normal case
  }

  if (!sysSourceLoaded) {
    const sysBinary = lgetenv('LESSKEY_SYSTEM') || LESSKEYFILE_SYS;
    try {
      parseLesskeyBinary(fs.readFileSync(sysBinary), true);
      recordLesskeyForm({ kind: 'binary', origin: sysBinary, system: true });
    } catch {
      // like less, a missing system binary is not an error
    }
  }

  const file = lesskeyFile();
  let userSourceLoaded = false;

  if (file) {
    try {
      parseLesskey(fs.readFileSync(file, 'utf8'), file);
      userSourceLoaded = true;
      recordLesskeyForm({ kind: 'source', origin: file, system: false });
    } catch {
      // less opens the default file silently
    }
  }

  if (!userSourceLoaded) {
    // without a source file less falls back to the compiled binary file,
    // $LESSKEY or ~/.less (_less on Windows)
    const binary = lgetenv('LESSKEY') ??
      path.join(homeDir(), LESSKEYFILE_NAME);

    try {
      parseLesskeyBinary(fs.readFileSync(binary));
      recordLesskeyForm({ kind: 'binary', origin: binary, system: false });
    } catch {
      // like less, a missing binary file is not an error
    }
  }

  const systemContent = lgetenv('LESSKEY_CONTENT_SYSTEM');

  if (systemContent) {
    parseLesskeyContent(systemContent, true);
    recordLesskeyForm({ kind: 'content', origin: 'LESSKEY_CONTENT_SYSTEM',
      system: true });
  }

  const content = lgetenv('LESSKEY_CONTENT');

  if (content) {
    parseLesskeyContent(content);
    recordLesskeyForm({ kind: 'content', origin: 'LESSKEY_CONTENT',
      system: false });
  }
}

/**
 * Parses a compiled lesskey file, like decode.c's new_lesskey and
 * old_lesskey: the new format wraps c/e/v sections between the
 * "\0M+G" and "End" magics; the old format is one raw command table.
 * Invalid files are ignored silently, like less returning -1.
 */
export function parseLesskeyBinary(buf: Buffer, system: boolean = false): void {
  parsingSystem = system;
  definedVars.clear();
  currentVars.clear();
  if (
    buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x4D &&
    buf[2] === 0x2B && buf[3] === 0x47
  ) {
    if (
      buf.length < 7 ||
      buf[buf.length - 3] !== 0x45 ||  // E
      buf[buf.length - 2] !== 0x6E ||  // n
      buf[buf.length - 1] !== 0x64     // d
    ) {
      return;
    }

    let p = 4;

    for (;;) {
      const section = buf[p++];
      if (section === undefined || section === 0x78) return; // x = end

      // two-byte length, low order first, radix 64 (gint)
      const n = buf[p] + 64 * buf[p + 1];
      p += 2;
      if (p + n >= buf.length) return;

      const body = buf.subarray(p, p + n);

      if (section === 0x63) parseBinaryTable(body, false);      // c
      else if (section === 0x65) parseBinaryTable(body, true);  // e
      else if (section === 0x76) parseBinaryVars(body);         // v
      else return;

      p += n;
    }
  }

  // old-style: the last or second to last byte must be zero
  if (
    buf.length >= 2 &&
    (buf[buf.length - 1] === 0 || buf[buf.length - 2] === 0)
  ) {
    parseBinaryTable(buf, false);
  }
}

/**
 * Walks a compiled command or line-edit table: key chars, NUL, the
 * action byte (A_EXTRA flags a trailing extra string), with special
 * keys as SK_SPECIAL_KEY six-byte blobs.
 */
function parseBinaryTable(buf: Buffer, edit: boolean): void {
  let p = 0;

  while (p < buf.length) {
    let seq = '';
    let unknown = false;

    while (p < buf.length && buf[p] !== 0) {
      if (buf[p] === 0x0B) {
        const special = SK_CODES[buf[p + 1]];
        if (special === undefined) unknown = true;
        else seq += special;
        p += 6;
      } else {
        seq += String.fromCharCode(buf[p++]);
      }
    }

    p++; // the NUL after the key chars

    const actionByte = buf[p++] ?? 0;
    const code = actionByte & 0x7F;
    let extra = '';

    if (actionByte & 0x80) {
      while (p < buf.length && buf[p] !== 0) {
        extra += String.fromCharCode(buf[p++]);
      }

      p++;
    }

    // an empty entry with A_END_LIST is a compiled #stop
    if (code === 103 && !seq) {
      stopped = true;
      continue;
    }

    if (!seq || unknown) continue;

    if (edit) {
      const canon = EDIT_CODES[code];
      if (canon !== undefined && !editKeys.has(seq)) editKeys.set(seq, canon);
    } else {
      const action = ACTION_CODES[code];
      addBinding(
        seq,
        action ?? undefined,
        ACTION_CODE_KEYS[code],
        extra || undefined
      );
    }
  }
}

/**
 * Walks a compiled #env table: name, NUL, the EV_OK|A_EXTRA marker,
 * value, NUL.
 */
function parseBinaryVars(buf: Buffer): void {
  let p = 0;

  while (p < buf.length) {
    let name = '';
    while (p < buf.length && buf[p] !== 0) {
      name += String.fromCharCode(buf[p++]);
    }

    p += 2; // the NUL and the EV_OK|A_EXTRA marker

    let value = '';
    while (p < buf.length && buf[p] !== 0) {
      value += String.fromCharCode(buf[p++]);
    }

    p++;

    if (name && !definedVars.has(name)) {
      const expanded = expandEvars(value);
      if (expanded === null) break;

      definedVars.add(name);
      currentVars.set(name, expanded);
      setLesskeyEnv(name, expanded, parsingSystem);
    }
  }
}

/**
 * Finds the lesskey source file, like add_hometable's lookup.
 */
export function lesskeyFile(): string | null {
  const configured = lgetenv('LESSKEYIN');
  if (configured) return configured;

  const xdg = lgetenv('XDG_CONFIG_HOME');

  if (xdg) {
    const name = path.join(xdg, 'lesskey');
    if (fs.existsSync(name)) return name;
  }

  const home = homeDir();
  if (!home) return null;

  const config = path.join(home, '.config', 'lesskey');
  if (fs.existsSync(config)) return config;

  return path.join(home, LESSKEYIN_NAME);
}

/**
 * Parses a lesskey source, like lesskey_parse.c's parse_lesskey:
 * #command, #line-edit and #env switch sections, #stop discards the
 * built-in bindings, #version guards a line, and other #-lines are
 * comments.
 *
 * @param text - The lesskey source.
 * @param filename - Name reported in parse errors.
 */
export function parseLesskey(
  text: string,
  filename: string,
  system: boolean = false
): number {
  parsingSystem = system;
  return parseLesskeyText(text, filename);
}

/**
 * Parses inline lesskey source, like less's parse_lesskey_content
 * (lesskey_parse.c:738): lines end at a newline OR a semicolon, a
 * backslash escapes a literal semicolon, and a line hitting the
 * 1023-char cap SPLITS - the remainder becomes the next line.
 *
 * @param text - The --lesskey-content / $LESSKEY_CONTENT value.
 */
export function parseLesskeyContent(
  text: string,
  system: boolean = false
): number {
  parsingSystem = system;
  const lines: string[] = [];
  let line = '';

  for (let i = 0; i < text.length; i++) {
    if (line.length >= 1023) {
      lines.push(line);
      line = '';
    }

    const ch = text[i];

    if (ch === '\n' || ch === ';') {
      lines.push(line);
      line = '';
      continue;
    }

    if (ch === '\\' && text[i + 1] === ';') {
      line += ';';
      i++;
      continue;
    }

    line += ch;
  }

  if (line) lines.push(line);
  return parseLesskeyText(lines.join('\n'), 'lesskey-content');
}

function parseLesskeyText(text: string, filename: string): number {
  let section: 'command' | 'edit' | 'var' = 'command';

  parseErrors = 0;
  parseFile = filename;
  lastVarName = '';
  lastVarRaw = '';
  lastVarApplied = false;
  varTableBroken = false;
  definedVars.clear();
  currentVars.clear();

  const lines = text.split('\n');

  for (let n = 0; n < lines.length; n++) {
    parseLine = n + 1;
    let line = lines[n];

    // less's line is a C STRING: fgets keeps every byte it read, but
    // control_line and clean_line walk it with strncmp and stop at the
    // first NUL (lesskey_parse.c:722), so the line IS what precedes
    // one. Handing a COMPILED lesskey to --lesskey-src is the case
    // that shows it - the file opens with a NUL, so less reads an empty
    // line and says nothing, while we read the whole blob as one line
    // and refused the file over a "missing action"
    const nul = line.indexOf('\0');
    if (nul >= 0) line = line.slice(0, nul);

    // control lines, like control_line's prefix checks
    if (line.startsWith('#line-edit')) { section = 'edit'; continue; }
    if (line.startsWith('#command')) { section = 'command'; continue; }
    if (line.startsWith('#env')) { section = 'var'; continue; }

    if (line.startsWith('#stop')) {
      if (section === 'command') stopped = true;
      continue;
    }

    if (line.startsWith('#version')) {
      const rest = versionLine(line);
      if (rest === null) continue;
      line = rest;
    }

    line = cleanLine(line);
    if (!line) continue;

    if (section === 'var') {
      parseVarLine(line);
    } else {
      parseCmdLine(line, section);
    }
  }

  return parseErrors;
}

// lesskey_parse.c's `errors` counter: parse_lesskey returns it, and
// the option handlers turn a non-zero count into their own summary
// message (optfunc.c opt_ks/opt_kc)
let parseErrors = 0;

/** Reports a parse problem, like lesskey_parse.c's parse_error. */
function parseError(message: string): void {
  parseErrors++;
  if (quietParse) return;

  const text = `${parseFile}: line ${parseLine}: ${message}`;

  if (search.message) {
    search.messageQueue.push(text);
  } else {
    search.message = text;
  }
}

/**
 * Strips leading space and an unescaped-#-to-EOL comment, like
 * clean_line.
 */
function cleanLine(line: string): string {
  const s = line.replace(/^[ \t]+/, '');

  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\r') return s.slice(0, i);

    if (s[i] === '#' && (i === 0 || s[i - 1] !== '\\')) {
      return s.slice(0, i);
    }
  }

  return s;
}

/**
 * Evaluates a #version guard, like version_line: on a match the rest
 * of the line parses normally, otherwise the line is skipped.
 *
 * @returns The rest of the line, or null when it does not apply.
 */
function versionLine(line: string): string | null {
  let s = line.slice('#version'.length).replace(/^[ \t]+/, '');
  let op = s[0] ?? '';
  s = s.slice(1);

  if (op === '<' && s[0] === '=') { op = '-'; s = s.slice(1); }
  else if (op === '>' && s[0] === '=') { op = '+'; s = s.slice(1); }
  else if ((op === '=' || op === '!') && s[0] === '=') { s = s.slice(1); }
  else if (!'<>=!'.includes(op)) {
    parseError(`invalid operator '${op}' in #version line`);
    return null;
  }

  s = s.replace(/^[ \t]+/, '');
  const match = /^\d+/.exec(s);

  if (!match) {
    parseError('non-numeric version number in #version line');
    return null;
  }

  const ver = parseInt(match[0], 10);
  const v = LESS_VERSION;

  const ok =
    op === '>' ? v > ver :
    op === '<' ? v < ver :
    op === '+' ? v >= ver :
    op === '-' ? v <= ver :
    op === '=' ? v === ver :
    v !== ver;

  return ok ? s.slice(match[0].length) : null;
}

/**
 * Translates one key token, like lesskey_parse.c's tstr: octal and
 * letter escapes, \k special key names and ^X control notation.
 *
 * @returns The translated text and the next read position.
 */
function tstr(
  line: string,
  at: number,
  xlate: boolean
): { text: string, next: number, unresolved?: boolean } {
  const c = line[at];

  if (c === '\\') {
    const e = line[at + 1] ?? '';

    if (e >= '0' && e <= '7') {
      let code = 0;
      let i = at + 1;

      for (let n = 0; n < 3 && line[i] >= '0' && line[i] <= '7'; n++) {
        code = code * 8 + (line.charCodeAt(i++) - 0x30);
      }

      return { text: String.fromCharCode(code & 0xFF), next: i };
    }

    switch (e) {
      case 'b': return { text: '\b', next: at + 2 };
      case 'e': return { text: '\x1B', next: at + 2 };
      case 'n': return { text: '\n', next: at + 2 };
      case 'r': return { text: '\r', next: at + 2 };
      case 't': return { text: '\t', next: at + 2 };

      case 'k': {
        if (!xlate) break;

        let name = line[at + 2] ?? '';
        let next = at + 3;

        if (name === '^' || name === '+' || name === 'p') {
          name += line[at + 3] ?? '';
          next++;
        }

        const seq = specialKey(name);

        if (seq === undefined) {
          // less accepts every name its tstr lists and stores a blob for
          // it; whether the TERMINAL can produce that key is decided
          // later, when the blob is resolved (decode.c). So a keypad
          // name on a terminal with no keypad binds nothing and says
          // nothing - only a name less never had is an error
          if (knownSpecialKey(name)) return { text: '', next, unresolved: true };

          parseError(`invalid escape sequence "\\k${name}"`);
          return { text: '', next };
        }

        return { text: seq, next };
      }
    }

    // backslash followed by any other char just means that char
    return { text: e, next: at + 2 };
  }

  if (c === '^' && at + 1 < line.length) {
    const code = line.charCodeAt(at + 1) & 0x1F;
    return { text: String.fromCharCode(code), next: at + 2 };
  }

  return { text: c, next: at + 1 };
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t';

/** Skips spaces and tabs from a position. */
function skipSp(line: string, at: number): number {
  while (isSpace(line[at])) at++;
  return at;
}

/**
 * Parses a `KEY ACTION [EXTRA]` line into the command or line-edit
 * table, like parse_cmdline.
 */
function parseCmdLine(line: string, section: 'command' | 'edit'): void {
  // the key sequence runs to the first unescaped whitespace
  let seq = '';
  let i = 0;
  let unresolved = false;

  do {
    const token = tstr(line, i, true);
    seq += token.text;
    unresolved ||= token.unresolved === true;
    i = token.next;
  } while (i < line.length && !isSpace(line[i]));

  i = skipSp(line, i);

  if (i >= line.length) {
    parseError('missing action');
    return;
  }

  let name = '';
  while (i < line.length && !isSpace(line[i])) name += line[i++];

  // an extra string follows the action, like A_EXTRA
  i = skipSp(line, i);
  let extra = '';

  while (i < line.length) {
    const token = tstr(line, i, false);
    extra += token.text;
    i = token.next;
  }

  if (section === 'edit') {
    const canon = EDIT_KEYS[name];

    if (canon === undefined) {
      parseError(`unknown action: "${name}"`);
      return;
    }

    // the ACTION still had to be a real one, so a typo is still
    // reported; only the key went missing
    if (unresolved) return;

    // only editing behaviors our prompts implement can be re-bound
    if (canon !== null && !editKeys.has(seq)) editKeys.set(seq, canon);
    return;
  }

  const action = CMD_ACTIONS[name];

  if (action === undefined) {
    parseError(`unknown action: "${name}"`);
    return;
  }

  // a key this terminal cannot produce binds nothing, like a blob
  // whose SK code resolves to no sequence (the binary path drops one
  // the same way). The action was still checked, so a typo above is
  // still reported
  if (unresolved) return;

  addBinding(seq, action ?? undefined, CMD_KEYS[name], extra || undefined);
}

/**
 * Stores a #command binding; the first definition wins, like less's
 * cmd_search finding the earliest table entry.
 */
function addBinding(
  seq: string,
  action: Actions | undefined,
  key?: string,
  extra?: string
): void {
  bindings.set(seq, { action, key, extra });
}

/**
 * True when more characters could complete a longer binding, like
 * cmd_search answering A_PREFIX.
 */
export function userIsPrefix(seq: string): boolean {
  for (const bound of bindings.keys()) {
    if (bound.length > seq.length && bound.startsWith(seq)) return true;
  }

  return false;
}

/**
 * Parses a `NAME = VALUE` #env line, like parse_varline: values land
 * in the session environment, `+=` appends to the last variable.
 */
function parseVarLine(line: string): void {
  // a broken ${ truncated less's whole var table: every later
  // variable in this file is dropped too
  if (varTableBroken) return;

  const eq = line.indexOf('=');

  if (eq > 0 && line[eq - 1] === '+') {
    // less appends to the previously defined variable; a definition
    // that lost to an earlier table stays invisible
    if (lastVarName && lastVarApplied) {
      lastVarRaw += varValue(line, eq + 1);
      const expanded = expandEvars(lastVarRaw);

      if (expanded === null) {
        varTableBroken = true;
        currentVars.delete(lastVarName);
        deleteLesskeyEnv(lastVarName, parsingSystem);
      } else {
        currentVars.set(lastVarName, expanded);
        setLesskeyEnv(lastVarName, expanded, parsingSystem);
      }
    }

    return;
  }

  let name = '';
  let i = 0;

  while (i < line.length && !isSpace(line[i]) && line[i] !== '=') {
    const token = tstr(line, i, false);
    name += token.text;
    i = token.next;
  }

  i = skipSp(line, i);

  if (line[i] !== '=') {
    parseError('missing = in variable definition');
    return;
  }

  const value = varValue(line, i + 1);
  lastVarName = name;
  lastVarRaw = value;

  // the first definition wins, like cmd_decode's table search, and
  // lesskey variables override the real environment, like lgetenv
  lastVarApplied = !definedVars.has(name);
  if (!lastVarApplied) return;

  const expanded = expandEvars(value);

  if (expanded === null) {
    varTableBroken = true;
    lastVarApplied = false;
    return;
  }

  definedVars.add(name);
  currentVars.set(name, expanded);
  setLesskeyEnv(name, expanded, parsingSystem);
}

/**
 * Skips to the next unescaped slash or right curly bracket, like
 * evar.c's skipsl.
 */
function skipSlash(text: string, e: number): number {
  let esc = false;

  while (e < text.length && (esc || (text[e] !== '/' && text[e] !== '}'))) {
    esc = !esc && text[e] === '\\' && e + 1 < text.length;
    e++;
  }

  return e;
}

/**
 * Measures a prefix match of a variable value against a replacement
 * pattern, like evar_match: backslashes in the pattern are skipped.
 */
function evarMatch(evar: string, v: number, pat: string): number {
  let len = 0;
  let p = 0;

  while (p < pat.length) {
    if (pat[p] === '\\') p++;
    if (evar[v + len] !== pat[p]) return 0;
    len++;
    p++;
  }

  return len;
}

/**
 * Expands `${NAME}` and `${NAME/pat/repl/...}` in a #env value, like
 * evar.c's expand_evars: each slash pair rewrites prefix matches of
 * the variable's value, later pairs tried first; a missing right
 * bracket truncates less's whole table, reported here as null.
 */
function expandEvars(text: string): string | null {
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '$' || text[i + 1] !== '{') {
      out += text[i++];
      continue;
    }

    i += 2;
    let e = i;
    while (e < text.length && text[e] !== '}' && text[e] !== '/') e++;

    // missing right curly bracket truncates the table
    if (e >= text.length) return null;

    const name = text.slice(i, e);
    let term = text[e++];
    const evar = currentVars.get(name) ?? lgetenv(name) ?? '';

    // (slash, pattern, slash, replacement)... like make_replaces
    const replaces: { fm: string, to: string }[] = [];

    while (term === '/') {
      const fm = e;
      e = skipSlash(text, e);
      if (e >= text.length) break;

      if (e === fm) {
        // missing pattern: skip past the closing bracket
        while (e < text.length) if (text[e++] === '}') break;
        break;
      }

      term = text[e];
      const fmStr = text.slice(fm, e);
      e++;

      let toStr = '';

      if (term === '/') {
        const to = e;
        e = skipSlash(text, e);
        if (e >= text.length) break;

        term = text[e];
        toStr = text.slice(to, e);
        e++;
      }

      // less prepends to the list, so later pairs are tried first
      replaces.unshift({ fm: fmStr, to: toStr });
    }

    // emit the value, rewriting matches like add_evar
    let v = 0;

    while (v < evar.length) {
      let matched = 0;

      for (const { fm, to } of replaces) {
        matched = evarMatch(evar, v, fm);
        if (!matched) continue;

        v += matched;

        for (let r = 0; r < to.length; r++) {
          if (to[r] === '\\' && r + 1 < to.length) r++;
          out += to[r];
        }

        break;
      }

      if (!matched) out += evar[v++];
    }

    i = e;
  }

  return out;
}

/** Reads a variable value from a position, escapes translated. */
function varValue(line: string, at: number): string {
  let i = skipSp(line, at);
  let value = '';

  while (i < line.length) {
    const token = tstr(line, i, false);
    value += token.text;
    i = token.next;
  }

  return value;
}
