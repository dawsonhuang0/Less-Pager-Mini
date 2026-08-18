import {
  A_EXTRA,
  EV_OK,
  COMMAND_CODES,
  EDIT_ACTION_CODES,
  SK_SPECIAL_KEY,
  SK_CONTROL_K,
  SPECIAL_KEY_CODES,
} from './lesskeyCodes';

/**
 * Compiles lesskey source into the binary a `-k` file carries, like
 * less's `lesskey` program (lesskey.c) over lesskey_parse.c's tables.
 *
 * NOT exposed as a command. less ships `lesskey` as a separate program
 * and this pager deliberately does not: an npm install has no business
 * putting a compiler on anyone's PATH, and a source file is the better
 * thing to keep anyway. It exists for --edit-lesskey, which has to
 * write a binary back where it found one.
 *
 * It is a PORT, not a re-invention - the byte layout, the escape
 * handling and the error messages all follow less, and the tests compare
 * its output against the real `lesskey` binary byte for byte.
 */

/** Where a parse error goes; --edit-lesskey shows them like less does. */
export interface CompileResult {
  /** The compiled file, or null when nothing could be written. */
  data: Buffer | null;
  /** One message per error, already prefixed "line N: ". */
  errors: string[];
}

/** KRADIX: a section length is two base-64 bytes (lesskey.h:41). */
const KRADIX = 64;

const FILE_HEADER = [0x00, 0x4D, 0x2B, 0x47]; // C1_MAGIC
const CMD_SECTION = [0x63];                   // 'c'
const EDIT_SECTION = [0x65];                  // 'e'
const VAR_SECTION = [0x76];                   // 'v'
const END_SECTION = [0x78];                   // 'x'
const FILE_TRAILER = [0x45, 0x6E, 0x64];      // "End"

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t';

/** less's SK blob: the marker, the key, then 6 1 1 1. */
const skBlob = (code: number): number[] =>
  [SK_SPECIAL_KEY, code, 6, 1, 1, 1];

/**
 * One key token, like lesskey_parse.c's tstr.
 *
 * This is the COMPILER's tstr, so `\k` becomes an SK blob rather than
 * the terminal sequence the pager's own reader resolves it to. A bare
 * ^K goes the same way (the tstr_control_k static), because the raw
 * byte is what opens a blob and could not mean itself.
 *
 * @param xlate - False inside an extra string or a variable, where less
 *   leaves `\k` alone and a control byte stays literal.
 */
function tstr(
  line: string,
  at: number,
  xlate: boolean,
  error: (message: string) => void
): { bytes: number[], next: number } {
  const literal = (text: string, next: number): { bytes: number[],
    next: number } => {
    const bytes = [...text].map(c => c.charCodeAt(0) & 0xFF);

    return xlate && bytes.length === 1 && bytes[0] === 0x0B
      ? { bytes: skBlob(SK_CONTROL_K), next }
      : { bytes, next };
  };

  const c = line[at];

  if (c === '\\') {
    const e = line[at + 1] ?? '';

    if (e >= '0' && e <= '7') {
      let code = 0;
      let i = at + 1;

      for (let n = 0; n < 3 && line[i] >= '0' && line[i] <= '7'; n++) {
        code = code * 8 + (line.charCodeAt(i++) - 0x30);
      }

      return literal(String.fromCharCode(code & 0xFF), i);
    }

    switch (e) {
      // \b is the only one that less does NOT run through its control-K
      // check: it returns the string "\b" directly (lesskey_parse.c)
      case 'b': return { bytes: [0x08], next: at + 2 };
      case 'e': return literal('\x1B', at + 2);
      case 'n': return { bytes: [0x0A], next: at + 2 };
      case 'r': return { bytes: [0x0D], next: at + 2 };
      case 't': return { bytes: [0x09], next: at + 2 };

      case 'k': {
        if (!xlate) break;

        let name = line[at + 2] ?? '';
        let next = at + 3;

        if (name === '^' || name === '+' || name === 'p') {
          name += line[at + 3] ?? '';
          next++;
        }

        const code = SPECIAL_KEY_CODES[name];

        if (code === undefined) {
          error(`invalid escape sequence "\\k${name}"`);
          return { bytes: [], next };
        }

        return { bytes: skBlob(code), next };
      }
    }

    // backslash before anything else just means that character
    return literal(e, at + 2);
  }

  if (c === '^' && at + 1 < line.length) {
    return literal(String.fromCharCode(line.charCodeAt(at + 1) & 0x1F),
      at + 2);
  }

  return literal(c ?? '', at + 1);
}

/** Skips spaces and tabs, like less's skipsp. */
function skipSp(line: string, at: number): number {
  while (isSpace(line[at])) at++;
  return at;
}

/** The three tables a compiled file holds, as less's lesskey_tables. */
interface Tables {
  command: number[];
  edit: number[];
  variable: number[];
}

/**
 * A `KEY ACTION [EXTRA]` line, like parse_cmdline: the key bytes, a
 * NUL, then the action - with A_EXTRA OR'd in and the extra string
 * appended when one follows.
 */
function compileCmdLine(
  line: string,
  buffer: number[],
  names: Record<string, number>,
  error: (message: string) => void
): void {
  let i = 0;

  do {
    const token = tstr(line, i, true, error);
    buffer.push(...token.bytes);
    i = token.next;
  } while (i < line.length && !isSpace(line[i]));

  buffer.push(0);

  i = skipSp(line, i);

  if (i >= line.length) {
    error('missing action');
    return;
  }

  let end = i;
  while (end < line.length && !isSpace(line[end])) end++;

  const name = line.slice(i, end);
  let action = names[name];

  if (action === undefined) {
    error(`unknown action: "${name}"`);
    // less stores A_INVALID and carries on, so the rest of the file
    // still compiles and the key is dead rather than missing
    action = 100;
  }

  i = skipSp(line, end);

  if (i >= line.length) {
    buffer.push(action);
    return;
  }

  buffer.push(action | A_EXTRA);

  while (i < line.length) {
    const token = tstr(line, i, false, error);
    buffer.push(...token.bytes);
    i = token.next;
  }

  buffer.push(0);
}

/**
 * A `NAME = VALUE` line, like parse_varline. `+=` is less's "rather ugly
 * way": it erases the previous value's terminating NUL and appends,
 * ignoring the name it was given.
 */
function compileVarLine(
  line: string,
  buffer: number[],
  error: (message: string) => void
): void {
  const eq = line.indexOf('=');
  let i = 0;

  if (eq > 0 && line[eq - 1] === '+') {
    buffer.pop();
    i = eq + 1;
  } else {
    do {
      const token = tstr(line, i, false, error);
      buffer.push(...token.bytes);
      i = token.next;
    } while (i < line.length && !isSpace(line[i]) && line[i] !== '=');

    buffer.push(0);
    i = skipSp(line, i);

    if (line[i] !== '=') {
      error('missing = in variable definition');
      return;
    }

    i++;
    buffer.push(EV_OK | A_EXTRA);
  }

  i = skipSp(line, i);

  while (i < line.length) {
    const token = tstr(line, i, false, error);
    buffer.push(...token.bytes);
    i = token.next;
  }

  buffer.push(0);
}

/** Strips a trailing comment and surrounding space, like clean_line. */
function cleanLine(line: string): string {
  const s = line.replace(/^[ \t]+/, '');

  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\r' || s[i] === '\n') return s.slice(0, i);
    if (s[i] === '#' && (i === 0 || s[i - 1] !== '\\')) return s.slice(0, i);
  }

  return s;
}

/** A section length, as less's fputint: two base-64 bytes, low first. */
function putInt(out: number[], value: number): void {
  out.push(value % KRADIX, Math.floor(value / KRADIX) % KRADIX);
}

/**
 * Compiles lesskey source text into the binary file format.
 *
 * @param text - The source, as the editor left it.
 * @param version - The running less version, for #version lines.
 * @returns The bytes, and any messages less's parser would have printed.
 */
export function compileLesskey(text: string, version: number): CompileResult {
  const tables: Tables = { command: [], edit: [], variable: [] };
  const errors: string[] = [];

  let current: keyof Tables = 'command';
  let lineNumber = 0;

  for (const raw of text.split('\n')) {
    lineNumber++;

    // less's line is a C string: everything past a NUL is invisible
    const nul = raw.indexOf('\0');
    let line = nul >= 0 ? raw.slice(0, nul) : raw;

    const error = (message: string): void => {
      errors.push(`line ${lineNumber}: ${message}`);
    };

    // control lines, like control_line's five prefixes
    if (line.startsWith('#line-edit')) { current = 'edit'; continue; }
    if (line.startsWith('#command')) { current = 'command'; continue; }
    if (line.startsWith('#env')) { current = 'variable'; continue; }

    if (line.startsWith('#stop')) {
      // A_END_LIST, which makes the reader discard every table before
      // this one
      tables[current].push(0, 103);
      continue;
    }

    if (line.startsWith('#version')) {
      const rest = versionLine(line, version, error);
      if (rest === null) continue;
      line = rest;
    }

    line = cleanLine(line);
    if (line === '') continue;

    if (current === 'variable') {
      compileVarLine(line, tables.variable, error);
    } else {
      compileCmdLine(line, tables[current],
        current === 'edit' ? EDIT_ACTION_CODES : COMMAND_CODES, error);
    }
  }

  const out: number[] = [...FILE_HEADER];

  for (const [marker, table] of [
    [CMD_SECTION, tables.command],
    [EDIT_SECTION, tables.edit],
    [VAR_SECTION, tables.variable],
  ] as [number[], number[]][]) {
    if (table.length >= KRADIX * KRADIX) {
      return {
        data: null,
        errors: [...errors, `table too large: ${table.length} bytes`],
      };
    }

    out.push(...marker);
    putInt(out, table.length);
    out.push(...table);
  }

  out.push(...END_SECTION, ...FILE_TRAILER);

  return { data: Buffer.from(out), errors };
}

/**
 * A #version line: the rest of it when the version matches, null when
 * it does not, like version_line.
 */
function versionLine(
  line: string,
  version: number,
  error: (message: string) => void
): string | null {
  // less reads the OPERATOR first and the number second, so a bad
  // number is reported as a bad number even when the operator was
  // fine (version_line, lesskey_parse.c)
  const rest = line.slice('#version'.length).replace(/^[ \t]+/, '');
  const two = /^(>=|<=|==|!=)/.exec(rest);
  const op = two ? two[1] : rest[0] ?? '';

  if (!'<>=!'.includes(op[0] ?? '')) {
    error(`invalid operator '${op[0] ?? ''}' in #version line`);
    return null;
  }

  const after = rest.slice(op.length).replace(/^[ \t]+/, '');
  const digits = /^\d+/.exec(after);

  if (!digits) {
    error('non-numeric version number in #version line');
    return null;
  }

  const want = parseInt(digits[0], 10);

  const ok =
    op === '>' ? version > want :
    op === '<' ? version < want :
    op === '>=' ? version >= want :
    op === '<=' ? version <= want :
    op === '=' || op === '==' ? version === want :
    version !== want;

  return ok ? after.slice(digits[0].length) : null;
}
