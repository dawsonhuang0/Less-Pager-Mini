import { describe, expect, it } from 'vitest';

import { renderLesskeyBinary } from '../../src/features/lesskeyRender';
import { compileLesskey } from '../../src/features/lesskeyCompile';

/** Compiles source, then renders the result back to source. */
const trip = (source: string): string => {
  const { data, errors } = compileLesskey(source, 707);

  expect(errors).toEqual([]);
  return renderLesskeyBinary(data as Buffer) as string;
};

/** A hand-built binary, for bytes no source produces. */
const binary = (...body: number[]): Buffer => Buffer.from([
  0x00, 0x4D, 0x2B, 0x47,
  0x63, body.length % 64, Math.floor(body.length / 64), ...body,
  0x65, 0, 0,
  0x76, 0, 0,
  0x78, 0x45, 0x6E, 0x64,
]);

/*
 * Rendering a compiled lesskey back as source (lesskeyRender.ts).
 *
 * less has no such thing - its lesskey only compiles - so there is no
 * oracle for the TEXT. What can be checked is that the text means the
 * same file, which tests/lksweep.py does over the whole corpus by
 * compiling the render and comparing bytes. These pin the notation.
 */
describe('rendering a compiled lesskey as source', () => {
  it('writes a binding under its section header', () => {
    expect(trip('#command\nx quit\n')).toBe('#command\nx\tquit\n');
  });

  it('names a special key by its \\k form, not its bytes', () => {
    // the file holds a blob, and the whole point of a blob is that the
    // terminal decides what it means later - so it renders as \ku,
    // never as whatever this terminal's up arrow happens to be
    expect(trip('#command\n\\ku back-line\n'))
      .toBe('#command\n\\ku\tback-line\n');

    // several \k forms reach one key; the shortest comes back
    expect(trip('#command\n\\k^b quit\n')).toBe('#command\n\\kB\tquit\n');

    // a literal ^K had to be stored as SK_CONTROL_K, and reads back
    // as the key it always was
    expect(trip('#command\n^K quit\n')).toBe('#command\n^K\tquit\n');
  });

  it('escapes what the parser would otherwise eat', () => {
    expect(trip('#command\n\\40 quit\n')).toBe('#command\n\\40\tquit\n');
    expect(trip('#command\n\\# quit\n')).toBe('#command\n\\#\tquit\n');
    expect(trip('#command\n\\^ quit\n')).toBe('#command\n\\^\tquit\n');
    expect(trip('#command\n\\\\ quit\n')).toBe('#command\n\\\\\tquit\n');
    expect(trip('#command\n^G quit\n')).toBe('#command\n^G\tquit\n');
  });

  it('keeps an extra string, with no \\k translation', () => {
    // less parses an extra with tstr's xlate off, so "\ku" there was
    // never a key name and must not come back as one
    expect(trip('#command\nx forw-line \\ku\n'))
      .toBe('#command\nx\tforw-line\tku\n');
    expect(trip('#command\nzz quit 5j\n')).toBe('#command\nzz\tquit\t5j\n');
  });

  it('writes #env and #stop back', () => {
    expect(trip('#env\nLESS = -R\n')).toBe('#env\nLESS = -R\n');
    expect(trip('#command\nx quit\n#stop\n'))
      .toBe('#command\nx\tquit\n#stop\n');
  });

  it('flattens += into the value it produced', () => {
    // the file holds one variable, not the two lines that built it
    expect(trip('#env\nA = 1\nA += 2\n')).toBe('#env\nA = 12\n');
  });

  it('comments an action no lesskey name reaches', () => {
    // A_F_MOUSE(66) is what less's decoder resolves a wheel report to,
    // so lesskey_parse.c never names it: only a hand-written binary
    // carries one, and it cannot be written back as a binding
    const source = renderLesskeyBinary(binary(0x78, 0x00, 66)) as string;

    expect(source).toBe(
      '#command\n# x  <action 66: no lesskey name for this>\n');
  });

  it('refuses anything that is not a lesskey binary', () => {
    expect(renderLesskeyBinary(Buffer.from('#command\nx quit\n')))
      .toBeNull();
    expect(renderLesskeyBinary(Buffer.alloc(0))).toBeNull();
  });

  it('skips a section it has nothing to say about', () => {
    // empty tables are still in the file; a header with no lines
    // under it would only confuse whoever opens the editor
    expect(trip('#command\nx quit\n')).not.toContain('#env');
  });
});
