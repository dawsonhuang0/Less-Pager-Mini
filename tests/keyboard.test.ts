import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';

import {
  keyboard,
  keyboardFd,
  openTtyKeyboard,
  pushUngot,
  pushUngotLive,
  takeUngot,
  ungotIsLive,
  consumeInterrupt,
  hasUngot,
  gateReleaseKind,
  gateReleasedByWinch,
  gateReturn,
  raiseSigint,
  wasSelfSigint,
  freshWindowSize,
  watchWinch,
  unwatchWinch,
  closeTtyKeyboard
} from '../src/tty/keyboard';

const realPlatform = process.platform;
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const windowSize = Object.getOwnPropertyDescriptor(
  process.stdout,
  'getWindowSize'
);

const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value, configurable: true });
};

const setTty = (target: NodeJS.ReadStream | NodeJS.WriteStream,
  value: boolean): void => {
  Object.defineProperty(target, 'isTTY', { value, configurable: true });
};

beforeEach(() => {
  consumeInterrupt();
  wasSelfSigint();
  setPlatform(realPlatform);
});

afterEach(() => {
  consumeInterrupt();
  wasSelfSigint();
  closeTtyKeyboard();
  setPlatform(realPlatform);
  vi.restoreAllMocks();

  if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty);
  else delete (process.stdout as { isTTY?: boolean }).isTTY;

  if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;

  if (windowSize) {
    Object.defineProperty(process.stdout, 'getWindowSize', windowSize);
  } else {
    delete (process.stdout as { getWindowSize?: () => number[] }).getWindowSize;
  }
});

describe('ungot keyboard queue', () => {
  it('concatenates multiple polled chunks in arrival order', () => {
    pushUngot(Buffer.from('ab'));
    pushUngot(Buffer.from('cd'));

    expect(hasUngot()).toBe(true);
    expect(takeUngot()?.toString()).toBe('abcd');
    expect(hasUngot()).toBe(false);
    expect(takeUngot()).toBe(null);
  });

  it('returns the single queued buffer and clears it', () => {
    const chunk = Buffer.from('x');
    pushUngot(chunk);

    expect(takeUngot()).toBe(chunk);
    expect(takeUngot()).toBe(null);
  });

  it('drops every queued key on interrupt', () => {
    pushUngot(Buffer.from('\x03x'));
    consumeInterrupt();

    expect(hasUngot()).toBe(false);
    expect(takeUngot()).toBe(null);
  });

  // og's check_poll ungets an ordinary key and, on the intr char,
  // calls getcc_clear() instead (os.c:161) - so the ^C itself is
  // never handed on. Handing it back put an interrupt in front of the
  // question that same interrupt had raised, and answered it unseen
  it('leaves nothing live behind, so the next screen is not answered',
    () => {
      pushUngotLive(Buffer.from('\x03'));
      consumeInterrupt();

      expect(ungotIsLive()).toBe(false);
      expect(takeUngot()).toBe(null);
    });
});

describe('noninteractive return gate', () => {
  it('prints one plain line and does not enter the blocking gate', () => {
    setTty(process.stdout, false);
    const write = vi.spyOn(fs, 'writeSync').mockReturnValue(0);

    gateReturn('broken');

    expect(write).toHaveBeenCalledWith(1, 'broken\n');
    expect(gateReleaseKind()).toBe('dismiss');
    expect(gateReleasedByWinch()).toBe(false);
  });
});

describe('self SIGINT bookkeeping', () => {
  it('does nothing off a tty and consumes false repeatedly', () => {
    setTty(process.stdin, false);
    const kill = vi.spyOn(process, 'kill');

    raiseSigint();

    expect(kill).not.toHaveBeenCalled();
    expect(wasSelfSigint()).toBe(false);
    expect(wasSelfSigint()).toBe(false);
  });

  it('marks a successful process-group signal exactly once', () => {
    setPlatform('linux');
    setTty(process.stdin, true);
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    raiseSigint();

    expect(kill).toHaveBeenCalledWith(0, 'SIGINT');
    expect(wasSelfSigint()).toBe(true);
    expect(wasSelfSigint()).toBe(false);
  });

  it('clears the mark when signalling the process group fails', () => {
    setPlatform('linux');
    setTty(process.stdin, true);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('no process group');
    });

    raiseSigint();

    expect(wasSelfSigint()).toBe(false);
  });

  it('never sends a process-group signal on Windows', () => {
    setPlatform('win32');
    setTty(process.stdin, true);
    const kill = vi.spyOn(process, 'kill');

    raiseSigint();

    expect(kill).not.toHaveBeenCalled();
  });
});

describe('tty opening and dimensions', () => {
  it('falls back to fd 2 when no terminal can be opened', () => {
    // og's open_tty tries ttyname(2), then "/dev/tty", then fd 2
    // itself, terminal or not (ttyin.c:67) - it cannot come away
    // empty, which is what lets less paint its first screen before
    // getchr finds the EOF and quits
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('no tty');
    });

    expect(openTtyKeyboard()).toBe(true);
    expect(keyboard()).not.toBe(process.stdin);
    expect(keyboardFd()).toBe(2);
  });

  it('falls back to Node window size when /dev/tty is unavailable', () => {
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('no tty');
    });
    Object.defineProperty(process.stdout, 'getWindowSize', {
      value: () => [123, 45],
      configurable: true,
    });

    expect(freshWindowSize()).toEqual([123, 45]);
  });

  it('returns null when neither tty nor cached dimensions exist', () => {
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('no tty');
    });
    Object.defineProperty(process.stdout, 'getWindowSize', {
      value: undefined,
      configurable: true,
    });

    expect(freshWindowSize()).toBe(null);
  });
});

describe('window-change subscriptions', () => {
  it('uses SIGWINCH on Unix and resize on Windows', () => {
    const unix = (): void => {};
    setPlatform('linux');
    watchWinch(unix);
    expect(process.listeners('SIGWINCH')).toContain(unix);
    unwatchWinch(unix);
    expect(process.listeners('SIGWINCH')).not.toContain(unix);

    const windows = (): void => {};
    setPlatform('win32');
    watchWinch(windows);
    expect(process.stdout.listeners('resize')).toContain(windows);
    unwatchWinch(windows);
    expect(process.stdout.listeners('resize')).not.toContain(windows);
  });
});
