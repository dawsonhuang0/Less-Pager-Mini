import { strWidth } from 'char-width';

import { config } from '../state/config';

import { getLayout, stylesOpen } from './lineLayout';

import {
  chopLine,
  optWordwrap,
  optSqueeze,
  optCtldisp,
  optProcBackspace,
  optBsMode,
  optProcReturn,
  optProcTab,
  nextTabStop
} from '../options';

import { colored, attrText } from '../features/color';

import { rawByteOf, binByteText, utfBinText, ubinChar, omitChar }
  from '../features/charset';

import {
  ansiEndChars,
  ansiMidChars,
  ansiOscChars,
  ASCII_REGEX,
  STYLE_REGEX,
  STYLE_REGEX_G,
  STYLE_RESET,
  INVERSE_ON,
  INVERSE_OFF,
  UNDERLINE_ON,
  UNDERLINE_OFF
} from '../state/constants';

/**
 * Returns how many extra sub-rows a line will take if it overflows screen
 * width.
 *
 * - Returns 0 if line-chopping is enabled.
 * - Styled or Unicode lines use the cached layout, so the count always
 *   matches what the renderer actually emits.
 *
 * @param line - The string to measure.
 * @returns Number of sub-rows needed to display the line.
 */
export function maxSubRow(line: string): number {
  if (chopLine()) return 0;

  // under -r og counts no widths at all - fits_on_screen returns TRUE
  // outright for ctldisp == OPT_ON (line.c) - so however long the line
  // is, it is ONE row and the terminal does the wrapping. The plain
  // ASCII shortcut below divides by the screen width and would answer
  // with the row count the layout deliberately does not have
  if (optCtldisp() === 1) return 0;

  // --wordwrap boundaries live in the layout, even for plain lines
  if (!optWordwrap() && !isStyled(line) && isAscii(line) &&
      !line.includes('\x08')) {
    return Math.floor(Math.max(line.length - 1, 0) / config.screenWidth);
  }

  return getLayout(line).rowStart.length - 1;
}

// controls, raw-byte markers and unicode binaries all transform
// og's omit set (U+00AD, U+200D, variation selectors, skin-tone and
// hair modifiers) is \p{Cf}/\p{Sk}, none of which the classes below
// cover - so a line carrying only those skipped the transform entirely
// and shipped them straight to the terminal. They are alternated
// rather than put in the class: a lone ZWJ or variation selector
// inside a character class reads as a misleading combined sequence.
const CONTROL_REGEX = new RegExp(
  '[\\x00-\\x08\\x0B-\\x1F\\x7F\\t\\uE000-\\uE0FF\\uFFFD\\p{Cn}\\p{Co}\\p{Cs}]' +
  '|\\u00AD|\\u200D|[\\uFE00-\\uFE0F]' +
  '|[\\u{1F3FB}-\\u{1F3FF}]|[\\u{1F9B0}-\\u{1F9B3}]|[\\u{E0100}-\\u{E01EF}]',
  'u'
);


// binary data repeats the same control chars and raw bytes millions
// of times: their renderings (and stripped widths) cache per run,
// since color state cannot change mid-transform
let charCache = new Map<string, [string, number]>();

/**
 * Prepares raw lines for display: -s squeezes runs of blank lines, tabs
 * expand at the -x stops, and control characters follow -r/-R.
 *
 * @param lines - Raw content lines.
 * @returns The display lines.
 */
// og paints every OSC8 link's TEXT with AT_UNDERLINE (AT_COLOR_OSC8
// under --use-color) while the escape bytes pass through as AT_ANSI,
// and the selected link additionally hilites (line.c:880-886); the
// selection coordinates arrive via setter to keep imports one-way
/* eslint-disable no-control-regex */
const OSC8_SEQ_G = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC8_ONE = /\x1b\]8;[^;\x07\x1b]*;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
/* eslint-enable no-control-regex */

let osc8SelectedAt: { row: number, start: number } | null = null;

/** Registers the selected link's row/offset for display styling. */
export function setOsc8Display(
  at: { row: number, start: number } | null
): void {
  osc8SelectedAt = at;
}

/** Styles a line's OSC8 link text on the RAW line, sentinel-coded so
 *  the styles ride through every ctldisp mode: the underline is og's
 *  CD_ANSI in_osc8_link attr (ANSI mode only — probed, -r emits no
 *  \e[4m), while the SELECTION standout is og's hilite machinery and
 *  paints over caret and raw renderings alike (line.c:880). */
/**
 * Re-opens the run's own attribute after every escape sequence the
 * FILE contributed, so a reset inside a link does not end it.
 *
 * og never has this problem: store_char ORs link_attr into each
 * CHARACTER's attribute (line.c:885) and put_line emits whatever
 * transitions that implies, while the file's own sequences ride
 * along as AT_ANSI. Wrapping the run once cannot express that.
 */
function armAttr(text: string): string {
  if (!text.includes('\x1b')) return text;

  let out = '';
  let i = 0;
  let run = 0;

  while (i < text.length) {
    if (text[i] !== '\x1b') {
      i++;
      continue;
    }

    const end = ansiRunEnd(text, i);
    out += text.slice(run, end) + OWN_STYLE + UNDERLINE_ON.slice(1);
    i = end;
    run = end;
  }

  return out + text.slice(run);
}

function styleOsc8Line(
  line: string,
  row: number,
  underline: boolean
): string {
  OSC8_SEQ_G.lastIndex = 0;

  // eslint-disable-next-line no-control-regex
  const own = (code: string): string => code.replace(/\x1b/g, OWN_STYLE);

  let out = '';
  let last = 0;
  let inLink = false;
  let linkStart = -1;
  let m: RegExpExecArray | null;

  while ((m = OSC8_SEQ_G.exec(line)) !== null) {
    const text = line.slice(last, m.index);

    if (inLink && text) {
      const isSelected = osc8SelectedAt !== null &&
        osc8SelectedAt.row === row && osc8SelectedAt.start === linkStart;

      if (isSelected) {
        // og's selection paints underline+standout in EVERY ctldisp
        // mode (probed: caret mode too emits \e[4m\e[7m text)
        out += own(UNDERLINE_ON) + own(INVERSE_ON) + text +
          own(INVERSE_OFF) + own(UNDERLINE_OFF);
      } else if (underline) {
        out += own(colored('osc8', armAttr(text), UNDERLINE_ON, UNDERLINE_OFF));
      } else {
        out += text;
      }
    } else {
      out += text;
    }

    out += m[0];
    inLink = m[1] !== '';
    // Osc8Link.start records where the link TEXT begins
    if (inLink) linkStart = OSC8_SEQ_G.lastIndex;
    last = OSC8_SEQ_G.lastIndex;
  }

  out += line.slice(last);
  return out;
}

// the raw line behind each DISPLAY line, kept because a search runs
// against the raw text (og's forw_raw_line + cvt_text, search.c:1680)
// while the hilite lands on displayed columns.
//
// Keyed by the displayed text, not by row: callers hand rows from
// several arrays (the file, the help screen, a parked copy) and an
// index would go stale between them. Only lines the transform
// actually changed are stored, so a plain file adds nothing.
let sourceLines = new Map<string, string>();
const SOURCE_MAP_LIMIT = 8192;

/** The raw line a display line was derived from, if it still differs. */
export const sourceLine = (display: string): string | undefined =>
  sourceLines.get(display);

/**
 * How many DISPLAYED characters the first `count` raw characters
 * produce, style codes excluded.
 *
 * og needs no such function: it stores one display char at a time and
 * tags each with its source position - a tab's spaces all carry the
 * tab's (store_tab, line.c:1056), a caret pair the control char's
 * (store_prchar, line.c:1069). Transforming the prefix answers the
 * same question, and only match boundaries ever ask.
 */
export function displayPrefixLength(raw: string, count: number): number {
  if (count <= 0) return 0;

  const prefix = raw.slice(0, count);
  const shown = CONTROL_REGEX.test(prefix) ? transformLine(prefix) : prefix;

  return shown.replace(STYLE_REGEX_G, '').length;
}

/**
 * The raw index whose displayed prefix is `shown` characters long -
 * the inverse of displayPrefixLength, for turning a display position
 * back into the source position og would have used.
 */
export function sourceIndexAt(raw: string, shown: number): number {
  if (shown <= 0) return 0;

  for (let i = 1; i <= raw.length; i++) {
    if (displayPrefixLength(raw, i) >= shown) return i;
  }

  return raw.length;
}

/**
 * The style codes still in force at a character index, so a line can
 * be resumed part-way and still look right - og carries the same
 * state forward in shifted_ansi (line.c:282) when it shifts a line.
 */
export function openStyleAt(line: string, index: number): string {
  if (index <= 0 || !line.includes('\x1b')) return '';

  let out = '';

  for (let i = 0; i < index && i < line.length; ) {
    if (line[i] !== '\x1b') {
      i++;
      continue;
    }

    const end = ansiRunEnd(line, i);
    const code = line.slice(i, end);

    out = code === STYLE_RESET ? '' : out + code;
    i = end;
  }

  return out;
}

export function transformContent(lines: string[]): string[] {
  charCache = new Map();

  const squeeze = optSqueeze();
  const ctldisp = optCtldisp();
  const out: string[] = [];
  let blank = false;

  // the map accumulates rather than being replaced: displayText
  // transforms ONE line at a time for the stream engine's own
  // measurements (fileView.ts:28), and a screen's entries must
  // survive that. The display text is the key, so an entry can only
  // be replaced by an identical rendering
  if (sourceLines.size > SOURCE_MAP_LIMIT) sourceLines = new Map();
  let row = -1;

  for (const raw of lines) {
    row++;

    if (squeeze && raw === '') {
      if (blank) continue;
      blank = true;
    } else {
      blank = false;
    }

    let line = raw;

    // style BEFORE the control transform: caret mode still standouts
    // the selected link's text between its caret-rendered sequences
    if (line.includes('\x1b]8;') &&
        (ctldisp === 2 || osc8SelectedAt?.row === row)) {
      line = styleOsc8Line(line, row, ctldisp === 2);
    }

    const shown = CONTROL_REGEX.test(line) ? transformLine(line) : line;

    // only when the transform actually moved something: an untouched
    // line needs no map, and the search can run on the display text
    if (shown !== raw) sourceLines.set(shown, raw);
    out.push(shown);
  }

  return out;
}

/**
 * Expands tabs and converts control characters in one line, like less's
 * do_append: caret notation in standout unless -r passes them raw; -R
 * (the default here) lets ANSI style sequences through.
 */
/** og's is_ansi_middle: a $LESSANSIMIDCHARS char that is not an end. */
function ansiMiddle(char: string): boolean {
  return ansiMidChars().includes(char) && !ansiEndChars().includes(char);
}

/**
 * The end of the escape run starting at `start`, like cvt_text
 * consuming an ansi_start sequence (cvt.c:79): characters go while
 * ansi_step answers ANSI_MID, and the one that ends the run is taken
 * too - whether it ended it properly (ANSI_END) or aborted it
 * (ANSI_ERR). That is why ESC[K and ESC(B vanish entirely and not
 * just their valid prefix.
 *
 * @param line - The raw line.
 * @param start - Index of the ESC.
 * @returns The index after the run, or `start` when none begins here.
 */
export function ansiRunEnd(line: string, start: number): number {
  if (line[start] !== '\x1b') return start;

  const intro = line[start + 1];

  // an OSC intro runs to its String Terminator instead
  if (intro === ']' ||
      (intro !== undefined && ansiOscChars().includes(intro))) {
    const bel = line.indexOf('\x07', start + 2);
    const st = line.indexOf('\x1b\\', start + 2);
    const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);

    return end < 0 ? line.length : end + (end === st ? 2 : 1);
  }

  let scan = start + 1;
  while (scan < line.length && ansiMiddle(line[scan])) scan++;

  // a line that simply ENDS mid-sequence has nothing left to take
  return scan >= line.length ? line.length : scan + 1;
}

/**
 * The prompt line through the same char machinery as content, like
 * og's prompt() handing pr_string's result to load_line (command.c),
 * which pappends it character by character exactly as forw_line does
 * a file line: tabs expand to their stops and control characters take
 * caret notation instead of reaching the terminal.
 *
 * The prototype's literal bytes are NOT converted while the prompt is
 * being built - og's ap_char stores them raw (5a369ed, whose whole
 * point was that routing them through ap_str corrupts multibyte
 * chars). The conversion belongs here, at the draw.
 */
export function transformPrompt(line: string): string {
  charCache = new Map();
  return CONTROL_REGEX.test(line) ? transformLine(line, 2) : line;
}

/**
 * og's do_append recognizes an ANSI sequence when ctldisp is ONPLUS
 * *or* the char has no file position (line.c:1302) - and a prompt is
 * appended with NULL_POSITION, so its escapes are always live. When one
 * is there, load_line then leaves the line's own attributes alone
 * instead of colouring the whole prompt standout (line.c:1950).
 */
export function promptHasAnsi(line: string): boolean {
  return line.includes('\x1B') || line.includes('\x9B');
}

function transformLine(line: string, ctldispOverride?: number): string {
  const ctldisp = ctldispOverride ?? optCtldisp();
  let out = '';
  let col = 0;
  let i = 0;

  // backspace handling, like line.c: --proc-backspace overrides the
  // -u/-U mode; og's DEFAULT is overstrike processing (BS_SPECIAL)
  if (line.includes('\x08')) {
    const pb = optProcBackspace();

    if (pb === 1 || (pb === 0 && optBsMode() === 0)) {
      line = procBackspaces(line);
    }
    // -u (BS_NORMAL) keeps the raw \b: og stores the byte and the
    // terminal overprints it; the layout counts it as pwidth -1/-2
    // otherwise (--proc-backspace off, or -U with it unset) \b
    // falls through to the ^H control display, like store_bs
  }

  // og pends a CR seen before the newline and discards it
  // (line.c:1106) under --proc-return or the default -u/-U mode;
  // -u and -U render it as ^M instead. Mid-line CRs are ^M in
  // EVERY mode - the pend only eats the one before the newline.
  const pr = optProcReturn();

  if ((pr === 1 || (pr === 0 && optBsMode() === 0)) &&
      line.endsWith('\r')) {
    line = line.slice(0, -1);
  }

  // -u passes the raw backspace byte through (BS_NORMAL's STORE_CHAR):
  // the terminal overprints it, pwidth counting -1
  const rawBs = optProcBackspace() === 0 && optBsMode() === 1;

  while (i < line.length) {
    // a whole code point, not a code unit: an astral character (every
    // emoji) is a surrogate PAIR, and its lead surrogate alone reads
    // as unassigned — is_ubin_char then renders it <U+XXXX>. Only
    // lines carrying a control character reach here, which is why
    // plain emoji lines looked right and every colored one did not
    const point = line.codePointAt(i) ?? 0;
    const char = point > 0xFFFF ? line.slice(i, i + 2) : line[i];

    if (char === '\x08' && rawBs) {
      out += char;
      col = Math.max(col - 1, 0);
      i++;
      continue;
    }

    // styling WE injected (overstrike bold/underline): swap the
    // sentinel back to a real ESC in every ctldisp mode — og keeps
    // these attrs out-of-band, so only DATA escapes caret
    if (char === OWN_STYLE) {
      const seq = /^\[[0-9;]*m/.exec(line.slice(i + 1));

      if (seq) {
        out += '\x1b' + seq[0];
        i += 1 + seq[0].length;
        continue;
      }
    }

    // og expands tabs unless --proc-tab (or -U with it unset) says
    // control display (line.c:1389) - then ^I falls through below
    const pt = optProcTab();

    if (char === '\t' && (pt === 1 || (pt === 0 && optBsMode() !== 2))) {
      const stop = nextTabStop(col);
      out += ' '.repeat(stop - col);
      col = stop;
      i++;
      continue;
    }

    if (char === '\x1B' && ctldisp === 2) {
      const ansi = STYLE_REGEX_G;
      ansi.lastIndex = i;
      const match = ansi.exec(line);

      if (match && match.index === i) {
        out += match[0];
        i += match[0].length;
        continue;
      }

      // og's ansi machine recognizes a COMPLETE OSC8 sequence and
      // stores it AT_ANSI (line.c osc_return): the whole sequence —
      // BEL terminator and ST alike — passes through at zero width
      OSC8_ONE.lastIndex = i;
      const osc8 = OSC8_ONE.exec(line);

      if (osc8 && osc8.index === i) {
        out += osc8[0];
        i += osc8[0].length;
        continue;
      }

      // An OSC intro (ESC ] or a $LESSANSIOSCCHARS char) runs its own
      // state machine to the terminator; the allowed types matched
      // above, so reaching here means the type is not allowed and
      // og's ANSI_ERR removes the WHOLE sequence, terminator included
      const intro = line[i + 1];

      if (intro === ']' ||
          (intro !== undefined && ansiOscChars().includes(intro))) {
        const bel = line.indexOf('\x07', i + 2);
        const st = line.indexOf('\x1b\\', i + 2);
        const end = bel < 0 ? st
          : st < 0 ? bel
            : Math.min(bel, st);

        if (end < 0) {
          // og USED to close an unterminated OSC with a synthesised ST
          // at end of line; 254fefb calls that unsafe and removes the
          // whole sequence instead - add_attr_normal sends every OSC
          // state except OSC_START/OSC_END to remove_ansi(), which
          // truncates the line buffer back to the introducing ESC. So
          // the sequence AND everything it swallowed to end of line
          // simply never reach the screen. (An unterminated CSI is a
          // different case: its ostate stays OSC_START, nothing is
          // removed, and what it stored still prints - see below.)
          i = line.length;
          continue;
        }

        i = end + (end === st ? 2 : 1);
        continue;
      }

      // Neither: og's ansi_step walks the middle characters and the
      // first one that is neither middle nor end returns ANSI_ERR,
      // whose remove_ansi() deletes everything the sequence stored —
      // the aborting character with it (line.c:1252). So ESC[K and
      // ESC(B VANISH under -R; they are not caret-rendered. A line
      // that simply ENDS mid-sequence keeps what was stored.
      let scan = i + 1;
      while (scan < line.length && ansiMiddle(line[scan])) scan++;

      if (scan >= line.length) {
        // og emits what the unfinished sequence stored (ESC[31 goes
        // out raw), but a LONE trailing ESC never reaches the screen:
        // pdone's attribute exit takes its place. Passing it through
        // would swallow the newline after it and merge two rows
        if (scan > i + 1) out += line.slice(i);
        i = line.length;
        continue;
      }

      i = scan + 1;
      continue;
    }

    // a raw undecodable byte displays with $LESSBINFMT, like og's
    // binary chars (<XX> in standout / the BIN color)
    const rawByte = rawByteOf(char);

    if (rawByte >= 0) {
      let entry = charCache.get(char);

      if (!entry) {
        const text = binByteText(rawByte);
        entry = [text, text.replace(STYLE_REGEX_G, '').length];
        charCache.set(char, entry);
      }

      out += entry[0];
      col += entry[1];
      i++;
      continue;
    }

    // og's is_omit_char (line.c:1373): these are DROPPED entirely, so
    // they never reach the terminal - only -U (BS_CONTROL) shows them,
    // as the hex form. A ZWJ left in the stream joins emoji into one
    // glyph, which is exactly the unpredictable screen content og is
    // avoiding.
    if (char >= '\x80') {
      const point = line.codePointAt(i) ?? 0;

      if (omitChar(point)) {
        const key = String.fromCodePoint(point);

        if (optBsMode() === 2) {
          const text = utfBinText(point);
          out += text;
          col += text.replace(STYLE_REGEX_G, '').length;
        }

        i += key.length;
        continue;
      }
    }

    // a unicode char with no sane display uses $LESSUTFBINFMT
    if (char >= '\x80' && ubinChar(char)) {
      const code = line.codePointAt(i) ?? 0;
      const key = String.fromCodePoint(code);
      let entry = charCache.get(key);

      if (!entry) {
        const text = utfBinText(code);
        entry = [text, text.replace(STYLE_REGEX_G, '').length];
        charCache.set(key, entry);
      }

      out += entry[0];
      col += entry[1];
      i += key.length;
      continue;
    }

    if (char < ' ' || char === '\x7F') {
      if (ctldisp === 1) {
        out += char;
        col++;
      } else {
        let entry = charCache.get(char);

        if (!entry) {
          const caret = char === '\x7F'
            ? '^?'
            // og's prchar special-cases the escape byte as "ESC"
            // (charset.c:534), every other control ^X
            : char === '\x1B'
              ? 'ESC'
              : '^' + String.fromCharCode(char.charCodeAt(0) + 0x40);
          entry = [
            colored('ctrl', caret, INVERSE_ON, INVERSE_OFF),
            caret.length,
          ];
          charCache.set(char, entry);
        }

        out += entry[0];
        col += entry[1];
      }

      i++;
      continue;
    }

    out += char;
    col += char >= '\x80' ? strWidth(char) : 1;
    i += char.length;
  }

  return out;
}

/**
 * Merges adjacent same-attribute wraps into one run: og's at_switch
 * writes a transition only when the attribute CHANGES, so "SUMMARY"
 * is a single bold span with a single exit — one full reset, which
 * is also where a leaked --end-prompt SGR dies.
 */
function ownAttr(attr: 'bold' | 'underline'): { on: string, off: string } {
  const [on, off] = attrText(attr, '\x00')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b/g, OWN_STYLE)
    .split('\x00');

  return { on: on ?? '', off: off ?? '' };
}

/**
 * Joins the per-character overstrike styling into runs.
 *
 * Both attributes close with the same reset, so deleting every
 * "close immediately followed by an open" would also delete the pair
 * at a bold-to-underline boundary — the underline run would lose its
 * opener and print bold, which is how `|X\bX_\bc...` in the help came
 * out bold instead of "X bold, command underlined". A run therefore
 * only continues while the attribute is the SAME one.
 */
function coalesceOwnRuns(text: string): string {
  const bold = ownAttr('bold');
  const under = ownAttr('underline');

  if (!bold.on || !bold.off || !under.on || !under.off) return text;

  const attrs = { bold, underline: under };
  let open: 'bold' | 'underline' | null = null;
  let out = '';
  let i = 0;

  const close = (): void => {
    if (open) out += attrs[open].off;
    open = null;
  };

  while (i < text.length) {
    const kind = text.startsWith(bold.on, i) ? 'bold' as const
      : text.startsWith(under.on, i) ? 'underline' as const
        : null;

    if (kind) {
      const { on, off } = attrs[kind];
      const end = text.indexOf(off, i + on.length);

      if (end >= 0) {
        if (open !== kind) {
          close();
          out += on;
          open = kind;
        }

        out += text.slice(i + on.length, end);
        i = end + off.length;
        continue;
      }
    }

    close();
    out += text[i];
    i++;
  }

  close();

  return out;
}

/**
 * Converts nroff-style overstrikes for --proc-backspace: `X\bX` prints
 * bold and `_\bX` underlined, leftover backspaces just erase.
 */
// stands in for the ESC of styling WE generate mid-transform (the
// overstrike bold/underline): og keeps such attrs out-of-band, so
// they render in EVERY ctldisp mode while data ESCs caret — the
// transform loop swaps the sentinel back to a real ESC on emission
const OWN_STYLE = '\uE100';

function procBackspaces(line: string): string {
  const own = (kind: 'bold' | 'underline', c: string): string =>
    // eslint-disable-next-line no-control-regex
    attrText(kind, c).replace(/\x1b/g, OWN_STYLE);

  // og's do_append order: an identical pair is bold FIRST (so _\b_
  // is bold, not underline), then an underscore on either side
  // underlines - X\b_ keeps the PREVIOUS char (line.c "we replace
  // prev_ch, but we keep its attributes" branch is only for
  // non-underscore overstrikes)
  /* eslint-disable no-control-regex */
  const out = line
    .replace(/(.)\x08\1/g, (_, c: string) => own('bold', c))
    .replace(/_\x08(.)/g, (_, c: string) => own('underline', c))
    .replace(/(.)\x08_/g, (_, c: string) => own('underline', c))
    .replace(/.\x08(.)/g, '$1');
  /* eslint-enable no-control-regex */

  return coalesceOwnRuns(out);
}

/**
 * Calculates the total visual width of a string based on terminal character
 * widths.
 *
 * @param line - The input string to measure.
 * @returns The total visual width of the string in terminal columns.
 */
export function visualWidth(line: string): number {
  if (isStyled(line)) line = line.replace(STYLE_REGEX_G, '');

  if (line.includes('\x08')) {
    // og's pwidth counts a raw -u backspace as -1 (-2 after a wide
    // char): measuring the overprinted result gives the same sum
    /* eslint-disable no-control-regex */
    while (/[^\x08]\x08/.test(line)) {
      line = line.replace(/[^\x08]\x08/g, '');
    }
    line = line.replace(/\x08/g, '');
    /* eslint-enable no-control-regex */
  }

  return isAscii(line) ? line.length : strWidth(line);
}

/**
 * Appends a style reset to a line only if a style is still open at its end.
 *
 * - Prevents style bleeding without emitting redundant reset codes.
 *
 * @param line - The line to terminate.
 * @returns The line with styles guaranteed closed.
 */
export function withReset(line: string): string {
  return stylesOpen(line) ? line + STYLE_RESET : line;
}

const segmenter = new Intl.Segmenter();

/**
 * Splits a line into grapheme clusters.
 *
 * - Keeps multi-code-point sequences (ZWJ emoji, variation selectors,
 *   combining marks) together as single units.
 *
 * @param line - The string to split.
 * @returns Array of grapheme clusters.
 */
export const splitChars = (line: string): string[] =>
  Array.from(segmenter.segment(line), ({ segment }) => segment);

/**
 * Checks whether a given segment consists entirely of ASCII characters.
 *
 * - Matches characters in the range 0x00 to 0x7F.
 * - Used to determine whether fast-path rendering can be applied.
 *
 * @param segment - A string segment to check.
 * @returns Whether the segment is pure ASCII.
 */
export const isAscii = (segment: string): boolean => ASCII_REGEX.test(segment);

/**
 * Checks whether a given string contains ANSI style codes.
 *
 * @param line The input string to test.
 * @returns `true` if ANSI style codes are present, otherwise `false`.
 */
export const isStyled = (line: string): boolean => STYLE_REGEX.test(line);
