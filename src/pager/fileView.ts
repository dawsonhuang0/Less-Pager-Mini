import { BlockFile } from './blockFile';

import { forwLine, backLine, lastLineStart } from './fileLines';

import { config } from '../state/config';
import { chopLine } from '../options';

import { transformContent } from '../lines/helpers';

import { getLayout } from '../lines/lineLayout';

/**
 * The visible-screen model for file-backed sessions, ported from
 * og's position.c + forwback.c: the view is a byte position at the
 * top of the screen (plus a wrap sub-row), and movement walks lines
 * from there — no global line index exists.
 */

export interface ViewTop {
  /** Line-start byte position of the top line. */
  pos: number;
  /** Wrap sub-row within that line (0 in chop mode). */
  subRow: number;
}

/** A line's display text: the normal content transform per line. */
export function displayText(raw: string): string {
  return transformContent([raw])[0] ?? '';
}

export class BigView {
  readonly bf: BlockFile;
  private current: ViewTop = { pos: 0, subRow: 0 };
  /** True once the view shows the last line's end, like mode.EOF. */
  atEof = false;

  constructor(bf: BlockFile) {
    this.bf = bf;
  }

  get top(): ViewTop {
    return this.current;
  }

  /**
   * Re-homes the screen, dropping the top's shift.
   *
   * Replacing the whole top is a JUMP: every one of them walks the
   * file for a fresh position, and those walks - back_line, find_pos -
   * only ever land on a row start of the ABSOLUTE grid. jump_forw is
   * explicit: back_line from the end, then jump_loc (jump.c:62).
   * Scrolling instead nudges subRow in place and keeps the shift,
   * which is exactly the asymmetry og shows.
   *
   * A repaint is NOT a jump: it re-jumps to the byte the screen
   * already starts at (jump.c:131), shift and all - which is why
   * markPosClear leaves the shift alone and only this drops it.
   */
  set top(next: ViewTop) {
    config.subShift = 0;
    this.current = next;
  }

  /** Display sub-rows a line occupies under the current mode. */
  rowsOf(text: string): number {
    if (chopLine() || config.col) return 1;
    return getLayout(displayText(text)).rowStart.length;
  }

  /**
   * The same, for the line the top's shift belongs to: its rows sit at
   * boundary + shift, so the last one can fall past the line's end and
   * the line paints one row fewer than the boundary grid counts. og
   * reads its table instead of counting, so it never sees this.
   */
  shiftedRowsOf(text: string, subRow: number): number {
    const total = this.rowsOf(text);
    if (config.subShift <= 0 || chopLine() || config.col) return total;

    const disp = displayText(text);
    const from = (getLayout(disp).rowStart[subRow] ?? 0) + config.subShift;
    if (from >= disp.length) return total;

    return subRow + getLayout(disp.slice(from)).rowStart.length;
  }

  /**
   * Advances a shifted top by one row, re-wrapping from its own byte.
   *
   * og's table[TOP] is a byte and forw_line wraps from THERE, so the
   * row it produces is whatever fits starting at that byte. Under a
   * fixed width that is the same as adding the shift to the next
   * boundary - offset + width == (boundary + width) + shift - but
   * --wordwrap breaks at spaces, so the rows are unequal and the two
   * answers part company: the shifted grid has to be re-wrapped, not
   * translated. Doing it by offset is right for both.
   *
   * Returns false when the line has no row left, so the caller moves
   * on to the next line.
   */
  private advanceShifted(text: string): boolean {
    const disp = displayText(text);
    const starts = getLayout(disp).rowStart;
    const from = (starts[this.current.subRow] ?? 0) + config.subShift;

    if (from >= disp.length) return false;

    const len = getLayout(disp.slice(from)).rowStart[1];
    if (len === undefined) return false;

    const next = from + len;

    let sub = 0;
    while (sub + 1 < starts.length && starts[sub + 1] <= next) sub++;

    this.current.subRow = sub;
    config.subShift = next - (starts[sub] ?? 0);
    return true;
  }

  /**
   * Materializes the visible screen, like og filling the position
   * table: returns the raw line texts with their positions/sub-rows,
   * exactly `count` display rows unless the file ends first.
   */
  visible(count: number): {
    rows: { text: string, pos: number, subRow: number }[],
    endPos: number,
  } {
    const rows: { text: string, pos: number, subRow: number }[] = [];
    let pos = this.top.pos;
    let sub = this.top.subRow;
    let endPos = pos;
    let more = false;

    // the shift belongs to the line the top sits on, and nothing below
    const shiftPos = this.top.pos;
    const shiftSub = this.top.subRow;

    while (true) {
      const line = forwLine(this.bf, pos);
      if (!line) break;

      const total = pos === shiftPos
        ? this.shiftedRowsOf(line.text, shiftSub)
        : this.rowsOf(line.text);

      // A sub-row past the line's last one means something reshaped
      // the wrapping under the top - an option that changes what a
      // line displays, and so how it breaks. og cannot be in this
      // state at all: table[TOP] is a BYTE and forw_line reads from
      // it, so there is no index to go stale. Ours can, and emitting
      // nothing here handed sync() an empty screen and buried the
      // real fault; the byte is still inside the line, so read from
      // its last row.
      let s = Math.min(sub, Math.max(total - 1, 0));

      for (; s < total && rows.length < count; s++) {
        rows.push({ text: line.text, pos, subRow: s });
      }

      if (rows.length >= count) {
        // content past the bottom row means the end is not shown
        more = s < total || line.next < this.bf.size;
        endPos = line.next;
        break;
      }

      endPos = line.next;
      pos = line.next;
      sub = 0;
    }

    this.atEof = !more;
    return { rows, endPos };
  }

  /**
   * The position shown at a screen row, like og's position(): row k
   * counted from the top of the window, the end-of-file position
   * just past the last line, or null beyond that on a short screen.
   */
  screenPos(k: number): ViewTop | null {
    let pos = this.top.pos;
    let sub = this.top.subRow;

    for (let i = 0; i < k; i++) {
      if (pos >= this.bf.size) return null;

      const line = forwLine(this.bf, pos);
      if (!line) return null;

      if (sub + 1 < this.rowsOf(line.text)) {
        sub++;
      } else {
        pos = line.next;
        sub = 0;
      }
    }

    return { pos, subRow: sub };
  }

  /**
   * The top whose screen bottoms at the last line — og's jump_forw
   * anchor: plain forward moves never pass it (forward() finds
   * nothing to read past the eof and rings the bell instead).
   */
  endTop(window: number): { pos: number, subRow: number } {
    const saved = this.top;
    const savedShift = config.subShift;
    this.gotoEnd(window);
    const end = this.top;
    this.top = saved;
    // a probe, not a move: gotoEnd re-homes the top like og's
    // jump_forw, and the caller's own shift must outlive that
    config.subShift = savedShift;
    return end;
  }

  /** Scrolls forward n display rows, like forw(): a plain move
   *  clamps at the last screenful (og's eof bell spot); a FORCED
   *  move (J, ESC-SPACE) passes window as undefined and runs on
   *  until the last line reaches the top, like og's force=TRUE. */
  lineForward(n: number, window?: number): number {
    const end = window !== undefined ? this.endTop(window) : null;
    let moved = 0;

    // the shift belongs to the line the top starts on; walking off it
    // leaves the boundary grid
    const shiftPos = this.top.pos;
    const shiftSub = this.top.subRow;

    while (moved < n) {
      if (end && (this.top.pos > end.pos ||
          (this.top.pos === end.pos && this.top.subRow >= end.subRow))) {
        break;
      }

      const line = forwLine(this.bf, this.top.pos);
      if (!line) break;

      const shifted = config.subShift > 0 && this.top.pos === shiftPos;
      const total = this.top.pos === shiftPos
        ? this.shiftedRowsOf(line.text, shiftSub)
        : this.rowsOf(line.text);

      if (shifted) {
        if (this.advanceShifted(line.text)) {
          moved++;
          continue;
        }

        if (line.next >= this.bf.size) break;
        this.top = { pos: line.next, subRow: 0 };
        moved++;
        continue;
      }

      if (this.top.subRow + 1 < total) {
        this.top.subRow++;
      } else if (line.next < this.bf.size) {
        this.top = { pos: line.next, subRow: 0 };
      } else {
        break;
      }

      moved++;
    }

    return moved;
  }

  /** Scrolls backward n display rows, like back(). */
  lineBackward(n: number): number {
    let moved = 0;

    while (moved < n) {
      if (this.top.subRow > 0) {
        this.top.subRow--;
      } else {
        const prev = backLine(this.bf, this.top.pos);
        if (!prev) break;

        this.top = {
          pos: prev.start,
          subRow: this.rowsOf(prev.text) - 1,
        };
      }

      moved++;
    }

    return moved;
  }

  /** Jumps to the first line, like jump_back(1). */
  gotoStart(): void {
    this.top = { pos: 0, subRow: 0 };
  }

  /**
   * Jumps so the last line sits on the bottom row, like jump_forw:
   * walk back window-1 display rows from the last line's last row.
   */
  gotoEnd(window: number): void {
    const last = lastLineStart(this.bf);
    const text = forwLine(this.bf, last)?.text ?? '';

    this.top = { pos: last, subRow: this.rowsOf(text) - 1 };
    this.lineBackward(window - 2);
  }

  /**
   * Jumps to a byte percentage of the file, snapped back to a line
   * start, like og's jump_percent over find_pos.
   */
  gotoPercent(percent: number): void {
    // og's percent_pos: integer division per step, round-up remainder
    const size = this.bf.size;
    const pos = Math.min(
      Math.floor(size / 100) * percent +
        Math.floor(((size % 100) * percent + 99) / 100),
      size
    );

    const nl = this.bf.findNewlineBack(pos, 1 << 16);
    this.top = { pos: nl < 0 ? 0 : nl + 1, subRow: 0 };
  }

  /** Jumps to an absolute byte position's line, like jump_line_loc. */
  gotoPos(pos: number): void {
    const clamped = Math.max(0, Math.min(pos, this.bf.size));
    const nl = this.bf.findNewlineBack(clamped, 1 << 20);
    this.top = { pos: nl < 0 ? 0 : nl + 1, subRow: 0 };
  }
}
