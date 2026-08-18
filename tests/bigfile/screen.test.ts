import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { BlockFile } from '../../src/pager/blockFile';
import { BigView } from '../../src/pager/fileView';

import { config } from '../../src/state/config';
import { getLayout } from '../../src/lines/lineLayout';
import { opt } from '../../src/options/state';
import { initCharset } from '../../src/features/charset';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-bigview-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  config.screenWidth = 20;
  config.chopLongLines = true;
  config.col = 0;
  opt.bufSpace = 64;
  opt.autoBuffers = 1;
  initCharset();
});

function view(name: string, data: string): BigView {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return new BigView(new BlockFile(p));
}

const texts = (v: BigView, n: number): string[] =>
  v.visible(n).rows.map(r => r.text);

/** The top line's display text. */
const forwLineText = (v: BigView): string => v.visible(1).rows[0].text;

/** The character offset a wrap sub-row begins at. */
const rowStart = (text: string, subRow: number): number =>
  getLayout(text).rowStart[subRow] ?? 0;

describe('BigView movement', () => {
  const data = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`)
    .join('\n') + '\n';

  it('shows the first screen and scrolls forward/back', () => {
    const v = view('a.txt', data);

    expect(texts(v, 3)).toEqual(['line-1', 'line-2', 'line-3']);

    v.lineForward(2);
    expect(texts(v, 2)).toEqual(['line-3', 'line-4']);

    v.lineBackward(1);
    expect(texts(v, 1)).toEqual(['line-2']);

    // backward past the start stops
    expect(v.lineBackward(10)).toBe(1);
    expect(v.top.pos).toBe(0);
  });

  it('jumps to the end like G', () => {
    const v = view('b.txt', data);

    v.gotoEnd(5); // 4 content rows + prompt
    expect(texts(v, 4)).toEqual(
      ['line-47', 'line-48', 'line-49', 'line-50']);
  });

  it('jumps by byte percent snapped to line starts', () => {
    const v = view('c.txt', data);

    v.gotoPercent(50);
    const first = texts(v, 1)[0];
    expect(first).toMatch(/^line-2[4-6]$/);

    v.gotoPercent(0);
    expect(texts(v, 1)).toEqual(['line-1']);
  });

  it('walks wrapped sub-rows in wrap mode', () => {
    config.chopLongLines = false;

    const long = 'x'.repeat(50); // 3 sub-rows at width 20
    const v = view('d.txt', `${long}\nshort\n`);

    const { rows } = v.visible(4);
    expect(rows.map(r => r.subRow)).toEqual([0, 1, 2, 0]);
    expect(rows[3].text).toBe('short');

    v.lineForward(1);
    expect(v.top).toEqual({ pos: 0, offset: rowStart(long, 1) });

    v.lineForward(2);
    expect(v.top.offset).toBe(0);
    expect(texts(v, 1)).toEqual(['short']);

    v.lineBackward(1);
    expect(v.top).toEqual({ pos: 0, offset: rowStart(long, 2) });
  });

  it('scrolling forward stops at the last line', () => {
    const v = view('e.txt', 'one\ntwo\nthree\n');

    expect(v.lineForward(10)).toBe(2);
    expect(texts(v, 1)).toEqual(['three']);
  });

  it('re-wraps a shifted top rather than translating it (wordwrap)', () => {
    // less's table[TOP] is a byte and forw_line wraps from THERE. Under a
    // fixed width that equals adding the shift to the next boundary -
    // offset + width == (boundary + width) + shift - but --wordwrap
    // breaks at spaces, so rows are unequal and the two answers part
    // company. Translating landed the next row mid-word.
    config.chopLongLines = false;
    opt.wordwrap = 1;

    try {
      const words = 'aaa bbbb cc ddddddd ee fff gggggggg hh iii jjjj kk ';
      const v = view('w.txt', words.repeat(12) + '\n');
      const text = forwLineText(v);

      // start one character into the second row
      v.lineForward(1);
      v.top = { pos: v.top.pos, offset: v.top.offset + 1 };

      const before = v.top.offset;
      v.lineForward(1);
      const after = v.top.offset;

      // the new top must be a wrap point of the text starting at the
      // OLD top, i.e. it lands just after a space, never inside a word
      expect(text[after - 1]).toBe(' ');
      expect(after).toBeGreaterThan(before);
    } finally {
      opt.wordwrap = 0;
    }
  });

  it('a jump lands on a row start, a scroll keeps an off-grid top', () => {
    // less's jumps walk the file for a fresh position, and back_line /
    // find_pos only ever land on a row start of the ABSOLUTE grid -
    // jump_forw says so outright (jump.c:62). Scrolling instead moves
    // the top within its line, so a top part-way into a row stays
    // part-way in; there is no shift kept beside it that could be
    // dropped or left behind by mistake.
    config.chopLongLines = false;
    const line = 'x'.repeat(400);
    const v = view('f.txt', line + '\n');

    const offGrid = (): boolean =>
      !getLayout(line).rowStart.includes(v.top.offset);

    v.lineForward(2);
    v.top = { pos: v.top.pos, offset: v.top.offset + 7 };

    // a scroll keeps the top off the boundary grid
    v.lineForward(1);
    expect(offGrid()).toBe(true);
    // ...and back_line lands on the greatest row start BELOW it, so
    // the step back re-joins the grid rather than undoing 7 alone
    v.lineBackward(1);
    expect(getLayout(line).rowStart).toContain(v.top.offset);

    // the probe behind the last-screenful clamp must not move the top
    v.top = { pos: v.top.pos, offset: v.top.offset + 7 };
    const probed = { ...v.top };
    v.endTop(10);
    expect(v.top).toEqual(probed);

    // every jump names a row start of its own
    v.gotoEnd(10);
    expect(getLayout(line).rowStart).toContain(v.top.offset);

    v.top = { pos: v.top.pos, offset: v.top.offset + 7 };
    v.gotoStart();
    expect(v.top).toEqual({ pos: 0, offset: 0 });

    v.top = { pos: 0, offset: 7 };
    v.gotoPercent(50);
    expect(v.top.offset).toBe(0);

    v.top = { pos: 0, offset: 7 };
    v.gotoPos(120);
    expect(v.top.offset).toBe(0);
  });
});
