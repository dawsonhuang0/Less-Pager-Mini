import {
  A_EXTRA,
  COMMAND_NAMES,
  EDIT_ACTION_NAMES,
  SK_SPECIAL_KEY,
  SK_CONTROL_K,
  SPECIAL_KEY_CODES,
} from './lesskeyCodes';

/**
 * Renders a compiled lesskey back as the source it was built from.
 *
 * A binary cannot be edited, and less ships no tool that turns one back
 * into text - `lesskey` only goes one way. --edit-lesskey needs the
 * other way, so a user whose keys live in ~/.less sees the same thing
 * a user with ~/.lesskey sees.
 *
 * What comes out is not the ORIGINAL text - comments, spacing, the
 * order of sections and the choice between synonyms are all lost, they
 * were never in the file. What is guaranteed is that compiling the
 * result gives the same bytes back, which is what tests/lksweep.py
 * checks in both directions.
 */

/** An SK code back to the shortest \k form that produces it. */
const SPECIAL_KEY_NAMES: Record<number, string> = {};

for (const [name, code] of Object.entries(SPECIAL_KEY_CODES)) {
  const held = SPECIAL_KEY_NAMES[code];

  // several forms reach one key ("B" and "^b" are both a control
  // backspace); the shortest reads best, and ties go alphabetically
  // so the output cannot depend on object order
  if (held === undefined || name.length < held.length ||
      (name.length === held.length && name < held)) {
    SPECIAL_KEY_NAMES[code] = name;
  }
}

/** Where a section's bytes came from, so the header can name it. */
type Section = 'command' | 'edit' | 'var';

/**
 * One byte of a key sequence, in source notation.
 *
 * The escapes are less's tstr read backwards: a control byte becomes
 * `^X`, the three characters that mean something to the parser get a
 * backslash, and anything unprintable falls back to octal - which
 * tstr accepts for any byte at all.
 */
function keyByte(byte: number): string {
  if (byte === 0x20) return '\\40';             // a bare space ends the key
  if (byte < 0x20) return '^' + String.fromCharCode(byte + 0x40);
  if (byte >= 0x7F) return '\\' + byte.toString(8).padStart(3, '0');

  const ch = String.fromCharCode(byte);
  return '\\#^'.includes(ch) || ch === '\\' ? '\\' + ch : ch;
}

/** A key sequence, blobs expanded back to their \k names. */
function keySequence(bytes: number[]): string {
  let out = '';

  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === SK_SPECIAL_KEY && bytes[i + 1] !== undefined) {
      const code = bytes[i + 1];

      // a blob is six bytes: the marker, the key, then 6 1 1 1
      i += 5;

      // SK_CONTROL_K is how a literal ^K had to be stored, so it
      // renders as the key it always was
      if (code === SK_CONTROL_K) {
        out += '^K';
        continue;
      }

      const name = SPECIAL_KEY_NAMES[code];

      // a blob no \k form produces cannot be written as source at all;
      // less's own tables never emit one, so this is a corrupt file
      out += name === undefined ? `\\k?${code}` : '\\k' + name;
      continue;
    }

    out += keyByte(bytes[i]);
  }

  return out;
}

/**
 * An extra string, or a variable's value.
 *
 * less parses these with tstr's translation OFF, so `\k` means a
 * literal k and only the plain escapes apply - but `^X` still means
 * control, since that case sits outside the xlate test.
 */
function plainString(bytes: number[]): string {
  return bytes.map(byte => {
    if (byte < 0x20) return '^' + String.fromCharCode(byte + 0x40);
    if (byte >= 0x7F) return '\\' + byte.toString(8).padStart(3, '0');

    const ch = String.fromCharCode(byte);
    return ch === '\\' || ch === '#' || ch === '^' ? '\\' + ch : ch;
  }).join('');
}

/** Reads to the next NUL, returning the bytes and the position past it. */
function upToNul(bytes: number[], at: number): { taken: number[],
  next: number } {
  let end = at;
  while (end < bytes.length && bytes[end] !== 0) end++;

  return { taken: bytes.slice(at, end), next: end + 1 };
}

/** One #command or #line-edit table, as source lines. */
function renderBindings(bytes: number[], section: Section): string[] {
  const names = section === 'edit' ? EDIT_ACTION_NAMES : COMMAND_NAMES;
  const lines: string[] = [];
  let at = 0;

  while (at < bytes.length) {
    const key = upToNul(bytes, at);
    at = key.next;

    if (at > bytes.length) break;

    const action = bytes[at++];

    if (action === undefined) break;

    // less's A_END_LIST, which a #stop line put there
    if (key.taken.length === 0 && action === 103) {
      lines.push('#stop');
      continue;
    }

    let extra = '';

    if (action & A_EXTRA) {
      const rest = upToNul(bytes, at);
      at = rest.next;
      extra = plainString(rest.taken);
    }

    const code = action & ~A_EXTRA;
    const name = names[code];

    if (name === undefined) {
      // no name exists for it - the four mouse codes, or a corrupt
      // byte. Saying so beats writing a line that will not compile
      lines.push(`# ${keySequence(key.taken)}  <action ${code}: ` +
        'no lesskey name for this>');
      continue;
    }

    lines.push(`${keySequence(key.taken)}\t${name}` +
      (extra === '' ? '' : `\t${extra}`));
  }

  return lines;
}

/** The #env table, as `NAME = value` lines. */
function renderVariables(bytes: number[]): string[] {
  const lines: string[] = [];
  let at = 0;

  while (at < bytes.length) {
    const name = upToNul(bytes, at);
    at = name.next;

    // no action byte follows: this is what less writes for a "+=" with
    // nothing to append to (parse_varline erases the previous entry's
    // terminating NUL, and on an empty table there is none). The name
    // never reached the file, so "+= value" is the only source that
    // rebuilds these exact bytes - and it is what less's own compiler
    // accepts, since parse_varline only needs a "+" before the "="
    if (at >= bytes.length) {
      lines.push(`+= ${plainString(name.taken)}`);
      break;
    }

    // the action byte is always EV_OK|A_EXTRA here
    at++;

    const value = upToNul(bytes, at);
    at = value.next;

    if (name.taken.length === 0) continue;

    lines.push(`${plainString(name.taken)} = ${plainString(value.taken)}`);
  }

  return lines;
}

/**
 * Renders a compiled lesskey file as source text.
 *
 * @param data - The file, starting at its "\0M+G" magic.
 * @returns The source, or null when this is not a lesskey binary.
 */
export function renderLesskeyBinary(data: Buffer): string | null {
  const bytes = [...data];

  if (bytes[0] !== 0x00 || bytes[1] !== 0x4D || bytes[2] !== 0x2B ||
      bytes[3] !== 0x47) {
    return null;
  }

  const out: string[] = [];
  let at = 4;

  while (at < bytes.length) {
    const marker = String.fromCharCode(bytes[at]);

    if (marker === 'x') break;

    const length = bytes[at + 1] + bytes[at + 2] * 64;
    const body = bytes.slice(at + 3, at + 3 + length);
    at += 3 + length;

    const section: Section | null =
      marker === 'c' ? 'command' :
      marker === 'e' ? 'edit' :
      marker === 'v' ? 'var' : null;

    // less's lesskey skips a section type it does not know, and so does
    // its reader; there is nothing to render for one either
    if (section === null || body.length === 0) continue;

    const lines = section === 'var'
      ? renderVariables(body)
      : renderBindings(body, section);

    if (lines.length === 0) continue;

    out.push(section === 'command' ? '#command' :
      section === 'edit' ? '#line-edit' : '#env');
    out.push(...lines, '');
  }

  return out.join('\n');
}
