import fs from 'fs';

import { ringBell, markPosClear, markFullRepaint } from "../helpers";
import { maxSubRow, isAscii, isStyled } from "../lines/helpers";

import { getLayout } from "../lines/lineLayout";

import { config, mode } from "../state/config";

import { search } from "./searching";

import { files, lineBase, byteBase } from "./files";

import { prChar, chopLine, jumpSindex, optHeader, optShowAttn, optWordwrap,
  optPermaMarks, optAutosaveAction, hook } from "../options";

import { saveHistory, touchMarks } from "../startup/histfile";

/**
 * Jumps to line `lineNum` in the content, placing it at the top of the
 * screen (`g`, `<`, `ESC-<`).
 *
 * - Reports an error like less when the line does not exist.
 *
 * @param content - Full content lines.
 * @param lineNum - 1-based target line number, or 0 when none was given.
 */
export function firstLine(content: string[], lineNum: number): void {
  // recycled pipe data cannot be sought again, like og's discarded
  // buffers failing ch_seek
  const base = lineBase();

  // og's jump_back for line 1 with the beginning recycled: land on
  // the earliest retained data (ch_beg_seek) and still report it
  if (base > 0 && lineNum <= 1) {
    jumpLoc(content, 0, 0, lineNum > 0 ? jumpSindex() : 0);
    search.message = 'Cannot seek to beginning of file';
    return;
  }

  if (lineNum > 1 && lineNum <= base) {
    search.message = `Cannot seek to line number ${lineNum}`;
    return;
  }

  if (lineNum - base > content.length) {
    search.message = `Cannot seek to line number ${lineNum}`;
    return;
  }

  // like A_GOLINE: without a number the -j target is ignored, so no
  // blank lines appear before the beginning of the file
  const sindex = lineNum > 0 ? jumpSindex() : 0;

  jumpLoc(content, Math.max(lineNum - base, 1) - 1, 0, sindex);
}

/**
 * Jumps to the end of the content, placing the last line at the bottom of
 * the screen (`G`, `>`, `ESC->`).
 *
 * - With a number, behaves exactly like `firstLine` (as in less).
 * - Rings the bell when already at the end.
 *
 * @param content - Full content lines.
 * @param lineNum - 1-based target line number, or 0 to jump to the end.
 * @returns True when jump_forw's end jump ran (past its eof_bell) —
 *   the caller decides whether it was og's pos_clearing G or the
 *   buffered F entry.
 */
export function lastLine(content: string[], lineNum: number): boolean {
  if (lineNum > 0) {
    firstLine(content, lineNum);
    return false;
  }

  const pad = endPad(content);

  if (config.row === config.endRow && config.subRow === config.endSubRow &&
      config.blankTop === pad) {
    ringBell('eof');
    return false;
  }

  // jump_forw records the last position unconditionally
  recordLastPosition();
  setTop(config.endRow, config.endSubRow);
  config.blankTop = pad;
  return true;
}

/**
 * Null rows above BOF for an end jump on short content, like jump_loc's
 * back-walk from the last line hitting BOF and handing the remainder to
 * forw as blank lines at the top of the screen (jump.c:316): G and F
 * bottom-anchor a file shorter than the window under a run of tildes.
 */
export function endPad(content: string[]): number {
  const cap = config.window - 1;
  let rows = 0;

  for (const line of content) {
    rows += maxSubRow(line) + 1;
    if (rows >= cap) return 0;
  }

  return cap - rows;
}

/**
 * Jumps `percent` percent into the content, placing the target line at the
 * top of the screen (`p`, `%`).
 *
 * - Percentages above 100 are clamped to 100, like less.
 * - 100 percent lands on the last line, not past it.
 *
 * @param content - Full content lines.
 * @param percent - Percentage into the content, 0 for the beginning.
 */
export function percentLine(content: string[], percent: number): void {
  if (percent > 100) percent = 100;

  // round half to even, like less's percent_pos/umuldiv
  const scaled = content.length * percent;
  let row = Math.floor(scaled / 100);
  const rem = scaled % 100;
  if (rem > 50 || (rem === 50 && row % 2 === 1)) row++;

  jumpToRow(content, Math.min(row, content.length - 1));
}

/**
 * Jumps to a byte offset in the content (`P`), like less's jump_pos:
 * the line containing the offset lands on the -j target line.
 *
 * @param content - Full content lines.
 * @param offset - Byte offset, 0 for the beginning.
 */
export function goPos(content: string[], offset: number): void {
  // recycled pipe data cannot be sought again, like og's ch_seek
  // failing on a discarded block
  offset -= byteBase();

  if (offset < 0) {
    search.message = 'Cannot seek to that file position';
    return;
  }

  let row = 0;
  let bytes = 0;

  while (row + 1 < content.length) {
    const next = bytes + Buffer.byteLength(content[row]) + 1;
    if (next > offset) break;

    bytes = next;
    row++;
  }

  jumpLoc(content, row, 0, jumpSindex());
}

/**
 * Custom bracket command state (`ESC-^F` / `ESC-^B`): collects the two
 * characters naming the open and close bracket, like less's `Brackets: `
 * prompt.
 */
export const brackets = {
  pending: '' as '' | 'f' | 'b',
  chars: '',
  n: 1,
};

/**
 * Opens the `Brackets: ` prompt for a custom bracket pair.
 *
 * @param forward - True for `ESC-^F` (find close), false for `ESC-^B`.
 * @param n - N-th reference bracket to match.
 */
export function startBrackets(forward: boolean, n: number): void {
  brackets.pending = forward ? 'f' : 'b';
  brackets.chars = '';
  brackets.n = n;
}

/**
 * Collects the two custom bracket characters, then runs the match.
 *
 * - `^C` or any ESC sequence cancels the prompt.
 *
 * @param content - Full content lines.
 * @param key - Raw key input following `ESC-^F` / `ESC-^B`.
 */
type BracketFinder = (
  open: string,
  close: string,
  forward: boolean,
  n: number
) => boolean;

export function bracketsKey(
  content: string[],
  key: string,
  finder: BracketFinder | null = null
): void {
  if (key === '\x03' || key.startsWith('\x1B')) {
    brackets.pending = '';
    return;
  }

  brackets.chars += key[0];
  if (brackets.chars.length < 2) return;

  const forward = brackets.pending === 'f';
  brackets.pending = '';

  if (!finder?.(
    brackets.chars[0],
    brackets.chars[1],
    forward,
    brackets.n
  )) {
    matchBracket(
      content,
      brackets.chars[0],
      brackets.chars[1],
      forward,
      brackets.n
    );
  }
}

/**
 * Bracket matching, ported from less's match_brac (brac.c).
 *
 * - Forward: finds the n-th `open` in the top displayed line, scans forward
 *   counting nesting, and places the line holding the matching `close` on
 *   the bottom line of the screen.
 * - Backward: finds the n-th `close` in the bottom displayed line, scans
 *   backward, and places the line holding the matching `open` on top.
 * - Reference scans start at the first displayed character (mid-line when
 *   the top/bottom row shows a wrapped chunk) and run to the line's end.
 *
 * @param content - Full content lines.
 * @param open - Open bracket character.
 * @param close - Close bracket character.
 * @param forward - Scan direction.
 * @param n - N-th reference bracket in the reference line.
 */
export function matchBracket(
  content: string[],
  open: string,
  close: string,
  forward: boolean,
  n: number
): void {
  // a blank-padded top row has no position in less (position(TOP) is null)
  if (forward && config.blankTop) {
    search.message = 'Nothing in top line';
    return;
  }

  const start = forward
    ? { row: config.row, subRow: config.subRow }
    : bottomPosition(content);

  if (!start) {
    search.message = 'Nothing in bottom line';
    return;
  }

  const ref = forward ? open : close;
  const line = content[start.row];
  let i = subRowStart(line, start.subRow);

  for (; i < line.length; i++) {
    if (line[i] === ref && --n === 0) break;
  }

  if (i >= line.length) {
    search.message = `No bracket in ${forward ? 'top' : 'bottom'} line`;
    return;
  }

  let nest = 0;

  if (forward) {
    for (let r = start.row, j = i + 1; r < content.length; r++, j = 0) {
      const curr = content[r];

      for (; j < curr.length; j++) {
        if (curr[j] === open) {
          nest++;
        } else if (curr[j] === close && --nest < 0) {
          jumpLoc(content, r, 0, config.window - 2);
          return;
        }
      }
    }
  } else {
    for (let r = start.row, j = i - 1; r >= 0; r--, j = Infinity) {
      const curr = content[r];

      for (j = Math.min(j, curr.length - 1); j >= 0; j--) {
        if (curr[j] === close) {
          nest++;
        } else if (curr[j] === open && --nest < 0) {
          jumpLoc(content, r, 0, 0);
          return;
        }
      }
    }
  }

  search.message = 'No matching bracket';
}

/**
 * Returns the raw string index where a wrapped sub-row starts.
 *
 * @param line - The raw content line.
 * @param subRow - Wrapped sub-row index.
 */
/**
 * Advances the top over the rows a backward move uncovered, treating
 * the anchor as a row boundary.
 *
 * og's forw() generates each row from the current bottom and
 * add_forw_pos drops table[0] (position.c:63), so moving forward
 * walks the entries the backward moves prepended - the last of which
 * ends AT the anchor - before the grid below resumes. Returns the
 * rows it consumed.
 */
/**
 * og's pos_rehead (position.c): every horizontal shift command moves
 * table[TOP] back to the BEGINNING of its line first - LSHIFT,
 * RSHIFT, LLSHIFT, RRSHIFT and the horizontal wheel all call it
 * (command.c:1740, :1754, :2459, :2473, :2483, :2493) - and trashes
 * the screen, so the repaint regenerates from there. A top already on
 * a line start is left alone ("if (linepos == tpos) return").
 *
 * The move is permanent: shifting right and back left again leaves
 * the screen at the line's start, not where it was.
 */
export function posRehead(): void {
  if (config.subRow === 0 && config.subShift === 0) return;

  config.subRow = 0;
  config.subShift = 0;
  config.screen = [];
  hook.reheadSource?.();
}

export function subRowStart(line: string, subRow: number): number {
  if (subRow === 0) return 0;

  // --wordwrap boundaries live in the layout, even for plain lines
  if (!optWordwrap() && !isStyled(line) && isAscii(line)) {
    return subRow * config.screenWidth;
  }

  const layout = getLayout(line);
  const cluster = layout.rowStart[subRow];

  let index = 0;
  for (let c = 0; c < cluster; c++) index += layout.chars[c].length;

  for (let k = 0; k < layout.codeIdx.length; k++) {
    if (layout.codeIdx[k] > cluster) break;
    index += layout.codes[k].length;
  }

  return index;
}

/**
 * Returns the sub-row whose range contains a raw string index; an
 * index exactly on a wrap boundary belongs to the sub-row it starts.
 */
export function subRowOfIndex(line: string, index: number): number {
  let sub = maxSubRow(line);
  while (sub > 0 && subRowStart(line, sub) > index) sub--;
  return sub;
}

/**
 * A marked position: a content position plus the 1-based screen line it
 * occupied, like less's scrpos, and the file it belongs to (m_ifile).
 */
export interface Mark {
  file: number;
  row: number;
  subRow: number;
  sline: number;
  /** Seekable inputs retain og's byte POSITION across window changes. */
  pos?: number;
}

const MARK_LETTER_REGEX = /^[a-zA-Z#]$/;

/**
 * Shifts user marks after the front of a streaming pipe is recycled,
 * like og's positions inside discarded buffers becoming unreadable:
 * marks above the cut are lost.
 *
 * @param drop - Display rows removed from the front.
 */
export function shiftMarkRows(drop: number): void {
  if (drop <= 0) return;

  for (const [char, mark] of userMarks) {
    if (mark.row < drop) {
      userMarks.delete(char);
    } else {
      mark.row -= drop;
    }
  }
}

const userMarks = new Map<string, Mark>();

// the "last mark" addressed by the apostrophe (less's LASTMARK)
let quoteMark: Mark | null = null;

/**
 * A mark restored from the history file (less's file_marks): the mark
 * letter, its screen line, byte position and file name.
 */
export interface FileMark {
  char: string;
  sline: number;
  pos: number;
  path: string;
}

let fileMarks: FileMark[] = [];

/** Stores marks parsed from the history file's `.mark` section. */
export function setFileMarks(restored: FileMark[]): void {
  fileMarks = restored;
}

/** The history-file marks, re-saved and merged by saveHistory. */
export function getFileMarks(): FileMark[] {
  return fileMarks;
}

/**
 * Rebinds mark file indexes around a file-list splice: og marks hold
 * stable IFILEs, ours hold list indexes. A removal drops that file's
 * marks like og's unmark(ifile); an insertion shifts the rest.
 *
 * @param at - The splice position.
 * @param delta - +1 for an insertion, -1 for a removal.
 */
export function marksFileSpliced(at: number, delta: 1 | -1): void {
  const adjust = (mark: Mark): Mark | null => {
    if (delta < 0 && mark.file === at) return null;
    if (mark.file >= at + (delta < 0 ? 1 : 0)) {
      return { ...mark, file: mark.file + delta };
    }
    return mark;
  };

  for (const [char, mark] of [...userMarks]) {
    const next = adjust(mark);
    if (next) userMarks.set(char, next);
    else userMarks.delete(char);
  }

  if (quoteMark) quoteMark = adjust(quoteMark);
}

/** Removes a restored mark, like clrmark clearing file_marks "so
 *  save_marks doesn't save it to history file". */
function dropFileMark(char: string): void {
  fileMarks = fileMarks.filter(f => f.char !== char);
}

/** Canonical file name, like og's lrealpath (falls back unchanged). */
export function realPath(path: string): string {
  try {
    return fs.realpathSync(path);
  } catch {
    return path;
  }
}

// file-switch hooks for cross-file marks, registered by the pager to
// avoid a module cycle with commands.ts
let markSwitchHook: (mark: Mark, sline: number) => void = () => {};
let markEditHook: (path: string, char: string, sline: number) => void =
  () => {};

interface SourceMarkHooks {
  position(row: number, subRow: number): number | null;
  linePosition(line: number): number | null | undefined;
  jump(mark: Mark, sline: number): boolean;
}

let sourceMarkHooks: SourceMarkHooks | null = null;

/** Registers the active seekable input's byte-position mark operations. */
export function onSourceMarks(hooks: SourceMarkHooks | null): void {
  sourceMarkHooks = hooks;
}

/** Registers gomark's edit_ifile paths: switching to an open entry's
 *  mark, and opening a restored mark's file by name. */
export function onMarkSwitch(
  switchFn: (mark: Mark, sline: number) => void,
  editFn: (path: string, char: string, sline: number) => void
): void {
  markSwitchHook = switchFn;
  markEditHook = editFn;
}

/** Lists the active user marks, for --save-marks persistence. */
export function allMarks(): { char: string, mark: Mark }[] {
  const all = [...userMarks].map(([char, mark]) => ({ char, mark }));

  // og's save_marks loop covers LASTMARK: the ' position persists
  // and '' works across sessions
  if (quoteMark) all.push({ char: "'", mark: quoteMark });

  return all;
}

/**
 * Applies history-file marks to a freshly examined file, converting
 * byte positions back to rows, like less resolving file_marks.
 *
 * @param index - The examined entry's index in the file list.
 * @param lines - The file's content lines.
 */
export function adoptFileMarks(index: number, lines: string[]): void {
  const path = files.list[index]?.path;
  if (!path || path === '-') return;

  // og's mark_check_ifile compares canonical names (lrealpath vs
  // get_real_filename): a mark saved absolute binds to a relative open
  const real = realPath(path);

  for (const restored of fileMarks) {
    if (realPath(restored.path) !== real) continue;

    // restored marks never displace one set this session (og: an
    // active cmark cleared m_filename, so mark_check_ifile skips it)
    if (restored.char === "'" ? quoteMark !== null
      : userMarks.has(restored.char)) {
      continue;
    }

    let bytes = 0, row = 0;

    while (row < lines.length - 1 && bytes < restored.pos) {
      bytes += Buffer.byteLength(lines[row]) + 1;
      if (bytes > restored.pos) break;
      row++;
    }

    const mark = {
      file: index,
      row,
      subRow: 0,
      sline: restored.sline,
      pos: restored.pos,
    };

    // the restored LASTMARK lands in the ' slot, like restore_mark
    // filling marks[LASTMARK]: '' works across sessions
    if (restored.char === "'") {
      quoteMark = mark;
    } else {
      userMarks.set(restored.char, mark);
    }
  }
}

/**
 * Mark command state: which prompt is open (`set mark: `, `goto mark: `,
 * `clear mark: `) and the captured N prefix.
 */
export const marks = {
  pending: '' as '' | 'm' | 'M' | "'" | 'c',
  n: 0,
};

/**
 * Opens the `set mark: ` prompt (`m`, `M`).
 *
 * - Silently ignored on the help screen, like less.
 *
 * @param bottom - True to mark the bottom displayed line (`M`).
 * @param n - Line number to mark instead of the screen position.
 */
export function startSetMark(bottom: boolean, n: number): void {
  if (mode.HELP) return;

  marks.pending = bottom ? 'M' : 'm';
  marks.n = n;
}

/**
 * Opens the `goto mark: ` prompt (`'`, `^X^X`).
 *
 * @param n - Screen line to place the mark on, overriding the stored one.
 */
export function startGoMark(n: number): void {
  marks.pending = "'";
  marks.n = n;
}

/**
 * Opens the `clear mark: ` prompt (`ESC-m`).
 */
export function startClearMark(): void {
  marks.pending = 'c';
  marks.n = 0;
}

/**
 * Returns the letter of a user mark on a content row of the current
 * file, for the -J status column, or an empty string.
 *
 * @param row - Content row to look up.
 */
export function markAtRow(row: number): string {
  const pos = sourceMarkHooks?.position(row, 0);

  for (const [char, mark] of userMarks) {
    if (mark.file !== files.index) continue;
    if (pos !== null && pos !== undefined && mark.pos === pos) return char;
    if (mark.pos === undefined && mark.row === row) return char;
  }

  return '';
}

/**
 * Forgets all marks and closes any mark prompt.
 */
export function resetMarks(): void {
  userMarks.clear();
  quoteMark = null;
  marks.pending = '';
  marks.n = 0;
}

/**
 * Handles the character following a mark command.
 *
 * - Erase and newline characters cancel silently, like less; `^C` and ESC
 *   sequences cancel by this pager's prompt convention.
 *
 * @param content - Full content lines.
 * @param key - Raw key input following the mark command.
 */
export function marksKey(content: string[], key: string): void {
  const pending = marks.pending;
  marks.pending = '';

  // og's getcc returns 0 when an interrupt cleared it, and A_SETMARK
  // hands that to setmark, so og answers ^C here with "Invalid mark
  // letter ^@" rather than cancelling. Reproducing it needs more than
  // the letter: og's trashed-screen repaint runs BEFORE the message
  // and draws no rows at all, because the pending S_INTERRUPT aborts
  // forw()'s paint loop through ABORT_SIGS. Not modelled; we cancel.
  if (key === '\x03' || key.startsWith('\x1B')) return;

  const char = key[0];

  if (
    char === '\x08' || char === '\x7F' ||
    char === '\x0D' || char === '\x0A'
  ) {
    return;
  }

  if (pending === 'm' || pending === 'M') {
    setMark(content, char, pending === 'M', marks.n);
  } else if (pending === "'") {
    goMark(content, char, marks.n);
    return;
  } else if (pending === 'c') {
    clearMark(char);
  }

  // og's A_SETMARK and A_CLRMARK both end in repaint() (command.c:2374,
  // :2386) - pos_clear plus jump_loc from the top, so the screen is
  // redrawn whole behind the skipping marker even though nothing moved.
  // Only the erase/newline keys break out before it, and A_GOMARK has
  // no repaint at all. We redrew the prompt row alone.
  //
  // setmark's own error() comes FIRST and blocks in get_return, so a
  // rejected mark letter shows its message over the old screen and
  // the repaint runs when the RETURN dismisses it
  if (search.message) markFullRepaint();
  else markPosClear();
}

/**
 * Stores a mark at the top or bottom displayed line, or at line N.
 *
 * @param content - Full content lines.
 * @param char - Mark letter.
 * @param bottom - True to mark the bottom displayed line.
 * @param lineNum - 1-based line to mark instead, or 0.
 */
function setMark(
  content: string[],
  char: string,
  bottom: boolean,
  lineNum: number
): void {
  if (!MARK_LETTER_REGEX.test(char)) {
    search.message = `Invalid mark letter ${prChar(char)}`;
    return;
  }

  const numberedPos = lineNum > 0
    ? sourceMarkHooks?.linePosition(lineNum)
    : undefined;

  if (lineNum > content.length && numberedPos === undefined) {
    search.message = `Cannot find line number ${lineNum}`;
    return;
  }

  if (numberedPos === null) {
    search.message = `Cannot find line number ${lineNum}`;
    return;
  }

  let mark: Mark;

  if (lineNum) {
    mark = {
      file: files.index,
      row: Math.min(lineNum - 1, Math.max(content.length - 1, 0)),
      subRow: 0,
      sline: bottom ? config.window - 1 : 1,
      pos: numberedPos,
    };
  } else {
    mark = bottom ? lastVisiblePosition(content) : {
      file: files.index,
      row: config.row,
      subRow: config.subRow,
      sline: config.blankTop + 1,
    };
  }

  if (mark.pos === undefined) {
    const pos = sourceMarkHooks?.position(mark.row, mark.subRow);
    if (pos !== null && pos !== undefined) mark.pos = pos;
  }
  userMarks.set(char, mark);

  // og's setmark raises marks_modified BEFORE its autosave check, so
  // the very first m of a session writes immediately (unlike search
  // history's cmd_accept ordering)
  touchMarks();
  if (optPermaMarks() && optAutosaveAction('m')) saveHistory();
}

/**
 * Jumps to a mark, restoring it to the screen line it was stored with.
 *
 * - `^` and `$` are the predefined beginning/end marks; `.`, `:` and `;`
 *   are the current top and bottom lines; `'` is the previous position.
 *
 * @param content - Full content lines.
 * @param char - Mark letter.
 * @param sline - 1-based screen line override from an N prefix, or 0.
 */
function goMark(content: string[], char: string, sline: number): void {
  let mark: Mark | undefined;

  switch (char) {
    case '^':
      mark = { file: files.index, row: 0, subRow: 0, sline: 0, pos: 0 };
      break;

    case '$': {
      const row = content.length - 1;
      const subRow = chopLine() || config.col
        ? 0
        : maxSubRow(content[row]);
      mark = {
        file: files.index,
        row,
        subRow,
        sline: config.window - 1,
        pos: Number.MAX_SAFE_INTEGER,
      };
      break;
    }

    case '.':
    case ':':
      mark = {
        file: files.index,
        row: config.row,
        subRow: config.subRow,
        sline: config.blankTop + 1,
      };
      mark.pos = sourceMarkHooks?.position(mark.row, mark.subRow) ?? undefined;
      break;

    case ';':
      mark = lastVisiblePosition(content);
      break;

    case "'":
      // marks reference the main content, unreachable from the help screen
      if (mode.HELP) {
        ringBell();
        return;
      }

      // og's gomark sets an unset last mark to ch_zero() at jump_sline
      // (mark.c:340) -- POSITION zero, the beginning of the file. Ours
      // built a synthetic row 0 and let the code below fill its
      // position in from the window, where row 0 is the current top:
      // after any scrolling `''` jumped to where it already was
      mark = quoteMark ?? {
        file: files.index,
        row: 0,
        subRow: 0,
        sline: jumpSindex() + 1,
        pos: 0,
      };
      break;

    default:
      if (!MARK_LETTER_REGEX.test(char)) {
        search.message = `Invalid mark letter ${char}`;
        return;
      }

      if (mode.HELP) {
        ringBell();
        return;
      }

      mark = userMarks.get(char);

      if (!mark) {
        // og's restored marks live by filename until requested:
        // gomark's mark_get_ifile + edit_ifile open the file
        const restored = fileMarks.find(f => f.char === char);

        if (restored) {
          markEditHook(restored.path, char, sline);
          return;
        }

        search.message = 'Mark not set';
        return;
      }
  }

  if (mark.pos === undefined && mark.file === files.index) {
    mark.pos = sourceMarkHooks?.position(mark.row, mark.subRow) ?? undefined;
  }

  if (mark.file !== files.index) {
    // og's gomark edits the mark's file (edit_ifile) and jumps there;
    // "Mark not in current file" belongs to markpos (the | command)
    markSwitchHook(mark, sline);
    return;
  }

  jumpToMark(content, mark, sline);
}

/**
 * Lands a resolved mark on its screen line, gomark's jump_loc tail.
 */
export function jumpToMark(
  content: string[],
  mark: Mark,
  sline: number,
  fresh: boolean = false
): void {
  if (mark.pos !== undefined && sourceMarkHooks?.jump(mark, sline)) return;

  if (mark.row >= content.length) {
    search.message = 'Cannot seek to that file position';
    return;
  }

  // the stored sub-row may be stale after a resize
  const subRow = chopLine() || config.col
    ? 0
    : Math.min(mark.subRow, maxSubRow(content[mark.row]));

  // clip like sindex_from_sline: 1 .. window-1, then to 0-based
  const line = sline || mark.sline;
  const sindex = Math.min(Math.max(line, 1), config.window - 1) - 1;

  jumpLoc(content, mark.row, subRow, sindex, fresh);
}

/**
 * Finishes a cross-file gomark once its file is open: the mark should
 * have been adopted by the open (mark_check_ifile).
 */
export function jumpToUserMark(
  content: string[],
  char: string,
  sline: number
): void {
  const mark = userMarks.get(char);

  if (!mark || mark.file !== files.index) {
    search.message = 'Mark not set';
    return;
  }

  jumpToMark(content, mark, sline, true);
}

/**
 * Clears a user mark (`ESC-m`).
 *
 * - Rings the bell when the mark is not set, like less.
 *
 * @param char - Mark letter.
 */
function clearMark(char: string): void {
  if (!MARK_LETTER_REGEX.test(char)) {
    search.message = `Invalid mark letter ${char}`;
    return;
  }

  // og's clrmark clears file_marks too - without this the restored
  // copy resurrects the cleared mark at the next write
  const restored = fileMarks.length;
  dropFileMark(char);

  if (!userMarks.delete(char) && fileMarks.length === restored) {
    ringBell();
    return;
  }

  // og's clrmark autosaves the history file too (--save-marks with
  // an 'm' autosave action)
  touchMarks();
  if (optPermaMarks() && optAutosaveAction('m')) saveHistory();
}

/**
 * Places a target on a screen row with less's jump_loc semantics.
 *
 * - A target already sitting on its destination screen row rings the bell
 *   and moves nothing (back(0) hitting eof_bell in less).
 * - The previous position is recorded only on the full-repaint paths;
 *   the on-screen scroll and both "Surprise!" close-enough branches of
 *   jump_loc skip lastmark, so short jumps are not remembered by `''`.
 *
 * @param content - Full content lines.
 * @param row - Target row.
 * @param subRow - Target sub-row.
 * @param sindex - 0-based screen row to place the target on.
 */
export function jumpLoc(
  content: string[],
  row: number,
  subRow: number,
  sindex: number,
  fresh: boolean = false
): void {
  // a jump above the pinned header lands at their start, like less's
  // jump_loc clamping the target through after_header_pos
  const header = optHeader();

  if (header.lines > 0 && row < header.start) {
    row = header.start;
    subRow = 0;
  }

  // og's edit_ifile trashes the screen: a jump right after a file
  // switch never takes the already-there bell shortcut
  if (!fresh && targetScreenRow(content, row, subRow) === sindex) {
    ringBell('eof');
    return;
  }

  // jump_loc sets the -w attn position on the landing line; the
  // --hilite-target highlight follows the target screen row instead
  config.attnRow = optShowAttn() ? row : -1;

  saveLastPosition(content, row, subRow, sindex);
  placeAt(content, row, subRow, sindex);
}

/**
 * Resolves a mark character to its content row for the `|` command,
 * like less's markpos.
 *
 * @param content - Full content lines.
 * @param char - Mark letter or predefined mark.
 * @returns The row, or null with a message set.
 */
export function markRow(content: string[], char: string): number | null {
  switch (char) {
    case '^': return 0;
    case '$': return content.length - 1;
    case '.': case ':': return config.row;
    case ';': return lastVisiblePosition(content).row;
  }

  let mark: Mark | undefined;

  if (char === "'") {
    // markpos has no ch_zero() fallback -- that one belongs to gomark.
    // An unset LASTMARK still has m_ifile == NULL_IFILE, so markpos's
    // "not in current file" test fires and the pipe aborts (mark.c:376)
    if (!quoteMark) {
      search.message = 'Mark not in current file';
      return null;
    }

    mark = quoteMark;
  } else {
    if (!MARK_LETTER_REGEX.test(char)) {
      search.message = `Invalid mark letter ${char}`;
      return null;
    }

    mark = userMarks.get(char);

    if (!mark) {
      search.message = 'Mark not set';
      return null;
    }
  }

  if (mark.file !== files.index) {
    search.message = 'Mark not in current file';
    return null;
  }

  return Math.min(mark.row, content.length - 1);
}

/**
 * A line number as a byte POSITION, like less's find_pos -- which is
 * what get_pipe_pos returns for its `|line number: ` entry.
 *
 * @param lineNum - 1-based line number.
 * @returns The position, or undefined when this input has none.
 */
export function linePos(lineNum: number): number | null | undefined {
  return sourceMarkHooks?.linePosition(lineNum);
}

/**
 * Resolves a mark character to its byte POSITION, like less's markpos.
 *
 * og's marks ARE positions: a mark holds an scrpos, and markpos hands
 * pipe_pos the raw m_scrpos.pos. Ours hold a local row as well, and a
 * row is only meaningful while the window that produced it is still
 * mapped -- once it slides, the same row names different bytes. Every
 * caller that compares one mark against another (the pipe) has to work
 * in positions for that reason.
 *
 * @param content - Full content lines.
 * @param char - Mark letter or predefined mark.
 * @returns The byte position, or undefined when this input has none.
 */
export function markPos(
  content: string[],
  char: string
): number | undefined {
  if (!hook.sourceBytePosition) return undefined;

  // og's position(sindex) indexes the SCREEN: TOP is row 0 and BOTTOM
  // is sc_height-2, so on a wrapped line both are bytes INSIDE a line.
  // sourceRowByte is that table; the content row is the fallback.
  const screenByte = (sindex: number, row: number): number | undefined => {
    const byRow = hook.sourceRowByte?.(sindex);
    if (byRow !== undefined && byRow !== null) return byRow;
    return hook.sourceBytePosition?.(row) ?? undefined;
  };

  switch (char) {
    // ch_zero()
    case '^': return 0;

    // og seeks to the end and backs up a line. The byte before EOF is
    // the same pipe range: pipe_data copies through its argument and
    // then finishes the line, so both spellings reach EOF.
    case '$': {
      const end = hook.sourceBytePosition(content.length);
      if (end === null || end === undefined) return undefined;
      return Math.max(end - 1, 0);
    }

    case '.': case ':': return screenByte(0, config.row);
    case ';': return screenByte(
      config.window - 2, lastVisiblePosition(content).row);
  }

  const mark = char === "'" ? quoteMark : userMarks.get(char);

  // markpos reports "Mark not in current file" and returns
  // NULL_POSITION; the caller has already reported through markRow, so
  // an unusable mark just falls back to the row path here.
  if (!mark || mark.file !== files.index) return undefined;
  return mark.pos;
}

/**
 * Records the current position into the quote mark when a jump takes one
 * of less's full-repaint paths, mirroring which jump_loc branches call
 * lastmark.
 *
 * @param content - Full content lines.
 * @param row - Target row of the jump.
 * @param subRow - Target sub-row of the jump.
 * @param sindex - 0-based screen row the target will be placed on.
 */
function saveLastPosition(
  content: string[],
  row: number,
  subRow: number,
  sindex: number
): void {
  const screenRow = targetScreenRow(content, row, subRow);

  // displayed targets are reached by scrolling, without lastmark
  if (screenRow !== null) return;

  const chop = chopLine() || config.col;
  const topSubRow = chop ? 0 : config.subRow;

  if (row < config.row || (row === config.row && subRow < topSubRow)) {
    // above the top: the backward walk reaches the screen within
    // sc_height-1 lines and scrolls silently; farther targets repaint
    const up = displayDistance(
      content, row, subRow, config.row, topSubRow, config.window
    );

    if (sindex + up > config.window - 2) recordLastPosition();
    return;
  }

  // below the screen: within sindex-1 lines of the first undisplayed
  // line, jump_loc scrolls forward silently; farther targets repaint
  const down = displayDistance(
    content, config.row, topSubRow, row, subRow, 2 * config.window
  ) - (config.window - 1 - config.blankTop);

  if (down > sindex - 1) recordLastPosition();
}

/**
 * Returns the screen row a content position is displayed on, or null when
 * it is not displayed.
 *
 * @param content - Full content lines.
 * @param row - Content row.
 * @param subRow - Sub-row within the row.
 */
function targetScreenRow(
  content: string[],
  row: number,
  subRow: number
): number | null {
  const topSubRow = chopLine() || config.col ? 0 : config.subRow;

  if (row < config.row || (row === config.row && subRow < topSubRow)) {
    return null;
  }

  const screenRow = config.blankTop + displayDistance(
    content, config.row, topSubRow, row, subRow, config.window
  );

  return screenRow <= config.window - 2 ? screenRow : null;
}

/**
 * Counts display rows between two content positions, capped for early
 * exit on far distances.
 *
 * @param content - Full content lines.
 * @param fromRow - Earlier position row.
 * @param fromSubRow - Earlier position sub-row.
 * @param toRow - Later position row.
 * @param toSubRow - Later position sub-row.
 * @param cap - Stop counting past this many rows.
 */
function displayDistance(
  content: string[],
  fromRow: number,
  fromSubRow: number,
  toRow: number,
  toSubRow: number,
  cap: number
): number {
  if (chopLine() || config.col) {
    return Math.min(toRow - fromRow, cap);
  }

  let distance = 0;
  let row = fromRow;
  let subRow = fromSubRow;

  while (row < toRow && distance <= cap) {
    distance += maxSubRow(content[row]) - subRow + 1;
    row++;
    subRow = 0;
  }

  return Math.min(distance + (row === toRow ? toSubRow - subRow : 0), cap);
}

/**
 * Saves the current top position as the previous position (`''`).
 *
 * - Refused on the help screen, like less's lastmark.
 * - Also called when entering the help screen: less's edit_ifile records
 *   the last position whenever it leaves the current file (edit.c).
 */
export function recordLastPosition(): void {
  if (mode.HELP) return;

  // og's lastmark raises marks_modified: nearly any jump dirties
  // the history file, so og rewrites it at quit
  touchMarks();

  quoteMark = {
    file: files.index,
    row: config.row,
    subRow: config.subRow,
    sline: config.blankTop + 1,
  };

  quoteMark.pos = sourceMarkHooks?.position(
    quoteMark.row,
    quoteMark.subRow
  ) ?? undefined;
}

/**
 * Resolves the content position shown on the bottom line of the screen.
 *
 * @param content - Full content lines.
 * @returns The bottom row and sub-row, or null when the bottom line is
 *          past the end of the content.
 */
function bottomPosition(
  content: string[]
): { row: number, subRow: number } | null {
  let steps = config.window - 2 - config.blankTop;

  if (chopLine() || config.col) {
    const row = config.row + steps;
    return row < content.length ? { row, subRow: 0 } : null;
  }

  let row = config.row;
  let subRow = config.subRow;

  while (steps > 0) {
    const currMaxSubRow = maxSubRow(content[row]);

    if (subRow + steps <= currMaxSubRow) {
      subRow += steps;
      break;
    }

    steps -= currMaxSubRow - subRow + 1;

    row++;
    subRow = 0;

    if (row >= content.length) return null;
  }

  return { row, subRow };
}

/**
 * Resolves the last non-empty displayed position and its screen line,
 * like less's get_scrpos(BOTTOM) scanning up past rows beyond EOF.
 *
 * @param content - Full content lines.
 */
/**
 * Sets the mouse mark `#` at a clicked screen line (0-based), like
 * og's mouse_button_left calling setmark('#', y, 0).
 */
export function setMouseMark(content: string[], y: number): void {
  const steps = Math.max(y - config.blankTop, 0);
  let row = config.row;
  let subRow = config.subRow;

  if (chopLine() || config.col) {
    row = Math.min(row + steps, content.length - 1);
    subRow = 0;
  } else {
    for (let s = 0; s < steps; s++) {
      if (subRow < maxSubRow(content[row])) {
        subRow++;
      } else if (row < content.length - 1) {
        row++;
        subRow = 0;
      } else {
        break;
      }
    }
  }

  userMarks.set('#', {
    file: files.index,
    row,
    subRow,
    sline: y + 1,
  });
}

/**
 * Jumps to the mouse mark, like mouse_button_right's gomark('#', 0).
 */
export function goMouseMark(content: string[]): void {
  goMark(content, '#', 0);
}

function lastVisiblePosition(content: string[]): Mark {
  let steps = config.window - 2 - config.blankTop;

  if (chopLine() || config.col) {
    const row = Math.min(config.row + steps, content.length - 1);
    return {
      file: files.index,
      row,
      subRow: 0,
      sline: config.blankTop + 1 + (row - config.row),
    };
  }

  let row = config.row;
  let subRow = config.subRow;
  let taken = 0;

  while (steps > 0) {
    const currMaxSubRow = maxSubRow(content[row]);

    if (subRow + steps <= currMaxSubRow) {
      subRow += steps;
      taken += steps;
      break;
    }

    if (row === content.length - 1) {
      taken += currMaxSubRow - subRow;
      subRow = currMaxSubRow;
      break;
    }

    steps -= currMaxSubRow - subRow + 1;
    taken += currMaxSubRow - subRow + 1;

    row++;
    subRow = 0;
  }

  return {
    file: files.index,
    row,
    subRow,
    sline: config.blankTop + 1 + taken,
  };
}

/**
 * Scrolls so the given content position sits on the given screen row.
 *
 * - When the walk back reaches BOF early, the remaining rows become blank
 *   padding above the content, like less's jump_loc drawing blank lines at
 *   the top to keep the target on its screen line.
 *
 * @param content - Full content lines.
 * @param row - 0-based target row.
 * @param subRow - Sub-row within the target row.
 * @param sindex - 0-based screen row to place the target on.
 */
function placeAt(
  content: string[],
  row: number,
  subRow: number,
  sindex: number
): void {
  let steps = sindex;

  // og's back() never scrolls above the current header start
  // (forwback.c: pos != after_header_pos breaks the paint loop -
  // even at BOF, since after_header_pos(NULL) is the header start),
  // so with a header active the -j back-walk clamps with NO blank
  // rows and a jump to the header start stays aligned under the
  // overlay
  const header = optHeader();
  const headerOn = header.lines > 0;
  const floor = headerOn ? header.start : 0;

  if (chopLine() || config.col) {
    const top = Math.max(row - steps, floor);
    setTop(top, 0);
    config.blankTop = headerOn ? 0 : Math.max(steps - row, 0);
    return;
  }

  let topRow = row;
  let topSubRow = subRow;
  let blankTop = 0;

  while (steps > 0) {
    if (topSubRow >= steps) {
      topSubRow -= steps;
      break;
    }

    if (topRow === floor) {
      // only a headerless BOF pads with blank rows
      blankTop = headerOn ? 0 : steps - topSubRow;
      topSubRow = 0;
      break;
    }

    steps -= topSubRow + 1;

    topRow--;
    topSubRow = maxSubRow(content[topRow]);
  }

  setTop(topRow, topSubRow);
  config.blankTop = blankTop;
}

/**
 * Places a content row on the -j target line and refreshes EOF state.
 *
 * @param content - Full content lines.
 * @param row - 0-based target row.
 */
function jumpToRow(content: string[], row: number): void {
  jumpLoc(content, row, 0, jumpSindex());
}

/**
 * Sets the top-of-screen position and refreshes INIT/EOF state.
 *
 * @param row - 0-based top row.
 * @param subRow - Wrapped sub-row within the top row.
 */
function setTop(row: number, subRow: number): void {
  if (mode.INIT) mode.INIT = false;

  config.row = row;
  config.subRow = subRow;
  // a jump lands on a real row start and og's jump_loc regenerates
  // the whole position table from it (pos_clear), so neither the
  // shift nor the anchor survives
  config.subShift = 0;
  config.screen = [];
  config.blankTop = 0;

  mode.EOF = row > config.endRow || (
    row === config.endRow && subRow >= config.endSubRow
  );
}
