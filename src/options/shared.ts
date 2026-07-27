
import { opt } from './state';

import { config, mode } from "../state/config";

import { calculateEOF } from "../helpers";





import { search } from "../features/searching";

import { lineBase } from "../features/files";



import {
  MOUSE_ON,
  MOUSE_OFF,
  MOUSE_SGR_ON,
  MOUSE_SGR_OFF,
  BRACKETED_PASTE_ON,
  BRACKETED_PASTE_OFF,
  INVERSE_ON,
  INVERSE_OFF,
  BOLD_ON,
  BOLD_OFF,
  UNDERLINE_ON,
  UNDERLINE_OFF
} from "../state/constants";

/**
 * Option value types, like opttbl.c: BOOL toggles, TRIPLE has lower and
 * upper states, NUMBER and STRING prompt for a parameter, NOVAR runs an
 * action.
 */
/** Content-rebuild hook, set by the pager (onRebuild), the -b
 *  buffer trim hook (onTrimBufSpace), and whether the pager screen
 *  is initialized: og writes mouse/paste modes only from screen
 *  init and TOGGLE handlers, never during the option scan. */
export const hook = {
  rebuildContent: (() => {}) as () => void,
  /** og's O_HL_REPAINT: re-highlight NOW, under the option's message. */
  hiliteRepaint: (() => {}) as () => void,
  /** Reads the top row's character offset, returning a function that
   *  restores it once the width has changed (og's table[TOP]). */
  topOffset: ((() => () => {}) as (content: string[]) => () => void),
  trimBufSpace: (() => {}) as () => void,
  screenActive: false,
  /** --file-size draining a still-unknown pipe (og's opt_filesize). */
  scanFileSize: (() => {}) as () => void,
  /** Absolute 1-based line number for a source-backed local row. */
  sourceLineNumber: null as null |
    ((row: number) => number | null | undefined),
  /** Absolute byte position for a source-backed local row. */
  sourceBytePosition: null as null |
    ((row: number) => number | null | undefined),
  /** Total raw line count for a seekable source. */
  sourceLineCount: null as null | (() => number | null | undefined),
  /** Local materialized row holding the absolute header start. */
  sourceHeaderRow: null as null | (() => number | undefined),
  /** Moves a seekable source when --header changes its absolute start. */
  sourceHeaderChanged: null as null | ((start: number) => void),
};

/** Registers the immediate -b pool trim, like og's ch_setbufspace. */
export function onTrimBufSpace(fn: () => void): void {
  hook.trimBufSpace = fn;
}


// option-backed state not living in config, defaults from opttbl.c

// -j/-# fractions in parts per million, like og's NUM_FRAC_DENOM

// control chars pass through like `less -R`, this pager's native mode


/** Per prompt style --end-prompt strings (short, medium, long). */
export const endPrompts: (string | null)[] = [null, null, null];

/** Default search modifiers set by --search-options. */
export const defSearchType = {
  pastEof: false,
  fromStart: false,
  keep: false,
  invert: false,
  noRegex: false,
  wrap: false,
  subs: new Set<number>(),
};

// --emouse feature bits, like optfunc.c's emouse_defs
export const EMOUSE_HSCROLL = 1;
export const EMOUSE_VSCROLL = 2;
export const EMOUSE_HDRAG = 4;
export const EMOUSE_VDRAG = 8;
export const EMOUSE_LCLICK = 16;
export const EMOUSE_RCLICK = 32;

export const EMOUSE_DEFS: [string, number][] = [
  ['hscroll', EMOUSE_HSCROLL],
  ['vscroll', EMOUSE_VSCROLL],
  ['hdrag', EMOUSE_HDRAG],
  ['vdrag', EMOUSE_VDRAG],
  ['lclick', EMOUSE_LCLICK],
  ['rclick', EMOUSE_RCLICK],
  ['scroll', EMOUSE_HSCROLL | EMOUSE_VSCROLL],
  ['drag', EMOUSE_HDRAG | EMOUSE_VDRAG],
  ['hmove', EMOUSE_HSCROLL | EMOUSE_HDRAG],
  ['vmove', EMOUSE_VSCROLL | EMOUSE_VDRAG],
  ['move', EMOUSE_VSCROLL | EMOUSE_VDRAG | EMOUSE_HSCROLL | EMOUSE_HDRAG],
  ['click', EMOUSE_LCLICK | EMOUSE_RCLICK],
  ['all', EMOUSE_VSCROLL | EMOUSE_VDRAG | EMOUSE_HSCROLL | EMOUSE_HDRAG |
    EMOUSE_LCLICK | EMOUSE_RCLICK],
];

/** Fresh-search start mode of -a/-A (less's how_search). */
export const optHowSearch = (): number => opt.howSearch;

/** Match highlighting mode of -g/-G (less's hilite_search). */
export const optHiliteSearch = (): number => opt.hiliteSearch;

/** State 2 of -e/-E etc, read by the pager loop; $LESS_IS_MORE maps
 *  the flag onto more's -e semantics, like og's get_quit_at_eof. */
export const optQuitAtEof = (): number => opt.lessIsMore
  ? (opt.quitAtEof ? 2 : 1)
  : opt.quitAtEof;

/** Bell suppression level of -q/-Q. */
export const optQuiet = (): number => opt.quiet;

/** True when -c forces full repaints instead of scrolling. */
export const optClearRepaint = (): boolean => opt.clearRepaint > 0;

/** Backward scroll limit of -h, -1 when unlimited. */
export const optBackScroll = (): number => opt.backScroll;

/** Forward scroll limit of -y, -1 when unlimited. */
export const optForwScroll = (): number => opt.forwScroll;

/** True when -K makes ctrl-C exit the pager. */
export const optQuitOnIntr = (): boolean => opt.quitOnIntr > 0;

/** True when -F quits a file that fits on the first screen. */
export const optQuitIfOneScreen = (): boolean => opt.quitIfOneScreen > 0;

/** Prompt style of -m/-M (0 short, 1 medium, 2 long). */
export const optPrType = (): number => opt.prType;

/** The prompt style used for display: more mode defaults to medium
 *  and -m selects short, like og's pr_string type mapping. */
export const displayPrType = (): number =>
  opt.lessIsMore ? (opt.prType ? 0 : 1) : opt.prType;

/** Line number mode of -n/-N (0 off, 1 on, 2 displayed). */
export const optLinenums = (): number => opt.linenums;

/** Control char display of -r/-R (0 caret, 1 raw, 2 ANSI through). */
export const optCtldisp = (): number => opt.ctldisp;

/** True when -s squeezes runs of blank lines. */
export const optSqueeze = (): boolean => opt.squeeze > 0;

/** Unread-line highlight mode of -w/-W (less's show_attn). */
export const optShowAttn = (): number => opt.showAttn;

/** True when -J displays the status column. */
export const optStatusCol = (): boolean => opt.statusCol > 0;

/** The -" shell quote characters. */
export const optQuotes = (): { open: string, close: string } =>
  ({ open: opt.quoteOpen, close: opt.quoteClose });

/** True when tildes pad past end of file (-~ default on). */
export const optTildes = (): boolean => opt.tildes > 0;

/** True when --no-histdups removes duplicate history entries. */
export const optNoHistDups = (): boolean => opt.noHistDups > 0;

/** Mouse mode of --mouse (0 off, 1 on, 2 reverse). */
export const optMouse = (): number => opt.mouseMode;

/** True when --rmouse (or --MOUSE) reverses the scroll direction. */
export const optMouseReverse = (): boolean => opt.mouseReverse > 0;

/** True when --save-marks persists marks in the history file. */
export const optPermaMarks = (): boolean => opt.permaMarks > 0;

/** The -N line number field width (--line-num-width). */
export const optLinenumWidth = (): number => opt.linenumWidth;

/** The -J column width (--status-col-width). */
export const optStatusColWidth = (): number => opt.statusColWidth;

/** True when --incsearch searches as the pattern is typed. */
export const optIncrSearch = (): boolean => opt.incrSearch > 0;

/** The --header state: pinned lines, columns and 0-based start row. */
export const optHeader = (): { lines: number, cols: number, start: number } =>
  ({ lines: opt.headerLines, cols: opt.headerCols, start: opt.headerStart });

/**
 * Re-anchors the header at the top of a newly opened file, like less's
 * edit_ifile calling set_header(ch_zero()).
 */
export function resetHeaderStart(): void {
  opt.headerStart = 0;
}

/** The --no-search-header-* state: exclude header lines/columns. */
export const optNoSearchHeaders = (): { lines: boolean, cols: boolean } =>
  ({ lines: opt.nosearchHeaderLines > 0, cols: opt.nosearchHeaderCols > 0 });

/** True when --redraw-on-quit repaints the last screen at exit. */
export const optRedrawOnQuit = (): boolean => opt.redrawOnQuit > 0;

/** True when --no-paste ignores bracketed paste input. */
export const optNoPaste = (): boolean => opt.noPaste > 0;

/** True when --hilite-target highlights search/jump targets. */
export const optHiliteTarget = (): boolean => opt.hiliteTarget > 0;

/** True when --autosave includes an action char (or `*`). */
export const optAutosaveAction = (act: string): boolean =>
  opt.autosave.includes(act) || opt.autosave.includes('*');

/** The --search-options default modifiers for a fresh search. */
export const optDefSearchType = (): typeof defSearchType => defSearchType;

/**
 * The --match-shift columns for the current screen width, like less's
 * calc_match_shift resolving a fraction (parts per million, rounded
 * like og's muldiv; the default fraction is half the width).
 */
export function optMatchShift(): number {
  if (opt.matchShiftFraction < 0) return opt.matchShift;
  return mulFrac(fullScreenWidth(), opt.matchShiftFraction);
}

/** True when --emouse enables left-click mark setting. */
export const optEmouseLclick = (): boolean =>
  (opt.emouse & EMOUSE_LCLICK) !== 0;

/** True when --emouse enables right-click mark jumping. */
export const optEmouseRclick = (): boolean =>
  (opt.emouse & EMOUSE_RCLICK) !== 0;

/** True when --emouse (or --mouse) enables vertical wheel scrolling. */
export const optWheelEnabled = (): boolean =>
  opt.mouseMode > 0 || (opt.emouse & EMOUSE_VSCROLL) !== 0;

/** True when --status-line highlights whole marked/attn lines. */
export const optStatusLine = (): boolean => opt.statusLine > 0;

/** True when --form-feed stops scrolling at a \f line. */
export const optStopOnFormFeed = (): boolean => opt.stopOnFormFeed > 0;

/** True when --past-eof lets forward scrolls continue past (END). */
export const optPastEof = (): boolean => opt.pastEof > 0;

/** The -u/-U backspace mode (0 special, 1 plain, 2 control). */
export const optBsMode = (): number => opt.bsMode;

/** The --proc-backspace state (0 default, 1 overstrike, 2 ^H). */
export const optProcBackspace = (): number => opt.procBackspace;

/** The --proc-tab state (0 default, 1 expand, 2 ^I). */
export const optProcTab = (): number => opt.procTab;

/** The --proc-return state (0 default, 1 delete at EOL, 2 ^M). */
export const optProcReturn = (): number => opt.procReturn;

/** True when --wordwrap breaks wrapped lines at spaces. */
export const optWordwrap = (): boolean => opt.wordwrap > 0;

/** True when -X suppresses the terminal init/deinit strings. */
export const optNoInit = (): boolean => opt.noInit > 0;

/** True when --no-keypad suppresses keypad mode. */
export const optNoKeypad = (): boolean => opt.noKeypad > 0;

/** True when --no-vbell suppresses the visual bell flash. */
export const optNoVbell = (): boolean => opt.noVbell > 0;

/** True when --use-color enables the -D color map. */
export const optUseColor = (): boolean => opt.useColor > 0;

/** The -T tags file name (or a GTAGS-family name). */
export const optTagsFile = (): string => opt.tagsFile;

/** Resets -T to the "tags" default, for -T- once stdin is read. */
export const resetTagsFile = (): void => { opt.tagsFile = 'tags'; };

/** True when -d suppresses the dumb terminal warning. */
export const optKnowDumb = (): boolean => opt.knowDumb > 0;

/** The --intr character that leaves the F wait (default ^X). */
export const optIntrChar = (): string => opt.intrChar;

/** True while $LESSOPEN preprocessing is enabled (-L turns it off). */
export const optUseLessopen = (): boolean => opt.useLessopen > 0;

/** True when --show-preproc-errors reports preprocessor failures. */
export const optShowPreprocError = (): boolean => opt.showPreprocError > 0;

/** True when --no-edit-warn skips the LESSOPEN editing warning. */
export const optNoEditWarn = (): boolean => opt.noEditWarn > 0;

/** True when interactive shell, pipe and editor commands are disabled. */
export const optNoShell = (): boolean => opt.noShell > 0;

/** OG's deliberately terse error for an unavailable process escape. */
export const NO_SHELL_MESSAGE = 'Command not available';

/** True when --follow-name makes F re-open the file by name. */
export const optFollowName = (): boolean => opt.followName > 0;

/** True when --exit-follow-on-close ends F when the input closes. */
export const optExitFollowOnClose = (): boolean => opt.exitFollowOnClose > 0;

/** The --end-prompt string for the current prompt style, if any. */
export const optEndPrompt = (): string | null => endPrompts[displayPrType()];

/** True when --old-bot clears the bottom line from lower-left, like
 *  og's clear_bot choosing lower_left over line_left. */
export const optOldBot = (): boolean => opt.oldBot > 0;

/**
 * Scans the first --modelines lines for vim-style modelines, like
 * edit.c's check_modelines: only ts=/tabstop= settings are honored.
 */
export function checkModelines(lines: string[]): void {
  for (let i = 0; i < opt.modelines && i < lines.length; i++) {
    checkModeline(lines[i]);
  }
}

/** Parses one line for less:/vim:/vi:/ex: modelines. */
export function checkModeline(line: string): void {
  for (const pgm of ['less:', 'vim:', 'vi:', 'ex:']) {
    let from = 0;

    for (;;) {
      const at = line.indexOf(pgm, from);
      if (at < 0) break;

      const rest = line.slice(at + pgm.length).replace(/^ +/, '');

      if (at === 0 || line[at - 1] === ' ') {
        if (rest.startsWith('set ')) {
          modelineOptions(rest.slice(4), ':');
        } else if (pgm !== 'less:') {
          // "less:" requires "set", like check_modeline
          modelineOptions(rest, '');
        }

        break;
      }

      from = at + pgm.length;
    }
  }
}

export function modelineOptions(text: string, endChar: string): void {
  if (endChar) {
    const end = text.indexOf(endChar);
    if (end >= 0) text = text.slice(0, end);
  }

  for (const opt of text.split(/[ :]+/)) {
    const match = /^(?:ts|tabstop)=(\d+)/.exec(opt);
    if (match) setTabs(match[1]);
  }
}

/**
 * Adjusts a 1-based display line number for --no-number-headers, like
 * linenum.c's vlinenum: the header lines and everything above them get
 * no number (0), lines below the header restart at 1.
 */
export function vlinenum(linenum: number): number {
  const sourced = hook.sourceLineNumber?.(linenum - 1);
  const absolute = sourced === undefined
    ? linenum + lineBase()
    : sourced ?? 0;

  return vlinenumAbsolute(absolute);
}

/** Applies --no-number-headers to an already absolute line number. */
export function vlinenumAbsolute(absolute: number): number {
  if (opt.nonumHeaders && opt.headerLines > 0) {
    const headerEnd = opt.headerStart + 1 + opt.headerLines;
    return absolute < headerEnd ? 0 : absolute - headerEnd + 1;
  }

  return absolute;
}

/** Rounded n*frac/1,000,000, like og's muldiv on a fraction. */
export const mulFrac = (n: number, frac: number): number =>
  Math.round(n * frac / 1000000);

/**
 * OG keeps sc_width as the complete terminal width. Our renderer stores the
 * text width after reserving the line prefix, so commands defined in terms
 * of sc_width must add that applied reservation back.
 */
export const fullScreenWidth = (): number =>
  config.screenWidth + opt.appliedGutter;

/** The -j target as a 0-based screen row for the current window. */
export function jumpSindex(): number {
  // a -j.5 fraction resolves against the current height, like
  // calc_jump_sline
  let sline = opt.jumpFraction >= 0
    ? mulFrac(config.window, opt.jumpFraction)
    : opt.jumpTarget;

  if (sline < 0) sline += config.window;

  // a target obscured by the --header lines moves below them, like
  // less's calc_jump_sline
  return Math.min(Math.max(sline, opt.headerLines + 1), config.window - 1) - 1;
}

/** The -# shift columns, resolving a fraction of the screen width
 *  like og's calc_shift_count; 0 means the half-screen default. */
export function optShiftCount(): number {
  if (opt.shiftFraction >= 0) {
    return mulFrac(fullScreenWidth(), opt.shiftFraction);
  }
  return config.setCol;
}

/**
 * Stores a numeric shift from an ESC-(/ESC-) count, clearing the -#
 * fraction like og's A_LSHIFT with a number.
 */
export function setShiftCount(count: number): void {
  config.setCol = count;
  opt.shiftFraction = -1;
}

/**
 * Parses a number or a `.F` fraction, like optfunc.c's toggle_fraction
 * with getfraction: the fraction keeps six digits (parts per million).
 *
 * @returns The parsed value, or null after the og error message.
 */
export function parseFraction(
  text: string,
  printopt: string,
  negok: boolean
): { num: number, frac: number } | null {
  if (text.startsWith('.')) {
    const digits = /^\.(\d+)/.exec(text);

    if (!digits) {
      optScanError(`Invalid fraction in ${printopt}`);
      return null;
    }

    const frac = parseInt(digits[1].slice(0, 6).padEnd(6, '0'), 10);
    return { num: 0, frac };
  }

  const value = parseInt(text, 10);

  if (isNaN(value) || (value < 0 && !negok)) {
    optScanError(value < 0 && !negok
      ? `Negative number not allowed in ${printopt}`
      : `Number is required after ${printopt}`);
    return null;
  }

  return { num: value, frac: -1 };
}

/**
 * Formats a value-or-fraction query, like optfunc.c's query_fraction
 * trimming trailing zeros down to two characters.
 */
export function queryFraction(
  value: number,
  frac: number,
  intMsg: string,
  fracMsg: string
): string {
  if (frac < 0) return intMsg.replace('%d', String(value));

  let text = '.' + String(frac).padStart(6, '0');
  while (text.length > 2 && text.endsWith('0')) text = text.slice(0, -1);

  return fracMsg.replace('%s', text);
}

/** Lines per mouse wheel tick (--wheel-lines). */
export const optWheelLines = (): number => opt.wheelLines;

/** Truncation marker character (--rscroll), empty when disabled. */
export const optRscroll = (): string => opt.rscrollChar;

/** The --rscroll fallback attribute codes when -D R sets no color,
 *  like og's rscroll_attr from setfmt's `*x` prefix. */
export function optRscrollAttr(): { on: string, off: string } {
  switch (opt.rscrollAttr) {
    case 'd': return { on: BOLD_ON, off: BOLD_OFF };
    case 'u': return { on: UNDERLINE_ON, off: UNDERLINE_OFF };
    case 'k': return { on: '\x1B[5m', off: '\x1B[25m' };
    case 'n': return { on: '', off: '' };
    default: return { on: INVERSE_ON, off: INVERSE_OFF };
  }
}

/**
 * True when displayed lines are truncated at the screen width: -S, or
 * any --header lines/columns, like og's chop_line().
 */
export const chopLine = (): boolean =>
  config.chopLongLines || opt.headerLines > 0 || opt.headerCols > 0;

/**
 * The scroll window size, like og's get_swindow: a positive -z is the
 * size itself; zero or negative is relative to the screen height less
 * the --header lines (the default -1 leaves one line of overlap).
 */
export function getSwindow(): number {
  if (config.setWindow > 0) return config.setWindow;
  return config.window - opt.headerLines + config.setWindow;
}

/**
 * Returns the next tab stop after a column, like less's tabstops list:
 * explicit stops first, then every tabDefault columns.
 */
export function nextTabStop(col: number): number {
  for (const stop of opt.tabStops) {
    if (stop > col) return stop;
  }

  const last = opt.tabStops.length ? opt.tabStops[opt.tabStops.length - 1] : 0;
  return last +
    (Math.floor((col - last) / opt.tabDefault) + 1) * opt.tabDefault;
}

/**
 * Columns reserved at the left edge for the -J status column and the
 * -N line number field: og's NOMINAL width (line_pfx_width returns
 * linenum_width + 1, line.c:459) — a wider number overflows the
 * field and its LINE's text area shrinks instead (the line buffer
 * simply fills to sc_width past the actual prefix).
 */
export function gutterWidth(): number {
  return (opt.statusCol ? opt.statusColWidth : 0) +
    (opt.linenums === 2 ? opt.linenumWidth + 1 : 0);
}

// the gutter columns currently subtracted from config.screenWidth

/**
 * Reserves the gutter inside a freshly measured screen width; call
 * right after config.screenWidth is set from the terminal size.
 */
export function reserveGutter(): void {
  const width = config.screenWidth;
  opt.appliedGutter = gutterWidth();
  config.screenWidth = width - opt.appliedGutter;
  config.halfScreenWidth = Math.floor(width / 2);
}

/**
 * Re-applies the gutter after a display option changed its width.
 */
export function applyGutter(content: string[]): void {
  const gutter = gutterWidth();
  if (gutter === opt.appliedGutter) return;

  // og's table[TOP] is a byte position, so a width change moves
  // nothing - it just re-wraps from the same byte. Ours is a boundary
  // index, so the OFFSET is what has to be carried across, and the
  // remainder past the new boundary becomes the shift. The layout
  // lives on the other side of an import cycle, hence the hook.
  const carry = hook.topOffset(content);

  const width = fullScreenWidth();
  config.screenWidth = width - gutter;
  config.halfScreenWidth = Math.floor(width / 2);
  opt.appliedGutter = gutter;

  carry();
  recalculateEOF(content);
}

// re-derives displayed content after -s/-x/-r change its shape

/** Registers the content pipeline rebuild used by -s, -x and -r. */
export function onRebuild(fn: () => void): void {
  hook.rebuildContent = fn;
}

/**
 * Writes the mouse tracking codes for the current --mouse/--emouse
 * state.
 */
export function applyMouse(): void {
  // og's mouse strings are hardcoded xterm sequences, not termcap,
  // so even a dumb terminal receives them; before the screen
  // initializes og's INIT handler writes nothing, and like
  // init_mouse nothing is written while the option stays off
  if (!process.stdout.isTTY || !hook.screenActive) return;

  const want = Boolean(opt.mouseMode || opt.emouse);
  if (!want && !mouseApplied) return;

  mouseApplied = want;
  process.stdout.write(want
    ? MOUSE_SGR_ON + MOUSE_ON
    : MOUSE_OFF + MOUSE_SGR_OFF);
}

let mouseApplied = false;
let pasteApplied = false;

/**
 * Turns terminal bracketed paste markers on with --no-paste, so pasted
 * input can be recognized and ignored.
 */
export function applyBracketedPaste(): void {
  // og's opt_no_paste writes only at TOGGLE (hardcoded sequences,
  // dumb included); the screen init enables the markers itself, and
  // nothing is written while the option stays off
  if (!process.stdout.isTTY || !hook.screenActive) return;

  const want = Boolean(opt.noPaste);
  if (!want && !pasteApplied) return;

  pasteApplied = want;
  process.stdout.write(
    want ? BRACKETED_PASTE_ON : BRACKETED_PASTE_OFF
  );
}

/** Displays a control char like less's prchar (^X, ESC, ^?). */
export function prChar(char: string): string {
  const code = char.charCodeAt(0);

  if (code === 0x1B) return 'ESC';
  if (code < 0x20) return '^' + String.fromCharCode(code + 0x40);
  if (code === 0x7F) return '^?';
  return char;
}

/**
 * Parses a comma-separated --emouse feature list, like decode.c's
 * parse_csl_bitmap: names prefix-match and combinations expand.
 *
 * Invalid/ambiguous members contribute no bits but do not stop the
 * list, matching csl_bitmap_bit returning zero to parse_csl_bitmap.
 */
export function parseEmouse(text: string): number {
  if (!text || text === '-') return 0;

  let bits = 0;

  for (const name of text.split(',').map(item => item.trim()).filter(Boolean)) {
    const matches = EMOUSE_DEFS.filter(([def]) => def.startsWith(name));

    if (matches.length !== 1) {
      const kind = matches.length ? 'ambiguous' : 'invalid';
      optScanError(`--emouse: ${kind} name "${name}"`);
      continue;
    }

    bits |= matches[0][1];
  }

  return bits;
}

/**
 * Builds the --emouse query list, like opt_emouse's QUERY greedily
 * naming combinations before their components.
 */
export function emouseNames(): string {
  let bits = opt.emouse;
  const names: string[] = [];

  for (let i = EMOUSE_DEFS.length - 1; i >= 0; i--) {
    const [name, bit] = EMOUSE_DEFS[i];

    if ((bits & bit) === bit && bit !== 0) {
      names.push(name);
      bits &= ~bit;
    }
  }

  return names.join(',');
}

/**
 * Parses a --search-options answer, like opt_search_type: EFKNRW set
 * default modifiers, digits pick sub-patterns, `-` clears.
 */
export function setSearchType(text: string): void {
  const next = {
    pastEof: false,
    fromStart: false,
    keep: false,
    invert: false,
    noRegex: false,
    wrap: false,
    subs: new Set<number>(),
  };

  for (const char of text) {
    switch (char.toUpperCase()) {
      case 'E': case '\x05': next.pastEof = true; break;
      case 'F': case '\x06': next.fromStart = true; break;
      case 'K': case '\x0B': next.keep = true; break;
      case 'N': case '\x0E': next.invert = true; break;
      case 'R': case '\x12': next.noRegex = true; break;
      case 'W': case '\x17': next.wrap = true; break;

      case '-':
        next.pastEof = next.fromStart = next.keep = false;
        next.invert = next.noRegex = next.wrap = false;
        next.subs.clear();
        break;

      case '^': break;

      default:
        if (char >= '1' && char <= '5') {
          next.subs.add(char.charCodeAt(0) - 0x30);
          break;
        }

        search.message = `invalid search option '${char}'`;
        return;
    }
  }

  // wrapping past EOF and stopping at EOF are exclusive, like less's
  // norm_search_type
  if (next.wrap) next.pastEof = false;

  Object.assign(defSearchType, next, { subs: next.subs });
}

/** Formats the --search-options state, like opt_search_type QUERY. */
export function searchTypeNames(): string {
  let out = '';

  if (defSearchType.pastEof) out += 'E';
  if (defSearchType.fromStart) out += 'F';
  if (defSearchType.keep) out += 'K';
  if (defSearchType.invert) out += 'N';
  if (defSearchType.noRegex) out += 'R';
  if (defSearchType.wrap) out += 'W';
  for (const n of [...defSearchType.subs].sort()) out += n;

  return out || '-';
}

/**
 * Parses a --match-shift answer, like toggle_fraction with the `.d`
 * format: a leading `.` sets a fraction of the screen width, kept in
 * parts per million like og.
 */
export function setMatchShift(text: string): void {
  const parsed = parseFraction(text, '--match-shift', false);
  if (!parsed) return;

  if (parsed.frac >= 0) {
    opt.matchShiftFraction = parsed.frac;
  } else {
    opt.matchShift = parsed.num;
    opt.matchShiftFraction = -1;
  }
}

export const CASELESS_MESSAGES = [
  'Case is significant in searches',
  'Ignore case in searches',
  'Ignore case in searches and in patterns',
];

// the option table, entries and messages ported from opttbl.c

/**
 * Sets the header search exclusions, like optfunc.c's
 * do_nosearch_headers: the three options assign both flags rather than
 * toggling. Silent, so $LESS INIT matches og; toggles report through
 * noSearchHeadersMessage.
 */
export function setNoSearchHeaders(lines: number, cols: number): void {
  opt.nosearchHeaderLines = lines;
  opt.nosearchHeaderCols = cols;
}

export function noSearchHeadersMessage(): void {
  if (opt.nosearchHeaderLines && opt.nosearchHeaderCols) {
    search.message = 'Search does not include header lines or columns';
  } else if (opt.nosearchHeaderLines) {
    search.message = 'Search includes header columns but not header lines';
  } else if (opt.nosearchHeaderCols) {
    search.message = 'Search includes header lines but not header columns';
  } else {
    search.message = 'Search includes header lines and columns';
  }
}

/**
 * Recomputes the EOF anchor after a display-affecting toggle (-S).
 */
export function recalculateEOF(content: string[]): void {
  calculateEOF(content);

  if (!mode.EOF) {
    mode.EOF = config.row > config.endRow || (
      config.row === config.endRow && config.subRow >= config.endSubRow
    );
  }
}


/**
 * Parses the -x tab stop list, like less's set_tabs: a comma-separated
 * ascending list whose last interval repeats. Non-increasing entries
 * are skipped without ending the list, and fewer than two resulting
 * stops (counting the fixed leading 0) leave the old stops unchanged.
 */
export function setTabs(text: string): void {
  const stops = [0];
  let at = 0;

  while (stops.length < 128) {
    let value = 0;
    let overflow = false;

    while (text[at] === ' ') at++;

    for (; text[at] >= '0' && text[at] <= '9'; at++) {
      value = value * 10 + (text.charCodeAt(at) - 0x30);
      if (value > 0x7FFFFFFF) overflow = true;
    }

    if (!overflow && value > stops[stops.length - 1]) stops.push(value);

    while (text[at] === ' ') at++;
    if (text[at++] !== ',') break;
  }

  if (stops.length < 2) return;

  opt.tabStops = stops;
  opt.tabDefault = stops[stops.length - 1] - stops[stops.length - 2];
}

/**
 * Reports a startup scan problem at the first prompt, like og's
 * error() calls before the screen initializes: follow-ups queue behind
 * the first message.
 */
export function optScanError(message: string): void {
  if (search.message) {
    search.messageQueue.push(message);
  } else {
    search.message = message;
  }
}


/**
 * Applies a --header parameter (`L[,C[,N]]`), like less's parse_header:
 * empty fields keep their value, a leading `-` disables the header, and
 * without N the header anchors at the current top line (og's TOGGLE
 * defaulting start_pos to position(TOP)).
 */
// og can't parse --header at INIT: find_pos needs the open file, so
// opt_header stores init_header and main applies it as a TOGGLE after
// the first file opens (main.c:450)
let pendingHeader: string | null = null;

/** Applies a command-line --header once content exists; the first
 *  display's jump clamps through after_header_pos, so the screen
 *  opens at the header start. */
export function applyPendingHeader(content: string[]): void {
  if (pendingHeader === null) return;

  const value = pendingHeader;
  pendingHeader = null;
  setHeader(value, content);

  config.row = opt.headerStart;
  config.subRow = 0;
}

export function setHeader(text: string, content: string[]): void {
  // startup scan: the file is not open yet - defer like og's
  // init_header (main.c:450 applies it after the first open)
  if (!content.length) {
    pendingHeader = text;
    return;
  }

  const fields = text.startsWith('-') ? ['0', '0'] : text.split(',');
  const values = [-1, -1, -1];

  for (let i = 0; i < 3 && i < fields.length; i++) {
    if (fields[i] === '') continue;

    if (!/^\d+$/.test(fields[i])) {
      search.message = 'Number is required after --header';
      return;
    }

    values[i] = parseInt(fields[i], 10);
  }

  if (values[0] >= 0) opt.headerLines = values[0];
  if (values[1] >= 0) opt.headerCols = values[1];

  const sourcedLine = hook.sourceLineNumber?.(config.row);
  const sourced = sourcedLine !== undefined;

  opt.headerStart = values[2] > 0
    ? (sourced
      ? values[2] - 1
      : Math.min(values[2] - 1, Math.max(content.length - 1, 0)))
    : sourcedLine !== null && sourcedLine !== undefined
      ? sourcedLine - 1
      : config.row;

  // og's O_REPAINT repaints through jump_loc, whose after_header_pos
  // clamps a top above the new header start up to it: the view lands
  // at the header, content continuing right below (jump.c:215)
  if (config.row < opt.headerStart) config.row = opt.headerStart;

  // header lines/columns force chopping (og's chop_line), so the
  // sub-row layout changed shape
  config.subRow = 0;
  if (sourced) hook.sourceHeaderChanged?.(opt.headerStart);
  recalculateEOF(content);
}
