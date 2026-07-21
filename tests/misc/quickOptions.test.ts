import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import {
  option,
  startOption,
  optionKey,
  scanOptions,
  optMouseReverse,
  optEndPrompt,
  optShiftCount,
  jumpSindex
} from '../../src/options';

import { takeCmdAtPrompt, resetMisc } from '../../src/features/misc';

import { ringBell, calculateEOF } from '../../src/helpers';

const writeSpy = vi.spyOn(process.stdout, 'write')
  .mockImplementation(() => true);

const content = Array.from({ length: 30 }, (_, i) => `q${i + 1}`);

/** Feeds an option command key by key, like ogOptions.test.ts. */
function toggle(keys: string): void {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey(content, key);
}

const scan = (env: string) => scanOptions(env, content);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.screenWidth = 80;
  config.window = 6;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;

  search.message = '';
  search.messageQueue.length = 0;
  search.input = null;
  option.pending = '';

  resetMisc();
  initContent(content);
  calculateEOF(content);

  scan('-+q --+no-vbell --+mouse --+rmouse --+old-bot');
  search.message = '';
  writeSpy.mockClear();
});

describe('bells like og lbell/eof_bell/vbell', () => {
  let clock = 1_000_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(clock += 10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('beeps for errors by default', () => {
    ringBell();
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });

  it('still beeps for errors under -q', () => {
    scan('-q');
    writeSpy.mockClear();

    ringBell();
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });

  it('flashes instead of beeping for errors under -Q', () => {
    scan('-Q');
    writeSpy.mockClear();

    ringBell();
    expect(writeSpy).not.toHaveBeenCalledWith('\x07');
    expect(writeSpy).toHaveBeenCalledWith('\x1B[?5h');

    vi.advanceTimersByTime(100);
    expect(writeSpy).toHaveBeenCalledWith('\x1B[?5l');
  });

  it('flashes at eof under -q and rate limits to one per second', () => {
    scan('-q');
    writeSpy.mockClear();

    ringBell('eof');
    expect(writeSpy).toHaveBeenCalledWith('\x1B[?5h');

    writeSpy.mockClear();
    ringBell('eof');
    expect(writeSpy).not.toHaveBeenCalled();

    vi.setSystemTime(clock + 2_000);
    ringBell('eof');
    expect(writeSpy).toHaveBeenCalledWith('\x1B[?5h');
  });

  it('beeps at eof without -q', () => {
    ringBell('eof');
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });

  it('suppresses the flash with --no-vbell', () => {
    scan('-q --no-vbell');
    writeSpy.mockClear();

    ringBell('eof');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('--rmouse', () => {
  it('toggles with og messages', () => {
    toggle('--rmouse\x0D');
    expect(search.message).toBe('Reverse mouse scroll direction');
    expect(optMouseReverse()).toBe(true);

    toggle('--rmouse\x0D');
    expect(search.message).toBe('Normal mouse scroll direction');
    expect(optMouseReverse()).toBe(false);
  });

  it('follows --mouse like og opt_mouse', () => {
    scan('--MOUSE');
    expect(optMouseReverse()).toBe(true);

    scan('--mouse');
    expect(optMouseReverse()).toBe(false);

    // turning the mouse off leaves the direction alone, like og
    scan('--MOUSE');
    scan('--+mouse');
    expect(optMouseReverse()).toBe(true);
  });
});

describe('--old-bot', () => {
  it('toggles with og messages', () => {
    toggle('--old-bot\x0D');
    expect(search.message).toBe('Use old bottom of screen behavior');

    toggle('--old-bot\x0D');
    expect(search.message).toBe('Use new bottom of screen behavior');
  });
});

describe('--cmd', () => {
  it('stores the first-prompt command from $LESS and consumes once', () => {
    scan('--cmd=G');
    expect(takeCmdAtPrompt()).toBe('G');
    expect(takeCmdAtPrompt()).toBe('');
  });

  it('cannot be toggled at runtime, like og', () => {
    toggle('--cmd\x0D');
    expect(search.message).toBe('Cannot change the --cmd option');
  });
});

describe('-j and -# fractions, like og toggle_fraction', () => {
  beforeEach(() => {
    scan('-j1 -#0');
    config.chopLongLines = false;
    search.message = '';
  });

  it('resolves a -j fraction against the window height', () => {
    scan('-j.5');
    // window 6: muldiv(6, .5) = 3, clamped and 0-based like og
    expect(jumpSindex()).toBe(2);
  });

  it('reports fractions trimmed of trailing zeros, like og', () => {
    toggle('-j.500000\x0D');
    expect(search.message).toBe('Position target at screen position .5');

    toggle('-j3\x0D');
    expect(search.message).toBe('Position target at screen line 3');
  });

  it('resolves a -# fraction against the screen width', () => {
    toggle('-#.25\x0D');
    expect(search.message).toBe('Horizontal shift .25 of screen width');
    expect(optShiftCount()).toBe(20);

    // a numeric shift clears the fraction, like og's A_LSHIFT
    toggle('-#8\x0D');
    expect(search.message).toBe('Horizontal shift 8 columns');
    expect(optShiftCount()).toBe(8);
  });

  it('rejects an invalid fraction with the og message', () => {
    toggle('-j.\x0D');
    expect(search.message).toBe('Invalid fraction in -j');

    search.message = '';
    toggle('-#x\x0D');
    expect(search.message).toBe('Number is required after -#');
  });

  it('scans fractions from $LESS with validchars', () => {
    scan('-#.25 -j.5 -S');
    expect(optShiftCount()).toBe(20);
    expect(jumpSindex()).toBe(2);
    expect(config.chopLongLines).toBe(true);
  });
});

describe('--end-prompt', () => {
  it('exposes the stored string for the current prompt style', () => {
    toggle('--end-prompt=done \x0D');
    expect(optEndPrompt()).toBe('done ');

    toggle('--end-prompt=-\x0D');
    expect(optEndPrompt()).toBeNull();
  });
});
