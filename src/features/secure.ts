import { search } from "./searching";

/**
 * The $LESSSECURE feature gate, like main.c's init_secure: with
 * LESSSECURE set nothing is allowed except what $LESSSECURE_ALLOW
 * names, and $LESSSECURE_DISALLOW subtracts from either state.
 */
export type SecureFeature =
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
function parseFeatures(text: string, name: string): Set<SecureFeature> {
  const out = new Set<SecureFeature>();

  for (const raw of text.split(',')) {
    // parse_csl skips blanks around each name
    const token = raw.trim();
    if (!token) continue;

    const matches = FEATURES.filter(f => f.startsWith(token));

    if (matches.length !== 1) {
      const kind = matches.length ? 'ambiguous' : 'invalid';
      search.message = `${name}: ${kind} name "${token}"`;
      continue;
    }

    out.add(matches[0]);
  }

  return out;
}

/** Reads the LESSSECURE environment, like init_secure. */
export function initSecure(): void {
  allowed = process.env.LESSSECURE
    ? new Set()
    : new Set(FEATURES);

  const allow = process.env.LESSSECURE_ALLOW;

  if (allow) {
    for (const f of parseFeatures(allow, 'LESSSECURE_ALLOW')) {
      allowed.add(f);
    }
  }

  const disallow = process.env.LESSSECURE_DISALLOW;

  if (disallow) {
    for (const f of parseFeatures(disallow, 'LESSSECURE_DISALLOW')) {
      allowed.delete(f);
    }
  }
}

/** True when a feature may run, like secure_allow. */
export const secureAllow = (feature: SecureFeature): boolean =>
  allowed.has(feature);
