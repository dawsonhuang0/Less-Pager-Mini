/**
 * Builds dist: four bundles, minified.
 *
 * This is the esbuild CLI call in script form, for the one thing the
 * CLI cannot express - a plugin. `jsRegexGuard` carries the source of
 * its two worker threads as template literals, handed to `new Worker`
 * under `eval: true`. A minifier will not reach inside a string, and
 * it is right not to: changing a string changes the program. So those
 * two are stripped here instead, where the build knows they are code.
 */
import { build, type Plugin } from 'esbuild';
import { readFile } from 'fs/promises';

/** What ships: the library, the CLI, and the two child entries. */
const ENTRIES = [
  'src/index.ts',
  'src/cli.ts',
  'src/features/jsRegexGuard.ts',
  'src/tty/title.ts',
];

/** The file holding worker source, and the constants that hold it. */
const GUARD = /src\/features\/jsRegexGuard\.ts$/;
const WORKERS = ['MATCHER', 'WATCHER'];

/**
 * Drops the comment lines from one worker's source.
 *
 * Line-based on purpose. The two templates carry no block comment, no
 * nested backtick, and no `//` past code - checked below - so there is
 * nothing here that a real parse would catch and this would not, and
 * a wrong parse of a string full of `${}` holes is the bigger risk.
 * Indentation stays: the shipped worker is still readable, and gzip
 * has long since stopped charging for a repeated run of spaces.
 */
function strip(source: string, name: string): string {
  if (source.includes('`') || source.includes('/*')) {
    throw new Error(`build: ${name} is no longer line-comments-only`);
  }

  const kept = source.split('\n').filter(line => {
    const bare = line.trim();

    if (bare !== '' && !bare.startsWith('//') && bare.includes('//')) {
      throw new Error(`build: ${name} has a trailing comment: ${bare}`);
    }
    return bare !== '' && !bare.startsWith('//');
  });

  return `\n${kept.join('\n')}\n`;
}

/** Rewrites the guard as it is loaded, leaving src untouched. */
const stripWorkerComments: Plugin = {
  name: 'strip-worker-comments',
  setup(builder) {
    builder.onLoad({ filter: GUARD }, async ({ path }) => {
      let contents = await readFile(path, 'utf8');

      for (const name of WORKERS) {
        const declaration = new RegExp('const ' + name + ' = `([^`]*)`');
        const found = declaration.exec(contents);

        if (found === null) {
          throw new Error(`build: ${name} is not a template literal`);
        }
        // a replacer function, never a replacement string: `$` is
        // magic in the latter, and worker source is all `${...}`
        contents = contents.replace(
          found[0], () => `const ${name} = \`${strip(found[1], name)}\``
        );
      }
      return { contents, loader: 'ts' };
    });
  },
};

build({
  entryPoints: ENTRIES,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outdir: 'dist',
  external: ['node:*'],
  minify: true,
  logLevel: 'info',
  plugins: [stripWorkerComments],
}).catch(() => process.exit(1));
