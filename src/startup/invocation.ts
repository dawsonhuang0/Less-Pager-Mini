import { opt } from '../options/state';

// The package entry point is safe-by-default. The executable marks its next
// pager call so the terminal command retains less's ordinary shell behavior.
let terminalInvocation = false;

// what the CURRENT session is, kept for the post-scan lock below
let libraryCall = true;

/** Marks the next pager entry as originating from the lmn executable. */
export function markTerminalInvocation(): void {
  terminalInvocation = true;
}

/** Applies and consumes the invocation-specific --no-shell default. */
export function initInvocationOptions(): void {
  libraryCall = !terminalInvocation;
  opt.noShell = libraryCall ? 1 : 0;
  terminalInvocation = false;
}

/**
 * Re-asserts a library call's shell lock once the option scan is done.
 *
 * The scan reads $LESS, $MORE and a lesskey's #env lines, none of
 * which the embedding application necessarily controls: without this,
 * `LESS=--+no-shell` in the surrounding shell would hand `!`, `|` and
 * `v` back to whoever is reading the pager, in a program that chose
 * the safe default by calling the library at all.
 *
 * An application that WANTS shell access says so in its own config
 * map — `pager(x, { LESS: '--+no-shell' })` — and that overlay is
 * trusted, because it is the application's own configuration rather
 * than the environment it was launched in.
 *
 * The `lmn` executable is unaffected: it marks its invocation, keeps
 * less's ordinary behavior, and its own --no-shell still applies.
 *
 * @param appConfigured - Whether the scanned value came from the
 *   caller's own overlay.
 */
export function lockLibraryShell(appConfigured: boolean): void {
  if (libraryCall && !appConfigured) opt.noShell = 1;
}
