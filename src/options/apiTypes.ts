import { OptionSpec } from './spec';

/**
 * Builds the less-option key map behind the public PagerOptions type:
 * every LONG way a less option can be named in the options object,
 * with 'flag' (boolean) or 'value' (string | number) as its kind.
 *
 * - Every long name, plus its FULL-UPPERCASE form for triples (less's
 *   uppercase long name selects the second state).
 * - Option LETTERS are deliberately absent: a `-p`/`-S` key in an
 *   options object is unreadable next to the long names, and 200
 *   one-character entries drown the editor's completion list. The
 *   scan still accepts a letter passed at runtime, and $LESS carries
 *   the terminal spelling for anyone who wants it.
 *
 * The generated src/state/lessOptionTypes.ts snapshots this map; the
 * api test asserts the snapshot still matches the live table.
 */
export function buildLessOptionMap(
  specs: OptionSpec[]
): Record<string, 'flag' | 'value'> {
  const out: Record<string, 'flag' | 'value'> = {};

  for (const spec of specs) {
    const kind: 'flag' | 'value' =
      spec.type === 'number' || spec.type === 'string' ? 'value' : 'flag';

    for (const name of spec.names) {
      out[name] = kind;

      const upper = name.toUpperCase();
      if (spec.type === 'triple' && upper !== name && !(upper in out)) {
        out[upper] = kind;
      }
    }
  }

  return out;
}

/**
 * Every option LETTER the scan accepts, sorted, for the argument type.
 *
 * A triple's uppercase letter selects its second state (-e/-E), the
 * same way an uppercase NAME does above, so it belongs here even
 * though the table stores one letter per spec.
 */
export function buildLessOptionLetters(specs: OptionSpec[]): string[] {
  const out = new Set<string>();

  for (const spec of specs) {
    if (!spec.letter) continue;
    out.add(spec.letter);

    const upper = spec.letter.toUpperCase();
    if (spec.type === 'triple' && upper !== spec.letter) out.add(upper);
  }

  return [...out].sort();
}
