import paramPager from './pager/paramPager';
import streamPager, { pagerPipe as pipeSession } from './pager/streamPager';

import { setCliOptions, takeCliOptions } from './options';

import { setSessionEnv } from './startup/environment';

import { LessOptions, LessOptionLetter } from './state/lessOptionTypes';

import { PagerEnv } from './state/envTypes';

export { LessOptions, PagerEnv };

/**
 * This library's own switches, spelled like options but never reaching
 * the option table.
 *
 * They are stripped here, so they are unknown everywhere less would
 * otherwise meet them: absent from `--help`, unreachable from the `-`
 * toggle and the `_` query, and rejected by `lmn` like any other
 * unknown flag. They configure a library CALL, and there is no call to
 * configure from inside a running pager.
 */
const TAB_OBJECT = '--tab-object';
const EXAMINE_FILE = '--examine-file';

/** Every long option name the table knows, as the generator left it. */
type LessOptionName = keyof LessOptions & string;

/**
 * One less argument.
 *
 * The long names are spelled out so an editor can offer them, in all
 * three forms og accepts: `--name`, `--name=value`, and `--+name` to
 * put an option back to its default. `(string & {})` keeps the union
 * suggestible while still accepting everything else that is legal on
 * a less command line - option letters (`-N`), bundled letters
 * (`-NS`), initial commands (`+G`, `+/pattern`) - none of which have
 * a name to suggest.
 */
export type NamedArg =
  // the letter forms, so `-R` and `-N` are offered beside the names
  | `-${LessOptionLetter}`
  | `--${LessOptionName}`
  | `--${LessOptionName}=${string}`
  | `--+${LessOptionName}`
  | typeof TAB_OBJECT
  | typeof EXAMINE_FILE;

export type PagerArg =
  | NamedArg
  // Everything else legal on a less command line. It also means
  // nothing is REJECTED here, so the suggestion set is worth
  // asserting against NamedArg, which has no such escape hatch -
  // dropping a form from it is otherwise invisible.
  | (string & {});

/** Pulls this library's switches out of the argument list, leaving
 *  the rest for the ordinary less scan. */
function splitArgs(args: readonly PagerArg[]): {
  tabObject: boolean,
  examineFile: boolean,
  rest: string[],
} {
  const rest: string[] = [];
  let tabObject = false;
  let examineFile = false;

  for (const arg of args) {
    if (arg === TAB_OBJECT) tabObject = true;
    else if (arg === EXAMINE_FILE) examineFile = true;
    else rest.push(arg);
  }

  return { tabObject, examineFile, rest };
}

/**
 * Less-pager-mini
 *
 * Featuring flags:
 * - `--tab-object`: JSON.stringifies the input object indented with `\t`;
 *   tab stop width is 8 by default, adjust via `--tabs`.
 * - `--examine-file`: treats the input as file path(s) and attempts to read
 *   from disk, invalid file paths are not paged.
 * - `--use-js-regexp`: uses JavaScript's RegExp for searching;
 *   *off* by default - using `posix-regex`.
 *
 * Safeguard flag - *on* by default:
 * - `no-shell`: prevents shell command execution, `$LESSOPEN`, `$LESSCLOSE`
 *   and every other process launch. Set env `{ LESS: '--+no-shell' }` to
 *   toggle off (if `--no-shell` is absent). `lmn` excepted - *off* by default.
 *
 * @example
 * await pager(lines);
 * await pager('app.log', ['--examine-file', '-RS']);
 * await pager(lines, ['-R'], { LESS: '-X' });
 *
 * @param input - Content to display, or path(s) under `--examine-file`.
 * @param args - Less arguments, as typed on a command line.
 * @param env - Environment variables; args over `$LESS`.
 */
async function pager(
  input: unknown,
  args: readonly PagerArg[] = [],
  env: PagerEnv | null = null
): Promise<void> {
  const { tabObject, examineFile, rest } = splitArgs(args);

  // the arguments join the CLI scan after any the executable queued
  if (rest.length) setCliOptions([...takeCliOptions(), ...rest]);

  if (env) setSessionEnv(env);

  try {
    await (examineFile
      ? streamPager(input)
      : paramPager(input, tabObject));
  } finally {
    setSessionEnv(null);
  }
}

/** Pages a non-seekable stream; arguments work as in pager (the two
 *  library switches are meaningless for a pipe and ignored). */
async function pagerPipe(
  stream: Parameters<typeof pipeSession>[0],
  args: readonly PagerArg[] = [],
  env: PagerEnv | null = null
): Promise<void> {
  const { rest } = splitArgs(args);

  if (rest.length) setCliOptions([...takeCliOptions(), ...rest]);

  if (env) setSessionEnv(env);

  try {
    await pipeSession(stream);
  } finally {
    setSessionEnv(null);
  }
}

export { pagerPipe };

export default pager;

// CommonJS interop; ESM importers use the default export directly.
try {
  module.exports = pager;
  module.exports.default = pager;
  module.exports.pagerPipe = pagerPipe;
} catch {
  // ESM module records are frozen.
}
