/**
 * OG-compatible environment lookup.
 *
 * less searches local lesskey variables first, then the real process
 * environment, then system lesskey variables. LESSNOCONFIG filters every
 * lookup except the raw TERM/POSIXLY_CORRECT/platform probes which call
 * `actualEnv` explicitly.
 */

const userVars = new Map<string, string>();
const systemVars = new Map<string, string>();

// environment passed by a library caller: the embedding application's
// own configuration, so it sits ABOVE og's whole ladder. A lesskey
// #env belongs to whoever runs the application, not to the
// application, which is why it does not outrank this the way it
// outranks a real environment value in og.
let sessionVars: Record<string, string | undefined> | null = null;

/**
 * True when the CALLER supplied this variable, rather than it coming
 * from the ambient process environment. The overlay is the embedding
 * application's own configuration, so it can be trusted with choices
 * the surrounding shell cannot be.
 */
export function fromSessionEnv(name: string): boolean {
  const value = sessionVars?.[name];
  return value !== undefined && value !== '';
}

/** Installs (or clears) a library call's environment overlay. */
export function setSessionEnv(
  vars: Record<string, string | undefined> | null
): void {
  sessionVars = vars;
}

function seedSystemDefaults(): void {
  // decode.c's compiled dflt_vartable. A real environment value still
  // wins because system tables are the final lgetenv tier. The unix
  // build bakes LIBEXECDIR in (Makefile: ${exec_prefix}/libexec, so
  // /usr/local/libexec by default); only the no-LIBEXECDIR build
  // (Windows) falls back to a bare PATH lookup. The leading "-" is
  // lsystem's echo suppression (lsystem.c:61).
  systemVars.set('LESS_OSC8_OPEN_ANY', process.platform === 'win32'
    ? '-less-osc8-open'
    : '-/usr/local/libexec/less-osc8-open');
}

let noConfig: string | undefined;
let invocationStart = Date.now();

/** Starts a fresh invocation before lesskey tables are loaded. */
export function initEnvironment(): void {
  userVars.clear();
  systemVars.clear();
  seedSystemDefaults();

  const value = process.env.LESSNOCONFIG;
  noConfig = value ? value : undefined;
  invocationStart = Date.now();
}

/** Clears only lesskey-provided values, used by isolated parser tests. */
export function resetLesskeyEnvironment(): void {
  userVars.clear();
  systemVars.clear();
  seedSystemDefaults();
}

/** Adds one #env value to the matching lesskey table. */
export function setLesskeyEnv(
  name: string,
  value: string,
  system: boolean = false
): void {
  (system ? systemVars : userVars).set(name, value);
}

/** Removes a broken value from the matching lesskey table. */
export function deleteLesskeyEnv(
  name: string,
  system: boolean = false
): void {
  (system ? systemVars : userVars).delete(name);
}

/** Reads the unfiltered process environment, like OG's direct getenv calls. */
export const actualEnv = (name: string): string | undefined =>
  process.env[name];

/** True when LESSNOCONFIG excludes this variable from lgetenv. */
function ignored(name: string): boolean {
  if (!noConfig) return false;

  for (const item of noConfig.split(',')) {
    if (item.trim() === name) return false;
  }

  return true;
}

/**
 * Reads og's ladder alone: user lesskey #env, then the real process
 * environment, then system lesskey #env, then the compiled defaults.
 *
 * This is what the ENVIRONMENT says with the caller's overlay taken
 * away, so it is the view policy must be read through. A deployment
 * hardens a session through any of these tiers - $LESS in the parent
 * shell, or a #env line in ~/.lesskey - and a library caller may
 * tighten what it finds here but never relax it.
 */
export function ambientEnv(name: string): string | undefined {
  if (ignored(name)) return undefined;

  if (userVars.has(name)) return userVars.get(name);

  const real = process.env[name];
  if (real !== undefined && real !== '') return real;

  return systemVars.get(name);
}

/**
 * Reads a less environment value with user > process > system precedence.
 * Empty real-environment values are absent, while an empty lesskey value
 * remains a winning table entry just like cmd_decode(EV_OK).
 */
export function lgetenv(name: string): string | undefined {
  // a library caller's envVars are the application's own explicit
  // configuration: they outrank every ambient tier and LESSNOCONFIG
  // filters only the user's environment, never the caller's
  // (og's isnullenv: an empty value reads as unset)
  const session = sessionVars?.[name];
  if (session !== undefined && session !== '') return session;

  return ambientEnv(name);
}

/** TERM uniquely falls back to real getenv even under LESSNOCONFIG. */
export const terminalEnv = (): string | undefined =>
  lgetenv('TERM') || actualEnv('TERM');

/** Integer lookup with OG's atoi-style invalid fallback. */
export function envInteger(name: string, fallback: number): number {
  const value = lgetenv(name);
  if (!value) return fallback;

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/** Positive millisecond option, preserving the compiled default otherwise. */
export function envDelay(name: string, fallback: number): number {
  const value = envInteger(name, 0);
  return value > 0 ? value : fallback;
}

/** True during og's initial no-poll screen-fill grace period. */
export function screenFillGrace(): boolean {
  return Date.now() < invocationStart + envDelay('LESS_SCREENFILL_TIME', 3000);
}
