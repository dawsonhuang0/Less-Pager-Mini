import { optUseColor } from "../options";

import {
  STYLE_RESET,
  INVERSE_ON,
  INVERSE_OFF,
  BOLD_ON,
  BOLD_OFF,
  UNDERLINE_ON,
  UNDERLINE_OFF
} from "../constants";

/**
 * Color selector kinds, like less.h's AT_COLOR_* slots plus the
 * attribute remaps (-Dn, -Ds, -Dd, -Du, -Dk).
 */
export type ColorKind =
  | 'attn' | 'bin' | 'ctrl' | 'error' | 'header' | 'target' | 'mark'
  | 'linenum' | 'osc8' | 'prompt' | 'rscroll' | 'search' | 'tilde'
  | 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5'
  | 'normal' | 'standout' | 'bold' | 'underline' | 'blink';

/** -D selector letters, like optfunc.c's color_from_namechar. */
const NAME_CHARS: Record<string, ColorKind> = {
  B: 'bin',
  C: 'ctrl',
  E: 'error',
  H: 'header',
  J: 'target',
  M: 'mark',
  N: 'linenum',
  O: 'osc8',
  P: 'prompt',
  R: 'rscroll',
  S: 'search',
  T: 'tilde',
  W: 'attn',
  A: 'attn',
  n: 'normal',
  s: 'standout',
  d: 'bold',
  u: 'underline',
  k: 'blink',
  '1': 'sub1',
  '2': 'sub2',
  '3': 'sub3',
  '4': 'sub4',
  '5': 'sub5',
};

/** The attribute remaps -D may set without --use-color (no AT_COLOR
 *  bit in og's gate). */
const ATTR_KINDS = new Set<ColorKind>(
  ['normal', 'standout', 'bold', 'underline', 'blink']
);

/** The default color map, like line.c's color_map initializers. */
const DEFAULT_COLORS: Record<ColorKind, string> = {
  attn: 'Wm',
  bin: 'kR',
  ctrl: 'kR',
  error: 'kY',
  linenum: 'c*',
  mark: 'Wb',
  prompt: 'kC',
  rscroll: 'kc',
  header: '',
  search: 'kG',
  tilde: '-d',
  target: '-u',
  osc8: '-u',
  sub1: 'ky',
  sub2: 'wb',
  sub3: 'YM',
  sub4: 'Yr',
  sub5: 'Wc',
  normal: '',
  standout: '',
  bold: '',
  underline: '',
  blink: '',
};

let colorMap: Record<ColorKind, string> = { ...DEFAULT_COLORS };

/** Restores the default color map, for tests. */
export function resetColors(): void {
  colorMap = { ...DEFAULT_COLORS };
}

// 4-bit color chars to SGR foreground codes, like parse_color4 plus
// sgr_color folded together
const COLOR4: Record<string, number> = {
  k: 30, r: 31, g: 32, y: 33, b: 34, m: 35, c: 36, w: 37,
  K: 90, R: 91, G: 92, Y: 93, B: 94, M: 95, C: 96, W: 97,
};

// attribute chars accepted after a color, like screen.c's is_attr_char
const CATTR_CODES: Record<string, string> = {
  '*': '1', 'd': '1',
  '~': '7', 's': '7',
  '_': '4', 'u': '4',
  '&': '5', 'l': '5',
};

const MODE_ON = {
  bold: BOLD_ON,
  underline: UNDERLINE_ON,
  blink: '\x1B[5m',
  standout: INVERSE_ON,
};

const MODE_OFF = {
  bold: BOLD_OFF,
  underline: UNDERLINE_OFF,
  blink: '\x1B[25m',
  standout: INVERSE_OFF,
};

/**
 * Parses a -D color string into its SGR open sequence, like screen.c's
 * parse_color feeding tput_color: one or two 4-bit color chars (fg,
 * bg), or decimal `fg.bg` 256-color values, `-` leaving a side
 * unchanged, then attribute chars (`*~_&` or `dsul`). Trailing junk is
 * ignored, like og's cattr loop breaking out.
 *
 * @returns The SGR codes (possibly empty), or null when invalid.
 */
export function colorSgr(text: string): string | null {
  if (!text) return null;

  // tput_color's special case: "*" resets to normal
  if (text === '*') return STYLE_RESET;

  let s = text[0] === '+' ? text.slice(1) : text;
  let fg = '';
  let bg = '';
  let parsed = false;

  const isAttr = (c: string | undefined): boolean =>
    c !== undefined && c in CATTR_CODES;
  const is4 = (c: string | undefined): boolean =>
    c !== undefined && (c in COLOR4 || c === '-');

  if (isAttr(s[0])) {
    // a pure attribute string leaves both colors unchanged
    parsed = true;
  } else if (is4(s[0])) {
    if (s[0] !== '-') fg = `\x1B[${COLOR4[s[0]]}m`;

    if (s[1] === undefined || isAttr(s[1])) {
      s = s.slice(1);
      parsed = true;
    } else if (is4(s[1])) {
      if (s[1] !== '-') bg = `\x1B[${COLOR4[s[1]] + 10}m`;
      s = s.slice(2);
      parsed = true;
    }
  }

  if (!parsed) {
    // 256-color decimal form fg.bg, like parse_color6; `-` or an
    // omitted side leaves that color unchanged
    fg = '';
    const match = /^(?:(\d+)|-)?(?:\.(?:(\d+)|-)?)?/.exec(s)!;
    if (!match[0]) return null;

    if (match[1]) fg = `\x1B[38;5;${parseInt(match[1], 10)}m`;
    if (match[2]) bg = `\x1B[48;5;${parseInt(match[2], 10)}m`;

    s = s.slice(match[0].length);
  }

  let cattr = '';

  // trailing attribute chars; anything after them is ignored, like
  // og's cattr loop breaking out of the string
  while (isAttr(s[0])) {
    cattr += `\x1B[${CATTR_CODES[s[0]]}m`;
    s = s.slice(1);
  }

  return fg + bg + cattr;
}

/**
 * Stores a -D color setting, like opt_D through set_color_map.
 *
 * @param text - The selector char followed by the color string.
 * @returns An og error message, or null on success.
 */
export function setColor(text: string): string | null {
  const kind = NAME_CHARS[text[0] ?? ''];

  if (!kind) {
    return `Invalid color specifier '${text[0] ?? ''}'`;
  }

  if (!optUseColor() && !ATTR_KINDS.has(kind)) {
    return 'Set --use-color before changing colors';
  }

  const rest = text.slice(1);

  if (rest && colorSgr(rest) === null) {
    return `Invalid color string "${rest}"`;
  }

  colorMap[kind] = rest;
  return null;
}

/**
 * Wraps text in its mapped color when --use-color is on, like
 * at_enter preferring the color over the fallback attribute.
 *
 * @param kind - The AT_COLOR slot.
 * @param text - The text to color.
 * @param fallbackOn - Attribute opener used without a color.
 * @param fallbackOff - Attribute closer used without a color.
 */
export function colored(
  kind: ColorKind,
  text: string,
  fallbackOn: string = '',
  fallbackOff: string = ''
): string {
  // with --use-color the color always wins: an empty or no-change
  // color means no highlight, never the standout fallback (at_enter
  // branches on the kind, not the map)
  if (optUseColor()) {
    const open = colorSgr(colorMap[kind]);
    return open ? open + text + STYLE_RESET : text;
  }

  return fallbackOn ? fallbackOn + text + fallbackOff : text;
}

/**
 * Wraps text in a base attribute, honoring a -D remap like
 * tput_inmode: a plain color replaces the attribute, a `+color`
 * prefixes the attribute to it.
 */
export function attrText(
  attr: 'bold' | 'underline' | 'blink' | 'standout',
  text: string
): string {
  const map = colorMap[attr];
  if (!map) return MODE_ON[attr] + text + MODE_OFF[attr];

  const open = colorSgr(map) ?? '';

  return map[0] === '+'
    ? MODE_ON[attr] + open + text + STYLE_RESET
    : open + text + STYLE_RESET;
}
