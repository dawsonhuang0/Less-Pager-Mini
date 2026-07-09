import { ringBell, maxSubRow, isAscii, isStyled } from "../helpers";

import { getLayout } from "../lineLayout";

import { config, mode } from "../config";

import { search } from "./searching";

import { files } from "./files";

/**
 * Jumps to line `lineNum` in the content, placing it at the top of the
 * screen (`g`, `<`, `ESC-<`).
 *
 * - Reports an error like less when the line does not exist.
 *
 * @param content - Full content lines.
 * @param lineNum - 1-based target line number.
 */
export function firstLine(content: string[], lineNum: number): void {
  if (lineNum > content.length) {
    search.message = `Cannot seek to line number ${lineNum}`;
    return;
  }

  jumpToRow(content, lineNum - 1);
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
 */
export function lastLine(content: string[], lineNum: number): void {
  if (lineNum > 0) {
    firstLine(content, lineNum);
    return;
  }

  if (config.row === config.endRow && config.subRow === config.endSubRow) {
    ringBell();
    return;
  }

  // jump_forw records the last position unconditionally
  recordLastPosition();
  setTop(config.endRow, config.endSubRow);
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
export function bracketsKey(content: string[], key: string): void {
  if (key === '\x03' || key.startsWith('\x1B')) {
    brackets.pending = '';
    return;
  }

  brackets.chars += key[0];
  if (brackets.chars.length < 2) return;

  const forward = brackets.pending === 'f';
  brackets.pending = '';

  matchBracket(
    content,
    brackets.chars[0],
    brackets.chars[1],
    forward,
    brackets.n
  );
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
function subRowStart(line: string, subRow: number): number {
  if (subRow === 0) return 0;

  if (!isStyled(line) && isAscii(line)) {
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
 * A marked position: a content position plus the 1-based screen line it
 * occupied, like less's scrpos, and the file it belongs to (m_ifile).
 */
interface Mark {
  file: number;
  row: number;
  subRow: number;
  sline: number;
}

const MARK_LETTER_REGEX = /^[a-zA-Z#]$/;

const userMarks = new Map<string, Mark>();

// the "last mark" addressed by the apostrophe (less's LASTMARK)
let quoteMark: Mark | null = null;

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
  } else if (pending === 'c') {
    clearMark(char);
  }
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
    search.message = `Invalid mark letter ${char}`;
    return;
  }

  if (lineNum > content.length) {
    search.message = `Cannot find line number ${lineNum}`;
    return;
  }

  if (lineNum) {
    userMarks.set(char, {
      file: files.index,
      row: lineNum - 1,
      subRow: 0,
      sline: bottom ? config.window - 1 : 1,
    });
    return;
  }

  userMarks.set(char, bottom ? lastVisiblePosition(content) : {
    file: files.index,
    row: config.row,
    subRow: config.subRow,
    sline: config.blankTop + 1,
  });
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
      mark = { file: files.index, row: 0, subRow: 0, sline: 0 };
      break;

    case '$': {
      const row = content.length - 1;
      const subRow = config.chopLongLines || config.col
        ? 0
        : maxSubRow(content[row]);
      mark = { file: files.index, row, subRow, sline: config.window - 1 };
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

      // an unset last mark means the beginning of the file, like less
      mark = quoteMark ?? { file: files.index, row: 0, subRow: 0, sline: 1 };
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
        search.message = 'Mark not set';
        return;
      }
  }

  if (mark.file !== files.index) {
    search.message = 'Mark not in current file';
    return;
  }

  if (mark.row >= content.length) {
    search.message = 'Cannot seek to that file position';
    return;
  }

  // the stored sub-row may be stale after a resize
  const subRow = config.chopLongLines || config.col
    ? 0
    : Math.min(mark.subRow, maxSubRow(content[mark.row]));

  // clip like sindex_from_sline: 1 .. window-1, then to 0-based
  const line = sline || mark.sline;
  const sindex = Math.min(Math.max(line, 1), config.window - 1) - 1;

  jumpLoc(content, mark.row, subRow, sindex);
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

  if (!userMarks.delete(char)) ringBell();
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
function jumpLoc(
  content: string[],
  row: number,
  subRow: number,
  sindex: number
): void {
  if (targetScreenRow(content, row, subRow) === sindex) {
    ringBell();
    return;
  }

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
    mark = quoteMark ?? { file: files.index, row: 0, subRow: 0, sline: 1 };
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
 * Records the current position into the quote mark when a jump takes one
 * of less's full-repaint paths, mirroring which jump_loc branches call
 * lastmark.
 *
 * @param content - Full content lines.
 * @param row - Target row of the jump.
 * @param subRow - Target sub-row of the jump.
 * @param sindex - 0-based screen row the target will be placed on.
 */
export function saveLastPosition(
  content: string[],
  row: number,
  subRow: number,
  sindex: number
): void {
  const screenRow = targetScreenRow(content, row, subRow);

  // displayed targets are reached by scrolling, without lastmark
  if (screenRow !== null) return;

  const chop = config.chopLongLines || config.col;
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
  const topSubRow = config.chopLongLines || config.col ? 0 : config.subRow;

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
  if (config.chopLongLines || config.col) {
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

  quoteMark = {
    file: files.index,
    row: config.row,
    subRow: config.subRow,
    sline: config.blankTop + 1,
  };
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

  if (config.chopLongLines || config.col) {
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
function lastVisiblePosition(content: string[]): Mark {
  let steps = config.window - 2 - config.blankTop;

  if (config.chopLongLines || config.col) {
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

  if (config.chopLongLines || config.col) {
    setTop(Math.max(row - steps, 0), 0);
    config.blankTop = Math.max(steps - row, 0);
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

    if (topRow === 0) {
      blankTop = steps - topSubRow;
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
 * Places a content row at the top of the screen and refreshes EOF state.
 *
 * @param content - Full content lines.
 * @param row - 0-based target row.
 */
function jumpToRow(content: string[], row: number): void {
  jumpLoc(content, row, 0, 0);
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
  config.blankTop = 0;

  mode.EOF = row > config.endRow || (
    row === config.endRow && subRow >= config.endSubRow
  );
}
