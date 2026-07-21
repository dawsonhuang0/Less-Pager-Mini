import { EventEmitter } from 'events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { initContent, files, pendingScroll, pipeDraining }
  from '../../src/features/files';

import { PipeDecoder, initCharset } from '../../src/features/charset';

import {
  pipeInput,
  pipeRetained,
  pipeFilling,
  abortPipeFill,
  attachPipe,
  pipeFullProbe,
  pipeOneScreenProbe,
  startPendingScroll,
  abortPendingScroll,
  pipeDemand,
  pipeDrain
} from '../../src/features/pipe';

import { opt, hook } from '../../src/options';

import { resetSession, session } from '../../src/session';

class FakePipe extends EventEmitter {
  paused = false;
  destroyed = false;
  readableEnded = false;
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

const stdoutWrite = vi.spyOn(process.stdout, 'write')
  .mockImplementation(() => true);

const rawMode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');

let stream: FakePipe;

beforeEach(() => {
  stdoutWrite.mockClear();
  initCharset();

  config.row = 0;
  config.subRow = 0;
  config.blankTop = 0;
  config.window = 5;
  config.screenWidth = 80;
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  opt.autoBuffers = 1;
  opt.bufSpace = 64;
  opt.squeeze = 0;
  opt.quiet = 0;
  opt.exitFollowOnClose = 0;

  initContent(['head']);
  resetSession(['head']);
  // contentPager derives a distinct display array before attaching.
  session.content = ['head'];
  files.list[0].streaming = true;
  files.list[0].size = 5;
  files.list[0].sizeKnown = false;
  delete files.list[0].discardedBytes;
  delete files.list[0].discardedLines;

  pendingScroll.rows = 0;
  pendingScroll.moved = false;
  pipeDraining.active = false;
  pipeDraining.note = '';
  pipeDraining.cancelMessage = '';

  stream = new FakePipe();
  pipeInput.source = stream as unknown as NodeJS.ReadableStream;
  pipeInput.decoder = new PipeDecoder();
  Object.defineProperty(process.stdin, 'setRawMode', {
    value: vi.fn(),
    configurable: true,
  });
});

afterEach(() => {
  session.detachPipe();
  pipeInput.source = null;
  pipeInput.decoder = null;
  pendingScroll.rows = 0;
  pendingScroll.moved = false;
  session.pipeDrainTo = null;
  session.pipeWaiting = false;
  pipeDraining.active = false;

  if (rawMode) Object.defineProperty(process.stdin, 'setRawMode', rawMode);
  else delete (process.stdin as { setRawMode?: unknown }).setRawMode;
});

describe('stream attachment and EOF', () => {
  it('grows the first screen, replays queued keys, drains, and detaches', () => {
    const feed = vi.fn();
    const jump = vi.fn();
    session.feedKeys = feed;
    session.fillKeys = ['j', 'k'];

    attachPipe();
    expect(pipeFilling()).toBe(true);
    expect(session.pipeStream).toBe(stream);

    stream.emit('data', Buffer.from('two\nthree\nfour\n'));
    expect(session.fullContent).toEqual(['head', 'two', 'three', 'four']);
    expect(session.pipeFirstFill).toBe(false);
    expect(feed.mock.calls.map(call => call[0])).toEqual(['j', 'k']);

    expect(pipeDrain(jump, 'Determining length', 'cancelled')).toBe(true);
    expect(pipeDraining.active).toBe(true);
    expect(pipeDraining.note).toBe('Determining length');

    stream.emit('data', Buffer.from('five'));
    stream.readableEnded = true;
    stream.emit('end');

    expect(session.fullContent)
      .toEqual(['head', 'two', 'three', 'four', 'five']);
    expect(files.list[0].streaming).toBe(false);
    expect(files.list[0].sizeKnown).toBe(true);
    expect(jump).toHaveBeenCalledOnce();
    expect(session.pipeDrainTo).toBe(null);
    expect(pipeDraining.active).toBe(false);

    session.detachPipe();
    expect(stream.destroy).toHaveBeenCalledOnce();
    expect(session.pipeStream).toBe(null);
  });

  it('handles a stream that ended before attachment', () => {
    stream.readableEnded = true;

    attachPipe();

    expect(files.list[0].streaming).toBe(false);
    expect(session.pipeStream).toBe(stream);
  });

  it('recycles old pipe data once a bounded -B budget is exceeded', () => {
    opt.autoBuffers = 0;
    opt.bufSpace = 0;
    attachPipe();

    const chunk = Array.from({ length: 1800 }, (_, i) => `row-${i}`)
      .join('\n') + '\n';
    stream.emit('data', Buffer.from(chunk));

    expect(files.list[0].discardedLines).toBeGreaterThan(0);
    expect(files.list[0].discardedBytes).toBeGreaterThan(0);
    expect(session.fullContent.length).toBeLessThan(1801);
    expect(pipeRetained()).toBeLessThan(files.list[0].size);
  });

  it('returns zero retained bytes when no file is active', () => {
    files.index = -1;
    expect(pipeRetained()).toBe(0);
  });
});

describe('startup pipe probes', () => {
  it('drains --file-size input and reveals its final size', async () => {
    const probe = pipeFullProbe();
    expect(session.pipeProbing).toBe(true);

    stream.emit('data', Buffer.from('two\n'));
    stream.emit('data', Buffer.from('three'));
    stream.emit('end');
    await probe;

    expect(session.fullContent).toEqual(['head', 'two', 'three']);
    expect(session.pipeProbing).toBe(false);
    expect(files.list[0].streaming).toBe(false);
    expect(files.list[0].sizeKnown).toBe(true);
  });

  it('stops the -F probe once content exceeds one screen', async () => {
    config.window = 3;
    const probe = pipeOneScreenProbe();

    stream.emit('data', Buffer.from('two\nthree\nfour\n'));
    await probe;

    expect(stream.pause).toHaveBeenCalled();
    expect(session.pipeProbing).toBe(false);
    expect(session.fullContent).toEqual(['head', 'two', 'three', 'four']);
  });

  it('finishes the -F probe immediately when already over one screen',
    async () => {
      config.window = 2;
      session.fullContent = session.content = ['one', 'two'];

      await pipeOneScreenProbe();

      expect(stream.resume).not.toHaveBeenCalled();
      expect(session.pipeProbing).toBe(false);
    });
});

describe('blocked movement state', () => {
  it('bottom-anchors buffered rows when the initial fill aborts', () => {
    mode.INIT = true;
    config.window = 5;
    session.fillKeys = ['x'];
    session.pipeWaiting = true;

    abortPipeFill();

    expect(session.pipeFirstFill).toBe(false);
    expect(session.fillKeys).toEqual([]);
    expect(session.pipeWaiting).toBe(false);
    expect(mode.INIT).toBe(false);
    expect(config.row).toBe(0);
    expect(config.blankTop).toBe(3);
  });

  it('clears an impossible pending move without a live stream', () => {
    pendingScroll.rows = 4;
    pendingScroll.moved = true;
    session.pipeStream = null;

    startPendingScroll();

    expect(pendingScroll.rows).toBe(0);
    expect(pendingScroll.moved).toBe(false);
  });

  it('resumes a live stream for pending movement and nearby demand', () => {
    session.pipeStream = stream as unknown as NodeJS.ReadableStream;
    session.pipePaused = true;
    pendingScroll.rows = 2;

    startPendingScroll();
    expect(session.pipePaused).toBe(false);
    expect(stream.resume).toHaveBeenCalledOnce();

    stream.resume.mockClear();
    session.pipePaused = true;
    session.content = Array.from({ length: 20 }, () => 'x');
    config.row = 0;
    pipeDemand();
    expect(session.pipePaused).toBe(false);
    expect(stream.resume).toHaveBeenCalledOnce();
  });

  it('leaves a far-ahead paused stream asleep', () => {
    session.pipeStream = stream as unknown as NodeJS.ReadableStream;
    session.pipePaused = true;
    session.content = Array.from({ length: 2000 }, () => 'x');

    pipeDemand();

    expect(session.pipePaused).toBe(true);
    expect(stream.resume).not.toHaveBeenCalled();
  });

  it('aborts pending movement with the correct bell paths', () => {
    pendingScroll.rows = 2;
    pendingScroll.moved = false;
    session.fillKeys = ['x'];
    session.pipeWaiting = true;

    abortPendingScroll(true);

    expect(pendingScroll.rows).toBe(0);
    expect(pendingScroll.moved).toBe(false);
    expect(session.fillKeys).toEqual([]);
    expect(session.pipeWaiting).toBe(false);
    expect(stdoutWrite.mock.calls.some(call => call[0] === '\x07')).toBe(true);
  });

  it('refuses drains without a live streaming file or from help', () => {
    const jump = vi.fn();
    expect(pipeDrain(jump, '', '')).toBe(false);

    session.pipeStream = stream as unknown as NodeJS.ReadableStream;
    mode.HELP = true;
    expect(pipeDrain(jump, '', '')).toBe(false);
    expect(jump).not.toHaveBeenCalled();
  });

  it('reveals a completed non-stream through the runtime hook', () => {
    files.list[0].streaming = false;
    files.list[0].sizeKnown = false;

    hook.scanFileSize();

    expect(files.list[0].sizeKnown).toBe(true);
  });
});
