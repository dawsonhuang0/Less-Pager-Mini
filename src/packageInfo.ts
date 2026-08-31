import fs from 'fs';
import path from 'path';

/**
 * The package's own manifest, read once.
 *
 * Two facts live there rather than in the code: our version, and which
 * less this port is built against. The second one used to be written
 * out in three places - the -V string, the #version comparison, and a
 * comment - and they could drift.
 */
interface Manifest {
  version?: string;
  lessVersion?: string;
}

let manifest: Manifest | null = null;

function read(): Manifest {
  if (manifest) return manifest;

  try {
    // __dirname is dist/ in a build and src/ under the test runner;
    // its parent is the package root either way
    const root = typeof __dirname === 'undefined'
      ? process.cwd()
      : path.join(__dirname, '..');

    manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    ) as Manifest;
  } catch {
    manifest = {};
  }

  return manifest;
}

/** Our own version, for -V and the version message. */
export function packageVersion(): string {
  return read().version ?? 'unknown';
}

/**
 * The less this port replicates, as less writes it: "710x".
 *
 * less's own version[] string (version.c), which is what the -V line
 * has to name.
 */
export function lessVersion(): string {
  return read().lessVersion ?? 'unknown';
}

/**
 * The same as a NUMBER, for a lesskey #version comparison.
 *
 * less compares against the leading digits of its version and ignores
 * the release letter (lesskey_parse.c), so "710x" is 710.
 */
export function lessVersionNumber(): number {
  return parseInt(lessVersion(), 10) || 0;
}
