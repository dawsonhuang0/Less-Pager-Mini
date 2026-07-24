import fs from 'fs';

import { Actions } from '../interfaces';

import { config, mode } from '../config';

import { session, deriveContent } from '../session';

import { calculateEOF, markPosClear, ringBell } from '../helpers';

import {
  binaryConfirm,
  binFile,
  files,
  onSourceFiles,
} from '../features/files';

import { osc8Links, setSelectedOsc8 } from '../features/osc8';

import { onSourceFollow } from '../features/follow';

import { onSourceTagJump, Tag } from '../features/tags';

import {
  Mark,
  onSourceMarks,
  recordLastPosition,
  subRowStart,
} from '../features/jumping';

import {
  SearchRequest,
  filterLineMask,
  recordSearchMatch,
  scanSearchBatch,
  search,
  searchInterrupted,
} from '../features/searching';

import { consumeInterrupt } from '../keyboard';

import { keyboard } from '../keyboard';

import {
  getSwindow,
  jumpSindex,
  checkModelines,
  hook,
  opt,
  optHeader,
  optHowSearch,
  optNoSearchHeaders,
} from '../options';

import { maxSubRow, transformContent } from '../lines/helpers';

import { CLEAR_LINE, INVERSE_OFF, INVERSE_ON } from '../constants';

import { PipeDecoder } from '../features/charset';

import { BlockFile } from './blockFile';

import { BigView } from './fileView';

import { forwLine, backLine } from './fileLines';

import { PagerInput } from './input';

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

  constructor(
    private bf: BlockFile,
    private fileIndex: number
  ) {
    this.view = new BigView(bf);
    this.activePath = files.list[fileIndex]?.path ?? '';
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
    hook.sourceBytePosition = row => this.sourceActive()
      ? this.positions[row] ?? null
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
    this.seekLine(config.row, false);
    this.sync();
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
      case 'FORCE_LINE_BACKWARD':
        this.backward(count || 1);
        return true;
      case 'FORCE_WINDOW_BACKWARD':
        this.backward(count || getSwindow());
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
        if (count) {
          this.gotoLine(count - 1);
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
        this.view.gotoPercent(Math.min(count, 100));
        this.clampHeader();
        this.sync();
        markPosClear();
        return true;
      case 'GO_POS':
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
          this.view.top = { pos: this.selectedOscPos, subRow: 0 };
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

    this.view.top = { pos: found, subRow: 0 };
    this.view.lineBackward(jumpSindex());
    this.sync();
    recordSearchMatch(Math.max(this.positions.indexOf(found), 0));
    markPosClear();
    return true;
  }

  restoreSearchOrigin(): void {
    if (!this.incrementalOrigin || !this.sourceActive()) return;
    this.view.top = { ...this.incrementalOrigin };
    this.incrementalOrigin = null;
    this.sync();
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
    const moved = session.lastFilter
      ? this.filteredForward(rows, clampAtLastScreen)
      : this.view.lineForward(
        rows,
        clampAtLastScreen ? config.window : undefined
      );

    if (!moved) ringBell('eof');
    if (moved && mode.INIT) mode.INIT = false;
    this.sync();
  }

  private backward(rows: number): void {
    const moved = session.lastFilter
      ? this.filteredBackward(rows)
      : this.fileBackward(rows);
    if (!moved) ringBell('eof');
    if (moved && mode.INIT) mode.INIT = false;
    this.sync();
  }

  /** Moves by file lines while retaining Fable's wrapped sub-row position. */
  private newlineForward(lines: number): void {
    let moved = 0;

    while (moved < lines) {
      const line = forwLine(this.bf, this.view.top.pos);
      if (!line || line.next >= this.bf.size) break;
      const next = session.lastFilter
        ? this.nextAccepted(line.next)
        : line.next;
      if (next === null) break;
      this.view.top = { pos: next, subRow: 0 };
      moved++;
    }

    if (!moved) ringBell('eof');
    this.sync();
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
  private findOsc8(direction: 1 | -1, count: number): void {
    let pos = this.selectedOscPos ?? this.view.top.pos;
    let remaining = Math.max(count, 1);

    if (this.selectedOscPos !== null && direction > 0) {
      pos = forwLine(this.bf, pos)?.next ?? this.bf.size;
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

    setSelectedOsc8(null);
    this.selectedOscPos = null;
    search.message = 'No OSC8 links found';
  }

  private selectOsc8(
    pos: number,
    link: ReturnType<typeof osc8Links>[number]
  ): void {
    this.selectedOscPos = pos;
    this.view.top = { pos, subRow: 0 };
    this.sync();
    setSelectedOsc8({
      ...link,
      row: Math.max(this.positions.indexOf(pos), 0),
    });
    markPosClear();
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

        atEof = this.nextAccepted(pos) === null;
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

      atEof = visible.rows.length === 0 || this.view.atEof;
    }

    // An empty file still has one display line in the array-backed core.
    if (!raw.length) raw.push('');

    session.fullContent = raw;
    session.content = deriveContent();

    // transformContent may squeeze blank header rows; measure the same
    // prefix rather than assuming raw and display indexes are identical.
    const displayBody = transformContent(raw.slice(0, bodyStart)).length;
    this.positions = positions;
    config.row = Math.min(displayBody, Math.max(session.content.length - 1, 0));
    config.subRow = this.view.top.subRow;
    config.blankTop = 0;

    calculateEOF(session.content);
    mode.EOF = atEof;
  }
}
