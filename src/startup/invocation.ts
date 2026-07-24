import { opt } from '../options/state';

// The package entry point is safe-by-default. The executable marks its next
// pager call so the terminal command retains less's ordinary shell behavior.
let terminalInvocation = false;

/** Marks the next pager entry as originating from the lmn executable. */
export function markTerminalInvocation(): void {
  terminalInvocation = true;
}

/** Applies and consumes the invocation-specific --no-shell default. */
export function initInvocationOptions(): void {
  opt.noShell = terminalInvocation ? 0 : 1;
  terminalInvocation = false;
}
