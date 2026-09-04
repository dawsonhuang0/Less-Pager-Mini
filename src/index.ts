import paramPager from './pager/paramPager';
import streamPager, { pagerPipe as pipeSession } from './pager/streamPager';

import { setCliOptions, takeCliOptions } from './options';

import { setSessionEnv } from './startup/environment';

import { LessOptions as OptionTable, LessOptionLetter }
  from './state/lessOptionTypes';

import { PagerEnv as SessionEnv } from './state/envTypes';


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
type LessOptionName = keyof OptionTable & string;

/**
 * One less argument.
 *
 * The long names are spelled out so an editor can offer them, in all
 * three forms less accepts: `--name`, `--name=value`, and `--+name` to
 * put an option back to its default. `(string & {})` keeps the union
 * suggestible while still accepting everything else that is legal on
 * a less command line - option letters (`-N`), bundled letters
 * (`-NS`), initial commands (`+G`, `+/pattern`) - none of which have
 * a name to suggest.
 */
/** Pulls this library's switches out of the argument list, leaving
 *  the rest for the ordinary less scan. */
function splitArgs(args: readonly pager.PagerArg[]): {
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
 * - `--use-gnu-regexp`: uses GNU regular expressions for searching;
 *   *on* by default for glibc systems, else using POSIX regular expressions.
 * - `--use-js-regexp`: uses JavaScript regular expressions for searching;
 *   *off* by default - using POSIX or GNU regular expressions.
 * - `--use-zsh-glob`: expands a filename with zsh's globbing rules in process;
 *   *on* by default for Windows, else globbing via `$SHELL`.
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
  args: readonly pager.PagerArg[] = [],
  env: pager.PagerEnv | null = null
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
async function pipePager(
  stream: Parameters<typeof pipeSession>[0],
  args: readonly pager.PagerArg[] = [],
  env: pager.PagerEnv | null = null
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

/**
 * The package's export IS the function, which is what a CommonJS
 * `module.exports = pager` means - and `export =` is how a .d.ts says
 * so. Declaring an ES default export over a CommonJS emit was a lie
 * TypeScript could see through: under `module: nodenext` it models the
 * interop as `default = module.exports`, computes that from an
 * ES-shaped declaration as the module NAMESPACE, and a namespace has
 * no call signatures. Every form that reached the default failed to
 * type-check - `import pager from`, `import * as ns` then `ns.default`,
 * and both spellings of `await import()` - while the runtime handed
 * back the function all along.
 *
 * Everything else rides the merged namespace, so the named and type
 * imports are unchanged. tests/types checks every form under both
 * nodenext and bundler.
 */
// The properties are assigned by hand rather than through the
// namespace, whose IIFE emit (`pager.pagerPipe = ...`) cjs-module-lexer
// cannot see - and what it cannot see, node does not offer as a named
// export, so `import { pagerPipe }` threw. Assigning module.exports
// FIRST makes the object being decorated the function itself, so the
// `export =` assignment that follows in the emit is a no-op.
module.exports = pager;
module.exports.pagerPipe = pipePager;
module.exports.default = pager;

/* eslint-disable-next-line @typescript-eslint/no-namespace, no-redeclare
   -- the function and namespace MERGE, which is the whole point */
declare namespace pager {
  export const pagerPipe: typeof pipePager;

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

  // less's own option shapes, re-exported so a caller can name them
  export type LessOptions = OptionTable;
  export type PagerEnv = SessionEnv;
}

export = pager;
