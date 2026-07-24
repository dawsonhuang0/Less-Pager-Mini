import { Actions } from '../interfaces';

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

  /** Runs a compiled search over the input's complete address space. */
  search(request: SearchRequest): boolean;

  /** Restores a seekable source after a cancelled/retyped incsearch. */
  restoreSearchOrigin(): void;

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
