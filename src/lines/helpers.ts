import { strWidth } from 'char-width';

import { config } from '../config';

import { getLayout } from './lineLayout';

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

import { rawByteOf, binByteText, utfBinText, ubinChar }
  from '../features/charset';

import {
  ASCII_REGEX,
  STYLE_REGEX,
  STYLE_REGEX_G,
  STYLE_RESET,
  INVERSE_ON,
  INVERSE_OFF
} from '../constants';

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

  // --wordwrap boundaries live in the layout, even for plain lines
  if (!optWordwrap() && !isStyled(line) && isAscii(line)) {
    return Math.floor(Math.max(line.length - 1, 0) / config.screenWidth);
  }

  return getLayout(line).rowStart.length - 1;
}

// controls, raw-byte markers and unicode binaries all transform
const CONTROL_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B-\x1F\x7F\t\uE000-\uE0FF\uFFFD\p{Cn}\p{Co}\p{Cs}]/u;


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
export function transformContent(lines: string[]): string[] {
  charCache = new Map();

  const squeeze = optSqueeze();
  const out: string[] = [];
  let blank = false;

  for (const raw of lines) {
    if (squeeze && raw === '') {
      if (blank) continue;
      blank = true;
    } else {
      blank = false;
    }

    out.push(CONTROL_REGEX.test(raw) ? transformLine(raw) : raw);
  }

  return out;
}

/**
 * Expands tabs and converts control characters in one line, like less's
 * do_append: caret notation in standout unless -r passes them raw; -R
 * (the default here) lets ANSI style sequences through.
 */
function transformLine(line: string): string {
  const ctldisp = optCtldisp();
  let out = '';
  let col = 0;
  let i = 0;

  // backspace handling, like line.c: --proc-backspace overrides the
  // -u/-U mode; og's DEFAULT is overstrike processing (BS_SPECIAL)
  if (line.includes('\x08')) {
    const pb = optProcBackspace();

    if (pb === 1 || (pb === 0 && optBsMode() === 0)) {
      line = procBackspaces(line);
    } else if (pb === 0 && optBsMode() === 1) {
      // -u: the backspace really overprints, leaving plain text
      // eslint-disable-next-line no-control-regex
      while (/.\x08/.test(line)) line = line.replace(/.\x08/g, '');
    }
    // otherwise \b renders as the ^H control char below
  }

  // --proc-return deletes a carriage return before the newline
  if (optProcReturn() === 1 && line.endsWith('\r')) {
    line = line.slice(0, -1);
  }

  while (i < line.length) {
    const char = line[i];

    // --proc-tab as ^I falls through to the control char display
    if (char === '\t' && optProcTab() !== 2) {
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
            : '^' + String.fromCharCode(char.charCodeAt(0) + 0x40);
          entry = [colored('ctrl', caret, INVERSE_ON, INVERSE_OFF), 2];
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
    i++;
  }

  return out;
}

/**
 * Converts nroff-style overstrikes for --proc-backspace: `X\bX` prints
 * bold and `_\bX` underlined, leftover backspaces just erase.
 */
function procBackspaces(line: string): string {
  /* eslint-disable no-control-regex */
  return line
    .replace(/_\x08(.)/g, (_, c: string) => attrText('underline', c))
    .replace(/(.)\x08\1/g, (_, c: string) => attrText('bold', c))
    .replace(/.\x08(.)/g, '$1');
  /* eslint-enable no-control-regex */
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
  const i = line.lastIndexOf(STYLE_RESET);
  const tail = i === -1 ? line : line.slice(i + STYLE_RESET.length);
  return STYLE_REGEX.test(tail) ? line + STYLE_RESET : line;
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
