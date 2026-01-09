import { TextOptions } from "./interfaces";

import { RESET } from "./constants";

export const width1chars = [
  // --- Standard ASCII ---
  'a', 'Z', '0', '9', '$', '%', '&', '+', '-', '=',

  // --- Extended Latin & Accents ---
  'é', 'ñ', 'ç', 'ß', 'ø', 'Å',

  // --- Box Drawing (Crucial for Borders) ---
  '│', '─', '┌', '┐', '└', '┘', '├', '┤', '┼', '█', '░',

  // --- Half-Width Katakana (The "looks like 2 but is 1" trap) ---
  'ｱ', 'ｲ', 'ｳ', 'ｴ', 'ｵ', 'ｶ', 'ｷ', 'ｸ', 'ｹ', 'ｺ',
  'ｻ', 'ｼ', 'ｽ', 'ｾ', 'ｿ', 'ﾀ', 'ﾁ', 'ﾂ', 'ﾃ', 'ﾄ',
  'ﾝ', 'ﾞ', 'ﾟ',

  // --- Ambiguous Width (Dangerous - usually 1 in modern terminals) ---
  'α', 'β', 'γ', // Greek
  '§', '¶', '©', '®', // Latin Symbols
  '→', '←', '↑', '↓', // Arrows

  // --- Thai (Complex text layout often bunches, but base chars are 1) ---
  'ก', 'ข', 'ฃ', 'ค', 'ฅ'
];

export const width2chars = [
  // --- Standard CJK (Chinese/Japanese/Korean) ---
  '一', '二', '三', // Kanji
  'あ', 'い', 'う', // Hiragana
  '가', '나', '다', // Hangul
  '龍', '猫', '漢', // Complex Hanzi

  // --- Full-Width ASCII (Look like English, take 2 cols) ---
  'Ａ', 'Ｂ', 'Ｃ', '１', '２', '３', '！', '？',
  'ａ', 'ｂ', 'ｃ', '＠', '＃',

  // --- Full-Width Punctuation ---
  '。', '、', '「', '」', '（', '）',

  // --- Standard Emojis ---
  '😀', '🚀', '💀', '🔥', '💻', '🐍', '✅',

  // --- Surrogate Pairs (Astral Plane Chars) ---
  '𠮷', // Common Kanji variant
  '𝌆', // Tetragram
  '🐲', // Dragon Face

  // Complex ZWJ Sequences (Multiple unicode points combined, take 2 cols)
  '👍🏽', // Thumbs Up + Skin Tone
  '👨‍👩‍👧‍👦', // Family (Man+Woman+Girl+Boy joined by ZWJ)
  '🏳️‍🌈', // Rainbow Flag
  '👩‍💻'  // Woman Technologist
];

const getThinChar = (ascii: boolean): string =>
  width1chars[Math.floor(Math.random() * (ascii ? 10 : 66))];
const getWideChar = (): string =>
  width2chars[Math.floor(Math.random() * 45)];

function getAnsi(): string {
  const entropy = Math.random() * 1000;
  if (entropy < 200) return RESET;

  const rand1 = entropy * 0.001;
  const rand2 = (entropy % 10) * 0.1;
  const rand3 = (entropy % 100) * 0.01;

  const type = Math.floor(rand1 * 3);
  const determinant = Math.ceil(type * 0.5);
  const brightness = Math.floor(type * 1.5) * 3 + Math.round(rand2);

  const base = determinant * brightness * 10;
  const style = Math.floor(rand3 * (9 - determinant));
  const code = 1 - determinant + base + style;

  return `\x1b[${code}m`;
}

/**
 * Generates multiple test text lines with specified characteristics.
 *
 * @param lines - Array of line specifications (length and options).
 * @returns Array of text lines with chars and visual widths.
 */
export const getTextSuite = (
  lines: { length: number, options: TextOptions }[]
): { chars: string[], widths: number[] }[] =>
  lines.map(({length, options}) => getText(length, options));

/**
 * Generates a single test text line with controlled character ratios.
 *
 * - Respects thin/wide character width ratios from options.
 * - Inserts ANSI codes randomly if enabled.
 *
 * @param length - Target visual width of the line.
 * @param options - Character ratios, ASCII mode, and ANSI toggle.
 * @returns Object with character array and corresponding width array.
 */
function getText(length: number, options: TextOptions): {
  chars: string[],
  widths: number[]
} {
  if (length === 0) return {
    chars: [options.ansi ? getAnsi() : ''],
    widths: [0]
  };

  const { thin = 0, wide = 0 } = options.ratios;
  if (thin + wide !== 100) throw new Error('Text ratios must sum to 100.');

  const chars = [];
  const widths = [];

  let wideCount = Math.round(length * wide / 200);
  let thinCount = length - wideCount * 2;

  const totalCount = wideCount + thinCount;

  const guardAnsi = Math.floor(Math.random() * totalCount);
  const guardResetAnsi = Math.floor(
    guardAnsi + Math.random() * (totalCount - guardAnsi)
  );

  for (let i = 0; i < totalCount; i++) {
    const remaining = wideCount + thinCount;
    const probWide = wideCount / remaining;

    if (probWide > Math.random()) {
      chars.push(getWideChar());
      widths.push(2);
      wideCount--;
    } else {
      chars.push(getThinChar(options.ascii));
      widths.push(1);
      thinCount--;
    }

    if (options.ansi) {
      if (i === guardResetAnsi) {
        chars.push(RESET);
        widths.push(0);
      } else if (i === guardAnsi || Math.random() < 0.3) {
        chars.push(getAnsi());
        widths.push(0);
      }
    }
  }

  return { chars, widths };
}
