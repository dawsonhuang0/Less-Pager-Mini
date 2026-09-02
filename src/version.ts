/**
 * The two versions, as literals.
 *
 * They were read out of package.json at run time until the build began
 * bundling, and a bundle makes that read fragile: the reader resolved
 * the manifest through `path.join(__dirname, '..')`, which is the
 * package root only for an entry emitted at `dist/`. An entry one
 * directory deeper found no manifest and reported "unknown", with a
 * `catch` to keep it quiet. Constants have no such geometry.
 *
 * `LESS_VERSION` lives here and nowhere else, so it cannot drift.
 * `VERSION` has to agree with package.json, which npm owns and bumps;
 * nothing syncs the two, so the version message is asserted against
 * the manifest in tests/misc/misc.test.ts and a stale literal here is
 * a failing test rather than a wrong `-V` line.
 */

/** Our own version, for -V and the version message. */
export const VERSION = '1.16.4';

/**
 * The less this port replicates, as less writes it: "710x".
 *
 * less's own version[] string (version.c), which is what the -V line
 * has to name. The `-V` string and the lesskey `#version` comparison
 * must agree, so both take it from here.
 */
export const LESS_VERSION = '710x';

/**
 * The same as a NUMBER, for a lesskey #version comparison.
 *
 * less compares against the leading digits of its version and ignores
 * the release letter (lesskey_parse.c), so "710x" is 710.
 */
export const LESS_VERSION_NUMBER = parseInt(LESS_VERSION, 10) || 0;
