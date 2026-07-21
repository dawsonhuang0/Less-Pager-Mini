import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

/** Bytes kept on disk ahead of the last position requested by the view. */
export const SPOOL_READ_AHEAD = 8 * 1024 * 1024;

export interface SpoolEvent {
  size: number;
  ended: boolean;
  settled: boolean;
  error: Error | null;
}

/**
 * A non-seekable stream made seekable in a private temporary file.
 *
 * Only the first chunk is consumed eagerly. Afterwards the file-backed
 * session advances an absolute target and the input remains paused once that
 * target is reached, so an upstream `cat` blocks close to the current view.
 */
export class PipeSpool {
  readonly directory: string;
  readonly path: string;

  private readonly stream: Readable;
  private fd: number;
  private target = 0;
  private draining = false;
  private closed = false;
  private started = false;
  private finishResolve: (() => void) | null = null;
  private startResolve: (() => void) | null = null;
  private readonly listeners = new Set<(event: SpoolEvent) => void>();

  size = 0;
  ended = false;
  error: Error | null = null;

  private constructor(stream: Readable) {
    this.stream = stream;
    this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmn-pipe-'));
    this.path = path.join(this.directory, 'input');
    this.fd = fs.openSync(this.path, 'w');
  }

  /** Creates the spool after capturing at most the stream's first chunk. */
  static async create(stream: Readable): Promise<PipeSpool> {
    const spool = new PipeSpool(stream);
    await spool.start();
    return spool;
  }

  private start(): Promise<void> {
    const started = new Promise<void>(resolve => {
      this.startResolve = resolve;
    });

    this.stream.on('data', this.onData);
    this.stream.once('end', this.onEnd);
    this.stream.once('error', this.onError);
    this.stream.resume();

    return started;
  }

  private readonly onData = (value: Buffer | string): void => {
    if (this.closed || this.ended) return;

    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let offset = 0;

    try {
      while (offset < chunk.length) {
        offset += fs.writeSync(
          this.fd, chunk, offset, chunk.length - offset, this.size + offset);
      }
      this.size += chunk.length;
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (!this.started) {
      // The pager can paint as soon as one chunk is seekable. It decides how
      // much more should be read after measuring the first visible window.
      this.started = true;
      this.target = this.size;
      this.stream.pause();
      this.startResolve?.();
      this.startResolve = null;
    } else if (!this.draining && this.size >= this.target) {
      this.stream.pause();
    }

    this.emit();
  };

  private readonly onEnd = (): void => {
    this.finish(null);
  };

  private readonly onError = (error: Error): void => {
    this.finish(error);
  };

  private finish(error: Error | null): void {
    if (this.ended) return;

    this.error = error;
    this.ended = true;
    this.started = true;
    this.startResolve?.();
    this.startResolve = null;

    if (this.fd >= 0) {
      fs.closeSync(this.fd);
      this.fd = -1;
    }

    this.emit();
    this.finishResolve?.();
    this.finishResolve = null;
  }

  private emit(): void {
    const event = this.snapshot();

    for (const listener of this.listeners) listener(event);
  }

  private snapshot(): SpoolEvent {
    return {
      size: this.size,
      ended: this.ended,
      settled: this.ended || (!this.draining && this.size >= this.target),
      error: this.error,
    };
  }

  /** Allows input through `position`, leaving the upstream paused afterward. */
  requestThrough(position: number): void {
    if (this.closed || this.ended || this.draining) return;

    this.target = Math.max(this.target, position);
    if (this.size < this.target) this.stream.resume();
  }

  /** Reads until true end-of-input, used only by commands such as G and %. */
  drain(): void {
    if (this.closed || this.ended) return;
    this.draining = true;
    this.stream.resume();
  }

  /** Stops an explicit drain immediately at the bytes already received. */
  cancelDrain(): void {
    if (this.closed || this.ended) return;
    this.draining = false;
    this.target = this.size;
    this.stream.pause();
    this.emit();
  }

  /** Resolves when the producer ends or errors. */
  waitForEnd(): Promise<void> {
    if (this.ended) return Promise.resolve();

    return new Promise(resolve => {
      const previous = this.finishResolve;
      this.finishResolve = () => {
        previous?.();
        resolve();
      };
    });
  }

  /** Resolves when the current bounded request pauses or reaches EOF. */
  waitForSettled(): Promise<SpoolEvent> {
    const current = this.snapshot();
    if (current.settled) return Promise.resolve(current);

    return new Promise(resolve => {
      const unsubscribe = this.subscribe(event => {
        if (!event.settled) return;
        unsubscribe();
        resolve(event);
      });
    });
  }

  subscribe(listener: (event: SpoolEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stops the producer and removes the private spool directory. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    this.stream.off('data', this.onData);
    this.stream.off('end', this.onEnd);
    this.stream.off('error', this.onError);
    this.stream.destroy();

    if (this.fd >= 0) {
      fs.closeSync(this.fd);
      this.fd = -1;
    }

    this.listeners.clear();
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}
