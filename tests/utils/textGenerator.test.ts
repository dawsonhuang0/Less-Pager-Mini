import { TextRatio, TestCase } from './interfaces';

import { describe, it, expect } from 'vitest';

import { width1chars, width2chars, getTextSuite } from './textGenerator';

import { STYLE_REGEX } from './constants';

const asciiSet = new Set(width1chars.slice(0, 10));
const wideSet = new Set(width2chars);

const lengthMap: Record<number, () => number> = {
  0: () => 0,
  1: () => 1 + Math.floor(Math.random() * 100),
  2: () => 2 + Math.floor(Math.random() * 50) * 2,
  3: () => 3 + Math.floor(Math.random() * 98)
};

function getRandomRatios(): TextRatio {
  const thin = 1 + Math.floor(Math.random() * 99);
  return { thin, wide: 100 - thin };
}

function addCases(
  name: string,
  base: number,
  ratios: TextRatio
): TestCase[] {
  return Array.from({ length: 4 }, (_, i) => {
    const ascii = i % 2 === 1;
    const ansi = i >= 2;

    return {
      name: `${name}${ascii ? ' + Ascii' : ''}${ansi ? ' + Ansi' : ''}`,
      length: lengthMap[base](),
      options: {
        ratios,
        ascii,
        ansi
      }
    };
  });
}

describe('success cases', () => {
  const passCases: TestCase[] = [
    ...addCases('Nothing', 0, { thin: 50, wide: 50 }),
    ...addCases('Nothing + Illegal Ratios', 0, { thin: 0, wide: 0 }),
    ...addCases('Pure Thin', 1, { thin: 100, wide: 0 }),
    ...addCases('Pure Wide', 2, { thin: 0, wide: 100 }),
    ...addCases('Mixed Evenly', 3, { thin: 50, wide: 50 }),
    ...addCases('Mixed Unevenly', 3, getRandomRatios()),
  ];

  const res = getTextSuite(passCases);

  res.forEach(({ chars, widths }, i) => {
    it(passCases[i].name, () => {
      expect(chars).not.toHaveLength(0);
      expect(widths).not.toHaveLength(0);
      expect(chars.length).toBe(widths.length);

      const totalLength = widths.reduce((sum, n) => sum + n);
      expect(totalLength).toBe(passCases[i].length);

      if (passCases[i].length === 0) {
        if (passCases[i].options.ansi) {
          expect(chars[0]).toMatch(STYLE_REGEX);
        } else {
          expect(chars[0]).toBe('');
        }
        expect(widths[0]).toBe(0);
        return;
      }

      if (passCases[i].options.ratios.thin === 100) {
        const unexpectedChars = chars.filter((char, i) =>
          widths[i] !== 0 && wideSet.has(char)
        );
        expect(unexpectedChars).toHaveLength(0);
        expect(widths).not.toContain(2);
      }

      if (passCases[i].options.ratios.wide === 100) {
        const unexpectedChars = chars.filter((char, i) =>
          widths[i] !== 0 && !wideSet.has(char)
        );
        expect(unexpectedChars).toHaveLength(0);
        expect(widths).not.toContain(1);
      }

      if (passCases[i].options.ascii) {
        const unexpectedChars = chars.filter((char, i) =>
          widths[i] === 1 && !asciiSet.has(char)
        );
        expect(unexpectedChars).toHaveLength(0);
      }

      if (passCases[i].options.ansi) {
        expect(chars).toEqual(
          expect.arrayContaining([expect.stringMatching(STYLE_REGEX)])
        );
        expect(widths).toContain(0);
      } else {
        expect(chars).not.toEqual(
          expect.arrayContaining([expect.stringMatching(STYLE_REGEX)])
        );
        expect(widths).not.toContain(0);
      }

      let wideWidth = 0;
      let thinWidth = 0;

      for(let i = 0; i < widths.length; i++) {
        if (widths[i] === 1) thinWidth += 1;
        if (widths[i] === 2) wideWidth += 2;
      }

      expect(Math.abs(
        passCases[i].options.ratios.wide / 100 - wideWidth / totalLength
      )).toBeLessThanOrEqual(1);
      expect(Math.abs(
        passCases[i].options.ratios.thin / 100 - thinWidth / totalLength
      )).toBeLessThanOrEqual(1);
    });
  });
});

describe('fail cases', () => {
  let { thin, wide } = getRandomRatios();

  if (Math.round(Math.random())) {
    thin += 1 - 2 * Math.round(Math.random());
    wide += 2 - 4 * Math.round(Math.random());
  } else {
    thin += 2 - 4 * Math.round(Math.random());
    wide += 1 - 2 * Math.round(Math.random());
  }

  const failCases = addCases('Illegal Ratios', 1, { thin, wide });

  it('unsatisfies text ratios', () => {
    expect(() => getTextSuite(failCases)).toThrow(
      'Text ratios must sum to 100.'
    );
  });
});
