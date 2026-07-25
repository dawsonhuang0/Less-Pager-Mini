import fs from 'fs';

import { Actions } from '../state/interfaces';

import { config, mode } from '../state/config';

import { session, deriveContent } from '../state/session';

import {
  calculateEOF,
  dirtyBottomRow,
  markPosClear,
  render,
  ringBell,
} from '../helpers';

import {
  binaryConfirm,
  binFile,
  files,
  onSourceFiles,
  pipeDraining,
} from '../features/files';

import { osc8Links, setSelectedOsc8 } from '../features/osc8';

import { onSourceFollow } from '../features/follow';

import { onSourceTagJump, Tag } from '../features/tags';

import {
  Mark,
  onSourceMarks,
  recordLastPosition,
  subRowOfIndex,
  subRowStart,
} from '../features/jumping';

import {
  SearchRequest,
  filterLineMask,
  recordSearchMatch,
  scanSearchBatch,
  search,
  searchInterrupted,
  stripStyles,
} from '../features/searching';

import { strWidth } from 'char-width';

import { consumeInterrupt } from '../tty/keyboard';

import { keyboard } from '../tty/keyboard';

import {
  getSwindow,
  jumpSindex,
  checkModelines,
  chopLine,
  hook,
  opt,
  optHeader,
  optHowSearch,
  optMatchShift,
  optNoSearchHeaders,
  optPastEof,
  optRscroll,
} from '../options';

import { maxSubRow, setOsc8Display, transformContent }
  from '../lines/helpers';

import { CLEAR_LINE, INVERSE_OFF, INVERSE_ON } from '../state/constants';

import { PipeDecoder } from '../features/charset';

import { BlockFile } from './blockFile';

import { BigView, displayText } from './fileView';

import { forwLine, backLine, MAX_LINE } from './fileLines';

import { PagerInput } from './input';

import { PipeSpool, SPOOL_READ_AHEAD, SpoolEvent } from './spool';

/**
 * The seekable-file side of the shared pager.
 *
 * It reuses Fable's BigView byte-position model. The ordinary controller
 * remains in charge of keys, prompts, options, help and rendering; this
 * object only answers operations that otherwise require reading through
 * every preceding byte. Each paint exposes a bounded local array to those
 * shared features; the underlying file remains byte-position based.
 */
export class FileInput implements PagerInput {
  private view: BigView;
  private positions: number[] = [];
  private lineAnchors = [{ pos: 0, num: 0 }];
  private lineScanAborted = false;
  private selectedOscPos: number | null = null;
  // which link within that line (its text-start offset)
  private selectedOscStart = -1;
  private incrementalOrigin: { pos: number, subRow: number } | null = null;
  private headerRow = 0;
  private headerPos = 0;
  private pending: {
    index: number,
    bf: BlockFile,
    lines: string[],
  } | null = null;
  private readonly saved = new Map<string, { pos: number, subRow: number }>();
  private activePath: string;

  // commands blocked at the provisional end of a still-growing spool,
  // completed by onGrowth like og's forw_line read returning with data
  private pendingForward: { rows: number, clamp: boolean } | null = null;
  private pendingJump: { kind: 'end' } |
    { kind: 'percent', value: number } |
    { kind: 'position', value: number } | null = null;
  private pendingPipeSearch: {
    request: SearchRequest,
    start: number,
    wrapStart: number,
    state: { remaining: number },
  } | null = null;
  private growthPaint = false;
  private unsubscribeGrowth: (() => void) | null = null;

  // og's interrupted drain leaves ch_length NULL even though the
  // writer died: the residual pipe data sits unread, so prompts and
  // = keep showing an unknown length until the NEXT forward read
  // reaches EOI — the spool has actually read everything, but the
  // og state machine must not know it yet
  private softEnd = false;

  // the view position of the previous resolveBottom, so only real
  // moves re-enter the walk (og's find_linenum caches resolve this)
  private lastResolved = '';

  // og's forced back (K, ESC-b, --past-eof) pads null rows above
  // BOF; forward moves consume them first, any jump clears them
  private padTop = 0;
  private keepPad = false;

  constructor(
    private bf: BlockFile,
    private fileIndex: number,
    private spool: PipeSpool | null = null
  ) {
    this.view = new BigView(bf);
    this.activePath = files.list[fileIndex]?.path ?? '';
  }

  /** True while the source is a pipe whose end has not been read. */
  private spoolAlive(): boolean {
    return this.spool !== null && !this.spool.ended;
  }

  /** Keeps the upstream flowing until read-ahead covers the view. */
  private requestAhead(): void {
    if (!this.spoolAlive()) return;
    const edge = this.positions.length
      ? this.positions[this.positions.length - 1]
      : this.view.top.pos;
    this.spool?.requestThrough(edge + SPOOL_READ_AHEAD);
  }

  ready(): void {
    onSourceMarks({
      position: row => this.markPosition(row),
      linePosition: line => this.sourceActive()
        ? this.findLinePosition(line - 1)
        : undefined,
      jump: (mark, sline) => this.jumpMark(mark, sline),
    });
    hook.sourceLineNumber = row => this.sourceActive()
      ? this.lineNumber(row)
      : undefined;
    // og's curr_byte (prompt.c): a row past the screen's position
    // table falls back to ch_length — BOTTOM_PLUS_ONE at (END) is
    // the file size, never 0
    hook.sourceBytePosition = row => this.sourceActive()
      ? this.positions[row] ?? this.bf.size
      : undefined;
    hook.sourceLineCount = () => this.sourceActive()
      ? this.lineCount()
      : undefined;
    hook.sourceHeaderRow = () => this.sourceActive()
      ? this.headerRow
      : undefined;
    hook.sourceHeaderChanged = start => {
      if (!this.sourceActive()) return;
      this.seekLine(start, false);
      this.sync();
    };
    onSourceFiles({
      load: index => this.loadSourceFile(index),
      activate: index => this.activateSourceFile(index),
    });
    onSourceFollow({
      pinEnd: () => this.pinFollowEnd(),
      refresh: () => this.refreshFollow(),
    });
    onSourceTagJump(tag => this.jumpTag(tag));

    if (this.spool) {
      this.unsubscribeGrowth = this.spool.subscribe(
        event => this.onGrowth(event)
      );
      // --file-size wants the pipe's true length: read it all, like
      // og's scan_eof running the EOI-discovering read up front
      if (opt.wantFileSize > 0 && this.spoolAlive()) this.spool.drain();
    }

    this.seekLine(config.row, false);
    this.sync();
  }

  /** Marks the spool drain a command started, owning the command
   *  line like og's ch_end_seek: blank for G, ierror's note for %. */
  private startDrain(note: string, cancelMessage: string): void {
    pipeDraining.active = true;
    pipeDraining.note = note;
    pipeDraining.cancelMessage = cancelMessage;
  }

  /** Releases the drain's hold on the command line. */
  private endDrain(): void {
    pipeDraining.active = false;
    pipeDraining.note = '';
    pipeDraining.cancelMessage = '';
  }

  /** A forward read reaching the spooled end after an interrupted
   *  drain: og's ch_forw_get finally returns the real EOI and the
   *  length becomes known (ch_fsize learned). */
  private discoverEnd(): void {
    if (!this.softEnd || !this.spool?.ended) return;

    this.softEnd = false;
    const entry = files.list[this.fileIndex];
    if (entry) {
      entry.size = this.spool.size;
      entry.sizeKnown = true;
      entry.streaming = false;
    }
  }

  /** ^C or --intr during a wait on the growing spool: og's READ_INTR
   *  surfaces as EOI at the current position, so ch_end_seek returns
   *  SUCCESS and G jumps to the BUFFERED end — only % fails its
   *  ch_length check and errors; a blocked move simply stops. */
  interrupt(): boolean {
    const waiting = this.pendingForward !== null ||
      this.pendingJump !== null || this.pendingPipeSearch !== null;

    if (!waiting) return false;

    const jump = this.pendingJump;
    const cancel = pipeDraining.cancelMessage;

    this.pendingForward = null;
    this.pendingJump = null;
    this.pendingPipeSearch = null;
    this.spool?.cancelDrain();
    this.endDrain();

    // og stops at READ_INTR without the residual read: the length
    // stays unknown until a later forward read reaches EOI
    this.softEnd = true;

    if (jump) {
      if (cancel) {
        search.message = cancel;
      } else {
        this.bf.refreshSize();

        if (jump.kind === 'end') {
          if (session.lastFilter) this.gotoFilteredEnd();
          else this.view.gotoEnd(config.window);
        } else if (jump.kind === 'position') {
          this.view.gotoPos(Math.min(jump.value, this.bf.size));
        }

        this.clampHeader();
        this.sync();
        markPosClear();
      }
    }

    return true;
  }

  /** Makes newly spooled bytes visible and completes commands which
   *  were blocked at the provisional end of a non-seekable input. */
  private onGrowth(event: SpoolEvent): void {
    if (session.exited || files.index !== this.fileIndex) return;

    const before = this.bf.size;
    this.bf.refreshSize();
    let moved = false;

    if (event.error) search.message = event.error.message;

    if (event.ended && !this.softEnd) {
      const entry = files.list[this.fileIndex];
      if (entry) {
        entry.size = this.spool?.size ?? this.bf.size;
        entry.sizeKnown = true;
        entry.streaming = false;
      }
    }

    if (this.pendingJump) {
      const jump = this.pendingJump;
      const ready = jump.kind === 'position'
        ? this.bf.size > jump.value || event.ended
        : event.ended;

      if (ready) {
        this.pendingJump = null;
        this.endDrain();
        if (jump.kind === 'end') {
          if (session.lastFilter) this.gotoFilteredEnd();
          else this.view.gotoEnd(config.window);
        } else if (jump.kind === 'percent') {
          this.view.gotoPercent(jump.value);
        } else {
          this.view.gotoPos(Math.min(jump.value, this.bf.size));
        }
        this.clampHeader();
        markPosClear();
        moved = true;
      }
    }

    if (this.pendingForward && (this.bf.size > before || event.ended)) {
      const pending = this.pendingForward;
      this.pendingForward = null;
      this.forward(pending.rows, pending.clamp);
      moved = true;
    }

    if (this.pendingPipeSearch && (event.settled || event.ended)) {
      moved = this.resumePipeSearch() || moved;
    }

    if (!this.growthPaint &&
        (moved || event.ended || event.settled || mode.EOF)) {
      this.growthPaint = true;
      setImmediate(() => {
        this.growthPaint = false;
        if (session.exited || session.shellPause || mode.HELP ||
            files.index !== this.fileIndex) {
          return;
        }
        this.sync();
        this.resolveBottom();
        render(session.content, session.buffer);
      });
    }
  }

  handle(action: Actions, count: number): boolean {
    this.lineScanAborted = false;

    if (mode.HELP || files.index !== this.fileIndex) {
      return false;
    }

    switch (action) {
      case 'LINE_FORWARD':
        this.forward(count || 1, true);
        return true;
      case 'FORCE_LINE_FORWARD':
        this.forward(count || 1, false);
        return true;
      case 'LINE_BACKWARD':
        this.backward(count || 1);
        return true;
      case 'FORCE_LINE_BACKWARD':
        // og's K: back with force=TRUE, padding past BOF
        this.backward(count || 1, true);
        return true;
      case 'FORCE_WINDOW_BACKWARD':
        // og's ESC-b: A_BF_SCREEN, backward(force=TRUE)
        this.backward(count || getSwindow(), true);
        return true;
      case 'WINDOW_FORWARD':
      case 'SET_WINDOW_FORWARD':
        if (action === 'SET_WINDOW_FORWARD' && count) {
          config.setWindow = count;
        }
        this.forward(count || getSwindow(), true);
        return true;
      case 'NO_EOF_WINDOW_FORWARD':
        this.forward(count || getSwindow(), false);
        return true;
      case 'WINDOW_BACKWARD':
      case 'SET_WINDOW_BACKWARD':
        if (action === 'SET_WINDOW_BACKWARD' && count) {
          config.setWindow = count;
        }
        this.backward(count || getSwindow());
        return true;
      case 'SET_HALF_WINDOW_FORWARD':
        if (count) config.setHalfWindow = count;
        this.forward(config.setHalfWindow || config.halfWindow, true);
        return true;
      case 'SET_HALF_WINDOW_BACKWARD':
        if (count) config.setHalfWindow = count;
        this.backward(config.setHalfWindow || config.halfWindow);
        return true;
      case 'NEWLINE_FORWARD':
        this.newlineForward(count || 1);
        return true;
      case 'NEWLINE_BACKWARD':
        this.newlineBackward(count || 1);
        return true;
      case 'FIRST_LINE':
        this.gotoLine(count > 0 ? count - 1 : optHeader().start);
        return true;
      case 'LAST_LINE':
        this.discoverEnd();
        if (count) {
          this.gotoLine(count - 1);
        } else if (this.spoolAlive()) {
          // G must read the pipe to its true end, like og's
          // ch_end_seek, with a blank command line while it reads
          this.pendingJump = { kind: 'end' };
          this.startDrain('', '');
          this.spool?.drain();
        } else {
          if (session.lastFilter) {
            this.gotoFilteredEnd();
          } else {
            this.view.gotoEnd(config.window);
          }
          this.sync();
          markPosClear();
        }
        return true;
      case 'PERCENT_LINE':
        this.discoverEnd();
        if (this.spoolAlive()) {
          // a percent of a length still unknown drains first, like
          // og's jump_percent behind ierror's interruptible note
          this.pendingJump = {
            kind: 'percent',
            value: Math.min(count, 100),
          };
          this.startDrain('Determining length of file',
            'Don\'t know length of file');
          this.spool?.drain();
          return true;
        }
        this.view.gotoPercent(Math.min(count, 100));
        this.clampHeader();
        this.sync();
        markPosClear();
        return true;
      case 'GO_POS':
        this.discoverEnd();
        if (this.spoolAlive() && count >= this.bf.size) {
          this.pendingJump = { kind: 'position', value: count };
          this.startDrain('', '');
          this.spool?.requestThrough(count + SPOOL_READ_AHEAD);
          return true;
        }
        this.view.gotoPos(count);
        this.clampHeader();
        this.sync();
        markPosClear();
        return true;
      case 'OSC8_FORWARD':
        this.findOsc8(1, count || 1);
        return true;
      case 'OSC8_BACKWARD':
        this.findOsc8(-1, count || 1);
        return true;
      case 'OSC8_JUMP':
        if (this.selectedOscPos === null) {
          search.message = 'No OSC8 link selected';
        } else {
          // og's osc8_jump is an unconditional jump_loc to the -j
          // line (search.c:2002), on-screen or not
          this.view.top = { pos: this.selectedOscPos, subRow: 0 };
          this.view.lineBackward(jumpSindex());
          this.sync();
          markPosClear();
        }
        return true;
      case 'CURLY_BRACKET_RIGHT':
        return this.bracket('{', '}', true, count || 1);
      case 'ROUND_BRACKET_RIGHT':
        return this.bracket('(', ')', true, count || 1);
      case 'SQUARE_BRACKET_RIGHT':
        return this.bracket('[', ']', true, count || 1);
      case 'CURLY_BRACKET_LEFT':
        return this.bracket('{', '}', false, count || 1);
      case 'ROUND_BRACKET_LEFT':
        return this.bracket('(', ')', false, count || 1);
      case 'SQUARE_BRACKET_LEFT':
        return this.bracket('[', ']', false, count || 1);
      case 'REPAINT':
      case 'DROP_INPUT_REPAINT':
        this.bf.refreshSize();
        return false;
      default:
        return false;
    }
  }

  search(request: SearchRequest): boolean {
    if (mode.HELP || files.index !== this.fileIndex) return false;
    this.lineScanAborted = false;

    if (request.incremental) {
      this.incrementalOrigin ??= { ...this.view.top };
    } else {
      this.incrementalOrigin = null;
    }

    const start = this.searchStart(request);
    if (start === null) {
      search.message = 'Nothing to search';
      return true;
    }

    const state = { remaining: request.count };
    let found = request.dir > 0
      ? this.scanForward(start, this.bf.size, state)
      : this.scanBackward(start, 0, state);

    if (found === 'stop') {
      if (!search.message) search.message = 'Search interrupted';
      return true;
    }

    if (found === null && request.dir > 0 && this.spoolAlive()) {
      // the provisional end is not "hit bottom": retry from a final
      // line-sized overlap once the next read-ahead window settles —
      // linear for enormous pipes, and still catching a match that
      // spans the previous spool boundary
      this.pendingPipeSearch = {
        request,
        start: Math.max(this.bf.size - MAX_LINE, 0),
        wrapStart: start,
        state,
      };
      this.requestAhead();
      return true;
    }

    if (found === null && request.wrap) {
      found = request.dir > 0
        ? this.scanForward(0, start, state)
        : this.scanBackward(this.bf.size, start, state);

      if (found !== null && found !== 'stop') {
        search.message = request.dir > 0
          ? 'Search hit bottom; continuing at top'
          : 'Search hit top; continuing at bottom';
      }
    }

    if (found === 'stop') {
      if (!search.message) search.message = 'Search interrupted';
      return true;
    }

    if (found === null) {
      search.message = `Pattern not found: ${request.pattern}`;
      return true;
    }

    this.landMatch(found);
    return true;
  }

  /** Places a found match like og's search jump: normally the match
   *  line at the -j target, a deep wrapped match bottoming its final
   *  sub-row (get_lastlinepos), a chopped off-screen match shifted
   *  into view (shift_visible). */
  private landMatch(found: number): void {
    const bSub = this.bottomSub(found);

    if (bSub !== null) {
      this.view.top = { pos: found, subRow: bSub };
      this.view.lineBackward(config.window - 2);
    } else {
      this.view.top = { pos: found, subRow: 0 };
      this.view.lineBackward(jumpSindex());
    }

    this.shiftMatch(found);
    this.sync();
    recordSearchMatch(Math.max(this.positions.indexOf(found), 0));
    markPosClear();
  }

  /** og's long-line landing (search.c plastlinepos + the
   *  end_off >= swidth*sheight/4 heuristic): a wrapped match ending
   *  deep in its line bottoms the final sub-row instead of topping. */
  private bottomSub(linePos: number): number | null {
    const regex = search.regex;
    if (chopLine() || config.col || !regex) return null;

    const line = linePos < this.bf.size ? forwLine(this.bf, linePos) : null;
    if (!line) return null;

    const display = displayText(line.text);
    const plain = stripStyles(display);
    const m = regex.exec(plain);
    if (!m) return null;

    const end = m.index + m[0].length;
    const sheight = config.window - jumpSindex();

    if (end < Math.floor(config.screenWidth * sheight / 4)) return null;

    // og 707's zeroed chpos sentinel: a match ending exactly at the
    // line end computes tpos = linepos and never bottom-jumps
    if (end >= plain.length) return null;

    const endSub = subRowOfIndex(display, end);
    return endSub >= sheight ? endSub : null;
  }

  /**
   * Shifts the screen horizontally so the match is visible, like
   * search.c's shift_visible: an off-screen match lands --match-shift
   * columns from the left edge. og only shifts in the chop branch;
   * wrapped long lines bottom-jump instead (bottomSub).
   */
  private shiftMatch(linePos: number): void {
    const regex = search.regex;
    if (!chopLine() || !regex) return;

    const line = linePos < this.bf.size ? forwLine(this.bf, linePos) : null;
    if (!line) return;

    const text = stripStyles(displayText(line.text));
    const match = regex.exec(text);
    if (!match) return;

    const startCol = strWidth(text.slice(0, match.index));
    const endCol = startCol + strWidth(match[0]);
    // the marker column only exists while --rscroll is enabled
    // (search.c:641: sc_width - (rscroll_char ? 1 : 0))
    const swidth = config.screenWidth - (optRscroll() ? 1 : 0);
    let newCol: number;

    if (endCol < swidth) {
      // the whole match fits the unshifted screen
      newCol = 0;
    } else if (startCol > config.col && endCol < config.col + swidth) {
      // already visible; leave the shift unchanged
      newCol = config.col;
    } else {
      const eolCol = strWidth(text) - swidth;

      newCol = startCol >= eolCol
        ? eolCol
        : startCol < optMatchShift() ? 0 : startCol - optMatchShift();
    }

    config.col = Math.max(newCol, 0);
  }

  restoreSearchOrigin(): void {
    if (!this.incrementalOrigin || !this.sourceActive()) return;
    this.view.top = { ...this.incrementalOrigin };
    this.incrementalOrigin = null;
    this.sync();
  }

  /** og's currline(BOTTOM) closing every forw()/back(): the eager
   *  line-number resolution running after each move's paint. */
  resolveBottom(): void {
    if (opt.linenums === 0 || mode.HELP || !this.sourceActive()) return;

    const at = this.view.top.pos + ':' + this.view.top.subRow;
    if (at === this.lastResolved) return;
    this.lastResolved = at;

    // og paints the moved content BEFORE the walk: forw() puts its
    // rows up, currline(BOTTOM) runs after, and the prompt comes
    // last — so the screen always shows the move immediately, with
    // a blank command line while the count runs
    render(session.content, session.buffer);
    fs.writeSync(1, '\r' + CLEAR_LINE);

    let retriedAfterEarlyInterrupt = false;

    for (;;) {
      this.lineScanAborted = false;
      if (this.countTo(this.view.top.pos) !== null) break;

      // abort_delayed_msg after the message showed: countTo turned
      // line numbers off and queued the og error text
      if (opt.linenums === 0) break;

      if (retriedAfterEarlyInterrupt) {
        // A second early ^C interrupts jump_forw's recovery repaint.
        // forw paints zero lines, leaving og's position table empty;
        // make_display then falls back to jump_loc(ch_zero(), 1).
        ringBell('eof');
        this.view.gotoStart();
        this.sync();
        break;
      }

      // Before the delayed message, abort_delayed_msg is a no-op.
      // jump_forw notices its incomplete landing and repaints the
      // end, whose currline(BOTTOM) starts a fresh line-number walk.
      retriedAfterEarlyInterrupt = true;
      render(session.content, session.buffer);
      fs.writeSync(1, '\r' + CLEAR_LINE);
    }

    // the blank and any mid-scan message bypassed the renderer: the
    // prompt row must repaint, like og's prompt() after the walk
    dirtyBottomRow();
  }

  /** Continues a forward search that ran out of spooled bytes. */
  private resumePipeSearch(): boolean {
    const pending = this.pendingPipeSearch;
    if (!pending) return false;
    this.pendingPipeSearch = null;

    const { request, state } = pending;
    let found = this.scanForward(pending.start, this.bf.size, state);

    if (found === 'stop') {
      if (!search.message) search.message = 'Search interrupted';
      return false;
    }

    if (found === null && this.spoolAlive()) {
      this.pendingPipeSearch = {
        ...pending,
        start: Math.max(this.bf.size - MAX_LINE, 0),
      };
      this.requestAhead();
      return false;
    }

    if (found === null && request.wrap) {
      found = this.scanForward(0, pending.wrapStart, state);

      if (found === 'stop') {
        if (!search.message) search.message = 'Search interrupted';
        return false;
      }
      if (found !== null) {
        search.message = 'Search hit bottom; continuing at top';
      }
    }

    if (found === null) {
      search.message = `Pattern not found: ${request.pattern}`;
      return false;
    }

    this.landMatch(found);
    return true;
  }

  bracket(open: string, close: string, forward: boolean, n: number): boolean {
    if (!this.sourceActive()) return false;

    const start = forward
      ? { ...this.view.top }
      : this.bottomSourcePosition();

    if (!start) {
      search.message = `Nothing in ${forward ? 'top' : 'bottom'} line`;
      return true;
    }

    const first = forwLine(this.bf, start.pos);
    if (!first) {
      search.message = `Nothing in ${forward ? 'top' : 'bottom'} line`;
      return true;
    }

    const ref = forward ? open : close;
    const display = transformContent([first.text])[0] ?? '';
    let at = subRowStart(display, start.subRow);

    for (; at < display.length; at++) {
      if (display[at] === ref && --n === 0) break;
    }

    if (at >= display.length) {
      search.message = `No bracket in ${forward ? 'top' : 'bottom'} line`;
      return true;
    }

    let nest = 0;
    let found: number | null = null;

    if (forward) {
      let pos = start.pos;
      let index = at + 1;

      while (pos < this.bf.size) {
        const line = forwLine(this.bf, pos);
        if (!line) break;

        if (!session.lastFilter || this.accepted(line.text)) {
          const text = transformContent([line.text])[0] ?? '';

          for (let i = index; i < text.length; i++) {
            if (text[i] === open) {
              nest++;
            } else if (text[i] === close && --nest < 0) {
              found = pos;
              break;
            }
          }
        }

        if (found !== null) break;
        pos = line.next;
        index = 0;
      }
    } else {
      let pos = start.pos;
      let index = at - 1;

      for (;;) {
        const line = forwLine(this.bf, pos);
        if (!line) break;
        const text = transformContent([line.text])[0] ?? '';

        for (let i = Math.min(index, text.length - 1); i >= 0; i--) {
          if (text[i] === close) {
            nest++;
          } else if (text[i] === open && --nest < 0) {
            found = pos;
            break;
          }
        }

        if (found !== null) break;
        const prev = session.lastFilter
          ? this.prevAccepted(pos)
          : backLine(this.bf, pos)?.start ?? null;
        if (prev === null) break;
        pos = prev;
        index = Infinity;
      }
    }

    if (found === null) {
      search.message = 'No matching bracket';
      return true;
    }

    recordLastPosition();
    this.view.top = { pos: found, subRow: 0 };

    if (forward) {
      if (session.lastFilter) {
        this.filteredBackward(Math.max(config.window - 2, 0));
      } else {
        this.view.lineBackward(Math.max(config.window - 2, 0));
      }
    }

    this.sync();
    markPosClear();
    return true;
  }

  rebuild(): boolean {
    if (mode.HELP || files.index !== this.fileIndex) {
      return false;
    }

    this.sync();
    return true;
  }

  close(): void {
    this.unsubscribeGrowth?.();
    this.unsubscribeGrowth = null;
    if (this.pendingJump) this.endDrain();
    onSourceMarks(null);
    onSourceFiles(null);
    onSourceFollow(null);
    onSourceTagJump(null);
    hook.sourceLineNumber = null;
    hook.sourceBytePosition = null;
    hook.sourceLineCount = null;
    hook.sourceHeaderRow = null;
    hook.sourceHeaderChanged = null;
    this.pending?.bf.close();
    this.bf.close();
  }

  /** Supplies bounded startup data to the existing shared file switch. */
  private loadSourceFile(index: number): string[] | null | undefined {
    this.sourceActive();
    const entry = files.list[index];
    if (!entry || entry.path === '-' || entry.lines || entry.alt) {
      return undefined;
    }

    if (this.pending?.index === index) return this.pending.lines;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(entry.path);
    } catch {
      return undefined;
    }

    if (!stat.isFile()) return undefined;

    let next: BlockFile;
    try {
      next = new BlockFile(entry.path);
    } catch {
      return undefined;
    }

    const head = next.readRange(0, 64 * 1024);

    if (!opt.forceOpen && !entry.everOpened && keyboard().isTTY &&
        binFile(head)) {
      next.close();
      binaryConfirm.request = true;
      binaryConfirm.path = entry.path;
      return null;
    }

    const decoder = new PipeDecoder();
    const lines = decoder.push(head);
    if (head.length >= next.size) lines.push(...decoder.flush());
    if (!lines.length) lines.push('');

    entry.size = next.size;
    entry.sizeKnown = true;
    entry.everOpened = true;
    entry.streaming = false;
    checkModelines(lines);

    const current = files.list[this.fileIndex];
    if (current) this.saved.set(current.path, { ...this.view.top });

    this.pending?.bf.close();
    this.pending = { index, bf: next, lines };
    return lines;
  }

  /** Activates the BlockFile after common switch bookkeeping completes. */
  private activateSourceFile(index: number): void {
    if (!this.pending || this.pending.index !== index) return;

    this.bf.close();
    this.bf = this.pending.bf;
    this.view = new BigView(this.bf);
    this.fileIndex = index;
    this.activePath = files.list[index]?.path ?? '';
    this.positions = [];
    this.lineAnchors = [{ pos: 0, num: 0 }];
    this.lineScanAborted = false;
    this.selectedOscPos = null;
    setSelectedOsc8(null);

    const entry = files.list[index];
    const saved = entry ? this.saved.get(entry.path) : undefined;
    this.view.top = saved ? { ...saved } : { pos: 0, subRow: 0 };
    this.pending = null;
    this.sync();
  }

  private pinFollowEnd(): boolean {
    if (!this.sourceActive()) return false;

    // F on a pipe reads to the true end and keeps reading, like
    // og's forw_loop with ignore_eoi
    if (this.spoolAlive()) this.spool?.drain();

    this.bf.refreshSize();
    const entry = files.list[this.fileIndex];
    if (entry) entry.size = this.bf.size;

    if (session.lastFilter) {
      this.gotoFilteredEnd();
    } else {
      this.view.gotoEnd(config.window);
    }
    this.sync();
    return true;
  }

  private refreshFollow(): boolean {
    return this.pinFollowEnd();
  }

  private jumpTag(tag: Tag): boolean {
    if (!this.sourceActive()) return false;

    let pos: number | null = null;

    if (tag.linenum > 0) {
      pos = this.findLinePosition(tag.linenum - 1);
    } else {
      const pattern = tag.pattern ?? '';
      let at = 0;

      while (at < this.bf.size) {
        const line = forwLine(this.bf, at);
        if (!line) break;
        // eslint-disable-next-line no-control-regex
        const plain = line.text.replace(/\x1B\[[0-9;]*m/g, '');

        if (plain.startsWith(pattern) &&
            (!tag.endline || plain.length === pattern.length ||
              plain[pattern.length] === '\r')) {
          pos = at;
          const num = this.countTo(at);
          if (num !== null) tag.linenum = num + 1;
          break;
        }

        at = line.next;
      }
    }

    if (pos === null) {
      search.message = 'Tag not found';
      return true;
    }

    recordLastPosition();
    this.view.top = { pos: Math.max(pos, this.headerPos), subRow: 0 };
    const up = jumpSindex();
    if (session.lastFilter) this.filteredBackward(up);
    else this.fileBackward(up);
    this.sync();
    markPosClear();
    return true;
  }

  private forward(rows: number, clampAtLastScreen: boolean): void {
    // scrolling forward consumes blank rows padded above BOF first,
    // like the array session's lineForward blankTop branch
    let want = rows;

    if (this.padTop > 0) {
      const consumed = Math.min(this.padTop, want);
      this.padTop -= consumed;
      want -= consumed;

      if (!want) {
        this.keepPad = true;
        this.sync();
        return;
      }
    }

    const moved = session.lastFilter
      ? this.filteredForward(want, clampAtLastScreen)
      : this.view.lineForward(
        want,
        clampAtLastScreen ? config.window : undefined
      );

    // a short forward move read the end: og's forw discovers the
    // EOI a post-interrupt length wait left unread
    if (moved < want) this.discoverEnd();

    // a move over a growing spool is the pipe read itself: wait for
    // the remainder instead of belling at the provisional end
    if (moved < want && this.spoolAlive()) {
      this.pendingForward = {
        rows: want - moved,
        clamp: clampAtLastScreen,
      };
    } else if (!moved && want === rows) {
      ringBell('eof');
    }

    if ((moved || want < rows) && mode.INIT) mode.INIT = false;
    this.keepPad = true;
    this.sync();
  }

  private backward(rows: number, force: boolean = false): void {
    // og's back() opens with squish_check (forwback.c:394), BEFORE it
    // knows whether anything can scroll: a backward command repaints
    // the squished short first screen — filling the blank rows above
    // with tildes — and only then bells at BOF. forward() is not
    // symmetric: it bells and returns before ever reaching forw(),
    // so a clamped forward leaves the squish alone
    if (mode.INIT) mode.INIT = false;

    // --past-eof forces every backward scroll, like og's back()
    if (optPastEof()) force = true;

    const moved = session.lastFilter
      ? this.filteredBackward(rows)
      : this.fileBackward(rows);

    // og's forced back (K, ESC-b) keeps revealing null lines above
    // the beginning, capped one short of an empty screen — file
    // distance consumes first, like the array forceLineBackward
    if (force && moved < rows) {
      const cap = Math.max(config.window - 2, 0);
      const before = this.padTop;
      this.padTop = Math.min(this.padTop + (rows - moved), cap);
      if (this.padTop === before && !moved) ringBell('eof');
    } else if (!moved) {
      ringBell('eof');
    }

    this.keepPad = true;
    this.sync();
  }

  /** og's to_newline scroll (forwback.c:302): rows reveal at the
   *  bottom edge until `lines` of them end their file line, wrap
   *  continuations riding free; the top may land mid-wrap. */
  private newlineForward(lines: number): void {
    const cur = { pos: this.view.top.pos, subRow: this.view.top.subRow };
    let line = forwLine(this.bf, cur.pos);

    const advance = (): boolean => {
      if (!line) return false;

      if (cur.subRow + 1 < this.view.rowsOf(line.text)) {
        cur.subRow++;
        return true;
      }

      const next = session.lastFilter
        ? this.nextAccepted(line.next)
        : line.next;
      if (next === null || next >= this.bf.size) return false;

      const nl = forwLine(this.bf, next);
      if (!nl) return false;

      cur.pos = next;
      cur.subRow = 0;
      line = nl;
      return true;
    };

    // find the current bottom display row
    let steps = Math.max(config.window - 2, 0);
    while (steps > 0 && advance()) steps--;

    let rows = 0;

    for (let n = lines; n > 0; ) {
      if (!advance()) break;
      rows++;
      if (line && cur.subRow === this.view.rowsOf(line.text) - 1) n--;
    }

    if (rows) {
      this.forward(rows, true);
    } else {
      ringBell('eof');
      this.sync();
    }
  }

  private newlineBackward(lines: number): void {
    let remaining = lines;
    let moved = 0;

    if (this.view.top.subRow > 0 && remaining > 0) {
      this.view.top.subRow = 0;
      remaining--;
      moved++;
    }

    while (remaining > 0) {
      const line = session.lastFilter
        ? this.prevAccepted(this.view.top.pos)
        : backLine(this.bf, this.view.top.pos)?.start ?? null;
      if (line === null) break;
      this.view.top = { pos: line, subRow: 0 };
      remaining--;
      moved++;
    }

    if (!moved) ringBell('eof');
    this.sync();
  }

  private accepted(text: string): boolean {
    const filter = session.lastFilter;
    if (!filter) return true;
    return filterLineMask([text], filter)?.[0] ?? false;
  }

  private nextAccepted(start: number): number | null {
    let pos = start;

    while (pos < this.bf.size) {
      const lines: string[] = [];
      const positions: number[] = [];

      while (lines.length < 1024 && pos < this.bf.size) {
        const line = forwLine(this.bf, pos);
        if (!line) break;
        lines.push(line.text);
        positions.push(pos);
        pos = line.next;
      }

      if (!lines.length) break;
      const mask = session.lastFilter
        ? filterLineMask(lines, session.lastFilter)
        : lines.map(() => true);
      if (!mask) return null;

      const at = mask.indexOf(true);
      if (at >= 0) return positions[at];
    }

    return null;
  }

  private prevAccepted(start: number): number | null {
    let pos = start;

    while (pos > 0) {
      const lines: string[] = [];
      const positions: number[] = [];

      while (lines.length < 1024 && pos > 0) {
        const line = backLine(this.bf, pos);
        if (!line) break;
        lines.push(line.text);
        positions.push(line.start);
        pos = line.start;
      }

      if (!lines.length) break;
      const mask = session.lastFilter
        ? filterLineMask(lines, session.lastFilter)
        : lines.map(() => true);
      if (!mask) return null;

      const at = mask.indexOf(true);
      if (at >= 0) return positions[at];
    }

    return null;
  }

  private rowsAt(pos: number): number {
    const raw = forwLine(this.bf, pos)?.text ?? '';
    const display = transformContent([raw])[0] ?? '';
    return maxSubRow(display) + 1;
  }

  private filteredForward(rows: number, clampAtLastScreen: boolean): number {
    const end = clampAtLastScreen ? this.filteredEndTop() : null;
    let moved = 0;

    while (moved < rows) {
      if (end && (this.view.top.pos > end.pos ||
          (this.view.top.pos === end.pos &&
            this.view.top.subRow >= end.subRow))) {
        break;
      }

      const total = this.rowsAt(this.view.top.pos);
      if (this.view.top.subRow + 1 < total) {
        this.view.top.subRow++;
      } else {
        const line = forwLine(this.bf, this.view.top.pos);
        const next = line ? this.nextAccepted(line.next) : null;
        if (next === null) break;
        this.view.top = { pos: next, subRow: 0 };
      }

      moved++;
    }

    return moved;
  }

  private filteredBackward(rows: number): number {
    let moved = 0;

    while (moved < rows) {
      if (this.view.top.subRow > 0) {
        this.view.top.subRow--;
      } else {
        const prev = this.prevAccepted(this.view.top.pos);
        if (prev === null || prev < this.headerPos) break;
        this.view.top = { pos: prev, subRow: this.rowsAt(prev) - 1 };
      }

      moved++;
    }

    return moved;
  }

  private fileBackward(rows: number): number {
    let moved = 0;

    while (moved < rows) {
      if (this.view.top.subRow > 0) {
        this.view.top.subRow--;
      } else {
        const prev = backLine(this.bf, this.view.top.pos);
        if (!prev || prev.start < this.headerPos) break;
        this.view.top = { pos: prev.start, subRow: this.rowsAt(prev.start) - 1 };
      }
      moved++;
    }

    return moved;
  }

  private filteredEndTop(): { pos: number, subRow: number } | null {
    const last = this.prevAccepted(this.bf.size);
    if (last === null) return null;

    const saved = { ...this.view.top };
    this.view.top = { pos: last, subRow: this.rowsAt(last) - 1 };
    this.filteredBackward(Math.max(config.window - 2, 0));
    const end = { ...this.view.top };
    this.view.top = saved;
    return end;
  }

  private gotoFilteredEnd(): void {
    const end = this.filteredEndTop();
    if (end) this.view.top = end;
  }

  private bottomSourcePosition(): { pos: number, subRow: number } | null {
    for (let row = config.window - 2; row >= 0; row--) {
      if (!session.lastFilter) {
        const pos = this.view.screenPos(row);
        if (pos && pos.pos < this.bf.size) return pos;
        continue;
      }

      const saved = { ...this.view.top };
      const moved = this.filteredForward(row, false);
      const pos = moved === row ? { ...this.view.top } : null;
      this.view.top = saved;
      if (pos) return pos;
    }

    return null;
  }

  /** Finds a 0-based file line without retaining the traversed text. */
  private gotoLine(target: number): void {
    const floor = optHeader().lines > 0 ? optHeader().start : 0;
    this.seekLine(Math.max(target, floor), true);
    this.sync();
    markPosClear();
  }

  private seekLine(target: number, bell: boolean): void {
    const pos = this.findLinePosition(target);

    if (pos === null) {
      if (bell) ringBell('eof');
      return;
    }

    this.view.top = { pos, subRow: 0 };
  }

  private findLinePosition(target: number): number | null {
    let pos = 0;
    let row = 0;

    while (row < target) {
      const line = forwLine(this.bf, pos);
      if (!line || line.next >= this.bf.size) {
        return null;
      }
      pos = line.next;
      row++;
    }

    return pos;
  }

  private clampHeader(): void {
    if (optHeader().lines > 0 && this.view.top.pos < this.headerPos) {
      this.view.top = { pos: this.headerPos, subRow: 0 };
    }
  }

  private markPosition(row: number): number | null {
    if (!this.sourceActive()) return null;
    return this.positions[row] ?? null;
  }

  private sourceActive(): boolean {
    if (mode.HELP) return false;

    if (files.list[files.index]?.path === this.activePath) {
      this.fileIndex = files.index;
      return true;
    }

    return false;
  }

  private lineNumber(row: number): number | null {
    const pos = this.positions[row];
    if (pos === undefined || this.lineScanAborted) return null;

    const num = this.countTo(pos);
    return num === null ? null : num + 1;
  }

  private lineCount(): number | null {
    if (this.lineScanAborted) return null;
    if (this.bf.size === 0) return 0;

    const num = this.countTo(this.bf.size - 1);
    return num === null ? null : num + 1;
  }

  /** Fable's cached find_linenum walk, retaining only sparse anchors. */
  private countTo(target: number): number | null {
    let anchor = this.lineAnchors[0];

    for (const candidate of this.lineAnchors) {
      if (candidate.pos <= target && candidate.pos > anchor.pos) {
        anchor = candidate;
      }
    }

    let { pos, num } = anchor;
    const started = Date.now();
    let messaged = false;
    let steps = 0;

    while (pos < target) {
      const chunk = this.bf.readRange(pos, Math.min(64 * 1024, target - pos));
      if (!chunk.length) break;

      for (let i = chunk.indexOf(0x0A); i >= 0;
        i = chunk.indexOf(0x0A, i + 1)) {
        num++;
      }

      pos += chunk.length;

      if ((++steps & 15) !== 0) continue;
      this.lineAnchors.push({ pos, num });

      if (!messaged && Date.now() - started >= 2000) {
        messaged = true;
        fs.writeSync(1, '\r' + CLEAR_LINE + INVERSE_ON +
          'Calculating line numbers... (interrupt to abort)' + INVERSE_OFF);
      }

      if (searchInterrupted()) {
        consumeInterrupt();
        session.intrPending = true;
        this.lineScanAborted = true;

        if (messaged) {
          opt.linenums = 0;
          search.message = 'Line numbers turned off';
        }

        return null;
      }
    }

    this.lineAnchors.push({ pos: target, num });
    return num;
  }

  private jumpMark(mark: Mark, sline: number): boolean {
    if (files.index !== this.fileIndex || mark.file !== this.fileIndex ||
        mark.pos === undefined) {
      return false;
    }

    recordLastPosition();

    if (mark.pos === Number.MAX_SAFE_INTEGER) {
      this.view.gotoEnd(config.window);
    } else {
      this.view.gotoPos(mark.pos);
      const line = sline || mark.sline;
      const sindex = Math.min(Math.max(line, 1), config.window - 1) - 1;
      this.view.lineBackward(sindex);
    }

    this.sync();
    markPosClear();
    return true;
  }

  /** Resolves less's screen-relative search start into a byte position. */
  private searchStart(request: SearchRequest): number | null {
    if (request.fromStart) {
      return request.dir > 0 ? this.noSearchHeaderStart(0) : this.bf.size;
    }

    let k: number;
    let addOne = false;

    if (optHowSearch() === 1) {
      k = request.dir > 0 ? config.window - 1 : 0;
    } else if (optHowSearch() === 2 && !request.afterTarget) {
      k = request.dir > 0 ? 0 : config.window - 1;
    } else {
      k = jumpSindex();
      if (request.dir > 0) addOne = true;
    }

    let start = this.view.screenPos(k);

    while (start === null) {
      k += request.dir;
      if (k < 0 || k >= config.window) return null;
      start = this.view.screenPos(k);
    }

    let pos = start.pos;
    if (addOne) pos = forwLine(this.bf, pos)?.next ?? this.bf.size;
    return this.noSearchHeaderStart(pos);
  }

  private noSearchHeaderStart(pos: number): number {
    if (!optNoSearchHeaders().lines || optHeader().lines <= 0) return pos;

    let after = 0;
    for (let i = 0; i < optHeader().lines; i++) {
      const line = forwLine(this.bf, after);
      if (!line) break;
      after = line.next;
    }

    return pos < after ? after : pos;
  }

  private scanForward(
    start: number,
    stop: number,
    state: { remaining: number }
  ): number | null | 'stop' {
    let pos = start;

    while (pos < stop && pos < this.bf.size) {
      const lines: string[] = [];
      const positions: number[] = [];

      while (lines.length < 1024 && pos < stop && pos < this.bf.size) {
        const line = forwLine(this.bf, pos);
        if (!line) break;
        lines.push(line.text);
        positions.push(pos);
        pos = line.next;
      }

      if (!lines.length) break;
      let candidates = lines;
      let candidatePositions = positions;

      if (session.lastFilter) {
        const mask = filterLineMask(lines, session.lastFilter);
        if (!mask) return 'stop';
        candidates = lines.filter((_, i) => mask[i]);
        candidatePositions = positions.filter((_, i) => mask[i]);
      }

      const hit = scanSearchBatch(candidates, state);
      if (hit === 'stop') return 'stop';
      if (hit !== 'miss') return candidatePositions[hit];
    }

    // the scan read to the spooled end, og's EOI discovery
    this.discoverEnd();
    return null;
  }

  private scanBackward(
    start: number,
    stop: number,
    state: { remaining: number }
  ): number | null | 'stop' {
    let pos = start;

    while (pos > stop) {
      const lines: string[] = [];
      const positions: number[] = [];

      while (lines.length < 1024 && pos > stop) {
        const line = backLine(this.bf, pos);
        if (!line || line.start < stop) break;
        lines.push(line.text);
        positions.push(line.start);
        pos = line.start;
      }

      if (!lines.length) break;
      let candidates = lines;
      let candidatePositions = positions;

      if (session.lastFilter) {
        const mask = filterLineMask(lines, session.lastFilter);
        if (!mask) return 'stop';
        candidates = lines.filter((_, i) => mask[i]);
        candidatePositions = positions.filter((_, i) => mask[i]);
      }

      const hit = scanSearchBatch(candidates, state);
      if (hit === 'stop') return 'stop';
      if (hit !== 'miss') return candidatePositions[hit];
    }

    return null;
  }

  /** Fable's byte-position OSC 8 walk over the complete file. */
  /** The line-start positions currently displayed, og's onscreen(). */
  private onscreen(pos: number): boolean {
    if (pos < this.view.top.pos) return false;
    return pos < this.view.visible(config.window - 1).endPos;
  }

  /** og's osc8_search (search.c:2005): continue within the selected
   *  line first; an off-screen selection restarts at the -j line; a
   *  found link only scrolls when it is NOT already on screen; a
   *  miss errors WITHOUT clearing the selection. */
  private findOsc8(direction: 1 | -1, count: number): void {
    let remaining = Math.max(count, 1);
    let pos: number;

    const selectedVisible = this.selectedOscPos !== null &&
      this.onscreen(this.selectedOscPos);

    if (selectedVisible && this.selectedOscPos !== null) {
      // continue the search in the same line as the current match
      const line = forwLine(this.bf, this.selectedOscPos);

      if (line) {
        const links = osc8Links([line.text]);
        const sameLine = direction > 0
          ? links.filter(l => l.start > this.selectedOscStart)
          : links.filter(l => l.start < this.selectedOscStart).reverse();

        for (const link of sameLine) {
          if (--remaining !== 0) continue;
          this.selectOsc8(this.selectedOscPos, link);
          return;
        }
      }

      pos = direction > 0
        ? line?.next ?? this.bf.size
        : this.selectedOscPos;
    } else {
      // og starts at the -j line like a normal search (search_pos)
      const start = this.view.screenPos(jumpSindex());

      if (start === null) {
        search.message = 'Nothing to search';
        return;
      }

      pos = start.pos;
      // a backward search examines lines before the start line
      if (direction < 0) pos = Math.min(pos + 1, this.bf.size);
    }

    while (direction > 0 ? pos < this.bf.size : pos > 0) {
      if (direction > 0) {
        const line = forwLine(this.bf, pos);
        if (!line) break;

        for (const link of osc8Links([line.text])) {
          if (--remaining !== 0) continue;
          this.selectOsc8(pos, link);
          return;
        }

        pos = line.next;
      } else {
        const line = backLine(this.bf, pos);
        if (!line) break;

        for (const link of osc8Links([line.text]).reverse()) {
          if (--remaining !== 0) continue;
          this.selectOsc8(line.start, link);
          return;
        }

        pos = line.start;
      }
    }

    // og errors and RETURNS: osc8_linepos keeps the old selection
    search.message = 'OSC 8 link not found';
  }

  private selectOsc8(
    pos: number,
    link: ReturnType<typeof osc8Links>[number]
  ): void {
    this.selectedOscPos = pos;
    this.selectedOscStart = link.start;

    // "If new link is on screen, just highlight it without
    // scrolling." (search.c:2049) — else jump_loc to the -j line;
    // only the jump pos_clears (the highlight is repaint_hilite)
    if (!this.onscreen(pos)) {
      this.view.top = { pos, subRow: 0 };
      this.view.lineBackward(jumpSindex());
      markPosClear();
    }

    // sync resolves the selection's current row itself (the og
    // position-range model), so one materialization styles it
    this.sync();
    setSelectedOsc8({
      ...link,
      row: Math.max(this.positions.indexOf(pos), 0),
    });

    // og saves the URI at every selection; the next prompt cycle
    // reports it (command.c:905 "Link: %s")
    search.message = `Link: ${link.uri}`;
  }

  /**
   * Materializes only the current view plus a small read-ahead. Header rows
   * are retained at the front so the shared overlay renderer can continue
   * to paint them after a distant seek.
   */
  private sync(): void {
    const header = optHeader();
    const raw: string[] = [];
    const positions: number[] = [];
    const seen = new Set<number>();

    let headerPos = 0;
    for (let i = 0; i < header.start; i++) {
      const line = forwLine(this.bf, headerPos);
      if (!line) break;
      headerPos = line.next;
    }

    this.headerPos = header.lines > 0 ? headerPos : 0;

    this.headerRow = raw.length;

    for (let i = 0; i < header.lines; i++) {
      const line = forwLine(this.bf, headerPos);
      if (!line) break;
      if (this.accepted(line.text)) {
        raw.push(line.text);
        positions.push(headerPos);
        seen.add(headerPos);
      }
      headerPos = line.next;
    }

    let bodyStart = positions.indexOf(this.view.top.pos);
    let atEof = false;

    if (session.lastFilter) {
      const start = this.nextAccepted(this.view.top.pos);

      if (start === null) {
        bodyStart = raw.length;
        atEof = true;
      } else {
        this.view.top.pos = start;
        if (bodyStart < 0) bodyStart = positions.indexOf(start);
        if (bodyStart < 0) bodyStart = raw.length;

        let pos = start;
        let accepted = 0;
        const limit = Math.max(config.window * 3, 64);

        while (pos < this.bf.size && accepted < limit) {
          const batch: { text: string, pos: number, next: number }[] = [];

          while (batch.length < 1024 && pos < this.bf.size) {
            const line = forwLine(this.bf, pos);
            if (!line) break;
            batch.push({ text: line.text, pos, next: line.next });
            pos = line.next;
          }

          if (!batch.length) break;
          const mask = filterLineMask(
            batch.map(line => line.text),
            session.lastFilter
          );
          if (!mask) break;

          for (let i = 0; i < batch.length && accepted < limit; i++) {
            if (!mask[i]) continue;
            const line = batch[i];

            if (!seen.has(line.pos)) {
              raw.push(line.text);
              positions.push(line.pos);
              seen.add(line.pos);
            }
            accepted++;
            if (accepted >= limit) pos = line.next;
          }
        }

        // same screen-vs-batch distinction as the seekable branch:
        // accepted lines beyond one screenful keep (END) unlit even
        // when the batch consumed the whole file
        atEof = accepted <= Math.max(config.window - 1 - this.padTop, 1) &&
          this.nextAccepted(pos) === null;
      }
    } else {
      const visible = this.view.visible(Math.max(config.window * 3, 64));
      if (bodyStart < 0) bodyStart = raw.length;

      for (const row of visible.rows) {
        if (seen.has(row.pos)) continue;
        raw.push(row.text);
        positions.push(row.pos);
        seen.add(row.pos);
      }

      // the batch materializes THREE windows: view.atEof describes
      // that batch, not the screen — (END) lights only when what
      // remains from the top fits the single displayed screenful
      atEof = visible.rows.length === 0 ||
        (this.view.atEof &&
          visible.rows.length <= Math.max(config.window - 1 - this.padTop, 1));
    }

    // An empty file still has one display line in the array-backed core.
    if (!raw.length) raw.push('');

    // og's osc8 hilite is a byte-position range checked at paint
    // (is_hilited_attr, search.c:686): resolve the selected line's
    // CURRENT row before this materialization styles, so the
    // standout follows the text through scrolls and repaints
    if (this.selectedOscPos !== null) {
      const selRow = positions.indexOf(this.selectedOscPos);
      setOsc8Display(selRow >= 0
        ? { row: selRow, start: this.selectedOscStart }
        : null);
    }

    session.fullContent = raw;
    session.content = deriveContent();

    // transformContent may squeeze blank header rows; measure the same
    // prefix rather than assuming raw and display indexes are identical.
    const displayBody = transformContent(raw.slice(0, bodyStart)).length;
    this.positions = positions;
    config.row = Math.min(displayBody, Math.max(session.content.length - 1, 0));
    config.subRow = this.view.top.subRow;
    // scroll moves carry their over-BOF pad; any jump clears it
    if (!this.keepPad) this.padTop = 0;
    this.keepPad = false;
    config.blankTop = this.padTop;

    calculateEOF(session.content);
    mode.EOF = atEof;

    // keep the upstream pipe flowing 8MB past the materialized window,
    // paused otherwise, so `yes | lmn` holds bounded spool growth
    this.requestAhead();
  }
}
