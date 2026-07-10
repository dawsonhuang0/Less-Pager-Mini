import { BlockFile } from './ch';

import { forwLine, backLine, lastLineStart } from './lineio';

import { config } from '../config';

import { transformContent } from '../helpers';

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
  top: ViewTop = { pos: 0, subRow: 0 };
  /** True once the view shows the last line's end, like mode.EOF. */
  atEof = false;

  constructor(bf: BlockFile) {
    this.bf = bf;
  }

  /** Display sub-rows a line occupies under the current mode. */
  private rowsOf(text: string): number {
    if (config.chopLongLines || config.col) return 1;
    return getLayout(displayText(text)).rowStart.length;
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

    while (true) {
      const line = forwLine(this.bf, pos);
      if (!line) break;

      const total = this.rowsOf(line.text);
      let s = sub;

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

  /** Scrolls forward n display rows, like forw(). */
  lineForward(n: number): number {
    let moved = 0;

    while (moved < n) {
      const line = forwLine(this.bf, this.top.pos);
      if (!line) break;

      const total = this.rowsOf(line.text);

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
