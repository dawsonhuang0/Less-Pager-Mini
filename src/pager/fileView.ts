import { BlockFile } from './blockFile';

import { forwLine, backLine, lastLineStart } from './fileLines';

import { config } from '../state/config';
import { chopLine } from '../options';

import { transformContent } from '../lines/helpers';

import { getLayout, rowEndFrom, LineLayout } from '../lines/lineLayout';

import { rowStartBelow, lastRowStart, subRowAt } from '../lines/screenOps';

/**
 * The visible-screen model for file-backed sessions, ported from
 * og's position.c + forwback.c: the view is a position INSIDE the
 * file where the screen starts, and movement walks rows from there —
 * no global line index exists.
 */

export interface ViewTop {
  /** Line-start byte position of the top line. */
  pos: number;
  /**
   * Where in that line the screen starts, as a display-character
   * offset — the same space the layout's rowStart indexes.
   *
   * og's table[TOP] is a BYTE and forw_line wraps from THERE, so the
   * top is a PLACE in the line, never an index into a wrapping that
   * something else may recompute differently. A sub-row index goes
   * stale the moment an option reshapes how the line breaks (-r, -S,
   * --wordwrap, a width change); a place cannot.
   */
  offset: number;
}

/** A line's display text: the normal content transform per line. */
export function displayText(raw: string): string {
  return transformContent([raw])[0] ?? '';
}

export class BigView {
  readonly bf: BlockFile;
  /**
   * Where the screen starts. A jump names its own offset (0, or the
   * row it means); a scroll walks it. There is no shift to keep or
   * drop on the side, so the two cannot disagree.
   */
  top: ViewTop = { pos: 0, offset: 0 };
  /** True once the view shows the last line's end, like mode.EOF. */
  atEof = false;

  constructor(bf: BlockFile) {
    this.bf = bf;
  }

  private layoutOf(text: string): LineLayout {
    return getLayout(displayText(text));
  }

  /** Display-character length of a line, its one past-the-end offset. */
  lineLength(text: string): number {
    return this.layoutOf(text).chars.length;
  }

  /**
   * Where the row starting at `offset` ends, like forw_line reading
   * from table[TOP]: whatever fits from THAT place. A result at or
   * past the line's length means the line is finished.
   *
   * Chopped lines are one row however long they are, so the answer is
   * always the whole line - og's fits_on_screen never gets asked.
   */
  rowEnd(text: string, offset: number): number {
    const layout = this.layoutOf(text);
    if (chopLine() || config.col) return layout.chars.length;
    return rowEndFrom(layout, offset);
  }

  /**
   * The next row's offset, or null when this row ends the line.
   */
  nextRowOffset(text: string, offset: number): number | null {
    const end = this.rowEnd(text, offset);
    return end < this.lineLength(text) && end > offset ? end : null;
  }

  /** og's back_line, on this line's display text (see screenOps). */
  rowStartBelow(text: string, offset: number): number {
    return rowStartBelow(displayText(text), offset);
  }

  /** The offset of the line's last display row. */
  lastRowStart(text: string): number {
    return lastRowStart(displayText(text));
  }

  /** The offset a given wrap sub-row begins at. */
  rowOffset(text: string, subRow: number): number {
    if (chopLine() || config.col) return 0;
    return this.layoutOf(text).rowStart[subRow] ?? 0;
  }

  /** The wrap sub-row an offset falls in, for the renderer's index. */
  subRowAt(text: string, offset: number): number {
    return subRowAt(displayText(text), offset);
  }

  /** Display sub-rows a line occupies under the current mode. */
  rowsOf(text: string): number {
    if (chopLine() || config.col) return 1;
    return this.layoutOf(text).rowStart.length;
  }

  /**
   * Materializes the visible screen, like og filling the position
   * table: returns the raw line texts with their positions/offsets,
   * exactly `count` display rows unless the file ends first.
   */
  visible(count: number): {
    rows: { text: string, pos: number, subRow: number, offset: number }[],
    endPos: number,
  } {
    const rows: { text: string, pos: number, subRow: number, offset: number }[]
      = [];
    let pos = this.top.pos;
    let offset = this.top.offset;
    let endPos = pos;
    let more = false;

    while (true) {
      const line = forwLine(this.bf, pos);
      if (!line) break;

      const len = this.lineLength(line.text);
      // the top is a place in the line, so the only way past its end
      // is content that shrank under it; read the last row instead of
      // nothing, which used to hand sync() an empty screen
      if (offset > len) offset = this.lastRowStart(line.text);

      let sub = this.subRowAt(line.text, offset);
      let ended = false;

      while (rows.length < count) {
        rows.push({ text: line.text, pos, subRow: sub, offset });

        const end = this.rowEnd(line.text, offset);
        if (end >= len || end <= offset) {
          ended = true;
          break;
        }

        offset = end;
        sub++;
      }

      if (rows.length >= count) {
        // content past the bottom row means the end is not shown
        more = !ended || line.next < this.bf.size;
        endPos = line.next;
        break;
      }

      endPos = line.next;
      pos = line.next;
      offset = 0;
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
    let offset = this.top.offset;

    for (let i = 0; i < k; i++) {
      if (pos >= this.bf.size) return null;

      const line = forwLine(this.bf, pos);
      if (!line) return null;

      const next = this.nextRowOffset(line.text, offset);

      if (next !== null) {
        offset = next;
      } else {
        pos = line.next;
        offset = 0;
      }
    }

    return { pos, offset };
  }

  /**
   * The top whose screen bottoms at the last line — og's jump_forw
   * anchor: plain forward moves never pass it (forward() finds
   * nothing to read past the eof and rings the bell instead).
   */
  endTop(window: number): ViewTop {
    const saved = this.top;
    this.gotoEnd(window);
    const end = this.top;
    this.top = saved;
    return end;
  }

  /**
   * og's position(BOTTOM_PLUS_ONE): whether a row exists just past the
   * screen's bottom. forward() bells when it does not (forwback.c:481)
   * and forw() stops as soon as a read hits EOF unless the move is
   * forced (bc798f8 cut that test down to `ABORT_SIGS() || !force`).
   *
   * That question is asked on the CURRENT top's own grid. An anchor
   * walked back from the file's END instead answers on the absolute
   * grid, and from a top part-way into a row the two disagree by one
   * row - which is exactly how far past og's eof bell we used to go.
   */
  private hasRowPastBottom(window: number): boolean {
    const at = this.screenPos(window - 1);
    return at !== null && at.pos < this.bf.size;
  }

  /** Scrolls forward n display rows, like forw(): a plain move
   *  stops once the bottom row ends the file (og's eof bell spot); a
   *  FORCED move (J, ESC-SPACE) passes window as undefined and runs on
   *  until the last line reaches the top, like og's force=TRUE. */
  lineForward(n: number, window?: number): number {
    let moved = 0;

    while (moved < n) {
      if (window !== undefined && !this.hasRowPastBottom(window)) break;

      const line = forwLine(this.bf, this.top.pos);
      if (!line) break;

      const next = this.nextRowOffset(line.text, this.top.offset);

      if (next !== null) {
        this.top = { pos: this.top.pos, offset: next };
      } else if (line.next < this.bf.size) {
        this.top = { pos: line.next, offset: 0 };
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
      if (this.top.offset > 0) {
        const line = forwLine(this.bf, this.top.pos);
        const back = line
          ? this.rowStartBelow(line.text, this.top.offset)
          : 0;

        this.top = { pos: this.top.pos, offset: back };
      } else {
        const prev = backLine(this.bf, this.top.pos);
        if (!prev) break;

        this.top = {
          pos: prev.start,
          offset: this.lastRowStart(prev.text),
        };
      }

      moved++;
    }

    return moved;
  }

  /** Jumps to the first line, like jump_back(1). */
  gotoStart(): void {
    this.top = { pos: 0, offset: 0 };
  }

  /**
   * Jumps so the last line sits on the bottom row, like jump_forw:
   * walk back window-1 display rows from the last line's last row.
   */
  gotoEnd(window: number): void {
    const last = lastLineStart(this.bf);
    const text = forwLine(this.bf, last)?.text ?? '';

    this.top = { pos: last, offset: this.lastRowStart(text) };
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
    this.top = { pos: nl < 0 ? 0 : nl + 1, offset: 0 };
  }

  /** Jumps to an absolute byte position's line, like jump_line_loc. */
  gotoPos(pos: number): void {
    const clamped = Math.max(0, Math.min(pos, this.bf.size));
    const nl = this.bf.findNewlineBack(clamped, 1 << 20);
    this.top = { pos: nl < 0 ? 0 : nl + 1, offset: 0 };
  }
}
