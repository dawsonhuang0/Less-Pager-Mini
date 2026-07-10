import fs from 'fs';

import { opt } from '../options/state';

/**
 * Windowed file access, ported from og's ch.c: the file is read in
 * fixed blocks kept in an LRU pool, so any position of an arbitrarily
 * large file is reachable without loading it. Positions are byte
 * offsets (og's POSITION), safe as JS numbers up to 2^53.
 */

/** Block size, like og's LBUFSIZE. */
export const BLOCK_SIZE = 8192;

export class BlockFile {
  private fd: number;
  /** Resident blocks by block index, in LRU order (oldest first). */
  private blocks = new Map<number, Buffer>();
  /** File length at open (or last refresh), like ch_length. */
  size: number;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.fd = fs.openSync(path, 'r');
    this.size = fs.fstatSync(this.fd).size;
  }

  /** Re-checks the file length, for F follow and growing files. */
  refreshSize(): number {
    this.size = fs.fstatSync(this.fd).size;
    return this.size;
  }

  /**
   * The maximum resident blocks: -b caps the pool like og's bufspace
   * (in KB); -B off pins the cap, on lets it grow to a sane ceiling.
   */
  private maxBlocks(): number {
    const kb = opt.bufSpace > 0 ? opt.bufSpace : 64;
    const capped = Math.max(Math.floor((kb * 1024) / BLOCK_SIZE), 4);
    return opt.autoBuffers ? Math.max(capped, 2048) : capped;
  }

  /** Returns one block's bytes, reading and pooling it on demand. */
  private blockAt(index: number): Buffer {
    const have = this.blocks.get(index);

    if (have) {
      // refresh LRU position
      this.blocks.delete(index);
      this.blocks.set(index, have);
      return have;
    }

    const buf = Buffer.alloc(BLOCK_SIZE);
    const read = fs.readSync(this.fd, buf, 0, BLOCK_SIZE,
      index * BLOCK_SIZE);
    const block = read === BLOCK_SIZE ? buf : buf.subarray(0, read);

    this.blocks.set(index, block);

    while (this.blocks.size > this.maxBlocks()) {
      const oldest = this.blocks.keys().next().value as number;
      this.blocks.delete(oldest);
    }

    return block;
  }

  /**
   * Reads a byte range, assembled from pooled blocks; clipped at the
   * ends of the file.
   */
  readRange(pos: number, len: number): Buffer {
    const start = Math.max(pos, 0);
    const end = Math.min(pos + len, this.size);
    if (end <= start) return Buffer.alloc(0);

    const parts: Buffer[] = [];
    let at = start;

    while (at < end) {
      const index = Math.floor(at / BLOCK_SIZE);
      const block = this.blockAt(index);
      const offset = at - index * BLOCK_SIZE;
      const take = Math.min(end - at, block.length - offset);

      if (take <= 0) break; // shorter block than expected: EOF moved

      parts.push(block.subarray(offset, offset + take));
      at += take;
    }

    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  /**
   * The next newline at or after `pos`, or -1 within the searched
   * span; scans block by block like ch_forw_get.
   */
  findNewline(pos: number, limit: number): number {
    let at = Math.max(pos, 0);
    const end = Math.min(this.size, pos + limit);

    while (at < end) {
      const index = Math.floor(at / BLOCK_SIZE);
      const block = this.blockAt(index);
      const offset = at - index * BLOCK_SIZE;
      const span = Math.min(block.length, offset + (end - at));
      const hit = block.indexOf(0x0A, offset);

      if (hit >= 0 && hit < span) return index * BLOCK_SIZE + hit;
      if (block.length < BLOCK_SIZE) break; // last block

      at = (index + 1) * BLOCK_SIZE;
    }

    return -1;
  }

  /**
   * The last newline strictly before `pos`, or -1 within the span;
   * scans backward like ch_back_get.
   */
  findNewlineBack(pos: number, limit: number): number {
    let at = Math.min(pos, this.size);
    const stop = Math.max(at - limit, 0);

    while (at > stop) {
      const index = Math.floor((at - 1) / BLOCK_SIZE);
      const block = this.blockAt(index);
      const blockStart = index * BLOCK_SIZE;
      const from = Math.max(stop - blockStart, 0);
      const upto = at - blockStart; // exclusive
      const hit = block.subarray(from, upto).lastIndexOf(0x0A);

      if (hit >= 0) return blockStart + from + hit;

      at = blockStart;
    }

    return -1;
  }

  close(): void {
    fs.closeSync(this.fd);
    this.blocks.clear();
  }
}
