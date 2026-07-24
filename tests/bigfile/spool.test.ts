import { EventEmitter } from 'events';
import fs from 'fs';
import { Readable } from 'stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PipeSpool } from '../../src/pager/spool';

class FakePipe extends EventEmitter {
  paused = true;
  destroyed = false;
  pause = vi.fn(() => {
    this.paused = true;
    return this;
  });
  resume = vi.fn(() => {
    this.paused = false;
    return this;
  });
  destroy = vi.fn(() => {
    this.destroyed = true;
    return this;
  });
}

const open: PipeSpool[] = [];

async function create(first: Buffer | null): Promise<{
  stream: FakePipe,
  spool: PipeSpool,
}> {
  const stream = new FakePipe();
  const pending = PipeSpool.create(stream as unknown as Readable);

  if (first === null) stream.emit('end');
  else stream.emit('data', first);

  const spool = await pending;
  open.push(spool);
  return { stream, spool };
}

afterEach(() => {
  for (const spool of open.splice(0)) spool.close();
});

describe('bounded pipe spooling', () => {
  it('captures one chunk, then holds upstream at an absolute target',
    async () => {
      const { stream, spool } = await create(Buffer.from('abc'));

      expect(stream.pause).toHaveBeenCalledOnce();
      expect(stream.paused).toBe(true);
      expect(fs.readFileSync(spool.path, 'utf8')).toBe('abc');

      spool.requestThrough(10);
      expect(stream.paused).toBe(false);

      stream.emit('data', Buffer.from('defg'));
      expect(spool.size).toBe(7);
      expect(stream.paused).toBe(false);

      stream.emit('data', Buffer.from('hij'));
      expect(spool.size).toBe(10);
      expect(stream.paused).toBe(true);
      expect(fs.readFileSync(spool.path, 'utf8')).toBe('abcdefghij');
    });

  it('drains only when explicitly requested and reports true EOF',
    async () => {
      const { stream, spool } = await create(Buffer.from('head\n'));
      const events: boolean[] = [];
      spool.subscribe(event => events.push(event.ended));

      spool.drain();
      expect(stream.paused).toBe(false);
      stream.emit('data', Buffer.from('tail'));
      stream.emit('end');
      await spool.waitForEnd();

      expect(spool.ended).toBe(true);
      expect(events.at(-1)).toBe(true);
      expect(fs.readFileSync(spool.path, 'utf8')).toBe('head\ntail');
    });

  it('cancels an unbounded drain back to immediate backpressure',
    async () => {
      const { stream, spool } = await create(Buffer.from('head\n'));

      spool.drain();
      expect(stream.paused).toBe(false);
      spool.cancelDrain();

      expect(stream.paused).toBe(true);
      expect(spool.ended).toBe(false);
    });

  it('handles an empty pipe and removes its private directory',
    async () => {
      const { spool } = await create(null);
      const directory = spool.directory;

      expect(spool.ended).toBe(true);
      expect(spool.size).toBe(0);
      expect(fs.existsSync(spool.path)).toBe(true);

      spool.close();
      expect(fs.existsSync(directory)).toBe(false);
    });

  it('writes a newline-free input directly to disk without a line tail',
    async () => {
      const first = Buffer.alloc(64 * 1024, 0x78);
      const { stream, spool } = await create(first);
      spool.requestThrough(first.length * 3);

      stream.emit('data', Buffer.alloc(first.length, 0x78));
      stream.emit('data', Buffer.alloc(first.length, 0x78));

      expect(spool.size).toBe(first.length * 3);
      expect(fs.statSync(spool.path).size).toBe(first.length * 3);
      expect(stream.paused).toBe(true);
    });
});
