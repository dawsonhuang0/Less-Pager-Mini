import { strWidth } from 'char-width';

/**
 * One screen cell, mirroring lt_screen.c's ScreenChar: a character
 * with attribute bits (bold 1, underline 2, standout 4, blink 8) and
 * 4/8-bit colors (0xff when unset, like NULL_COLOR).
 */
export interface Cell {
  ch: string;
  attr: number;
  fg: number;
  bg: number;
}

export const NULL_COLOR = 0xFF;

const BLANK: Cell = { ch: '_', attr: 0, fg: NULL_COLOR, bg: NULL_COLOR };

/**
 * A small terminal emulator for this pager's escape output, playing
 * the role of og's lt_screen: it tracks a width x height grid of
 * cells plus the cursor, so screens can be compared to the `=` dumps
 * recorded in .lt files.
 */
export class LtScreen {
  width: number;
  height: number;
  cells: Cell[][];
  cx = 0;
  cy = 0;

  /** xterm-style wraparound pending after writing the last column. */
  private pendingWrap = false;

  private attr = 0;
  private fg = NULL_COLOR;
  private bg = NULL_COLOR;

  /**
   * The terminal's "xn" (og's defer_wrap, screen.c:1532).
   *
   * og's lt_screen has no magic margin - it wraps the moment the last
   * column is written (screen_incr, lt_screen.c:133), which is right
   * for the terminal the recordings were made on: lesstest hands less
   * "am" and no "xn", and passes no $TERM (env.c is_less_env), so
   * setupterm fails, hardcopy is set and ltgetflag answers 0 for every
   * capability the environment does not name (screen.c:798).
   */
  private deferWrap: boolean;

  constructor(width: number, height: number, deferWrap = true) {
    this.width = width;
    this.height = height;
    this.deferWrap = deferWrap;
    this.cells = [];

    for (let y = 0; y < height; y++) {
      this.cells.push(Array.from({ length: width }, () => ({ ...BLANK })));
    }
  }

  /** Feeds pager output through the emulator. */
  feed(data: string): void {
    let i = 0;

    while (i < data.length) {
      // a whole code point: an astral character is a surrogate PAIR,
      // and taking one unit puts half of it in a cell and measures it
      // as narrow, so no shadow cell follows it (lt_screen.c:372)
      const point = data.codePointAt(i) ?? 0;
      const ch = point > 0xFFFF ? data.slice(i, i + 2) : data[i];

      if (ch === '\x1B') {
        i = this.escape(data, i);
        continue;
      }

      if (ch === '\r') {
        this.cx = 0;
        this.pendingWrap = false;
      } else if (ch === '\n') {
        // the pager writes \n assuming the tty's ONLCR translation
        this.pendingWrap = false;
        this.cx = 0;
        this.lineFeed();
      } else if (ch === '\b') {
        this.pendingWrap = false;
        if (this.cx > 0) this.cx--;
      } else if (ch === '\x07') {
        // bell: no screen change
      } else if (ch === '\t') {
        this.cx = Math.min((Math.floor(this.cx / 8) + 1) * 8, this.width - 1);
      } else if (ch >= ' ') {
        // deferred wraparound, like xterm's am/xenl: the wrap happens
        // when the next printable character arrives
        if (this.pendingWrap) {
          this.pendingWrap = false;
          this.cx = 0;
          this.lineFeed();
        }

        if (!this.deferWrap) {
          // no magic margin: the wrap happens now, and on the last
          // row that scrolls the screen
          this.putChar(ch);
          this.cx += Math.max(strWidth(ch), 1);

          if (this.cx >= this.width) {
            this.cx = 0;
            this.lineFeed();
          }
        } else {
          this.putChar(ch);

          const width = Math.max(strWidth(ch), 1);
          this.cx += width;

          if (this.cx >= this.width) {
            this.cx = this.width - 1;
            this.pendingWrap = true;
          }
        }
      }

      i += ch.length;
    }
  }

  /** The dump-model grid, for comparing with a parsed `=` line. */
  snapshot(): { cells: Cell[][], cx: number, cy: number } {
    return { cells: this.cells, cx: this.cx, cy: this.cy };
  }

  private putChar(ch: string): void {
    const cell = this.cells[this.cy]?.[this.cx];
    if (!cell) return;

    cell.ch = ch;
    cell.attr = this.attr;
    cell.fg = this.fg;
    cell.bg = this.bg;

    // lt_screen writes a WIDESHADOW_CHAR in the second column a wide
    // character covers, with attribute 0 and no colours - NOT the
    // current ones (lt_screen.c:372). The recorded dumps carry that,
    // so a wide character under standout marks ONE cell, not two.
    if (strWidth(ch) > 1 && this.cx + 1 < this.width) {
      const pad = this.cells[this.cy][this.cx + 1];
      pad.ch = '\0';
      pad.attr = 0;
      pad.fg = NULL_COLOR;
      pad.bg = NULL_COLOR;
      return;
    }

    // writing over the FIRST half of a wide character orphans its
    // shadow; lt_screen turns that into an error char - a space -
    // carrying the attribute in force at the time (lt_screen.c:378)
    const next = this.cells[this.cy]?.[this.cx + 1];

    if (next && next.ch === '\0') {
      next.ch = ' ';
      next.attr = this.attr;
      next.fg = NULL_COLOR;
      next.bg = NULL_COLOR;
    }
  }

  private lineFeed(): void {
    if (this.cy < this.height - 1) {
      this.cy++;
      return;
    }

    this.scrollUp(1);
  }

  private scrollUp(n: number): void {
    for (let k = 0; k < n; k++) {
      this.cells.shift();
      this.cells.push(
        Array.from({ length: this.width }, () => ({ ...BLANK }))
      );
    }
  }

  private scrollDown(n: number): void {
    for (let k = 0; k < n; k++) {
      this.cells.pop();
      this.cells.unshift(
        Array.from({ length: this.width }, () => ({ ...BLANK }))
      );
    }
  }

  private clearLine(y: number, fromX: number): void {
    for (let x = fromX; x < this.width; x++) {
      this.cells[y][x] = { ...BLANK };
    }
  }

  /** Handles one escape sequence, returning the index past it. */
  private escape(data: string, at: number): number {
    const next = data[at + 1];

    // OSC titles end at BEL or ST
    if (next === ']') {
      const bel = data.indexOf('\x07', at);
      const st = data.indexOf('\x1B\\', at);
      if (bel < 0 && st < 0) return data.length;
      if (bel >= 0 && (st < 0 || bel < st)) return bel + 1;
      return st + 2;
    }

    // ESC = / ESC > keypad modes
    if (next === '=' || next === '>') return at + 2;

    // ESC M reverse index: up one row, scrolling the screen DOWN when
    // already at the top — how both pagers expose a backward scroll's
    // newly uncovered line
    if (next === 'M') {
      if (this.cy === 0) this.scrollDown(1);
      else this.cy--;

      this.pendingWrap = false;
      return at + 2;
    }

    // ESC ( x designates a character set and prints nothing
    if (next === '(' || next === ')') return at + 3;

    if (next !== '[') return at + 2;

    const match = /^\x1B\[([?<]?)([\d;]*)([A-Za-z~])/.exec(data.slice(at));
    if (!match) return at + 2;

    const [full, priv, paramText, final] = match;

    // xterm's last-column flag survives a sequence that does not
    // touch the cursor: SGR sets attributes only, so a style change
    // between the last column and the deferred-wrap nudge (og's
    // " \b", line.c:1527) must leave the wrap pending. Clearing it
    // made the nudge overwrite the last column instead
    if (final !== 'm') this.pendingWrap = false;

    const params = paramText.split(';').map(p => parseInt(p, 10) || 0);

    if (priv === '?') {
      // private modes (alt screen, keypad, paste, sync): the alt
      // screen switch clears like a fresh screen
      if (params[0] === 1049 && final === 'h') {
        for (let y = 0; y < this.height; y++) this.clearLine(y, 0);
        this.cx = 0;
        this.cy = 0;
      }

      return at + full.length;
    }

    switch (final) {
      case 'H':
      case 'f':
        this.cy = Math.min(Math.max((params[0] || 1) - 1, 0), this.height - 1);
        this.cx = Math.min(Math.max((params[1] || 1) - 1, 0), this.width - 1);
        break;

      case 'A': this.cy = Math.max(this.cy - (params[0] || 1), 0); break;

      case 'B':
        this.cy = Math.min(this.cy + (params[0] || 1), this.height - 1);
        break;

      case 'C':
        this.cx = Math.min(this.cx + (params[0] || 1), this.width - 1);
        break;

      case 'D': this.cx = Math.max(this.cx - (params[0] || 1), 0); break;

      case 'K':
        if (params[0] === 2) {
          this.clearLine(this.cy, 0);
        } else if (params[0] === 1) {
          for (let x = 0; x <= this.cx; x++) {
            this.cells[this.cy][x] = { ...BLANK };
          }
        } else {
          this.clearLine(this.cy, this.cx);
        }
        break;

      case 'J':
        if (params[0] === 2) {
          for (let y = 0; y < this.height; y++) this.clearLine(y, 0);
        } else {
          this.clearLine(this.cy, this.cx);
          for (let y = this.cy + 1; y < this.height; y++) {
            this.clearLine(y, 0);
          }
        }
        break;

      case 'S': this.scrollUp(params[0] || 1); break;
      case 'T': this.scrollDown(params[0] || 1); break;

      case 'm': this.sgr(paramText); break;

      default: break;
    }

    return at + full.length;
  }

  /** Applies an SGR parameter list to the current attributes. */
  private sgr(paramText: string): void {
    const params = paramText === ''
      ? [0]
      : paramText.split(';').map(p => parseInt(p, 10) || 0);

    for (let i = 0; i < params.length; i++) {
      const p = params[i];

      if (p === 0) {
        this.attr = 0;
        this.fg = NULL_COLOR;
        this.bg = NULL_COLOR;
      } else if (p === 1) {
        this.attr |= 1;
      } else if (p === 4) {
        this.attr |= 2;
      } else if (p === 5) {
        this.attr |= 8;
      } else if (p === 7) {
        this.attr |= 4;
      } else if (p === 22) {
        this.attr &= ~1;
      } else if (p === 24) {
        this.attr &= ~2;
      } else if (p === 25) {
        this.attr &= ~8;
      } else if (p === 27) {
        this.attr &= ~4;
      } else if (p >= 30 && p <= 37) {
        this.fg = p;
      } else if (p >= 90 && p <= 97) {
        this.fg = p;
      } else if (p === 39) {
        this.fg = NULL_COLOR;
      } else if (p >= 40 && p <= 47) {
        this.bg = p - 10;
      } else if (p >= 100 && p <= 107) {
        this.bg = p - 10;
      } else if (p === 49) {
        this.bg = NULL_COLOR;
      } else if (p === 38 && params[i + 1] === 5) {
        this.fg = params[i + 2] ?? NULL_COLOR;
        i += 2;
      } else if (p === 48 && params[i + 1] === 5) {
        this.bg = params[i + 2] ?? NULL_COLOR;
        i += 2;
      }
    }
  }
}
