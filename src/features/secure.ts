import { search } from "./searching";

import { ambientEnv, lgetenv } from '../startup/environment';

/**
 * The $LESSSECURE feature gate, like main.c's init_secure: with
 * LESSSECURE set nothing is allowed except what $LESSSECURE_ALLOW
 * names, and $LESSSECURE_DISALLOW subtracts from either state.
 */
type SecureFeature =
  | 'edit' | 'examine' | 'glob' | 'history' | 'lesskey' | 'lessopen'
  | 'logfile' | 'osc8' | 'pipe' | 'shell' | 'stop' | 'tags';

const FEATURES: SecureFeature[] = [
  'edit', 'examine', 'glob', 'history', 'lesskey', 'lessopen',
  'logfile', 'osc8', 'pipe', 'shell', 'stop', 'tags',
];

let allowed = new Set<SecureFeature>(FEATURES);

/**
 * Prefix-matches a comma-separated feature list, like the
 * security_features csl_bitmap.
 */
function parseFeatures(
  text: string,
  name: string,
  report: boolean = true
): Set<SecureFeature> {
  const out = new Set<SecureFeature>();

  for (const raw of text.split(',')) {
    // parse_csl skips blanks around each name
    const token = raw.trim();
    if (!token) continue;

    const matches = FEATURES.filter(f => f.startsWith(token));

    if (matches.length !== 1) {
      // the ambient pass is a policy probe, not a scan: og reports
      // each bad name once, so only the real read speaks up
      if (report) {
        const kind = matches.length ? 'ambiguous' : 'invalid';
        search.message = `${name}: ${kind} name "${token}"`;
      }

      continue;
    }

    out.add(matches[0]);
  }

  return out;
}

/** The feature set one view of the environment permits, like
 *  init_secure reading its three variables in order. */
function allowedBy(
  read: (name: string) => string | undefined,
  report: boolean
): Set<SecureFeature> {
  const set = read('LESSSECURE') ? new Set<SecureFeature>() : new Set(FEATURES);

  const allow = read('LESSSECURE_ALLOW');

  if (allow) {
    for (const f of parseFeatures(allow, 'LESSSECURE_ALLOW', report)) {
      set.add(f);
    }
  }

  const disallow = read('LESSSECURE_DISALLOW');

  if (disallow) {
    for (const f of parseFeatures(disallow, 'LESSSECURE_DISALLOW', report)) {
      set.delete(f);
    }
  }

  return set;
}

/**
 * Reads the LESSSECURE environment, like init_secure — but a library
 * caller's overlay may only TIGHTEN what it finds.
 *
 * og is a program its user ran, so whoever sets LESSSECURE_ALLOW is
 * the same person who set LESSSECURE. A library call has two parties:
 * the deployment that hardened the environment, and the application
 * embedding the pager. Taking what BOTH permit means the application
 * can still restrict itself, and cannot hand back a feature the
 * environment took away.
 *
 * The ambient view is og's ladder, so $LESSNOCONFIG blanks LESSSECURE
 * exactly as it does in og (main.c reads no_config before init_secure,
 * and ignore_env then hides every name the list omits). Only the real
 * environment can set $LESSNOCONFIG, so a caller cannot reach for it
 * to wipe a policy it is not allowed to relax directly. Lesskey #env
 * lines cannot carry LESSSECURE in either program: og's init_secure
 * runs before init_cmds loads the tables, and so does ours.
 */
export function initSecure(): void {
  const ambient = allowedBy(ambientEnv, false);
  const merged = allowedBy(lgetenv, true);

  allowed = new Set([...merged].filter(feature => ambient.has(feature)));
}

/** True when a feature may run, like secure_allow. */
export const secureAllow = (feature: SecureFeature): boolean =>
  allowed.has(feature);
