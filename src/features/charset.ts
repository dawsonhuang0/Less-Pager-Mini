import { INVERSE_ON, INVERSE_OFF, BOLD_ON, BOLD_OFF, UNDERLINE_ON,
  UNDERLINE_OFF } from "../state/constants";

import { colored, coloredWrap } from "./color";

import { search } from "./searching";

import { lgetenv } from '../startup/environment';

/**
 * The charset machinery, ported from less's charset.c: a per-byte class
 * map built from $LESSCHARSET/$LESSCHARDEF, and the $LESSBINFMT /
 * $LESSUTFBINFMT display formats for binary characters.
 */

// per-byte classes, like chardef[]
const IS_BINARY = 1;
const IS_CONTROL = 2;

/** Charset descriptors, like charset.c's charsets[]. */
const CHARSETS: Record<string, { utf: boolean, desc: string }> = {
  'ascii': { utf: false, desc: '8bcccbcc18b95.b' },
  'utf-8': { utf: true, desc: '8bcccbcc18b95.b126.bb' },
  'iso8859': { utf: false, desc: '8bcccbcc18b95.33b.' },
  'latin3': { utf: false,
    desc: '8bcccbcc18b95.33b5.b8.b15.b4.b12.b18.b12.b.' },
  'arabic': { utf: false,
    desc: '8bcccbcc18b95.33b.3b.7b2.13b.3b.b26.5b19.b' },
  'greek': { utf: false, desc: '8bcccbcc18b95.33b4.2b4.b3.b35.b44.b' },
  'greek2005': { utf: false, desc: '8bcccbcc18b95.33b14.b35.b44.b' },
  'hebrew': { utf: false, desc: '8bcccbcc18b95.33b.b29.32b28.2b2.b' },
  'koi8-r': { utf: false, desc: '8bcccbcc18b95.b.' },
  'KOI8-T': { utf: false,
    desc: '8bcccbcc18b95.b8.b6.b8.b.b.5b7.3b4.b4.b3.b.b.3b.' },
  'georgianps': { utf: false, desc: '8bcccbcc18b95.3b11.4b12.2b.' },
  'tcvn': { utf: false, desc: 'b..b...bcccbccbbb7.8b95.b48.5b.' },
  'TIS-620': { utf: false, desc: '8bcccbcc18b95.b.4b.11b7.8b.' },
  'next': { utf: false, desc: '8bcccbcc18b95.bb125.bb' },
  'dos': { utf: false, desc: '8bcccbcc12bc5b95.b.' },
  'windows-1251': { utf: false, desc: '8bcccbcc12bc5b95.b24.b.' },
  'windows-1252': { utf: false, desc: '8bcccbcc12bc5b95.b.b11.b.2b12.b.' },
  'windows-1255': { utf: false, desc: '8bcccbcc12bc5b95.b.b8.b.5b9.b.4b.' },
};

/** Alias names, like cs_aliases[]. */
const ALIASES: Record<string, string> = {
  'UTF-8': 'utf-8', 'utf8': 'utf-8', 'UTF8': 'utf-8',
  'ANSI_X3.4-1968': 'ascii', 'US-ASCII': 'ascii',
  'latin1': 'iso8859', 'ISO-8859-1': 'iso8859',
  'latin9': 'iso8859', 'ISO-8859-15': 'iso8859',
  'latin2': 'iso8859', 'ISO-8859-2': 'iso8859',
  'ISO-8859-3': 'latin3',
  'latin4': 'iso8859', 'ISO-8859-4': 'iso8859',
  'cyrillic': 'iso8859', 'ISO-8859-5': 'iso8859',
  'ISO-8859-6': 'arabic',
  'ISO-8859-7': 'greek', 'IBM9005': 'greek2005',
  'ISO-8859-8': 'hebrew',
  'latin5': 'iso8859', 'ISO-8859-9': 'iso8859',
  'latin6': 'iso8859', 'ISO-8859-10': 'iso8859',
  'latin7': 'iso8859', 'ISO-8859-13': 'iso8859',
  'latin8': 'iso8859', 'ISO-8859-14': 'iso8859',
  'latin10': 'iso8859', 'ISO-8859-16': 'iso8859',
  'IBM437': 'dos',
  'KOI8-R': 'koi8-r', 'KOI8-U': 'koi8-r',
  'GEORGIAN-PS': 'georgianps', 'TCVN5712-1': 'tcvn',
  'NEXTSTEP': 'next',
  'windows': 'windows-1252', 'CP1251': 'windows-1251',
  'CP1252': 'windows-1252', 'CP1255': 'windows-1255',
};

let chardef = new Uint8Array(256);
let utfMode = true;

let binFmt = '<%02X>';
let utfBinFmt = '<U+%04lX>';

// the display attribute for binary chars, like binattr (standout +
// the BIN color slot)
let binAttrKind: 'bold' | 'blink' | 'standout' | 'underline' | 'normal' =
  'standout';

/**
 * Parses a chardef description, like ichardef: digits repeat the next
 * class char (`.` normal, `c` control, `b` binary), and the last
 * class fills the rest of the 256 bytes.
 */
function parseChardef(desc: string): void {
  const def = new Uint8Array(256);
  let at = 0;
  let count = 0;
  let value = 0;

  for (const char of desc) {
    if (char >= '0' && char <= '9') {
      count = count * 10 + (char.charCodeAt(0) - 0x30);
      continue;
    }

    if (char === '.') value = 0;
    else if (char === 'c') value = IS_CONTROL;
    else if (char === 'b') value = IS_BINARY | IS_CONTROL;
    else continue;

    do {
      if (at < 256) def[at++] = value;
    } while (--count > 0);

    count = 0;
  }

  while (at < 256) def[at++] = value;
  chardef = def;
}

/** Selects a named charset, like icharset. */
function useCharset(name: string | undefined): boolean {
  if (!name) return false;

  const resolved = ALIASES[name] ?? name;
  const charset = CHARSETS[resolved];
  if (!charset) return false;

  parseChardef(charset.desc);
  utfMode = charset.utf;
  return true;
}

/**
 * Applies a $LESSBINFMT-style format, like setfmt: a `*x` prefix
 * selects the attribute (d/k/s/u or normal), `%n` formats fall back
 * to the default.
 */
function setFmt(
  text: string | undefined,
  fallback: string
): { fmt: string, attr: typeof binAttrKind | null } {
  let s = text;

  if (!s || (s[0] === '*' ? s.length > 2 && s.slice(2).includes('n')
    : s.includes('n') && /%[-0-9.]*n/.test(s))) {
    s = fallback;
  }

  let attr: typeof binAttrKind | null = null;

  if (s[0] === '*' && s.length > 1) {
    switch (s[1]) {
      case 'd': attr = 'bold'; break;
      case 'k': attr = 'blink'; break;
      case 's': attr = 'standout'; break;
      case 'u': attr = 'underline'; break;
      default: attr = 'normal'; break;
    }

    s = s.slice(2);
  }

  return { fmt: s, attr };
}

/**
 * Initializes the charset from the environment, like init_charset:
 * $LESSCHARSET, then $LESSCHARDEF, then a UTF-8 sniff of the locale
 * variables; UTF-8 is the fallback (our native mode).
 */
// LESSUTFCHARDEF user overrides (v609), like ichardef_utf: hex
// ranges assigned to a class letter (b/c/d/w/p)
interface CodeRange { first: number; last: number; }

const userTables: Record<'w' | 'b' | 'c' | 'p' | 'd', CodeRange[]> = {
  w: [], b: [], c: [], p: [], d: [],
};

const inTable = (code: number, table: CodeRange[]): boolean =>
  table.some(r => code >= r.first && code <= r.last);

/** True when a user range forces the wide class. */
export const userWide = (code: number): boolean =>
  inTable(code, userTables.w);

/** True when a user range forces the composing class. */
export const userComposing = (code: number): boolean =>
  !inTable(code, userTables.p) && inTable(code, userTables.c);

/** Parses LESSUTFCHARDEF, like ichardef_utf. */
function parseUtfChardef(text: string): void {
  for (const key of Object.keys(userTables) as (keyof typeof userTables)[]) {
    userTables[key] = [];
  }

  let i = 0;

  const hex = (): number => {
    // less skips a U+ prefix before each number
    if (text.slice(i, i + 2).toUpperCase() === 'U+') i += 2;
    const m = /^[0-9a-fA-F]+/.exec(text.slice(i));
    if (!m) return -1;
    i += m[0].length;
    return parseInt(m[0], 16);
  };

  while (i < text.length) {
    const first = hex();
    let last = first;

    if (text[i] === '-') {
      i++;
      last = hex();
    }

    if (first < 0 || last < 0) {
      search.message = 'invalid hex number(s) in LESSUTFCHARDEF';
      return;
    }

    if (text[i++] !== ':') {
      search.message = 'missing colon in LESSUTFCHARDEF';
      return;
    }

    const kind = text[i++];
    const range = { first, last };

    switch (kind) {
      case 'b': userTables.b.push(range); break;
      case 'c': userTables.c.push(range); break;
      case 'd': userTables.d.push(range); break;
      case 'w':
        userTables.w.push(range);
        userTables.p.push(range);
        break;
      case 'p': case '.': userTables.p.push(range); break;
      default: break; // unknown attributes are ignored, like less
    }

    if (text[i] === ',') i++;
  }
}

export function initCharset(): void {
  binFmt = '<%02X>';
  utfBinFmt = '<U+%04lX>';
  binAttrKind = 'standout';

  parseUtfChardef(lgetenv('LESSUTFCHARDEF') ?? '');

  const binEnv = setFmt(lgetenv('LESSBINFMT'), '*s<%02X>');
  binFmt = binEnv.fmt;
  if (binEnv.attr !== null) binAttrKind = binEnv.attr;

  const utfEnv = setFmt(lgetenv('LESSUTFBINFMT'), '<U+%04lX>');
  utfBinFmt = utfEnv.fmt;
  if (utfEnv.attr !== null) binAttrKind = utfEnv.attr;

  if (useCharset(lgetenv('LESSCHARSET'))) return;

  const chardefEnv = lgetenv('LESSCHARDEF');

  if (chardefEnv) {
    parseChardef(chardefEnv);
    utfMode = false;
    return;
  }

  const locale = lgetenv('LC_ALL') || lgetenv('LC_CTYPE') ||
    lgetenv('LANG') || '';

  if (/utf-?8/i.test(locale)) {
    useCharset('utf-8');
    return;
  }

  // less falls back to the locale tables; ours is natively UTF-8
  useCharset('utf-8');
}

/**
 * less's omit table (omit.uni): characters DELETED from the output
 * rather than drawn, "so that we never send them to the terminal.
 * Terminals do not display these characters consistently, so the
 * screen content cannot be known after printing them" (023bc640).
 * 4ad1ce1 then moved emoji modifiers here from the hex display.
 */
const OMIT_RANGES: [number, number][] = [
  [0x00ad, 0x00ad],     // SOFT HYPHEN
  [0x200d, 0x200d],     // ZERO WIDTH JOINER
  [0xfe00, 0xfe0f],     // variation selectors
  [0x1f3fb, 0x1f3ff],   // skin tone modifiers
  [0x1f9b0, 0x1f9b3],   // hair components
  [0xe0100, 0xe01ef],   // variation selectors supplement
];

/** True for a character less omits from the display, like is_omit_char. */
export function omitChar(code: number): boolean {
  for (const [lo, hi] of OMIT_RANGES) {
    if (code >= lo && code <= hi) return true;
    if (code < lo) break;
  }

  return false;
}

/** True for a binary byte in the current charset, like binary_char. */
export const binaryByte = (byte: number): boolean =>
  byte > 255 || (chardef[byte] & IS_BINARY) !== 0;

/** True for a control byte, like control_char. */
export const controlByte = (byte: number): boolean =>
  byte > 255 || (chardef[byte] & IS_CONTROL) !== 0;

/**
 * True for a Unicode char displayed as binary, like is_ubin_char:
 * unassigned, surrogate, private-use and raw control planes.
 */
export function ubinChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return false;

  // LESSUTFCHARDEF overrides win, printable first like is_ubin_char
  if (inTable(code, userTables.p)) return false;
  if (inTable(code, userTables.b)) return true;

  // U+FFFD marks bytes that failed to decode
  if (code === 0xFFFD) return true;

  return /^[\p{Cc}\p{Cn}\p{Co}\p{Cs}]$/u.test(char);
}

/** Formats a code with a %02X / %04lX style printf format. */
function hexFmt(fmt: string, code: number): string {
  return fmt.replace(
    /%(0?\d*)l?([Xxd])/,
    (_, width: string, kind: string) => {
      let text = kind === 'd' ? String(code) : code.toString(16);
      if (kind === 'X') text = text.toUpperCase();
      return text.padStart(parseInt(width, 10) || 0, '0');
    }
  );
}

/**
 * Renders a binary byte with $LESSBINFMT and the binary attribute,
 * like line.c drawing with binattr (the BIN color under -D).
 */
export function binByteText(byte: number): string {
  return binText(hexFmt(binFmt, byte));
}

/** Renders a binary Unicode char with $LESSUTFBINFMT. */
export function utfBinText(code: number): string {
  return binText(hexFmt(utfBinFmt, code));
}

function attrWrap(kind: typeof binAttrKind): [string, string] {
  switch (kind) {
    case 'bold': return [BOLD_ON, BOLD_OFF];
    case 'blink': return ['\x1B[5m', '\x1B[25m'];
    case 'standout': return [INVERSE_ON, INVERSE_OFF];
    case 'underline': return [UNDERLINE_ON, UNDERLINE_OFF];
    case 'normal': return ['', ''];
  }
}

function binText(text: string): string {
  const [on, off] = attrWrap(binAttrKind);

  // the BIN color wins under --use-color, like binattr's AT_COLOR_BIN
  return colored('bin', text, on, off);
}

/** The escape pair every binary marker carries, for the run coalescing. */
export function binWrap(): [string, string] {
  const [on, off] = attrWrap(binAttrKind);

  return coloredWrap('bin', on, off);
}

/** UTF-8 sequence length from the lead byte, like utf_len. */
function utfLen(byte: number): number {
  if (byte < 0x80) return 1;
  if ((byte & 0xE0) === 0xC0) return 2;
  if ((byte & 0xF0) === 0xE0) return 3;
  if ((byte & 0xF8) === 0xF0) return 4;
  return 1;
}

/** Strict well-formedness, like is_utf8_well_formed. */
function wellFormed(data: Buffer, at: number, len: number): boolean {
  const b0 = data[at];
  const b1 = data[at + 1];

  const cont = (b: number | undefined): boolean =>
    b !== undefined && (b & 0xC0) === 0x80;

  switch (len) {
    case 2:
      return b0 >= 0xC2 && cont(b1);

    case 3:
      if (!cont(b1) || !cont(data[at + 2])) return false;
      if (b0 === 0xE0) return b1 >= 0xA0;
      if (b0 === 0xED) return b1 <= 0x9F;
      return true;

    case 4:
      if (!cont(b1) || !cont(data[at + 2]) || !cont(data[at + 3])) {
        return false;
      }
      if (b0 === 0xF0) return b1 >= 0x90;
      if (b0 === 0xF4) return b1 <= 0x8F;
      return b0 <= 0xF3;
  }

  return false;
}

/** The private-use page carrying raw undecodable bytes. */
const RAW_BYTE_BASE = 0xE000;

/** The raw byte carried by a private-use marker, or -1. */
export function rawByteOf(char: string): number {
  const code = char.charCodeAt(0);
  return code >= RAW_BYTE_BASE && code < RAW_BYTE_BASE + 0x100
    ? code - RAW_BYTE_BASE
    : -1;
}

/**
 * Decodes file bytes for display, like less reading through the
 * charset: valid UTF-8 sequences become chars and invalid bytes
 * become private-use markers later rendered with $LESSBINFMT; other
 * charsets map bytes through latin1 with their chardef classes.
 */
export function decodeContent(data: Buffer): string {
  // single code units batch through fromCharCode instead of per-char
  // string appends, which crawl on megabytes of binary data
  const parts: string[] = [];
  const codes: number[] = [];

  const flush = (): void => {
    if (codes.length) {
      parts.push(String.fromCharCode(...codes));
      codes.length = 0;
    }
  };

  const push = (code: number): void => {
    codes.push(code);
    if (codes.length >= 8192) flush();
  };

  if (!utfMode) {
    for (const byte of data) {
      push(byte >= 0x80 && (chardef[byte] & IS_CONTROL) !== 0
        ? RAW_BYTE_BASE + byte
        : byte);
    }

    flush();
    return parts.join('');
  }

  let i = 0;

  while (i < data.length) {
    const byte = data[i];

    if (byte < 0x80) {
      push(byte);
      i++;
      continue;
    }

    const len = utfLen(byte);

    if (len > 1 && i + len <= data.length && wellFormed(data, i, len)) {
      flush();
      parts.push(data.subarray(i, i + len).toString('utf8'));
      i += len;
    } else {
      push(RAW_BYTE_BASE + byte);
      i++;
    }
  }

  flush();
  return parts.join('');
}

/**
 * Incrementally decodes pipe bytes into complete lines, like less's ch
 * layer reading a non-seekable input: a multibyte sequence split
 * across chunks is held back rather than decoded as binary markers,
 * and the trailing partial line waits for its newline (or the end of
 * the input).
 */
export class PipeDecoder {
  private bytes: Buffer = Buffer.alloc(0);
  private tail = '';

  /** Decodes one chunk and returns the complete lines in it. */
  push(chunk: Buffer): string[] {
    let data = this.bytes.length
      ? Buffer.concat([this.bytes, chunk])
      : chunk;

    // hold back an incomplete trailing UTF-8 sequence
    let hold = 0;

    for (let i = 1; i <= 3 && i <= data.length; i++) {
      const byte = data[data.length - i];
      if ((byte & 0xC0) === 0x80) continue;

      const need = (byte & 0xF8) === 0xF0 ? 4
        : (byte & 0xF0) === 0xE0 ? 3
          : (byte & 0xE0) === 0xC0 ? 2 : 1;

      if (need > i) hold = i;
      break;
    }

    this.bytes = hold
      ? Buffer.from(data.subarray(data.length - hold))
      : Buffer.alloc(0);
    if (hold) data = data.subarray(0, data.length - hold);

    const text = this.tail + decodeContent(data);
    const lines = text.split('\n');
    this.tail = lines.pop() ?? '';

    return lines;
  }

  /** The final partial line once the input ends, if any. */
  flush(): string[] {
    const rest = this.bytes.length
      ? this.tail + decodeContent(this.bytes)
      : this.tail;

    this.bytes = Buffer.alloc(0);
    this.tail = '';

    return rest ? [rest] : [];
  }
}
