import { beforeEach, describe, expect, it, vi } from 'vitest';

import { compileLesskey } from '../../src/features/lesskeyCompile';

import { resetLesskey, parseLesskeyBinary, userBinding }
  from '../../src/features/lesskey';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

/** The compiled bytes, as numbers, for a source that must not fail. */
const compile = (source: string): number[] => {
  const { data, errors } = compileLesskey(source, 707);

  expect(errors).toEqual([]);
  expect(data).not.toBeNull();
  return [...data as Buffer];
};

/** Just one section's payload, by its marker letter. */
const section = (bytes: number[], marker: string): number[] => {
  let at = 4; // past "\0M+G"

  for (;;) {
    const type = String.fromCharCode(bytes[at]);
    const length = bytes[at + 1] + bytes[at + 2] * 64;
    const body = bytes.slice(at + 3, at + 3 + length);

    if (type === marker) return body;
    if (type === 'x') throw new Error(`no ${marker} section`);
    at += 3 + length;
  }
};

beforeEach(() => {
  resetLesskey();
});

/*
 * The lesskey compiler (src/features/lesskeyCompile.ts).
 *
 * tests/lksweep.py is the real check -- it compiles a corpus with GNU
 * lesskey out of the vendored tree and compares byte for byte. These
 * cover the shapes a reader of this code would want pinned, and run
 * without needing that binary built.
 */
describe('compiling lesskey source', () => {
  it('lays the file out like less\'s lesskey.c', () => {
    const bytes = compile('#command\nx quit\n');

    // "\0M+G", then c/e/v sections, then "x" "End"
    expect(bytes.slice(0, 4)).toEqual([0x00, 0x4D, 0x2B, 0x47]);
    expect(bytes.slice(-4)).toEqual([0x78, 0x45, 0x6E, 0x64]);

    // a length is two base-64 bytes, low first (fputint)
    expect(bytes.slice(4, 7)).toEqual([0x63, 3, 0]);

    // key bytes, NUL, then the action code - A_QUIT is 24
    expect(section(bytes, 'c')).toEqual([0x78, 0x00, 24]);

    // the empty sections are still written, with a zero length
    expect(section(bytes, 'e')).toEqual([]);
    expect(section(bytes, 'v')).toEqual([]);
  });

  it('stores a special key as less\'s BLOB, not a terminal sequence', () => {
    // the difference between compiling and reading: a compiled file
    // carries SK_SPECIAL_KEY <code> 6 1 1 1 and the reader expands it
    // through terminfo at load time, so what the terminal calls an up
    // arrow today cannot be baked in here
    expect(section(compile('#command\n\\ku back-line\n'), 'c'))
      .toEqual([0x0B, 3, 6, 1, 1, 1, 0x00, 2]); // SK_UP_ARROW, A_B_LINE

    // a literal ^K goes the same way (SK_CONTROL_K), because the raw
    // byte is what opens a blob and so cannot mean itself
    expect(section(compile('#command\n^K quit\n'), 'c'))
      .toEqual([0x0B, 40, 6, 1, 1, 1, 0x00, 24]);
  });

  it('leaves \\k alone inside an extra string, like less', () => {
    // tstr is called with xlate off there, so this is five characters
    const body = section(compile('#command\nx quit \\ku\n'), 'c');

    expect(body).toEqual([
      0x78, 0x00, 24 | 0x80,             // x, NUL, A_QUIT | A_EXTRA
      0x6B, 0x75, 0x00,                  // "ku", NUL  -- the \ is eaten
    ]);
  });

  it('writes #env with less\'s EV_OK, and appends with +=', () => {
    // NAME NUL (EV_OK|A_EXTRA) VALUE NUL; += erases the terminating
    // NUL and carries on, ignoring the name it was given
    expect(section(compile('#env\nA = 1\nA += 2\n'), 'v')).toEqual([
      0x41, 0x00, 0x81, 0x31, 0x32, 0x00,
    ]);
  });

  it('writes #stop as less\'s end-of-list marker', () => {
    expect(section(compile('#command\nx quit\n#stop\n'), 'c'))
      .toEqual([0x78, 0x00, 24, 0x00, 103]); // A_END_LIST
  });

  it('reports what less reports, in less\'s words', () => {
    const bad = (source: string): string[] =>
      compileLesskey(source, 707).errors;

    expect(bad('#command\nx blah\n'))
      .toEqual(['line 2: unknown action: "blah"']);
    expect(bad('#command\nx\n')).toEqual(['line 2: missing action']);
    expect(bad('#command\n\\kz quit\n'))
      .toEqual(['line 2: invalid escape sequence "\\kz"']);
    expect(bad('#env\nBAZ\n'))
      .toEqual(['line 2: missing = in variable definition']);

    // the operator is read before the number, so a bad number is
    // reported as one even though the operator parsed
    expect(bad('#version ~ 6\nx quit\n'))
      .toEqual(["line 1: invalid operator '~' in #version line"]);
    expect(bad('#version > abc\nx quit\n'))
      .toEqual(['line 1: non-numeric version number in #version line']);
  });

  it('stores A_INVALID for an unknown action and keeps compiling', () => {
    const { data } = compileLesskey('#command\nx blah\ny quit\n', 707);
    const body = section([...data as Buffer], 'c');

    // less's findaction returns A_INVALID and parsing carries on, so the
    // key is dead rather than the rest of the file being lost
    expect(body).toEqual([0x78, 0x00, 100, 0x79, 0x00, 24]);
  });

  it('produces a file this pager reads back', () => {
    const { data } = compileLesskey(
      '#command\nx quit\ngg goto-line\nq forw-line 5j\n', 707);

    parseLesskeyBinary(data as Buffer);

    expect(userBinding('x')?.action).toBe('EXIT');
    expect(userBinding('gg')?.action).toBe('FIRST_LINE');
    expect(userBinding('q')).toEqual({
      action: 'LINE_FORWARD',
      key: undefined,
      extra: '5j',
    });
  });
});
