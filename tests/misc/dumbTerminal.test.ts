import { afterEach, describe, expect, it, vi } from 'vitest';

import os from 'os';

import { dumbTerminal } from '../../src/tty/keyboard';

const realPlatform = process.platform;
const realTerm = process.env.TERM;

const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value });
};

afterEach(() => {
  setPlatform(realPlatform);

  if (realTerm === undefined) {
    delete process.env.TERM;
  } else {
    process.env.TERM = realTerm;
  }

  vi.restoreAllMocks();
});

describe('dumbTerminal, like less get_term/missing_cap', () => {
  it('unix: a missing $TERM loads the "unknown" entry and is dumb', () => {
    setPlatform('linux');

    delete process.env.TERM;
    expect(dumbTerminal()).toBe(true);

    process.env.TERM = 'dumb';
    expect(dumbTerminal()).toBe(true);

    process.env.TERM = 'xterm-256color';
    expect(dumbTerminal()).toBe(false);
  });

  it('windows consoles never consult $TERM, like less MSDOS builds', () => {
    setPlatform('win32');
    vi.spyOn(os, 'release').mockReturnValue('10.0.19045');

    // powershell and cmd set no $TERM at all
    delete process.env.TERM;
    expect(dumbTerminal()).toBe(false);

    // an explicit dumb still counts
    process.env.TERM = 'dumb';
    expect(dumbTerminal()).toBe(true);
  });

  it('windows consoles before VT processing degrade', () => {
    setPlatform('win32');
    delete process.env.TERM;

    vi.spyOn(os, 'release').mockReturnValue('6.3.9600');
    expect(dumbTerminal()).toBe(true);

    vi.spyOn(os, 'release').mockReturnValue('10.0.10240');
    expect(dumbTerminal()).toBe(true);
  });
});
