import { describe, expect, it } from 'vitest';

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Every import form, type-checked against the BUILT package.
 *
 * The entry is CommonJS whose `module.exports` is the function, and
 * saying so needs `export =`; an ES-shaped declaration over it made
 * TypeScript compute `default` as the module namespace, which has no
 * call signatures. Every form that reached the default failed under
 * `module: nodenext` while the runtime handed back the function - so
 * nothing in-process could catch it, and a consumer had to.
 *
 * Both resolutions, because they disagreed: `bundler` accepted all of
 * it and `nodenext` accepted none of the default forms.
 */
const ROOT = path.join(__dirname, '..', '..');
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc');

const CASES: Record<string, string> = {
  'static default': `
    import pager from 'less-pager-mini';
    export const f = (): Promise<void> => pager(['a'], ['-R']);`,
  'named pagerPipe': `
    import { pagerPipe } from 'less-pager-mini';
    export const f = (s: never): Promise<void> => pagerPipe(s, ['-R']);`,
  'namespace default': `
    import * as ns from 'less-pager-mini';
    export const f = (): Promise<void> => ns.default(['a'], ['-R']);`,
  'dynamic destructured': `
    export const f = async (): Promise<void> => {
      const { default: pager } = await import('less-pager-mini');
      await pager(['a'], ['-R']);
    };`,
  'dynamic property': `
    export const f = async (): Promise<void> => {
      const pager = (await import('less-pager-mini')).default;
      await pager(['a'], ['-R']);
    };`,
  'type imports': `
    import type { PagerArg, LessOptions, PagerEnv } from 'less-pager-mini';
    export type A = PagerArg;
    export type B = keyof LessOptions;
    export type C = PagerEnv;`,
};

/** `import x = require()`, which only an `export =` entry allows. */
const REQUIRE_CASE = `
  import pager = require('less-pager-mini');
  export const f = (): Promise<void> => pager(['a'], ['-R']);`;

function check(source: string, resolution: 'nodenext' | 'bundler'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmn-types-'));

  try {
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.symlinkSync(ROOT, path.join(dir, 'node_modules', 'less-pager-mini'));
    fs.symlinkSync(path.join(ROOT, 'node_modules', '@types'),
      path.join(dir, 'node_modules', '@types'));

    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'c', version: '1.0.0', type: 'module' }));
    fs.writeFileSync(path.join(dir, 'index.ts'), source);
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        module: resolution === 'bundler' ? 'esnext' : 'nodenext',
        moduleResolution: resolution,
        target: 'es2022',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        esModuleInterop: true,
        types: ['node'],
      },
      files: ['index.ts'],
    }));

    try {
      execFileSync(TSC, ['-p', dir], { encoding: 'utf8', stdio: 'pipe' });
      return '';
    } catch (error) {
      return String((error as { stdout?: string }).stdout ?? error).trim();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.each(['nodenext', 'bundler'] as const)('%s', resolution => {
  // each case spawns tsc over the whole built package, which is well
  // past vitest's default 5s once the rest of the suite is running
  it.each(Object.entries(CASES))('type-checks %s', (_name, source) => {
    expect(check(source, resolution)).toBe('');
  }, 120_000);

  if (resolution === 'nodenext') {
    it('type-checks import = require', () => {
      expect(check(REQUIRE_CASE, resolution)).toBe('');
    }, 120_000);
  }
});
