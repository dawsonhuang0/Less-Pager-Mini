/**
 * Regenerates src/state/lessOptionTypes.ts, the public option-key type
 * behind PagerConfig: `npm run gen:options`.
 *
 * The key map comes from the live option table, each key's description
 * from og's own --help text, and a value option's @default from the
 * table entry. tests/misc/api.test.ts fails while the snapshot lags
 * the table, and this script is what fixes it.
 */
import fs from 'fs';
import path from 'path';

import { optionSpecs } from '../src/options';
import { buildLessOptionMap, buildLessOptionLetters }
  from '../src/options/apiTypes';
import { help } from '../src/startup/lessHelp';

const TARGET = path.join(__dirname, '..', 'src/state/lessOptionTypes.ts');

/** Drops the overstrike underlining og's help text carries. */
const plain = (line: string): string => line.replace(/.\x08/g, '');

// --- descriptions, read out of the help text ---------------------------

const described = new Map<string, string>();

for (let i = 0; i < help.length; i++) {
  const line = plain(help[i]);
  const names = [...line.matchAll(/--([A-Za-z][A-Za-z0-9-]*)/g)].map(m => m[1]);

  if (!names.length) continue;

  const text: string[] = [];

  for (let j = i + 1; j < help.length; j++) {
    const next = plain(help[j]);

    // descriptions sit at column 18; a long-only option's own header
    // sits at 16, so it must not be swallowed as description text
    if (!/^ {18,}\S/.test(next) || /--[A-Za-z]/.test(next)) break;

    text.push(next.trim());
  }

  if (!text.length) continue;

  for (const name of names) {
    if (!described.has(name)) described.set(name, text.join(' '));
  }
}

// --- the spec behind each key, for its default -------------------------

const specs = optionSpecs();
const specOf = new Map<string, (typeof specs)[number]>();

for (const spec of specs) {
  for (const name of spec.names) {
    specOf.set(name, spec);

    const upper = name.toUpperCase();
    if (spec.type === 'triple' && !specOf.has(upper)) specOf.set(upper, spec);
  }
}

/**
 * The default this KEY carries, for value options only. A flag's table
 * default describes og's VARIABLE, not the named behavior: -B
 * --auto-buffers starts at 1 while its text reads "don't allocate", a
 * triple's 2 is not its uppercase key, and --no-shell starts ON for
 * library calls. Those are documented on the interface instead of
 * guessed per key.
 */
function defaultOf(key: string, kind: 'flag' | 'value'): string | null {
  if (kind !== 'value') return null;

  const spec = specOf.get(key);
  if (!spec) return null;

  const value = spec.defaultValue;
  if (value === '' || value === undefined) return null;

  return typeof value === 'number' ? String(value) : `'${value}'`;
}

// --- emit --------------------------------------------------------------

const map = buildLessOptionMap(specs);
const letters = buildLessOptionLetters(specs);
const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const quoted = (name: string): string => ident.test(name) ? name : `'${name}'`;

/** Wraps a doc comment at the lint limit, like the hand-written ones. */
function docComment(doc: string): string {
  const oneLine = `  /** ${doc} */`;
  if (oneLine.length <= 80) return oneLine;

  const lines: string[] = [];
  let line = '';

  for (const word of doc.split(' ')) {
    if (line && `   * ${line} ${word}`.length > 78) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }

  if (line) lines.push(line);

  return `  /**\n${lines.map(l => `   * ${l}`).join('\n')}\n   */`;
}

const props = Object.entries(map).map(([name, kind]) => {
  const spec = specOf.get(name);

  // og's help, then the lowercase entry an uppercase triple name is
  // folded into, then the option's own toggle message
  const desc = described.get(name) ??
    (name === name.toUpperCase()
      ? described.get(name.toLowerCase())
      : undefined) ??
    (spec && spec.messages.length > 1 ? `${spec.messages[1]}.` : undefined);

  const def = defaultOf(name, kind);

  const doc = [desc, def === null ? null : `@default ${def}`]
    .filter(Boolean).join(' ');

  const type = kind === 'value' ? 'number | string' : 'boolean';

  return `${docComment(doc || 'A less option.')}\n  ${quoted(name)}?: ${type};`;
}).join('\n');

const values = Object.entries(map)
  .map(([name, kind]) => `  ${quoted(name)}: '${kind}',`)
  .join('\n');

fs.writeFileSync(TARGET, `// GENERATED FILE - do not edit. Snapshot of \
buildLessOptionMap over
// the live option table (src/options), with each key's description
// taken from og's --help text and its default from the option table.
// Regenerate with \`npm run gen:options\`; tests/misc/api.test.ts fails
// until the snapshot matches the table again.

/** Every less option key the pager options object accepts. */
export const LESS_OPTION_VALUES = {
${values}
} as const;

/**
 * less option keys, typed: flags take a boolean, the rest a value.
 * Spelled out rather than mapped over LESS_OPTION_VALUES so each key
 * carries its own doc comment — the editor shows the description and
 * the default as you pick the name out of the completion list.
 *
 * A flag left out keeps less's startup state, which for nearly every
 * option means off; the exceptions are og's own inverted names (-B
 * --auto-buffers, -G --HILITE-SEARCH) and --no-shell, which a library
 * call starts ON. Only value options carry an @default, since a
 * triple's table state does not map onto one key's boolean.
 */
export interface LessOptions {
${props}
}

/**
 * Every option LETTER the scan accepts, so \`-R\` and \`-N\` are offered
 * beside the long names. A letter carries no doc comment: og's help
 * describes the option, and the letter is one spelling of it.
 */
export type LessOptionLetter =
${letters.map(l => `  | '${l}'`).join('\n')};
`);

console.log(`wrote ${Object.keys(map).length} option keys to ${TARGET}`);
