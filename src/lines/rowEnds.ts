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

/** Drops the previous screen's answers, before a new one is built. */
export function resetRowEnds(): void {
  flags = [];
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
  if (n > 0) flags = new Array<boolean>(n).fill(false).concat(flags);
}

/** True when the screen row at `index` ends the line it came from. */
export function rowEndsLine(index: number): boolean {
  return index >= 0 && (flags[index] ?? false);
}
