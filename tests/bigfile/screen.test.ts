import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { BlockFile } from '../../src/pager/blockFile';
import { BigView } from '../../src/pager/fileView';

import { config } from '../../src/state/config';
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
    expect(v.top).toEqual({ pos: 0, subRow: 1 });

    v.lineForward(2);
    expect(v.top.subRow).toBe(0);
    expect(texts(v, 1)).toEqual(['short']);

    v.lineBackward(1);
    expect(v.top).toEqual({ pos: 0, subRow: 2 });
  });

  it('scrolling forward stops at the last line', () => {
    const v = view('e.txt', 'one\ntwo\nthree\n');

    expect(v.lineForward(10)).toBe(2);
    expect(texts(v, 1)).toEqual(['three']);
  });

  it('a jump re-homes the top, a scroll keeps its shift', () => {
    // og's jumps walk the file for a fresh position, and back_line /
    // find_pos only ever land on a row start of the ABSOLUTE grid -
    // jump_forw says so outright (jump.c:62). Scrolling instead nudges
    // the row in place and keeps the shift. Left set, the stale shift
    // moved G's landing a row down and put p's top mid-grid.
    config.chopLongLines = false;
    const v = view('f.txt', 'x'.repeat(400) + '\n');

    v.lineForward(2);
    config.subShift = 7;

    // a scroll keeps it: the top stays on the same line, shift and all
    v.lineForward(1);
    expect(config.subShift).toBe(7);
    v.lineBackward(1);
    expect(config.subShift).toBe(7);

    // ...and the probe behind the last-screenful clamp must not eat it
    v.endTop(10);
    expect(config.subShift).toBe(7);

    // every jump drops it
    v.gotoEnd(10);
    expect(config.subShift).toBe(0);

    config.subShift = 7;
    v.gotoStart();
    expect(config.subShift).toBe(0);

    config.subShift = 7;
    v.gotoPercent(50);
    expect(config.subShift).toBe(0);

    config.subShift = 7;
    v.gotoPos(120);
    expect(config.subShift).toBe(0);
  });
});
