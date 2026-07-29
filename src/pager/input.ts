import { Actions } from '../state/interfaces';

import { SearchRequest } from '../features/searching';

/**
 * Input-specific operations used by the shared pager controller.
 *
 * Memory and pipe sessions leave these operations to the array-backed
 * feature functions. A seekable file may answer an operation from its
 * byte-position view instead, without owning key dispatch or rendering.
 */
export interface PagerInput {
  /** Activates the source after startup options and dimensions are known. */
  ready(): void;

  /** Returns true when the input handled the action completely. */
  handle(action: Actions, count: number): boolean;

  /**
   * og's pos_clear reaching a source engine: it keeps its own copy of
   * the rows a backward move exposed, because the materialized window
   * renumbers itself on every paint, so emptying config.screen alone
   * would let the next sync publish them straight back.
   */
  posClear?(): void;

  /** Runs a compiled search over the input's complete address space. */
  search(request: SearchRequest): boolean;

  /** Restores a seekable source after a cancelled/retyped incsearch. */
  restoreSearchOrigin(): void;

  /** Moves the top to a display-character offset in its own line,
   *  after a width change reshaped how that line breaks. The source's
   *  own view owns the top, so a rebuild would otherwise restore the
   *  old one (og keeps table[TOP] across screen_size_changed). */
  retopOffset(offset: number): void;

  /** Matches brackets across the input's complete address space. */
  bracket(open: string, close: string, forward: boolean, n: number): boolean;

  /** Re-materializes the active file window after a display option changes. */
  rebuild(): boolean;

  /** ^C/--intr during an input-side wait: true when a pending
   *  operation (a growing-spool move, jump or search) was abandoned. */
  interrupt?(): boolean;

  /** og's currline(BOTTOM) at the end of every forw()/back(): the
   *  eager line-number walk running after the rows paint and before
   *  the prompt, with its delayed "Calculating..." and abort chain. */
  resolveBottom?(): void;

  /** Releases the source's file descriptors. */
  close(): void;
}
