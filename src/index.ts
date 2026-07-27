import paramPager from './pager/paramPager';
import streamPager, { pagerPipe as pipeSession } from './pager/streamPager';

import { setCliOptions, takeCliOptions } from './options';

import { setSessionEnv } from './startup/environment';

import { LESS_OPTION_VALUES, LessOptions } from './state/lessOptionTypes';

import {
  PAGER_ENV_NAMES,
  PAGER_ENV_PREFIXES,
  PagerEnv,
} from './state/envTypes';

export { LessOptions, PagerEnv };

/**
 * Configuration for a library pager call — one map for everything.
 *
 * - `tab-object` and `examine-file` are this library's own
 *   switches.
 * - Any less option under its LONG name, CASED EXACTLY AS LESS
 *   DOCUMENTS IT (`'quit-if-one-screen'`, `'QUIT-AT-EOF'`). `true`
 *   includes the flag; a string or number becomes its value
 *   (`{ tabs: 8 }` is `--tabs=8`); `false`/`undefined` leave the
 *   default. Option letters are not keys here — they would read as
 *   noise beside the names — so spell `-S` as `{ LESS: '-S' }`.
 * - Any environment name less consults (`LESS`, `LESSOPEN`,
 *   `LESS_OSC8_OPEN_https`, ...): applied as this call's env overlay.
 *
 * Option and environment names never overlap (env names carry
 * underscores or are single ALL-CAPS words; uppercase option names
 * are always hyphenated) — the api test guards that invariant.
 */
export type PagerConfig = LessOptions & PagerEnv & {
  /** Indents objects one tab per level instead of one flat line. */
  'tab-object'?: boolean;
  /** Treats the input as file path(s) to open, like the terminal. */
  'examine-file'?: boolean;
};

const ENV_NAME_SET = new Set<string>(PAGER_ENV_NAMES);

const isEnvName = (name: string): boolean =>
  ENV_NAME_SET.has(name) ||
  PAGER_ENV_PREFIXES.some(prefix => name.startsWith(prefix));

/** Splits one config map into scan arguments and the env overlay. */
function splitConfig(config: PagerConfig): {
  tabObject: boolean,
  examineFile: boolean,
  args: string[],
  env: Record<string, string> | null,
} {
  const args: string[] = [];
  let env: Record<string, string> | null = null;

  for (const [name, value] of Object.entries(config)) {
    if (value === false || value === undefined) continue;
    if (name === 'tab-object' || name === 'examine-file') continue;

    // a known option name wins outright; the disjointness guard in
    // the api test keeps this unambiguous
    if (!(name in LESS_OPTION_VALUES) && isEnvName(name)) {
      (env ??= {})[name] = String(value);
      continue;
    }

    const val = value === true ? '' : String(value);

    // less forms: --name / --name=value. A one-character key is no
    // longer part of PagerConfig, but an untyped JavaScript caller
    // passing one still gets the letter form rather than a bad scan
    args.push(name.length === 1
      ? `-${name}${val}`
      : `--${name}${val && '='}${val}`);
  }

  return {
    tabObject: config['tab-object'] === true,
    examineFile: config['examine-file'] === true,
    args,
    env,
  };
}

/**
 * Less-pager-mini
 *
 * Flags apart from `less`:
 * - `tab-object`: If true, JSON.stringifies the input object indented
 *   with `\t`; the `tabs` option moves the stops (8 by default).
 *   Else it still stringifies, flat on one line, losing no content.
 * - `examine-file`: If true, treats input as file path(s) and reads from disk.
 *
 * Safeguard flag `no-shell` prevents shell command execution — and
 * with it `$LESSOPEN`, `$LESSCLOSE` and every other process launch.
 * By default:
 * - True from library calls, `pagerPipe` included. The ambient
 *   environment cannot lift it: the scan reads `$LESS`, `$MORE` and a
 *   lesskey's `#env` lines, none of which the embedding application
 *   necessarily controls. THIS map can, since it is that
 *   application's own configuration: `{ LESS: '--+no-shell' }`.
 *   An environment may still TIGHTEN what the map asks for — a
 *   deployment-wide `LESS=--no-shell` outranks that unlock, so an
 *   application cannot configure its way around a hardening policy.
 *   `$LESSSECURE` works the same way: this map can restrict a
 *   session further, never hand back a feature the environment
 *   withheld.
 * - False from the `lmn` terminal command, file or pipe alike, where
 *   its own `--no-shell` still applies.
 *
 * @example
 * await pager(lines);
 * await pager('app.log', { 'examine-file': true, LESS: '-RS' });
 *
 * @param input - Content to display, or path(s) under `examine-file`.
 * @param config - Less options and environment variables, one map.
 */
async function pager(
  input: unknown,
  config: PagerConfig = {}
): Promise<void> {
  const { tabObject, examineFile, args, env } = splitConfig(config);

  // less-named options join the CLI-argument scan, one arg per
  // option, after any arguments the executable already queued
  if (args.length) setCliOptions([...takeCliOptions(), ...args]);

  if (env) setSessionEnv(env);

  try {
    await (examineFile
      ? streamPager(input)
      : paramPager(input, tabObject));
  } finally {
    setSessionEnv(null);
  }
}

/** Pages a non-seekable stream; config works as in pager (the two
 *  library switches are meaningless for a pipe and ignored). */
async function pagerPipe(
  stream: Parameters<typeof pipeSession>[0],
  config: PagerConfig = {}
): Promise<void> {
  const { args, env } = splitConfig(config);

  if (args.length) setCliOptions([...takeCliOptions(), ...args]);

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
