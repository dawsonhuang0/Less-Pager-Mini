import { describe, expect, it } from 'vitest';

import { PipeDecoder, initCharset } from '../../src/features/charset';

describe('PipeDecoder, like ch reading a non-seekable input', () => {
  it('emits only complete lines, holding the partial tail', () => {
    initCharset();
    const decoder = new PipeDecoder();

    expect(decoder.push(Buffer.from('ab'))).toEqual([]);
    expect(decoder.push(Buffer.from('c\ndef\ngh'))).toEqual(
      ['abc', 'def']
    );
    expect(decoder.flush()).toEqual(['gh']);
  });

  it('drops the final empty line after a trailing newline', () => {
    initCharset();
    const decoder = new PipeDecoder();

    expect(decoder.push(Buffer.from('x\ny\n'))).toEqual(['x', 'y']);
    expect(decoder.flush()).toEqual([]);
  });

  it('reassembles a multibyte char split across chunks', () => {
    initCharset();
    const decoder = new PipeDecoder();
    const bytes = Buffer.from('你好\n');

    expect(decoder.push(bytes.subarray(0, 2))).toEqual([]);
    expect(decoder.push(bytes.subarray(2))).toEqual(['你好']);
  });

  it('flushes a held incomplete sequence as raw-byte markers', () => {
    initCharset();
    const decoder = new PipeDecoder();

    // a lone lead byte never completes: it decodes like any other
    // invalid byte at end of input ($LESSBINFMT marker range)
    expect(decoder.push(Buffer.from([0x41, 0xE4]))).toEqual([]);

    const rest = decoder.flush();
    expect(rest).toHaveLength(1);
    expect(rest[0].charCodeAt(0)).toBe(0x41);
    expect(rest[0].length).toBe(2);
  });
});
