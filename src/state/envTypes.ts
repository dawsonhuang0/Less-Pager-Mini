/**
 * Environment names the pager reads through less's lgetenv layering —
 * the keys a library caller's envVars overlay can meaningfully set.
 * (COMSPEC/POSIXLY_CORRECT/LESSNOCONFIG probe the raw process env by
 * design and are deliberately absent.)
 *
 * The api test greps the source for lgetenv/envInteger/envDelay
 * literals and fails when a new consumer is missing here.
 */
export const PAGER_ENV_NAMES = [
  'COLUMNS',
  'EDITOR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LESS',
  'LESSANSIENDCHARS',
  'LESSANSIMIDCHARS',
  'LESSANSIOSCALLOW',
  'LESSANSIOSCCHARS',
  'LESSBINFMT',
  'LESSCHARDEF',
  'LESSCHARSET',
  'LESSCLOSE',
  'LESSECHO',
  'LESSEDIT',
  'LESSGLOBALTAGS',
  'LESSHISTFILE',
  'LESSHISTSIZE',
  'LESSKEY',
  'LESSKEYIN',
  'LESSKEYIN_SYSTEM',
  'LESSKEY_CONTENT',
  'LESSKEY_CONTENT_SYSTEM',
  'LESSKEY_SYSTEM',
  'LESSMETACHARS',
  'LESSMETAESCAPE',
  'LESSOPEN',
  'LESSSECURE',
  'LESSSECURE_ALLOW',
  'LESSSECURE_DISALLOW',
  'LESSSEPARATOR',
  'LESSUTFBINFMT',
  'LESSUTFCHARDEF',
  'LESS_COLUMNS',
  'LESS_DATA_DELAY',
  'LESS_IS_MORE',
  'LESS_LINES',
  'LESS_OSC8_OPEN_ANY',
  'LESS_SCREENFILL_TIME',
  'LESS_SHELL_COPTION',
  'LESS_SHELL_LINES',
  'LESS_SIGUSR1',
  'LESS_TERMCAP_DEBUG',
  'LESS_UNSUPPORT',
  'LINES',
  'MORE',
  'SHELL',
  'TERM',
  'TERMCAP',
  'VISUAL',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
] as const;

/** Env name families looked up with a computed suffix. */
export const PAGER_ENV_PREFIXES = [
  'LESS_TERMCAP_',
  'LESS_TERMINFO_',
  'LESS_OSC8_OPEN_',
] as const;

/**
 * The envVars overlay for a library pager call: every less-consulted
 * name autocompletes; the suffixed families stay open (any termcap
 * capability, terminfo capability or OSC8 URI scheme).
 */
export type PagerEnv =
  Partial<Record<(typeof PAGER_ENV_NAMES)[number], string>> &
  Partial<Record<`LESS_TERMCAP_${string}`, string>> &
  Partial<Record<`LESS_TERMINFO_${string}`, string>> &
  Partial<Record<`LESS_OSC8_OPEN_${string}`, string>>;
