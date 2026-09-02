/**
 * Copies package.json's version into src/version.ts.
 *
 * Run from the `version` lifecycle script, which npm fires after it
 * has bumped the manifest and before it makes the commit, so the
 * literal moves in the same commit as the bump and there is no window
 * where the two disagree.
 *
 * The constant exists because a bundle cannot reliably find its own
 * manifest at run time; see the comment at the top of src/version.ts.
 * This is what keeps that copy honest.
 */
import { readFileSync, writeFileSync } from 'fs';

const SOURCE = 'src/version.ts';

/** The declaration to rewrite, with the literal as its one group. */
const DECLARATION = /(export const VERSION = ')([^']*)(';)/;

const { version } = JSON.parse(
  readFileSync('package.json', 'utf8')
) as { version?: string };

if (typeof version !== 'string') {
  throw new Error('syncVersion: package.json has no version');
}

const source = readFileSync(SOURCE, 'utf8');
const found = DECLARATION.exec(source);

if (found === null) {
  throw new Error(`syncVersion: no VERSION declaration in ${SOURCE}`);
}

if (found[2] === version) {
  console.log(`version: ${SOURCE} already at ${version}`);
} else {
  writeFileSync(
    SOURCE, source.replace(DECLARATION, () => `export const VERSION = '`
      + `${version}';`)
  );
  console.log(`version: ${SOURCE} ${found[2]} -> ${version}`);
}
