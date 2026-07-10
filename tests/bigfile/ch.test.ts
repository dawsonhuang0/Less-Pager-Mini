import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { BlockFile, BLOCK_SIZE } from '../../src/bigfile/ch';

import { forwLine, backLine, lastLineStart }
  from '../../src/bigfile/lineio';

import { opt } from '../../src/options/state';

import { initCharset } from '../../src/features/charset';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-bigfile-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  opt.bufSpace = 64;
  opt.autoBuffers = 1;
  initCharset();
});

/** Writes a file and opens it. */
function open(name: string, data: string | Buffer): BlockFile {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return new BlockFile(p);
}

describe('BlockFile', () => {
  it('reads ranges across block boundaries', () => {
    const line = 'x'.repeat(100) + '\n';
    const bf = open('spans.txt', line.repeat(200)); // ~20KB, 3 blocks

    const range = bf.readRange(BLOCK_SIZE - 50, 100);
    expect(range.length).toBe(100);
    expect(bf.readRange(0, 5).toString()).toBe('xxxxx');
    expect(bf.size).toBe(101 * 200);
    bf.close();
  });

  it('clips reads at EOF and finds newlines both ways', () => {
    const bf = open('small.txt', 'one\ntwo\nthree');

    expect(bf.readRange(10, 100).toString()).toBe('ree');
    expect(bf.findNewline(0, 100)).toBe(3);
    expect(bf.findNewline(4, 100)).toBe(7);
    expect(bf.findNewline(8, 100)).toBe(-1);
    expect(bf.findNewlineBack(7, 100)).toBe(3);
    expect(bf.findNewlineBack(3, 100)).toBe(-1);
    bf.close();
  });

  it('keeps the pool within the -b cap', () => {
    opt.bufSpace = 16; // 16KB = 2 blocks
    opt.autoBuffers = 0;

    const bf = open('pool.txt', Buffer.alloc(BLOCK_SIZE * 8, 0x61));

    for (let i = 0; i < 8; i++) bf.readRange(i * BLOCK_SIZE, 10);

    // all reads still work after eviction
    expect(bf.readRange(0, 3).toString()).toBe('aaa');
    bf.close();
  });
});

describe('line reading', () => {
  it('walks lines forward and backward by position', () => {
    const bf = open('lines.txt', 'alpha\nbravo\ncharlie\n');

    const l1 = forwLine(bf, 0);
    expect(l1?.text).toBe('alpha');
    expect(l1?.next).toBe(6);

    const l2 = forwLine(bf, l1!.next);
    expect(l2?.text).toBe('bravo');

    const back = backLine(bf, l1!.next);
    expect(back?.text).toBe('alpha');
    expect(back?.start).toBe(0);

    const back2 = backLine(bf, 12);
    expect(back2?.text).toBe('bravo');
    expect(back2?.start).toBe(6);

    expect(backLine(bf, 0)).toBeNull();
    bf.close();
  });

  it('handles a last line without a trailing newline', () => {
    const bf = open('tail.txt', 'one\ntwo');

    expect(lastLineStart(bf)).toBe(4);
    expect(forwLine(bf, 4)?.text).toBe('two');
    expect(forwLine(bf, 4)?.next).toBe(7);
    expect(forwLine(bf, 7)).toBeNull();
    bf.close();
  });

  it('treats a trailing newline like og: last line precedes it', () => {
    const bf = open('nltail.txt', 'one\ntwo\n');
    expect(lastLineStart(bf)).toBe(4);
    bf.close();
  });

  it('splits a pathological newline-less line at the cap', () => {
    const bf = open('monster.txt', Buffer.alloc((1 << 20) + 10, 0x62));

    const l1 = forwLine(bf, 0);
    expect(l1?.split).toBe(true);
    expect(l1?.next).toBe(1 << 20);

    const l2 = forwLine(bf, l1!.next);
    expect(l2?.text.length).toBe(10);
    expect(l2?.split).toBe(false);
    bf.close();
  });

  it('reads lines spanning multiple blocks', () => {
    const long = 'y'.repeat(BLOCK_SIZE * 2 + 100);
    const bf = open('long.txt', `${long}\nend\n`);

    const l1 = forwLine(bf, 0);
    expect(l1?.text.length).toBe(BLOCK_SIZE * 2 + 100);
    expect(forwLine(bf, l1!.next)?.text).toBe('end');
    bf.close();
  });
});

describe('terabyte-scale access', () => {
  it('opens and reads a sparse 1TB file instantly', () => {
    const p = path.join(dir, 'huge.txt');
    const fd = fs.openSync(p, 'w');
    fs.writeSync(fd, 'first line\n');
    fs.ftruncateSync(fd, 2 ** 40); // 1TB, sparse
    fs.writeSync(fd, Buffer.from('\nthe very end\n'), 0, 14, 2 ** 40 - 14);
    fs.closeSync(fd);

    const t0 = Date.now();
    const bf = new BlockFile(p);

    expect(bf.size).toBe(2 ** 40);
    expect(forwLine(bf, 0)?.text).toBe('first line');

    // jump to the end like G: only the last blocks are touched
    const last = lastLineStart(bf);
    expect(forwLine(bf, last)?.text).toBe('the very end');

    // byte-percent jump like og's jump_percent
    const mid = Math.floor(bf.size / 2);
    expect(bf.readRange(mid, 8).length).toBe(8);

    expect(Date.now() - t0).toBeLessThan(500);
    bf.close();
    fs.rmSync(p);
  });
});
