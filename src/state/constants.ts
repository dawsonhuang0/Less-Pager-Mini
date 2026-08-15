
import { lgetenv } from '../startup/environment';

import { formatTerminalCapability, terminalCapability, terminalFlag,
  terminfoAnswered } from '../tty/terminal';

export const ASCII_REGEX = /^[\x00-\x7F]*$/;

// escape-sequence recognition, like line.c's ansi_step: any run of
// middle characters after ESC, closed by an end character
const DEFAULT_MID_CHARS = '0123456789:;[?!"\'#%()*+ ';
const DEFAULT_END_CHARS = 'm';

/** Escapes a character for a regex character class. */
const classEscape = (text: string): string =>
  text.replace(/[\\\]^-]/g, '\\$&');

const regexEscape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Builds the sequence regex from mid and end character sets. */
function styleRegex(
  mid: string,
  end: string,
  flags: string,
  oscAllow: string = '',
  oscChars: string = ''
): RegExp {
  // an end character never acts as a middle one, like is_ansi_middle
  const pureMid = [...mid].filter(ch => !end.includes(ch)).join('');

  const csi = `\\x1b[${classEscape(pureMid)}]*[${classEscape(end)}]`;
  const types = new Set(['8']);
  for (const match of oscAllow.matchAll(/\d+/g)) types.add(match[0]);

  // In file contents, an extra untyped OSC intro is enabled only by
  // the following '*' marker. The standard ']' intro is typed and
  // validated against OSC 8 plus LESSANSIOSCALLOW.
  const custom: string[] = [];
  for (let i = 0; i + 1 < oscChars.length; i++) {
    if (oscChars[i + 1] === '*') custom.push(oscChars[i]);
  }
  const body = `(?:[^\\x07\\x1b]|\\x1b(?!\\\\))*`;
  const endOsc = `(?:\\x07|\\x1b\\\\)`;
  const osc = [
    `\\x1b\\](?:${[...types].join('|')});${body}${endOsc}`,
    ...custom.map(char =>
      `\\x1b${regexEscape(char)}${body}${endOsc}`),
  ];

  return new RegExp(`(?:${csi}|${osc.join('|')})`, flags);
}

// the live sets behind the regexes, for the character-at-a-time walk
// og's ansi_step does when a sequence turns out to be invalid
let midChars = DEFAULT_MID_CHARS;
let endChars = DEFAULT_END_CHARS;
let oscIntroChars = '';

/** og's is_ansi_middle set ($LESSANSIMIDCHARS). */
export const ansiMidChars = (): string => midChars;

/** og's is_ansi_end set ($LESSANSIENDCHARS). */
export const ansiEndChars = (): string => endChars;

/** og's osc_ansi_chars ($LESSANSIOSCCHARS): extra OSC intro chars. */
export const ansiOscChars = (): string => oscIntroChars;

/**
 * A "designate a character set" escape: ESC, one of ( ) * +, then the
 * set's name. Not SGR, and og's ANSI rule cannot close it - its end
 * chars default to just "m" (line.c:164) - so it is not a sequence to
 * either engine. og never meets one in text because it keeps its
 * attributes beside the characters rather than in them; we inline
 * ours, and terminfo's sgr0 leads with "\E(B" on xterm, so anything
 * MEASURING our display text has to skip it or count three columns
 * that are not there.
 */
export const CHARSET_DESIGNATION_G = /\x1b[()*+][\x20-\x2f]*[\x30-\x7e]/g;

export let STYLE_REGEX = styleRegex(DEFAULT_MID_CHARS, DEFAULT_END_CHARS, '');
export let STYLE_REGEX_G =
  styleRegex(DEFAULT_MID_CHARS, DEFAULT_END_CHARS, 'g');

/**
 * A style sequence OR a charset designation, for the callers that lay
 * text out in COLUMNS. Both are zero-width, but only the first is a
 * sequence by og's rule - see CHARSET_DESIGNATION_G. Parsing of FILE
 * content keeps to STYLE_REGEX, which is og's rule exactly.
 */
export let STYLE_OR_CHARSET_G = new RegExp(
  `(?:${STYLE_REGEX_G.source}|${CHARSET_DESIGNATION_G.source})`, 'g');

/**
 * Rebuilds the sequence regexes from $LESSANSIMIDCHARS and
 * $LESSANSIENDCHARS, like init_line.
 */
export function initAnsiChars(): void {
  const mid = lgetenv('LESSANSIMIDCHARS') || DEFAULT_MID_CHARS;
  const end = lgetenv('LESSANSIENDCHARS') || DEFAULT_END_CHARS;
  const oscAllow = lgetenv('LESSANSIOSCALLOW') || '';
  const oscChars = lgetenv('LESSANSIOSCCHARS') || '';

  midChars = mid;
  endChars = end;
  oscIntroChars = oscChars;

  STYLE_REGEX = styleRegex(mid, end, '', oscAllow, oscChars);
  STYLE_REGEX_G = styleRegex(mid, end, 'g', oscAllow, oscChars);
  STYLE_OR_CHARSET_G = new RegExp(
    `(?:${STYLE_REGEX_G.source}|${CHARSET_DESIGNATION_G.source})`, 'g');
}

export const CONSOLE_TITLE_START = '\x1b]0;';
export const CONSOLE_TITLE_END = '\x07';
export const CONSOLE_TITLE_RESET = CONSOLE_TITLE_START + CONSOLE_TITLE_END;

export const CONSOLE_CLEAR = '\x1b[2J\x1b[H';

export let CURSOR_HOME = '\x1b[H';
export let CLEAR_LINE = '\x1b[K';
export let CLEAR_BELOW = '\x1b[J';

/**
 * og's auto_wrap and defer_wrap (screen.c:1531): termcap "am" and "xn".
 *
 * auto_wrap - the terminal moves to the next line by itself once a
 * character lands past the right margin. defer_wrap - it holds that
 * move until the NEXT character arrives (xterm's magic margin), so a
 * full-width row leaves the cursor parked on the last column.
 *
 * The pair decides how a full row ends (line.c:1523), and the three
 * answers really differ: without xenl a full row must be followed by
 * NOTHING, because the terminal has already wrapped - a newline there
 * costs a whole blank line, and the deferred-wrap nudge costs one too.
 * Both default to true when the terminal says nothing, which is xterm,
 * the same assumption every escape string above makes.
 */
export let AUTO_WRAP = true;
export let DEFER_WRAP = true;

// og's terminfo clear (home + erase) and scroll-reverse strings,
// used by the -X main-screen paint model
export let CLEAR_SCREEN = '\x1b[H\x1b[2J';
export let REVERSE_INDEX = '\x1bM';

// terminfo's cup takes ZERO-based coordinates and carries %i to add
// the one the escape wants -- xterm's is "\E[%i%p1%d;%p2%dH". Our
// callers count from 1, so the conversion happens here and the
// fallback carries %i too, keeping one contract either way. Without
// it, a database-supplied cup incremented an already-1-based row and
// addressed line 11 of a ten-line screen.
let cursorToCapability = '\x1b[%i%p1%d;%p2%dH';
export const CURSOR_TO = (row: number, col: number): string =>
  formatTerminalCapability(cursorToCapability, row - 1, col - 1);

// synchronized output (mode 2026): supporting terminals render the
// whole frame atomically; others ignore it
const SYNC_ON = '\x1b[?2026h';
const SYNC_OFF = '\x1b[?2026l';

/** True while the pager owns a switchable alternate screen, like og
 *  testing sc_init and sc_deinit before it homes to the lower left. */
export let ON_ALTERNATE_SCREEN = true;

export let ALTERNATE_CONSOLE_ON = '\x1b[?1049h';
export let ALTERNATE_CONSOLE_OFF = '\x1b[?1049l';

// terminfo smkx/rmkx (DECCKM + DECKPAM), like less's keypad init;
// Apple Terminal converts wheel scrolling to arrow keys in this mode
export let KEYPAD_ON = '\x1b[?1h\x1b=';
export let KEYPAD_OFF = '\x1b[?1l\x1b>';

// og's mousecap enables button events, button-motion (drags) and
// SGR encoding: "\e[?1000h\e[?1002h\e[?1006h" (screen.c)
export let MOUSE_ON = '\x1b[?1000h\x1b[?1002h';
export let MOUSE_OFF = '\x1b[?1002l\x1b[?1000l';

export let MOUSE_SGR_ON = '\x1b[?1006h';
export let MOUSE_SGR_OFF = '\x1b[?1006l';

// bracketed paste markers, enabled by --no-paste
export let BRACKETED_PASTE_ON = '\x1b[?2004h';
export let BRACKETED_PASTE_OFF = '\x1b[?2004l';

export let TERMINAL_SUSPEND = SYNC_ON;
export let TERMINAL_RESUME = SYNC_OFF;
export let VISUAL_BELL: string | null = null;

export let STYLE_RESET = '\x1b[0m';

/**
 * og's color reset, which is NOT the attribute one.
 *
 * A colored run ends with a literal "\033[m" (line.c:1445) — og writes
 * the bytes itself rather than asking terminfo. Attribute runs end
 * with sgr0 instead, which on xterm carries a "\E(B" charset
 * designation in front. Using sgr0 for a color left that designation
 * in the message text, where nothing can recognise it as a sequence
 * (og's ANSI rule wants an END char, by default only "m") — so its
 * three bytes counted as printing columns and the cursor parked three
 * columns right of every message under --use-color.
 */
export const COLOR_RESET = '\x1b[m';

export let INVERSE_ON = '\x1b[7m';
export let INVERSE_OFF = '\x1b[27m';

export let BOLD_ON = '\x1b[1m';

// og exits bold through terminfo's sgr0 (no individual bold-off
// exists), a FULL attribute reset: a leaked SGR — say an
// --end-prompt color marker — dies at the first bold text (the
// tilde rows, help's SUMMARY), while standout/underline end with
// their own 27/24 and let it live on
export let BOLD_OFF = '\x1b[m';

export let UNDERLINE_ON = '\x1B[4m';
export let UNDERLINE_OFF = '\x1B[24m';

export let END_MARKER = INVERSE_ON + '(END)' + INVERSE_OFF;

/** Rebuilds every terminal string that this pager consumes. */
export function initTerminalCapabilities(): void {
  ALTERNATE_CONSOLE_ON = terminalCapability('smcup', 'ti') ?? '\x1b[?1049h';
  ALTERNATE_CONSOLE_OFF = terminalCapability('rmcup', 'te') ?? '\x1b[?1049l';

  // og's term_init only treats the screen as an ALTERNATE one when
  // both strings exist and "NR" does not deny it (screen.c:2061); a
  // terminal that cannot switch keeps its scrollback, so og neither
  // homes to the lower left nor expects the switch to undo itself
  ON_ALTERNATE_SCREEN = ALTERNATE_CONSOLE_ON !== '' &&
    ALTERNATE_CONSOLE_OFF !== '' &&
    !(terminalFlag('nrrmc', 'NR') ?? false);
  AUTO_WRAP = terminalFlag('am', 'am') ?? true;
  DEFER_WRAP = terminalFlag('xenl', 'xn') ?? true;
  KEYPAD_ON = terminalCapability('smkx', 'ks') ?? '\x1b[?1h\x1b=';
  KEYPAD_OFF = terminalCapability('rmkx', 'ke') ?? '\x1b[?1l\x1b>';

  const mouseStart = terminalCapability('MOUSE_START', 'MOUSE_START');
  MOUSE_ON = mouseStart ?? '\x1b[?1000h\x1b[?1002h';
  MOUSE_SGR_ON = mouseStart === undefined ? '\x1b[?1006h' : '';
  const mouseEnd = terminalCapability('MOUSE_END', 'MOUSE_END');
  MOUSE_OFF = mouseEnd ?? '\x1b[?1002l\x1b[?1000l';
  MOUSE_SGR_OFF = mouseEnd === undefined ? '\x1b[?1006l' : '';

  BRACKETED_PASTE_ON =
    terminalCapability('BRACKETED_PASTE_START', 'BRACKETED_PASTE_START') ??
    '\x1b[?2004h';
  BRACKETED_PASTE_OFF =
    terminalCapability('BRACKETED_PASTE_END', 'BRACKETED_PASTE_END') ??
    '\x1b[?2004l';

  TERMINAL_SUSPEND = terminalCapability('SUSPEND', 'SUSPEND') ?? SYNC_ON;
  TERMINAL_RESUME = terminalCapability('RESUME', 'RESUME') ?? SYNC_OFF;
  // og's fallbacks are text, not ANSI guesses: sc_home is
  // cheaper(home, cup(0,0), "|\b^") and sc_clear is "\n\n" with
  // missing_cap (screen.c:1626, :1680). A terminal that has neither
  // gets those, which is exactly what its dumb painter draws
  CURSOR_HOME = terminalCapability('home', 'ho') ?? '|\b^';
  cursorToCapability = terminalCapability('cup', 'cm') ??
    '\x1b[%i%p1%d;%p2%dH';
  // og does NOT guess at "el"/"ed": a terminal without them gets the
  // empty string and missing_cap (screen.c:1613, :1618), so nothing at
  // all is written where the clear would go. Guessing ESC[K put the
  // one escape sequence a dumb terminal ever saw into its output.
  CLEAR_LINE = terminalCapability('el', 'ce') ?? '';
  CLEAR_BELOW = terminalCapability('ed', 'cd') ?? '';
  CLEAR_SCREEN = terminalCapability('clear', 'cl') ?? '\n\n';
  // og's sc_addline is "al" or "ri", whichever is cheaper, and EMPTY
  // when the terminal has neither - which sets no_back_scroll and
  // forces a repaint on every backward movement (screen.c:1707)
  REVERSE_INDEX = terminalCapability('ill', 'al') ??
    terminalCapability('ri', 'sr') ?? '';
  VISUAL_BELL = terminalCapability('flash', 'vb') ?? null;

  // og's attribute exits go through tmodes(..., "sgr0", ..., "me")
  // (screen.c:1788), so a bold or standout run ends with the FULL
  // capability -- on xterm "\E(B\E[m", the SGR reset preceded by
  // designating ASCII as G0. -N's line numbers end exactly that way in
  // og's bytes, so this keeps the capability whole.
  //
  // A terminal whose entry has no sgr0 leaves og with "", but this
  // file also uses STYLE_RESET as its own "the styles end here"
  // sentinel -- split on, compared against -- so it keeps a value.
  // Only what tmodes hands to the TERMINAL goes empty.
  STYLE_RESET = terminalCapability('sgr0', 'me') ?? '\x1b(B\x1b[m';

  // og's order, and its defaults: standout falls back to nothing at
  // all, and the other three fall back to STANDOUT (screen.c:1645).
  [INVERSE_ON, INVERSE_OFF] =
    tmodes('smso', 'so', 'rmso', 'se', '', '', '\x1b[7m', '\x1b[27m');
  [UNDERLINE_ON, UNDERLINE_OFF] = tmodes('smul', 'us', 'rmul', 'ue',
    INVERSE_ON, INVERSE_OFF, '\x1b[4m', STYLE_RESET);
  [BOLD_ON, BOLD_OFF] = tmodes('bold', 'md', 'sgr0', 'me',
    INVERSE_ON, INVERSE_OFF, '\x1b[1m', STYLE_RESET);

  END_MARKER = INVERSE_ON + '(END)' + INVERSE_OFF;
}

/**
 * og's tmodes (screen.c:1774): one attribute's enter/exit pair.
 *
 * The ENTER capability decides. Missing, the pair falls back whole -
 * both strings - to the defaults it is handed; og gives standout the
 * empty pair, so a terminal without "smso" simply never stands out,
 * and hands the others standout's pair, so bold and underline come
 * out as standout on a terminal that has only that. Present, the exit
 * is looked up on its own, then sgr0, then the empty string.
 *
 * `guess` is ours, not og's: it applies only where no terminal entry
 * was found at all, which for og cannot happen (see terminfoAnswered).
 */
function tmodes(
  enterInfo: string,
  enterCap: string,
  exitInfo: string,
  exitCap: string,
  defaultEnter: string,
  defaultExit: string,
  guessEnter: string,
  guessExit: string
): [string, string] {
  const enter = terminalCapability(enterInfo, enterCap);

  if (enter === undefined) {
    return terminfoAnswered()
      ? [defaultEnter, defaultExit]
      : [guessEnter, guessExit];
  }

  const exit = terminalCapability(exitInfo, exitCap) ??
    terminalCapability('sgr0', 'me') ??
    (terminfoAnswered() ? '' : guessExit);

  return [enter, exit];
}
