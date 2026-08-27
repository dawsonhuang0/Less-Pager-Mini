/**
 * Which screen rows END the line they were built from.
 *
 * less's forw_line_seg carries an `endline` flag out of every line it
 * reads: TRUE when a newline finished the segment, FALSE when the
 * screen width cut it short (input.c:279), and TRUE again for a
 * CHOPPED line, which is read to its end and discarded past the
 * margin (input.c:246). pdone is the only thing that asks, and it
 * asks about a row that reached the right margin: with the line
 * ending there too, there is nothing to nudge into, so it writes a
 * newline (line.c:1523) rather than the deferred-wrap ' \b'.
 *
 * The renderer hands its painters bare strings, which cannot answer
 * that. This is the answer, kept beside them by screen row.
 *
 * An unrecorded row reads as "does not end its line" — the nudge, the
 * commoner case and the one a wrap always wants — so a painter that
 * cannot say which row it is holding keeps the behaviour it had.
 */
let flags: boolean[] = [];

/**
 * Which rows less draws as NULL lines, and which KIND.
 *
 * They matter because of a second flag. clear_after_line is set by
 * pdone for a row that reached the margin on a terminal that wraps by
 * itself (line.c:1552), and only prewind resets it - so a null line's
 * answer depends on whether one ran, and the two kinds differ:
 *
 * - past EOF, forw() keeps calling forw_line. The first such call has
 *   a real position, so it reaches prewind (input.c:148) and only THEN
 *   finds EOI (:193) - the flag is cleared, and every tilde after it
 *   takes the early return at :101 and leaves it cleared.
 * - above BOF, forw()'s nblank rows never call forw_line at all
 *   ("don't get a line from the file yet", forwback.c:285), so the
 *   flag is untouched and the blanks inherit it.
 *
 * Which is why less clears after the tildes ABOVE a short file's text
 * and not after the ones below it.
 */
let nulls: (undefined | 'bof' | 'eof')[] = [];

/** clear_after_line per row, once the screen's rows are final. */
let clears: boolean[] = [];

/**
 * ...and it survives the paint, because it is a static in line.c that
 * only prewind touches. A screen that OPENS with null lines - G on a
 * file shorter than the window puts the text at the bottom under a
 * field of tildes - inherits the answer the last row of the last paint
 * left, which is why less clears after those tildes.
 */
let carried = false;

/** Drops the previous screen's answers, before a new one is built. */
export function resetRowEnds(): void {
  flags = [];
  nulls = [];
  clears = [];
}

/**
 * Records that the row at `index` is one of less's null lines.
 *
 * @param kind - 'bof' for a blank above the beginning, which inherits
 *   the flag, or 'eof' for a tilde past the end, which clears it.
 */
export function setNullRow(index: number, kind: 'bof' | 'eof'): void {
  nulls[index] = kind;
}

/**
 * Works out clear_after_line for a finished screen, carrying the last
 * real line's answer across the null lines that follow it.
 *
 * @param count - How many rows the screen has.
 * @param filled - Whether row i reached the right margin.
 */
export function sealRowClears(
  count: number,
  filled: (index: number) => boolean
): void {
  for (let i = 0; i < count; i++) {
    if (nulls[i] === 'eof') carried = false;
    else if (nulls[i] === undefined) carried = filled(i);

    clears[i] = carried;
  }
}

/** True when less would clear to end of line after drawing this row. */
export function rowClearsAfter(index: number): boolean {
  return index >= 0 && (clears[index] ?? false);
}

/** Records whether the row drawn at `index` ends its line. */
export function setRowEnd(index: number, ends: boolean): void {
  flags[index] = ends;
}

/**
 * Slides every answer down by `n`, for rows prepended to the screen
 * after they were recorded — the squish pad, which puts a short file's
 * text at the BOTTOM of the window.
 */
export function shiftRowEnds(n: number): void {
  if (n <= 0) return;

  flags = new Array<boolean>(n).fill(false).concat(flags);
  clears = new Array<boolean>(n).fill(false).concat(clears);
  nulls = new Array<undefined | 'bof' | 'eof'>(n).fill(undefined).concat(nulls);
}

/** True when the screen row at `index` ends the line it came from. */
export function rowEndsLine(index: number): boolean {
  return index >= 0 && (flags[index] ?? false);
}
