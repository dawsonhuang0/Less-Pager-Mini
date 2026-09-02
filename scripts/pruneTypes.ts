/**
 * Deletes the declaration files nothing can reach.
 *
 * `tsc --emitDeclarationOnly` writes one `.d.ts` per source file, but
 * the runtime is four esbuild bundles — there is no `dist/features/
 * searching.js` for `dist/features/searching.d.ts` to describe, and no
 * import path that arrives at it. 152 of the 157 files are unreachable
 * dead weight, and two of them name `posix-regex` in a type import,
 * which consumers do not install: a bundled package must not leak a
 * build-time dependency into the types it ships.
 *
 * So the graph is walked from what package.json actually points at, and
 * everything off it goes.
 */
import { readFileSync, existsSync, statSync, rmSync, readdirSync } from 'fs';
import { join, dirname, normalize, relative } from 'path';

/** Where the entry declarations live, as package.json spells them. */
const ROOTS = ['dist/index.d.ts', 'dist/cli.d.ts'];

/** A relative specifier, in either the `from` or the `import()` form. */
const SPECIFIER = /from\s+['"](\.[^'"]+)['"]|import\(['"](\.[^'"]+)['"]\)/g;

/** The file a specifier names, module resolution's two spellings. */
function resolve(path: string): string | null {
  for (const candidate of [`${path}.d.ts`, join(path, 'index.d.ts')]) {
    if (existsSync(candidate)) return normalize(candidate);
  }
  return null;
}

/** Every declaration under `dir`, the whole emitted set. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith('.d.ts') ? [normalize(path)] : [];
  });
}

const reachable = new Set<string>();
const pending = ROOTS.filter(existsSync).map(normalize);

while (pending.length > 0) {
  const file = pending.pop()!;
  if (reachable.has(file)) continue;
  reachable.add(file);

  const here = dirname(file);
  for (const [, from, dynamic] of readFileSync(file, 'utf8')
    .matchAll(SPECIFIER)) {
    const target = resolve(normalize(join(here, from ?? dynamic)));
    if (target !== null && !reachable.has(target)) pending.push(target);
  }
}

if (reachable.size === 0) {
  throw new Error('pruneTypes: no entry declaration found under dist/');
}

let freed = 0;
for (const file of walk('dist')) {
  if (reachable.has(file)) continue;
  freed += statSync(file).size;
  rmSync(file);
}

/** An emptied directory is noise; the bundles keep their own alive. */
function prune(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) prune(join(dir, entry.name));
  }
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}
prune('dist');

const kept = [...reachable].map(file => relative('dist', file)).sort();
console.log(`types: kept ${kept.join(', ')} (${(freed / 1024).toFixed(0)}kb `
  + 'of unreachable declarations removed)');
