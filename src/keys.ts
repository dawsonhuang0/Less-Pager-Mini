import { Actions } from "./state/interfaces";

import { terminalCapability } from './tty/terminal';

/**
 * Matches one key at a time: a full CSI escape sequence (arrows, SGR mouse),
 * an ESC-prefixed combination, or a single code point.
 */
const KEY_SEQUENCE_REGEX =
  // an X10/X11 mouse report is THREE raw bytes after a complete CSI
  // ("ESC [ M" ends at its final byte), so it has to be claimed
  // before the general CSI rule or the coordinates arrive as three
  // separate keys - less reads them with getcc, one at a time, from
  // inside the action itself (decode.c x11mouse_action)
  new RegExp(
    '\\x1B\\[M[\\s\\S]{3}' +
    '|\\x1B\\[[\\x20-\\x3F]*[\\x40-\\x7E]' +
    '|\\x1BO[\\x40-\\x7E]|\\x1B[\\s\\S]|[\\s\\S]',
    'gu'
  );

/**
 * Splits raw terminal input into individual key sequences.
 *
 * - Terminals batch rapid input (mouse wheel, held keys, pastes) into one
 *   stdin chunk; each contained sequence must be handled separately.
 *
 * @param data - Raw input chunk from stdin.
 * @returns Array of individual key sequences.
 */
export function splitKeys(data: string): string[] {
  return data.match(KEY_SEQUENCE_REGEX) ?? [];
}

/**
 * less's kent translation (getcc_repl, command.c:1172): the terminal's
 * keypad-Enter sequence (terminfo kent, \eOM on xterm) reads as a
 * newline at getcc - commands and prompts alike - unless a lesskey
 * file mapped it. error()'s get_return reads RAW getchr instead, so
 * at a message the ESC ungets (dismissing) and the re-formed \eOM
 * becomes the NEXT command's newline: dismiss AND move.
 */
export function kentToNewline(key: string): string {
  return key === kentSequence() ? '\n' : key;
}

/** The terminal's keypad-Enter sequence, empty when it has none. */
export const kentSequence = (): string =>
  terminalCapability('kent', '@8') ?? '\x1bOM';

/**
 * Maps a key press to a corresponding pager action.
 *
 * @param key - A single-character string from user input.
 * @returns The corresponding `Actions` type if defined, otherwise `undefined`.
 */
/**
 * less's A_PREFIX test (cmd_decode, decode.c): the bytes in hand are a
 * proper prefix of some entry in the command table, so the command is
 * incomplete and the loop reads another character.
 *
 * less derives it from the TABLE. Ours hardcoded three characters
 * (`^X`, `:`, `^O`), so every other multi-key binding was
 * unreachable - `ZZ` is `'Z','Z',0, A_QUIT` (decode.c:236), and with
 * `Z` absent from that list its second key never had a chance.
 */
export function isKeyPrefix(keys: string): boolean {
  if (!keys) return false;

  for (const bound of Object.keys(boundKeys())) {
    if (bound.length > keys.length && bound.startsWith(keys)) return true;
  }

  return false;
}

export function getAction(key: string): Actions | undefined {
  if (key.startsWith('\x1b[<64;')) return 'LINE_BACKWARD';
  if (key.startsWith('\x1b[<65;')) return 'LINE_FORWARD';

  return boundKeys()[key];
}

/**
 * The special keys: the capability less reads for each, and every
 * other spelling the key is known by.
 *
 * ALL of them are bound, whatever the terminal said - v1.12.1's rule,
 * restored in full. Its line was
 * `terminalCapability(ti, tc) ?? fallback`, and that build is the one
 * known to work where nothing since has.
 *
 * The reason it has to be all of them, rather than the capability
 * plus a fallback when nothing answered: a terminal does not
 * necessarily send the same spelling for every source of the same
 * key. We send smkx, asking for DECCKM, and the KEYBOARD arrows come
 * back as \eOA - but a WHEEL tick translated to an arrow commonly
 * ignores DECCKM and arrives as \e[A. Binding only what terminfo
 * named left the keyboard working and the wheel dead, on a terminal
 * that had described itself perfectly well.
 *
 * TODO: this is not less's rule, and less's is the better one where
 * it can be applied. less fills each slot from terminfo
 * (special_key_str, screen.c:1218) and writes "\377" when the
 * capability is missing (decode.c:390), so a key the entry omits is
 * genuinely unbound and a second spelling rings the bell - TERM=dumb
 * is MEANT to have no arrows, and now gets them. less can afford that
 * because it links curses and always HAS an entry, and because it is
 * not trying to be one binary across terminals that disagree about
 * which spelling a wheel produces. Putting it back means knowing what
 * every source of a key actually sends, measured, not assumed:
 * $LMN_KEY_TRACE prints exactly that.
 *
 * The SGR wheel reports are bound separately in getAction and are
 * unaffected either way; they were identical in v1.12.1.
 */
const SPECIAL_KEYS: Array<[string, string, string[], Actions]> = [
  ['kcuf1', 'kr', ['\x1b[C', '\x1bOC'], 'SET_HALF_SCREEN_RIGHT'],
  ['kcub1', 'kl', ['\x1b[D', '\x1bOD'], 'SET_HALF_SCREEN_LEFT'],
  ['kcuu1', 'ku', ['\x1b[A', '\x1bOA'], 'LINE_BACKWARD'],
  ['kcud1', 'kd', ['\x1b[B', '\x1bOB'], 'LINE_FORWARD'],
  ['kpp', 'kP', ['\x1b[5~'], 'WINDOW_BACKWARD'],
  ['knp', 'kN', ['\x1b[6~'], 'WINDOW_FORWARD'],
  ['khome', 'kh', ['\x1b[H', '\x1bOH', '\x1b[1~'], 'FIRST_LINE'],
  ['kend', '@7', ['\x1b[F', '\x1bOF', '\x1b[4~'], 'LAST_LINE'],
  ['kf1', 'k1', ['\x1bOP', '\x1b[11~'], 'HELP'],
];

let bound: Record<string, Actions> | null = null;

/**
 * The one command table, terminfo strings included.
 *
 * less has a single cmdtable that already HOLDS each special key's real
 * bytes, so the same table answers both a direct lookup and
 * cmd_match's tail scan. Keeping the terminfo keys in a list beside
 * the table would hide them from [[tailDecode]], and an arrow would
 * stop resolving the moment it arrived behind a stray ESC.
 */
function boundKeys(): Record<string, Actions> {
  if (bound) return bound;

  bound = { ...keys };

  for (const [ti, tc, fallbacks, action] of SPECIAL_KEYS) {
    const seq = terminalCapability(ti, tc);

    if (seq) bound[seq] = action;

    for (const spelling of fallbacks) {
      if (!(spelling in bound)) bound[spelling] = action;
    }
  }

  return bound;
}

/**
 * less's cmd_match (decode.c:845): the largest N where the first N
 * chars of a binding equal the LAST N chars of the buffer.
 */
function tailMatch(buf: string, entry: string): number {
  for (let n = Math.min(buf.length, entry.length); n > 0; n--) {
    if (buf.slice(-n) === entry.slice(0, n)) return n;
  }

  return 0;
}

/**
 * Decodes an accumulated buffer like less's cmd_decode (decode.c:943):
 * bindings match against the buffer's TAIL, so stray prefix bytes
 * age out silently.
 *
 * @returns The binding the tail completes, `prefix` while more
 *          input could complete one, or `invalid`.
 */
function tailDecode(buf: string): string | 'prefix' | 'invalid' {
  let matchLen = 0;
  let result: string | 'prefix' | 'invalid' = 'invalid';

  for (const entry of Object.keys(boundKeys())) {
    const t = tailMatch(buf, entry);
    if (t === 0 || t < matchLen) continue;

    // less's sequential scan: later entries take ties, an equal-length
    // partial outranking an earlier completion
    result = t === entry.length ? entry : 'prefix';
    matchLen = t;
  }

  return result;
}

/**
 * Resolves the bytes of an unbound sequence like less reprocessing
 * them through cmd_decode: a completed tail binding comes out as a
 * replayable key (ESC j still scrolls, a digit still counts), an
 * unmatched buffer as null - ONE invalid command, bell and count
 * dropped. less keeps waiting on a trailing partial match; sequences
 * arrive whole here, so a dangling prefix simply drops.
 */
export function tailCascade(stream: string): Array<string | null> {
  const out: Array<string | null> = [];
  let buf = '';

  for (const ch of stream) {
    buf += ch;
    const m = tailDecode(buf);

    if (m === 'prefix') continue;

    buf = '';
    out.push(m === 'invalid' ? null : m);
  }

  return out;
}

/**
 * Maps single-character key inputs to their corresponding pager actions.
 *
 * This keybinding object enables interpreting user keystrokes (like `:` or `q`)
 * into `Actions` understood by the pager.
 * Supports control characters (e.g., ^C), punctuation, and printable ASCII.
 */
/* v8 ignore next */ // test coverage ignored because object has no logic
const keys: Record<string, Actions> = {
  /**
   * (N) - any number
   * (*) - supports (N) as prefix
   * EOF - end-of-file
   */

  // add buffer
  '0': 'ADD_BUFFER', // 0
  '1': 'ADD_BUFFER', // 1
  '2': 'ADD_BUFFER', // 2
  '3': 'ADD_BUFFER', // 3
  '4': 'ADD_BUFFER', // 4
  '5': 'ADD_BUFFER', // 5
  '6': 'ADD_BUFFER', // 6
  '7': 'ADD_BUFFER', // 7
  '8': 'ADD_BUFFER', // 8
  '9': 'ADD_BUFFER', // 9

  // delete buffer
  '\x08': 'DEL_BUFFER', // backspace
  '\x7F': 'DEL_BUFFER', // delete

  // examine a new file
  // less binds all three of E, :e and ^X^V to A_EXAMINE
  // (decode.c:168). Without the bare E the key fell through to the
  // unbound-key path and every character of the filename after it
  // ran as a COMMAND - "Eb2.txt" executed b, 2, ., t, x, t.
  'E': 'OPEN_FILE', // E
  ':e': 'OPEN_FILE', // :e

  // (*) examine the (N-th) next file from the command line
  ':n': 'NEXT_FILE', // :n

  // (*) examine the (N-th) previous file from the command line
  ':p': 'PREV_FILE', // :p

  // (*) examine the first (or N-th) file from the command line
  ':x': 'INDEX_FILE', // :x

  // delete the current file from the command line list
  ':d': 'REMOVE_FILE', // :d

  // go to a tag: toggle-option t, like less's :t binding
  ':t': 'OPTION_TAG', // :t

  // print current file name
  ':f': 'CURRENT_INFO', // :f

  // exit
  ':q': 'EXIT', // :q
  ':Q': 'EXIT', // :Q

  // less's table is `'Z','Z',0, A_QUIT` (decode.c:236): ZZ is a TWO-key
  // command and a lone Z is an incomplete one. Binding Z by itself
  // meant the second Z never arrived, and the action it named had no
  // handler at all - so ZZ rang the bell instead of quitting.
  'ZZ': 'EXIT', // ZZ

  // ESC command
  '\x1B': 'ESC', // ESC

  // hythen & underline command
  '\x2D': 'TAG_COMMAND', // -
  '\x5F': 'TAG_COMMAND', // _

  // add command to run when opening a new file
  '\x2B': 'ADD_COMMAND', // +

  // run shell command
  '\x21': 'SHELL_COMMAND', // !

  // run shell command, expanded like a prompt
  '\x23': 'PSHELL_COMMAND', // #

  // pipe file between current pos & mark to shell command
  '\x7C': 'PIPE_COMMAND', // |

  // save input to a file
  '\x73': 'SAVE_FILE', // s

  // edit the current file with $VISUAL or $EDITOR
  '\x76': 'EDIT_FILE', // v

  // quit current feature
  '\x03': 'QUIT', // ^C

  // help
  '\x68': 'HELP', // h
  '\x48': 'HELP', // H

  // exit
  '\x71': 'EXIT', // q
  '\x51': 'EXIT', // Q

  // NOT ^Z. That is VSUSP, which a terminal driver turns into SIGTSTP
  // before any program sees the byte - which is why less binds it
  // nowhere: CONTROL('Z') appears nowhere in decode.c, and its `ZZ`
  // quit is two capital Zs (decode.c:236). node's raw mode clears
  // ISIG, so the byte reaches us instead, and binding it here made ^Z
  // EXIT the pager where less suspends. core.ts raises the signal
  // instead, from SIGNAL_KEYS.

  // (*) forward one line (or (N) lines)
  '\x65': 'LINE_FORWARD', // e
  '\x05': 'LINE_FORWARD', // ^E
  '\x6A': 'LINE_FORWARD', // j
  '\x0E': 'LINE_FORWARD', // ^N
  '\x0D': 'LINE_FORWARD', // CR
  '\x0A': 'LINE_FORWARD', // LF

  // (*) backward one line (or (N) lines)
  '\x79': 'LINE_BACKWARD', // y
  '\x19': 'LINE_BACKWARD', // ^Y
  '\x6B': 'LINE_BACKWARD', // k
  '\x0B': 'LINE_BACKWARD', // ^K
  '\x10': 'LINE_BACKWARD', // ^P

  // (*) forward one window (or (N) lines)
  '\x66': 'WINDOW_FORWARD', // f
  '\x06': 'WINDOW_FORWARD', // ^F
  '\x16': 'WINDOW_FORWARD', // ^V
  '\x20': 'WINDOW_FORWARD', // SPACE

  // (*) backward one window (or (N) lines)
  '\x62': 'WINDOW_BACKWARD', // b
  '\x02': 'WINDOW_BACKWARD', // ^B
  't': 'NEXT_TAG', // (*) t
  'T': 'PREV_TAG', // (*) T

  'J': 'FORCE_LINE_FORWARD', // (*) J
  'K': 'FORCE_LINE_BACKWARD', // (*) K
  'Y': 'FORCE_LINE_BACKWARD', // (*) Y
  'P': 'GO_POS', // (N) P

  '\x1Bv': 'WINDOW_BACKWARD', // ESC-v

  // (*) forward one window (and set window to (N))
  '\x7A': 'SET_WINDOW_FORWARD', // z

  // (*) backward one window (and set window to (N))
  '\x77': 'SET_WINDOW_BACKWARD', // w

  // (*) forward one window but don't stop at EOF
  '\x1B\x20': 'NO_EOF_WINDOW_FORWARD', // ESC-SPACE
  '\x1Bb': 'FORCE_WINDOW_BACKWARD', // (*) ESC-b
  '\x1Bj': 'NEWLINE_FORWARD', // (*) ESC-j
  '\x1Bk': 'NEWLINE_BACKWARD', // (*) ESC-k


  // forward forever, like "tail -f"
  '\x46': 'FOLLOW', // F

  // like F, ringing the bell when the search pattern matches new data
  '\x1Bf': 'FOLLOW_BELL', // ESC-f

  // like F, but stop when the search pattern is found
  '\x1BF': 'FOLLOW_HILITE', // ESC-F

  // (*) forward one half-window (and set half-window to (N))
  '\x64': 'SET_HALF_WINDOW_FORWARD', // d
  '\x04': 'SET_HALF_WINDOW_FORWARD', // ^D

  // (*) backward one half-window (and set half-window to (N))
  '\x75': 'SET_HALF_WINDOW_BACKWARD', // u
  '\x15': 'SET_HALF_WINDOW_BACKWARD', // ^U

  // (*) right one half screen width (or (N) positions)
  '\x1B)': 'SET_HALF_SCREEN_RIGHT', // ESC-)

  // (*) left one half screen width (or (N) positions)
  '\x1B(': 'SET_HALF_SCREEN_LEFT', // ESC-(

  // right to last column displayed
  '\x1B}': 'LAST_COL', // ESC-}
  '\x1B[1;5C': 'LAST_COL', // ^RIGHT ARROW
  
  // left to first column
  '\x1B{': 'FIRST_COL', // ESC-{
  '\x1B[1;5D': 'FIRST_COL', // ^LEFT ARROW

  // repaint screen
  '\x72': 'REPAINT', // r
  '\x12': 'REPAINT', // ^R
  '\x0C': 'REPAINT', // ^L

  // repaint screen, discarding buffered input
  '\x52': 'DROP_INPUT_REPAINT', // R

  // (*) search forward for (N)-th matching line
  '\x2F': 'SEARCH_FORWARD', // /

  // (*) search backward for (N)-th matching line
  '\x3F': 'SEARCH_BACKWARD', // ?

  // (*) repeat previous search (for (N)-th occurrence)
  '\x6E': 'REPEAT_SEARCH', // n
  '\x1Bn': 'SPAN_REPEAT_SEARCH', // ESC-n (spans the file list)

  // (*) repeat previous search in reverse direction
  '\x4E': 'REVERSE_SEARCH', // N
  '\x1BN': 'SPAN_REVERSE_SEARCH', // ESC-N (spans the file list)

  // undo (toggle) search highlighting
  '\x1Bu': 'HIGHLIGHT_TOGGLE', // ESC-u

  // clear search highlighting
  '\x1BU': 'CLEAR_SEARCH', // ESC-U

  // (*) display only matching lines
  '\x26': 'PATTERN_ONLY', // &

  // (*) go to first line in file (or line (N))
  '\x67': 'FIRST_LINE', // g
  '\x3C': 'FIRST_LINE', // <
  '\x1B<': 'FIRST_LINE', // ESC-<

  // (*) go to last line in file (or line (N))
  '\x47': 'LAST_LINE', // G
  '\x3E': 'LAST_LINE', // >
  '\x1B>': 'LAST_LINE', // ESC->

  // (*) go to beginning of file (or (N) percent into file)
  '\x70': 'PERCENT_LINE', // p
  '\x25': 'PERCENT_LINE', // %

  // (*) find close bracket } ) ]
  '\x7B': 'CURLY_BRACKET_RIGHT', // {
  '\x28': 'ROUND_BRACKET_RIGHT', // (
  '\x5B': 'SQUARE_BRACKET_RIGHT', // [

  // (*) find open bracket { ( [
  '\x7D': 'CURLY_BRACKET_LEFT', // }
  '\x29': 'ROUND_BRACKET_LEFT', // )
  '\x5D': 'SQUARE_BRACKET_LEFT', // ]

  // mark the current top line with <letter>
  '\x6D': 'SET_MARK', // m

  // mark the current bottom line with <letter>
  '\x4D': 'SET_MARK_BOTTOM', // M

  // (*) go to a previously marked position
  '\x27': 'GO_MARK', // '
  '\x18\x18': 'GO_MARK', // ^X^X

  // OSC 8 hyperlink selection, jump and open (v696+)
  '\x0F\x0E': 'OSC8_FORWARD', // ^O^N
  '\x0Fn': 'OSC8_FORWARD',
  '\x0F\x10': 'OSC8_BACKWARD', // ^O^P
  '\x0Fp': 'OSC8_BACKWARD',
  '\x0F\x0C': 'OSC8_JUMP', // ^O^L
  '\x0Fl': 'OSC8_JUMP',
  '\x0F\x0F': 'OSC8_OPEN', // ^O^O
  '\x0Fo': 'OSC8_OPEN',

  // clear a mark
  '\x1Bm': 'CLEAR_MARK', // ESC-m

  // (*) find close bracket <c2>
  '\x1B\x06': 'CUSTOM_BRACKET_RIGHT', // ESC-^F

  // (*) find open bracket <c1>
  '\x1B\x02': 'CUSTOM_BRACKET_LEFT', // ESC-^B

  // examine a new file
  '\x18\x16': 'OPEN_FILE', // ^X^V

  // print current file name
  '\x3D': 'CURRENT_INFO', // =
  '\x07': 'CURRENT_INFO', // ^G

  // print version number of "less-pager-mini"
  '\x56': 'VERSION', // V
};
