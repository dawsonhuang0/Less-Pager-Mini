import fs from 'fs';

import { Actions } from '../state/interfaces';

import { config, mode } from '../state/config';

import { layoutGeneration } from '../lines/lineLayout';

import { session, deriveContent } from '../state/session';

import {
  calculateEOF,
  dirtyBottomRow,
  markPosClear,
  markBackPaint,
  markFarBackClear,
  backScrollCap,
  render,
  renderBare,
  ringBell,
} from '../helpers';

import {
  binaryConfirm,
  binFile,
  files,
  onSourceFiles,
  pipeDraining,
} from '../features/files';

import { ffCapForward, isFormFeed } from '../features/moving';

import { maxSubRow } from '../lines/helpers';

import { noteScrollRows, screenPainted } from '../helpers';

import { osc8Internal, osc8Links, setSelectedOsc8 }
  from '../features/osc8';

import { secureAllow } from '../features/secure';

import { onSourceFollow } from '../features/follow';

import { onSourceTagJump, Tag } from '../features/tags';

import { screenAhead } from '../lines/screenOps';

import { getLayout, stringIndexAt } from '../lines/lineLayout';

import {
  Mark,
  onSourceMarks,
  recordLastPosition,
  subRowOfIndex,
} from '../features/jumping';

import {
  SearchRequest,
  filterLineMask,
  recordSearchMatch,
  scanSearchBatch,
  search,
  searchInterrupted,
  shiftVisibleText,
  stripStyles,
} from '../features/searching';

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
  optNoSearchHeaders,
  optPastEof,
  optForwScroll,
  optStopOnFormFeed,
} from '../options';

import { setOsc8Display, transformContent }
  from '../lines/helpers';

import { CLEAR_LINE, INVERSE_OFF, INVERSE_ON } from '../state/constants';

import { PipeDecoder } from '../features/charset';

import { BlockFile } from './blockFile';

import { BigView, ViewTop, displayText } from './fileView';

import { sourceLine, sourceIndexAt } from '../lines/helpers';

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
  private lineScanMessaged = false;
  private selectedOscPos: number | null = null;
  // which link within that line (its text-start offset)
  private selectedOscStart = -1;
  private incrementalOrigin: ViewTop | null = null;
  private headerRow = 0;
  private headerPos = 0;

  /** The layout generation this.seam's extents were measured under. */
  private seamLayout = -1;

  /** Rows at the bottom left blank by og's lclear. */
  private blankBelow = 0;

  /** The pad came from jump_loc's give-up branch, not from nblank. */
  private blankGiveUp = false;
  private pending: {
    index: number,
    bf: BlockFile,
    lines: string[],
  } | null = null;
  private readonly saved = new Map<string, ViewTop>();
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

  // the rows a backward move exposed, as offsets into the top's own
  // line: og's add_back_pos entries, minus the row index the window
  // would invalidate on the next sync
  private seam: { offset: number, end: number }[] = [];

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
    // og's pipe_data reads the file between two positions; the block
    // file already does exactly that read
    hook.sourceReadRange = (from, to) => this.sourceActive() && to > from
      ? this.bf.readRange(from, to - from)
      : null;
    hook.sourceHeaderRow = () => this.sourceActive()
      ? this.headerRow
      : undefined;
    // og's O_REPAINT toggle trashes the screen, and make_display then
    // repaints through jump_loc - which rebuilds from the position
    // table. Null lines a give-up jump drew are NOT in that table, so
    // they do not survive the repaint the way an nblank pad does
    // og's curr_byte(where) reads position(where) - a SCREEN ROW's
    // byte - and walks forward over rows the table has nothing for,
    // falling back to ch_length (prompt.c). A wrapped line owns
    // several rows, so the answer is usually mid-line
    hook.sourceRowByte = sindex => {
      if (!this.sourceActive()) return null;

      // og reads position(where) FIRST and only then walks forward
      // over empty rows, so BOTTOM_PLUS_ONE - the last index - is read
      // rather than skipped
      for (let k = sindex; k <= config.window - 1; k++) {
        const at = this.view.screenPos(k);
        if (at === null) continue;

        const line = forwLine(this.bf, at.pos);
        if (!line || at.offset <= 0) return at.pos;

        // the offset counts DISPLAY characters; og's table holds a
        // byte, so it converts through the raw line the display was
        // built from
        const shown = displayText(line.text);
        const raw = sourceLine(shown) ?? shown;
        const upto = raw === shown
          ? at.offset
          : sourceIndexAt(raw, at.offset);

        return at.pos + Buffer.byteLength(raw.slice(0, upto));
      }

      return this.bf.size;
    };

    hook.sourceRepaint = () => {
      if (!this.sourceActive() || !this.blankGiveUp) return;

      // get_scrpos(TOP) scans for the FIRST live entry and repaints
      // from it at that screen line, so the content lands right where
      // back() stopped drawing null lines - and the entry one row PAST
      // it (forw's closing add_forw_pos) draws as one more null line
      // below. Counted off og's own output: 21 tildes, the row, then a
      // single tilde
      this.blankGiveUp = false;
      this.blankBelow = 0;
      this.keepPad = true;
      this.sync();
    };

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
      pinEnd: entering => this.pinFollowEnd(entering),
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

    // og's currline(BOTTOM) closes the STARTUP forw() too, so by the
    // time any command runs the bottom line's number is already known.
    // Without this the first command to bell - which og answers with a
    // bell and nothing else - triggered our first resolution, and the
    // paint that precedes it repainted the screen
    this.lastResolved = this.view.top.pos + ':' + this.view.top.offset;
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
          // jump_forw's own lastmark, once the length is known
          recordLastPosition();
          if (session.lastFilter) this.gotoFilteredEnd();
          else this.view.gotoEnd(config.window);
        } else if (jump.kind === 'position') {
          this.view.gotoPos(Math.min(jump.value, this.bf.size));
        }

        this.clampHeader();
        this.sync();
        this.seam = [];
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
          // jump_forw's own lastmark, once the length is known
          recordLastPosition();
          if (session.lastFilter) this.gotoFilteredEnd();
          else this.view.gotoEnd(config.window);
        } else if (jump.kind === 'percent') {
          this.view.gotoPercent(jump.value);
        } else {
          this.view.gotoPos(Math.min(jump.value, this.bf.size));
        }
        this.clampHeader();
        this.seam = [];
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
          // og's jump_forw bells and returns when the end is already
          // displayed, and 4e4dce3 widened that test to the FILTERED
          // end: `bot_pos == end_pos || (bot_pos == soft_eof &&
          // soft_eof != NULL_POSITION)` (jump.c:44). Without the
          // second half, G at the end of &-filtered input stayed
          // silent whenever the file's real last line was filtered
          // out, because bottom+1 never reaches the file's end.
          // NOT simply "EOF is displayed": og compares
          // position(BOTTOM_PLUS_ONE), so on a screen that ends in
          // tilde rows that entry is NULL_POSITION and no bell is
          // rung, even though the end is plainly visible. The screen
          // must be FULL as well as at the end.
          // og's jump_forw calls ch_end_seek BEFORE the test below
          // (jump.c:37), and for a seekable file that re-stats the
          // file: end_pos is the length NOW. A file that grew since
          // the last paint therefore MOVES rather than belling, and
          // the end it moves to is the new one
          const wasSize = this.bf.size;
          if (this.bf.refreshSize() > wasSize) mode.EOF = false;

          const shown = session.lastFilter
            ? session.content.length
            : this.view.visible(config.window - 1).rows.length;

          if (mode.EOF && shown >= config.window - 1) {
            ringBell('eof');
            return true;
          }

          // jump_forw calls lastmark() itself, right here: after the
          // eof_bell test and before pos_clear, because "lastmark will
          // be called later by jump_loc, but it fails because the
          // position table has been cleared" (jump.c:51). Ours never
          // did, so after G the ' mark was still unset -- '' did not
          // come back to where G left, and |' piped one line where og
          // pipes the whole file
          recordLastPosition();

          if (session.lastFilter) {
            this.gotoFilteredEnd();
          } else {
            this.view.gotoEnd(config.window);
            this.padShortScreen();
          }

          this.sync();
          this.seam = [];
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
        this.seam = [];
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
        this.seam = [];
        markPosClear();
        return true;
      case 'OSC8_FORWARD':
        this.findOsc8(1, count || 1);
        return true;
      case 'OSC8_BACKWARD':
        this.findOsc8(-1, count || 1);
        return true;
      case 'OSC8_OPEN': {
        if (!secureAllow('osc8')) return true;

        // a link into the same file runs no handler: og searches for
        // the "id=" anchor it names, forward with wrap (search.c:1942)
        const param = osc8Internal();
        if (param === null) return false;

        this.openInternalOsc8(param);
        return true;
      }
      case 'OSC8_JUMP':
        if (this.selectedOscPos === null) {
          search.message = 'No OSC8 link selected';
        } else {
          // og's osc8_jump is an unconditional jump_loc to the -j
          // line (search.c:2002), on-screen or not
          this.view.top = { pos: this.selectedOscPos, offset: 0 };
          this.view.lineBackward(jumpSindex());
          this.sync();
          this.seam = [];
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

    // og's "pos != opos" (search.c:2211). Its default how_search is
    // OPT_ONPLUS (opttbl.c:222), so a forward search starts at
    // position(TOP) - a SCREEN row start, which on a wrapped line is a
    // byte in the middle of it - and search_range hands that same byte
    // back as linepos when the match is in that first segment. Equal to
    // opos, the -j target's position, it jumps nowhere: the screen
    // repaints in place rather than snapping to the line's beginning.
    const target = this.view.screenPos(jumpSindex());

    if (bSub === null && target && target.pos === found) {
      // og runs jump_loc only `else if (pos != opos)` (search.c), so
      // a match already sitting on the -j target moves NOTHING - no
      // jump, and therefore no pos_clear and no repaint. The two
      // paints hilite_screen already made are the whole of it
      this.shiftMatch(found);
      this.sync();
      recordSearchMatch(Math.max(this.positions.indexOf(found), 0));
      return;
    }

    if (bSub !== null) {
      this.view.top = {
        pos: found,
        offset: this.view.rowOffset(
          forwLine(this.bf, found)?.text ?? '',
          bSub
        ),
      };
      this.view.lineBackward(config.window - 2);
    } else {
      // og's search ends in jump_loc(pos, jump_sline) (search.c), so
      // the landing takes exactly the branches a `g` does: a match
      // ALREADY DISPLAYED is scrolled to, one just above the screen
      // is scrolled back to, and only a far one repaints
      const done = (): void => {
        this.shiftMatch(found);
        this.sync();
        recordSearchMatch(Math.max(this.positions.indexOf(found), 0));
        this.seam = [];
      };

      // under a filter the rows this walk produces are not the rows
      // on screen, the same reason jumpNear declines one
      const before = !session.lastFilter && this.padTop === 0 &&
        (found < this.view.top.pos ||
          (found === this.view.top.pos && this.view.top.offset > 0));

      if (before) {
        const walk = this.backWalk(found, jumpSindex());

        if (walk === 'scroll') {
          this.backward(this.scrollRows, true);
          done();
          return;
        }

        if (walk === 'blank') {
          this.blankBack();
          done();
          return;
        }

        this.view.top = { pos: found, offset: 0 };
        this.view.lineBackward(jumpSindex());
        done();

        if (config.window - 1 <= backScrollCap()) markBackPaint();
        else { markFarBackClear(); markPosClear(); }
        return;
      }

      if (this.jumpNear(found, jumpSindex() + 1)) {
        done();
        return;
      }

      this.view.top = { pos: found, offset: 0 };
      this.view.lineBackward(jumpSindex());
    }

    this.shiftMatch(found);
    this.sync();
    recordSearchMatch(Math.max(this.positions.indexOf(found), 0));
    this.seam = [];
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

    const end = m.end;
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
    // the guards come first so a line is not read off disk for a
    // search that cannot shift anyway
    if (!chopLine() || !search.regex) return;

    const line = linePos < this.bf.size ? forwLine(this.bf, linePos) : null;
    if (!line) return;

    shiftVisibleText(stripStyles(displayText(line.text)));
  }

  restoreSearchOrigin(): void {
    if (!this.incrementalOrigin || !this.sourceActive()) return;
    // a restore, not a jump: og's abandoned incremental search returns
    // to the byte the screen started at, part-way into a row or not
    this.view.top = { ...this.incrementalOrigin };
    this.incrementalOrigin = null;
    this.sync();
  }

  /** og's currline(BOTTOM) closing every forw()/back(): the eager
   *  line-number resolution running after each move's paint. */
  resolveBottom(): void {
    if (opt.linenums === 0 || mode.HELP || !this.sourceActive()) return;

    const at = this.view.top.pos + ':' + this.view.top.offset;
    if (at === this.lastResolved) return;
    this.lastResolved = at;

    // og paints the moved content BEFORE the walk: forw() puts its
    // rows up, currline(BOTTOM) runs after, and the prompt comes
    // last — so the screen always shows the move immediately, with
    // a blank command line while the count runs
    // bare: og has not written a prompt at this point either, so
    // painting one here only to blank it on the next line was two
    // writes and a flicker that og never emits
    renderBare(session.content, session.buffer);

    this.lineScanMessaged = false;
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

    // A mid-scan message or the retry's blank bypassed the renderer,
    // so the row they landed on must repaint. When the walk was
    // silent -- the ordinary case -- nothing was written, and
    // dirtying anyway destroyed the record of the bottom row the
    // bare frame HAD painted: the next frame then printed that line
    // a second time, which is why every scroll went out twice.
    if (this.lineScanMessaged || retriedAfterEarlyInterrupt ||
        opt.linenums === 0) {
      dirtyBottomRow();
    }
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
    let at = stringIndexAt(getLayout(display), start.offset);

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
    this.view.top = { pos: found, offset: 0 };

    if (forward) {
      if (session.lastFilter) {
        this.filteredBackward(Math.max(config.window - 2, 0));
      } else {
        this.view.lineBackward(Math.max(config.window - 2, 0));
      }
    }

    this.sync();
    this.seam = [];
    markPosClear();
    return true;
  }

  retopOffset(offset: number): void {
    this.view.top = { pos: this.view.top.pos, offset };
    this.sync();
  }

  rebuild(): boolean {
    if (mode.HELP || files.index !== this.fileIndex) {
      return false;
    }

    // og's pos_rehead moves table[TOP] back to the line's beginning
    // (position.c:325); here the top's POSITION already is one, so
    // re-anchoring means dropping the sub-row the caller cleared
    if (config.subRow === 0 && config.subShift === 0) {
      this.view.top = { pos: this.view.top.pos, offset: 0 };
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
    hook.sourceReadRange = null;
    hook.sourceHeaderRow = null;
    hook.sourceHeaderChanged = null;
    hook.sourceRowByte = null;
    hook.sourceRepaint = null;
    this.pending?.bf.close();
    this.bf.close();
  }

  /** Supplies bounded startup data to the existing shared file switch. */
  private loadSourceFile(index: number): string[] | null | undefined {
    this.sourceActive();
    const entry = files.list[index];
    if (!entry || entry.lines || entry.alt) return undefined;

    // "-" is standard input, which the session spooled to a private
    // file so it is seekable; everything below then treats it as the
    // ordinary growing file it now is (og keeps fd0 and buffers it in
    // ch - the spool is our ch)
    const path = entry.path === '-' ? entry.spoolPath : entry.path;
    if (path === undefined) return undefined;

    if (this.pending?.index === index) return this.pending.lines;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(path);
    } catch {
      return undefined;
    }

    if (!stat.isFile()) return undefined;

    let next: BlockFile;
    try {
      next = new BlockFile(path);
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
    this.view.top = saved ? { ...saved } : { pos: 0, offset: 0 };
    this.pending = null;
    this.sync();
  }

  /**
   * The null rows an end jump leaves above BOF, like og's jump_loc
   * walking back sindex lines to put the last one at the bottom: when
   * back_line hits BOF first it BREAKS and hands the shortfall to
   * forw() as its nblank argument - "rely on forw() below to draw the
   * required number of blank lines at the top of the screen"
   * (jump.c:316). So a file shorter than the screen ends up at the
   * BOTTOM under tildes; gotoEnd on its own just clamps at BOF and
   * leaves the text at the top.
   */
  private padShortScreen(): void {
    const rows = this.view.visible(config.window - 1).rows.length;
    const blank = Math.max(config.window - 1 - rows, 0);

    if (blank > 0) {
      this.padTop = blank;
      this.keepPad = true;
    }
  }

  /**
   * jump_loc's lastmark, in positions.
   *
   * A jump only records the last mark when it had to REPAINT. Both of
   * jump_loc's branches walk from the target towards the screen first,
   * and either returns early -- "Surprise! The desired line is close
   * enough to the current screen that we can just scroll there after
   * all" -- before reaching the lastmark() below the loop (jump.c:294,
   * jump.c:347). Recording unconditionally instead made `''` twice in
   * a row land in two different places from og, because our first jump
   * left a mark og's scroll never wrote.
   *
   * @param pos - The position being jumped to.
   * @param sindex - 0-based screen row the target will be placed on.
   */
  private jumpLastMark(pos: number, sindex: number): void {
    const top = this.view.screenPos(0);
    const tpos = top === null ? null : top.pos;

    if (tpos === null || pos >= tpos) {
      // after the screen: back the target up towards position(BOTTOM)
      const bottom = this.view.screenPos(config.window - 1);
      const bpos = bottom === null ? null : bottom.pos;
      let at = pos;

      for (let n = 0; n < sindex; n++) {
        if (bpos !== null && at <= bpos) return; /* scroll */

        const prev = backLine(this.bf, at);
        if (!prev) break;
        at = prev.start;
      }
    } else {
      // before the screen: walk forward and see if we reach the top
      let at = pos;

      for (let n = sindex; n < config.window - 1; n++) {
        const line = forwLine(this.bf, at);
        if (!line) break;
        if (at >= tpos) return; /* scroll */
        at = line.next;
      }
    }

    recordLastPosition();
  }

  /**
   * jump_loc's lastmark for F's entry jump.
   *
   * og's F is forw_loop, which opens with jump_forw_buffered ->
   * jump_line_loc(end-1, sc_height-1) -> jump_loc. The ticks that
   * follow are forw(1), not a jump, so only the entry can mark.
   */
  private followLastMark(): void {
    // jump_line_loc(end-1) is the line containing the last byte
    const pos = backLine(this.bf, this.bf.size)?.start ?? null;
    if (pos === null) return;

    this.jumpLastMark(pos, config.window - 2);
  }

  private pinFollowEnd(entering: boolean): boolean {
    if (!this.sourceActive()) return false;

    // F on a pipe reads to the true end and keeps reading, like
    // og's forw_loop with ignore_eoi
    if (this.spoolAlive()) this.spool?.drain();

    this.bf.refreshSize();
    const entry = files.list[this.fileIndex];
    if (entry) entry.size = this.bf.size;

    if (entering) this.followLastMark();

    if (session.lastFilter) {
      this.gotoFilteredEnd();
    } else {
      this.view.gotoEnd(config.window);

      // F is jump_forw_buffered, which reaches the same jump_loc with
      // the same sc_height-1 target as G: content shorter than the
      // screen sits at the BOTTOM either way. og gets there through
      // the onscreen branch instead (no pos_clear), which back()s the
      // shortfall in as null lines rather than passing it as nblank -
      // a different route to the same screen
      this.padShortScreen();
    }
    this.sync();
    return true;
  }

  private refreshFollow(): boolean {
    return this.pinFollowEnd(false);
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
    this.view.top = { pos: Math.max(pos, this.headerPos), offset: 0 };
    const up = jumpSindex();
    if (session.lastFilter) this.filteredBackward(up);
    else this.fileBackward(up);
    this.sync();
    this.seam = [];
    markPosClear();
    return true;
  }

  private forward(
    rows: number,
    clampAtLastScreen: boolean,
    viaJump: boolean = false
  ): void {
    // og's forward() opens with `if (past_eof) force = TRUE`
    // (forwback.c:479), so --past-eof turns EVERY forward move into a
    // forced one and the last-screenful clamp simply does not apply.
    // backwardFrom already did this for its own direction; forward
    // never consulted the option at all, so --past-eof stopped dead
    // at the last screenful instead of running on past it.
    if (optPastEof()) clampAtLastScreen = false;

    // og's forward() asks position(BOTTOM_PLUS_ONE) and bells BEFORE
    // forw() gets a chance to consume anything (forwback.c:481). With
    // blank rows above BOF and the file's end already on screen there
    // is no row past the bottom, so the move bells and the blanks
    // stay put - consuming one of them first would scroll a screen
    // that og leaves alone.
    // og's forward() asks position(BOTTOM_PLUS_ONE) BEFORE anything
    // else, and an empty position table has no row past the bottom to
    // move to: it eof_bells and returns (forwback.c:481, where
    // empty_lines is true for a screen nothing has painted). A key
    // ungot at the startup gate runs before the first paint, so og
    // bells on it and paints the FIRST screen afterwards -- we moved.
    // The guard is og's COMMAND-level forward() (forwback.c:481). A
    // jump does not come through there: jump_loc calls forw() itself,
    // forced, and paints from the target -- which is why +5g works on
    // a screen nothing has drawn yet while a bare j on the same screen
    // only bells.
    if (!viaJump && !screenPainted()) {
      ringBell('eof');
      this.sync();
      return;
    }

    if (clampAtLastScreen && this.padTop > 0 && mode.EOF) {
      ringBell('eof');
      this.keepPad = true;
      this.sync();
      return;
    }

    // scrolling forward consumes blank rows padded above BOF first,
    // like the array session's lineForward blankTop branch
    let want = rows;

    // then the rows a backward move uncovered: og's forw() walks the
    // entries add_back_pos prepended, dropping table[0] each time
    // (position.c:63), before the grid below resumes
    if (this.seam.length) {
      const used = Math.min(want, this.seam.length);
      const last = this.seam[used - 1];

      this.seam = this.seam.slice(used);
      want -= used;

      // the entries land on the absolute grid, but the LAST one ends
      // at the original top, which may sit mid-boundary; the top is an
      // offset, so it simply goes there
      const off = this.seam.length ? this.seam[0].offset : last.end;
      this.view.top = { pos: this.view.top.pos, offset: off };

      if (want <= 0) {
        this.sync();
        return;
      }
    }

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

    // og's forw() stops after printing a line that starts with \f, so
    // the form feed ends up the LAST visible row (forwback.c:366).
    // The array session caps the move for that; the byte-position
    // engine never did, so --form-feed simply had no effect here
    if (optStopOnFormFeed()) want = ffCapForward(session.content, want);

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

    // -y: og's forw() decides do_repaint from the REQUESTED count the
    // same way back() does - `forw_scroll >= 0 && n > forw_scroll &&
    // n != sc_height-1` (forwback.c:243), the screenful exempt "since
    // repainting itself involves scrolling forward a screenful"
    if (moved && optForwScroll() >= 0 && rows > optForwScroll() &&
        rows !== config.window - 1) {
      markPosClear();
    }

    this.keepPad = true;
    noteScrollRows(moved);
    this.sync();
  }

  private backward(rows: number, force: boolean = false): void {
    // og's back() calls add_back_pos per row, and back_line bounds the
    // row it exposes at the one that was on top (input.c) while the
    // rows below keep the extents they had. The entries say that; a
    // single anchor could only ever say it once.
    const wasPos = this.view.top.pos;
    const wasOffset = this.view.top.offset;

    this.backwardFrom(rows, force);

    // A step that leaves the line has no bound, so every entry always
    // belongs to the top's OWN line - which is why they are kept as
    // bare offsets. The materialized window renumbers its rows on each
    // sync, so an index stored here would be stale by the next paint.
    if (this.view.top.pos !== wasPos) {
      this.seam = [];
    } else {
      const top = { row: config.row, offset: this.view.top.offset };

      this.seam = [
        ...screenAhead(session.content, top, wasOffset)
          .map(cell => ({ offset: cell.offset, end: cell.end })),
        ...this.seam,
      ].slice(0, Math.max(config.window - 1, 1));
    }

    this.publishSeam();
  }

  posClear(): void {
    this.seam = [];
    config.screen = [];
  }

  /**
   * How far a backward move may go before a form feed stops it.
   *
   * og's back() breaks after printing a line that starts with \f, so
   * the form feed ends up the TOP row (forwback.c:444).
   *
   * The array session answers this from session.content, which is the
   * whole file there. Here it is only the materialized window -- on a
   * backward move that is the visible rows and nothing above them --
   * so the walk goes back through the FILE a line at a time instead.
   *
   * @param rows - Display rows the move wants.
   * @returns The rows it may actually take.
   */
  private ffCapBack(rows: number): number {
    // steps within the top's own line come first, and og stops once
    // that line's FIRST row is the one on top
    const topLine = forwLine(this.bf, this.view.top.pos);
    let taken = topLine
      ? this.view.subRowAt(displayText(topLine.text), this.view.top.offset)
      : 0;

    if (taken > 0 && topLine && isFormFeed(displayText(topLine.text))) {
      return Math.min(taken, rows);
    }

    let pos = this.view.top.pos;

    while (taken < rows) {
      const prev = backLine(this.bf, pos);
      if (!prev) break;

      pos = prev.start;
      const text = displayText(prev.text);
      taken += maxSubRow(text) + 1;

      if (isFormFeed(text)) return Math.min(taken, rows);
    }

    return rows;
  }

  /** Re-expresses the seam in the row indices this paint will use. */
  private publishSeam(): void {
    // a seam cell is an EXTENT, measured under the layout that was in
    // force when back_line bounded it. og never carries one across a
    // layout change - its table holds starts only, and forw_line
    // re-extents every row at the draw - so a width, --wordwrap or
    // ctldisp change makes these ends describe a screen that no longer
    // exists. -r is the sharp case: it turns the whole line into ONE
    // row, and a stale 80-column seam re-chopped it behind the paint
    if (this.seamLayout !== layoutGeneration()) this.seam = [];
    this.seamLayout = layoutGeneration();

    config.screen = this.seam.map(cell => ({ row: config.row, ...cell }));
  }

  private backwardFrom(rows: number, force: boolean = false): void {
    // og's back() opens with squish_check (forwback.c:394), BEFORE it
    // knows whether anything can scroll: a backward command repaints
    // the squished short first screen — filling the blank rows above
    // with tildes — and only then bells at BOF. forward() is not
    // symmetric: it bells and returns before ever reaching forw(),
    // so a clamped forward leaves the squish alone
    if (mode.INIT) mode.INIT = false;

    // --past-eof forces every backward scroll, like og's back()
    if (optPastEof()) force = true;

    // og's back() breaks after printing a \f line, leaving it as the
    // TOP row (forwback.c:444) -- the mirror of the forward stop
    if (optStopOnFormFeed()) rows = this.ffCapBack(rows);

    // og's back() decides do_repaint from the REQUESTED count, before
    // it moves anything (`n > get_back_scroll()`, forwback.c:397), so
    // a `b` that ran into the top of the file still repaints under -c
    // or -h - but only if it moved at all: nothing moved is
    // `if (nlines == 0) eof_bell(); else if (do_repaint) repaint();`
    const doRepaint = rows > backScrollCap();

    const moved = session.lastFilter
      ? this.filteredBackward(rows)
      : this.fileBackward(rows);

    if (moved && doRepaint) markPosClear();

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

    noteScrollRows(-moved);
    this.keepPad = true;
    this.sync();
  }

  /**
   * A batch of lines narrowed to the ones the active display filter
   * accepts, with their positions, or null when the filter itself gave
   * up (an interrupted or too-complex pattern).
   *
   * Four places walked a batch off disk and then applied the mask to
   * it: forward and backward for "the next accepted line", forward and
   * backward for a search. All four spelled the mask out again.
   *
   * @param lines - The batch as read.
   * @param positions - The byte position of each line in the batch.
   */
  private acceptedBatch(
    lines: string[],
    positions: number[]
  ): { lines: string[], positions: number[] } | null {
    if (!session.lastFilter) return { lines, positions };

    const mask = filterLineMask(lines, session.lastFilter);
    if (!mask) return null;

    return {
      lines: lines.filter((_, i) => mask[i]),
      positions: positions.filter((_, i) => mask[i]),
    };
  }

  /** og's to_newline scroll (forwback.c:302): rows reveal at the
   *  bottom edge until `lines` of them end their file line, wrap
   *  continuations riding free; the top may land mid-wrap. */
  private newlineForward(lines: number): void {
    const cur = { ...this.view.top };
    let line = forwLine(this.bf, cur.pos);

    const advance = (): boolean => {
      if (!line) return false;

      const next = this.view.nextRowOffset(line.text, cur.offset);
      if (next !== null) {
        cur.offset = next;
        return true;
      }

      const nextPos = session.lastFilter
        ? this.nextAccepted(line.next)
        : line.next;
      if (nextPos === null || nextPos >= this.bf.size) return false;

      const nl = forwLine(this.bf, nextPos);
      if (!nl) return false;

      cur.pos = nextPos;
      cur.offset = 0;
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
      if (line && this.view.nextRowOffset(line.text, cur.offset) === null) n--;
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

    if (this.view.top.offset > 0 && remaining > 0) {
      this.view.top = { pos: this.view.top.pos, offset: 0 };
      remaining--;
      moved++;
    }

    while (remaining > 0) {
      const line = session.lastFilter
        ? this.prevAccepted(this.view.top.pos)
        : backLine(this.bf, this.view.top.pos)?.start ?? null;
      if (line === null) break;
      this.view.top = { pos: line, offset: 0 };
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

      const batch = this.acceptedBatch(lines, positions);
      if (!batch) return null;
      if (batch.positions.length) return batch.positions[0];
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

      const batch = this.acceptedBatch(lines, positions);
      if (!batch) return null;
      if (batch.positions.length) return batch.positions[0];
    }

    return null;
  }

  /**
   * One row back within the top's own line, like back_line landing on
   * the greatest row start below where it already is.
   */
  private rowAbove(): number {
    const line = forwLine(this.bf, this.view.top.pos);
    return line
      ? this.view.rowStartBelow(line.text, this.view.top.offset)
      : 0;
  }

  /** The offset of the last display row of the line at `pos`. */
  private lastRowAt(pos: number): number {
    return this.view.lastRowStart(forwLine(this.bf, pos)?.text ?? '');
  }

  private filteredForward(rows: number, clampAtLastScreen: boolean): number {
    const end = clampAtLastScreen ? this.filteredEndTop() : null;
    let moved = 0;

    while (moved < rows) {
      if (end && (this.view.top.pos > end.pos ||
          (this.view.top.pos === end.pos &&
            this.view.top.offset >= end.offset))) {
        break;
      }

      const line = forwLine(this.bf, this.view.top.pos);
      const next = line
        ? this.view.nextRowOffset(line.text, this.view.top.offset)
        : null;

      if (next !== null) {
        this.view.top = { pos: this.view.top.pos, offset: next };
      } else {
        const after = line ? this.nextAccepted(line.next) : null;
        if (after === null) break;
        this.view.top = { pos: after, offset: 0 };
      }

      moved++;
    }

    return moved;
  }

  private filteredBackward(rows: number): number {
    let moved = 0;

    while (moved < rows) {
      if (this.view.top.offset > 0) {
        this.view.top = { pos: this.view.top.pos, offset: this.rowAbove() };
      } else {
        const prev = this.prevAccepted(this.view.top.pos);
        if (prev === null || prev < this.headerPos) break;
        this.view.top = { pos: prev, offset: this.lastRowAt(prev) };
      }

      moved++;
    }

    return moved;
  }

  private fileBackward(rows: number): number {
    let moved = 0;

    while (moved < rows) {
      if (this.view.top.offset > 0) {
        this.view.top = { pos: this.view.top.pos, offset: this.rowAbove() };
      } else {
        const prev = backLine(this.bf, this.view.top.pos);
        if (!prev || prev.start < this.headerPos) break;
        this.view.top =
          { pos: prev.start, offset: this.view.lastRowStart(prev.text) };
      }
      moved++;
    }

    return moved;
  }

  private filteredEndTop(): ViewTop | null {
    const last = this.prevAccepted(this.bf.size);
    if (last === null) return null;

    const saved = { ...this.view.top };
    this.view.top = { pos: last, offset: this.lastRowAt(last) };
    this.filteredBackward(Math.max(config.window - 2, 0));
    const end = { ...this.view.top };
    this.view.top = saved;
    return end;
  }

  private gotoFilteredEnd(): void {
    // jump_forw hands &soft_eof to back_line and walks back from the
    // file's end (jump.c:62), so reaching the end THROUGH a filter
    // still counts as the end - the prompt says (END), not ":"
    session.softEofSeen = true;

    const end = this.filteredEndTop();
    if (end) this.view.top = end;
  }

  private bottomSourcePosition(): ViewTop | null {
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
  /**
   * og's onscreen() (position.c:135): the screen row holding a byte,
   * or -1. Note it returns -1 when the byte is past EVERY row, not the
   * bottom row - the loop only ever answers from `pos < table[i]`, so
   * falling out the end means "not on screen". Getting that backwards
   * made a jump to the file's end look like a jump onto the screen.
   */
  private onScreenRow(target: number): number {
    // og's table holds a BYTE PER ROW, so on a wrapped line its
    // entries differ row to row. Ours holds the row's LINE START plus
    // an offset, and comparing the line starts alone collapses every
    // row of one long line to the same value - on a single-line file
    // that made a top deep inside the line compare equal to byte 0
    // and report "on screen" for a target that was far above it.
    const before = (at: ViewTop): boolean =>
      target < at.pos || (target === at.pos && at.offset > 0);

    const first = this.view.screenPos(0);
    if (!first || before(first)) return -1;

    for (let k = 1; k < config.window; k++) {
      const at = this.view.screenPos(k);
      if (at && before(at)) return k - 1;
    }

    return -1;
  }

  /**
   * og's jump_loc near-target branch (jump.c:337): a target that is
   * ALREADY DISPLAYED is scrolled to with force=TRUE rather than
   * repainted, which keeps the junction a backward move leaves behind
   * instead of regenerating the screen from the target.
   *
   * @returns True when it handled the jump.
   */
  private jumpNear(target: number, sline: number): boolean {
    // under a filter the rows this walk produces are not the rows on
    // screen, so onscreen() would be comparing against the wrong table
    if (session.lastFilter || this.padTop > 0) return false;

    const nline = this.onScreenRow(target);
    if (nline < 0) return false;

    // sindex_from_sline: clip to 1..sc_height-1, then make it 0-based
    const sindex = Math.min(Math.max(sline, 1), config.window - 1) - 1;
    const delta = nline - sindex;

    if (delta > 0) {
      this.forward(delta, false, true);
    } else if (delta < 0) {
      this.backwardFrom(-delta, true);
    } else {
      // og scrolls by the difference either way, so a target already
      // sitting on its own -j line is back(0): the loop never runs,
      // nlines stays 0 and back() eof_bells (forwback.c:388). g at
      // the top of the file is exactly that case, and we repainted
      // the screen for it instead
      ringBell('eof');
      this.sync();
    }

    return true;
  }

  private gotoLine(target: number): void {
    const floor = optHeader().lines > 0 ? optHeader().start : 0;
    const want = Math.max(target, floor);
    const pos = this.findLinePosition(want);

    // og's onscreen() compares BYTE positions, and its top under -r is
    // a byte part-way into the line. Ours is that line's start plus an
    // offset, so a target at the line's beginning looks equal to the
    // top when og would call it strictly before - and og's give-up
    // branch below is what answers that case
    const before = pos !== null && (pos < this.view.top.pos ||
      (pos === this.view.top.pos && this.view.top.offset > 0));

    // og's jump_loc splits three ways for a target above the screen;
    // only the last of them repaints, and none of them pos_clears
    let farBack = false;

    if (before && pos !== null) {
      const walk = this.backWalk(pos, jumpSindex());

      if (walk === 'scroll') {
        // og's back(nline, tpos, TRUE, ...): the same scroll a k runs,
        // forced, with add_back_pos keeping the seam it exposes
        this.backward(this.scrollRows, true);
        return;
      }

      if (walk === 'blank') {
        this.blankBack();
        return;
      }

      farBack = true;
    }

    // og's jump_back ends in jump_loc(pos, jump_sline), and jump_loc
    // scrolls instead of repainting when the line is already on screen
    // og's onscreen branch just scrolls and returns (jump.c:251): the
    // position table stays live, and pos_clear belongs to the far
    // branch below. Clearing it here sent an ordinary short jump down
    // the skipping repaint instead of a scroll.
    if (pos !== null && this.jumpNear(pos, jumpSindex() + 1)) {
      this.seam = [];
      return;
    }

    // og's jump_loc, for a target BEFORE the screen, walks FORWARD
    // from it looking for a row that reaches the current top - and if
    // that walk runs off the end of the file first, it gives up,
    // lclear()s and back()s from the target with force (jump.c:353).
    // From the beginning of the file back() has nowhere to go, so it
    // draws a screenful of NULL LINES: the content is pushed off and
    // tildes are all that is left. -r is what makes the walk fail,
    // because the whole file is a single row
    // og's jump_back errors when find_pos cannot place the line and
    // does not move at all (jump.c:117). We fell through to a clamped
    // seek, so N g past the end of the file landed on the last screen
    // instead of reporting. A still-spooling source is not "past the
    // end" yet -- its length is not known -- so it keeps the old path.
    if (pos === null && !this.spoolAlive() && want > 0) {
      search.message = `Cannot seek to line number ${want + 1}`;
      return;
    }

    // og's forw() pos_clears -- and prints "...skipping..." -- only
    // when the target is NOT contiguous with what is displayed:
    // `if (pos != position(BOTTOM_PLUS_ONE) || empty_screen())`
    // (forwback.c:259). A jump landing exactly on the row after the
    // bottom is an ordinary forward screenful, and og scrolls it. We
    // cleared for every jump, so 10g on a nine-row screen printed the
    // marker and repainted where og simply scrolled on.
    const contiguous = pos !== null && !this.emptyScreen() &&
      pos === this.view.visible(config.window - 1).endPos;

    this.seekLine(want, true);
    this.sync();
    this.seam = [];

    // og's far backward branch lclear()s and back()s: the screen is
    // cleared and repainted upward, but the position table survives,
    // so the paint still knows it went BACKWARD. pos_clear belongs to
    // the forward/skipping path only
    // og's far backward branch lclear()s and back()s a whole screen -
    // and back() itself repaints when that exceeds get_back_scroll
    // (-c, -h), which pos_clears and paints FORWARD instead
    if (contiguous) {
      noteScrollRows(config.window - 1);
    } else if (farBack && config.window - 1 <= backScrollCap()) {
      markBackPaint();
    } else {
      // og's far backward branch lclear()s - home()s under -c - before
      // back(), and back() then repaints because a whole screen
      // exceeds get_back_scroll. That clear stands where a command's
      // clear_bot would otherwise be
      if (farBack) markFarBackClear();

      markPosClear();
    }
  }

  /** og's empty_screen(): nothing has been painted yet. */
  private emptyScreen(): boolean {
    return this.view.visible(config.window - 1).rows.length === 0;
  }

  /**
   * og's jump_loc branch for a target BEFORE the screen (jump.c:353).
   *
   * - `scroll`: the walk reached the old top within a screenful, so og
   *   says "Surprise! ... we can just scroll there after all" and runs
   *   back(nline, tpos) - a forced backward SCROLL, no lclear and no
   *   pos_clear. `rows` is og's nline: sindex plus the display-row
   *   distance from the target to the old top.
   * - `blank`: the walk ran off the END of the file first, so back()
   *   draws null lines over the screen.
   * - `far`: neither - the walk used up a screenful without arriving.
   *   og lclear()s and back()s a whole screen from where the walk
   *   stopped, which lands the same top the fall-through seek does.
   */
  private backWalk(pos: number, sindex: number): 'scroll' | 'blank' | 'far' {
    const top = this.view.top;
    let at = { pos, offset: 0 };
    let steps = 0;

    // og walks forward by DISPLAY ROWS - `pos = forw_line(pos,
    // &linepos, NULL)` once per screen line - and takes the scroll
    // shortcut the moment a row's start reaches the old top. Only a
    // walk that runs off the END of the file first leaves pos
    // NULL_POSITION, and that is the case back() then fills with null
    // lines
    for (; steps < config.window - 1 - sindex; steps++) {
      if (at.pos > top.pos ||
          (at.pos === top.pos && at.offset >= top.offset)) {
        this.scrollRows = sindex + steps;
        return 'scroll';
      }

      const line = forwLine(this.bf, at.pos);
      if (!line) return 'blank';

      const next = this.view.nextRowOffset(line.text, at.offset);

      if (next !== null) {
        at = { pos: at.pos, offset: next };
      } else if (line.next < this.bf.size) {
        at = { pos: line.next, offset: 0 };
      } else {
        return 'blank';
      }
    }

    return 'far';
  }

  // og's nline from the walk above, handed to back()
  private scrollRows = 0;

  /**
   * og's give-up branch: back() from nowhere draws null lines, the
   * content is pushed off and the rows below keep what lclear left.
   */
  private blankBack(): boolean {

    // og's back() stops when the entries the OLD table still holds
    // reach the bottom two slots - add_back_pos shifts them down one
    // per null line drawn - so it draws sc_height-1 minus however many
    // there were. The rest of the screen keeps what lclear left: blank
    const entries = this.view.visible(config.window - 1).rows.length + 1;
    const nulls = Math.max(config.window - 1 - entries, 0);

    // the top does NOT move: og's backward branch add_back_pos's the
    // walk's end - NULL_POSITION here - and lets back() draw null
    // lines over the screen, while the entries for the OLD top stay in
    // the table, shifted down. A later repaint reads one back out of
    // it (get_scrpos scans from the top for the first live entry), so
    // the content returns to where it was, not to the jump's target
    this.padTop = nulls;
    this.blankBelow = config.window - 1 - nulls;
    this.blankGiveUp = true;
    this.keepPad = true;
    this.sync();
    this.seam = [];
    markPosClear();
    return true;
  }

  private seekLine(target: number, bell: boolean): void {
    const pos = this.findLinePosition(target);

    if (pos === null) {
      if (bell) ringBell('eof');
      return;
    }

    this.view.top = { pos, offset: 0 };
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
      this.view.top = { pos: this.headerPos, offset: 0 };
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
        this.lineScanMessaged = true;
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

    if (mark.pos === Number.MAX_SAFE_INTEGER) {
      // the '$' mark is og's other unconditional ch_end_seek
      // (mark.c:179), so it lands on the file's length NOW
      this.bf.refreshSize();
      const end = backLine(this.bf, this.bf.size)?.start;
      if (end !== undefined) this.jumpLastMark(end, config.window - 2);
      this.view.gotoEnd(config.window);
    } else {
      const line = sline || mark.sline;
      const sindex = Math.min(Math.max(line, 1), config.window - 1) - 1;

      // gomark hands jump_loc the mark's position and screen line, and
      // jump_loc decides for itself whether this is worth a lastmark
      this.jumpLastMark(mark.pos, sindex);
      this.view.gotoPos(mark.pos);
      this.view.lineBackward(sindex);
    }

    this.sync();
    this.seam = [];
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
    const started = Date.now();
    let noted = false;

    while (pos < stop && pos < this.bf.size) {
      // og's delayed_msg shape (linenum.c:229): say nothing for the
      // first LONGTIME seconds, then name the loop with ierror's
      // suffix. og does this for line numbers and file length but not
      // for a search - search.c has no message at all, so a long walk
      // over a big file sits silent. This is the same clock the line
      // scan above already uses.
      if (!noted && Date.now() - started >= 2000) {
        noted = true;
        fs.writeSync(1, '\r' + CLEAR_LINE + INVERSE_ON +
          'Searching... (interrupt to abort)' + INVERSE_OFF);
        search.bottomClobbered = true;
      }

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

      const batch = this.acceptedBatch(lines, positions);
      if (!batch) return 'stop';
      const candidates = batch.lines;
      const candidatePositions = batch.positions;

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

      const batch = this.acceptedBatch(lines, positions);
      if (!batch) return 'stop';
      const candidates = batch.lines;
      const candidatePositions = batch.positions;

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

  /**
   * Selects the anchor an internal link names, scanning forward from
   * the current selection and wrapping once - og's osc8_search with
   * SRCH_FORW|SRCH_WRAP and a param (search.c:1949). The param mode
   * is also what re-admits an empty link: an id= anchor is one.
   */
  private openInternalOsc8(param: string): void {
    const from = this.selectedOscPos ?? this.view.top.pos;
    let pos = from;
    let wrapped = false;

    for (;;) {
      const line = forwLine(this.bf, pos);

      if (!line) {
        if (wrapped) break;
        wrapped = true;
        pos = 0;
        continue;
      }

      const [link] = osc8Links([line.text], param);

      if (link && !(pos === from && !wrapped)) {
        if (wrapped) {
          search.message = 'Search hit bottom; continuing at top';
        }

        // a param search sets NO globals - "Don't set osc8 globals if
        // we're just searching for a parameter" (search.c:1445) - so
        // the selection and its "Link:" message stay as they were and
        // only the view moves, and only when the target is off screen
        if (!this.onscreen(pos)) {
          this.view.top = { pos, offset: 0 };
          this.view.lineBackward(jumpSindex());
          this.sync();
          this.seam = [];
          markPosClear();
        }

        return;
      }

      pos = line.next;

      if (pos >= this.bf.size) {
        if (wrapped) break;
        wrapped = true;
        pos = 0;
      }
    }

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
      this.view.top = { pos, offset: 0 };
      this.view.lineBackward(jumpSindex());
      this.seam = [];
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
    // where the bottom line ENDS in the file, for og's eof_displayed:
    // -1 when no filter hid anything, so atEof answers on its own
    let bottomNext = -1;

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
            bottomNext = line.next;
            accepted++;
            if (accepted >= limit) pos = line.next;
          }
        }

        // same screen-vs-batch distinction as the seekable branch:
        // accepted lines beyond one screenful keep (END) unlit even
        // when the batch consumed the whole file
        const screenful = Math.max(config.window - 1 - this.padTop, 1);
        atEof = accepted <= screenful && this.nextAccepted(pos) === null;

        // og's soft_eof (forwback.c:310, and its comment: it "can
        // differ from actual EOF if & filtering is in effect"): forw
        // sets it where a read attempt RETURNED EOF, which only
        // happens when the filter leaves forw short of the lines it
        // wanted. A screen the filter fills exactly never attempts
        // that read, so the bottom line is not the end of anything
        // and og prompts ":" with the hidden tail still behind it.
        if (accepted < screenful) session.softEofSeen = true;
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

    // the ONE place the top becomes an index: the renderer still asks
    // for a sub-row plus a remainder, so derive both from the offset
    // here rather than carrying them alongside it, where they could
    // disagree with it
    const topText = forwLine(this.bf, this.view.top.pos)?.text ?? '';
    const topOffset = this.view.top.offset;

    config.subRow = this.view.subRowAt(topText, topOffset);
    config.subShift = topOffset - this.view.rowOffset(topText, config.subRow);

    // the window just renumbered its rows; the seam is offsets into
    // the top's line, so it survives that and is simply re-anchored
    this.publishSeam();
    // scroll moves carry their over-BOF pad; any jump clears it
    if (!this.keepPad) {
      this.padTop = 0;
      this.blankBelow = 0;
    }

    config.blankBelow = this.blankBelow;
    this.keepPad = false;
    config.blankTop = this.padTop;

    calculateEOF(session.content);
    mode.EOF = atEof;

    // og's eof_displayed wants the bottom line to END the file, so a
    // & filter hiding the tail leaves real lines behind it and the
    // prompt stays ":" (forwback.c:76)
    session.filterHidesTail = !!session.lastFilter && bottomNext >= 0 &&
      bottomNext < this.bf.size && !session.softEofSeen;

    // keep the upstream pipe flowing 8MB past the materialized window,
    // paused otherwise, so `yes | lmn` holds bounded spool growth
    this.requestAhead();
  }
}
