import { beforeEach, describe, expect, it } from 'vitest';

import { search } from '../../src/features/searching';

import {
  option,
  optionKey,
  opt,
  scanOptions,
  startOption,
} from '../../src/options';

import {
  initInvocationOptions,
  markTerminalInvocation,
} from '../../src/startup/invocation';

const enterOption = (keys: string): void => {
  startOption(keys[0] as '-' | '_');
  for (const key of keys.slice(1)) optionKey([], key);
};

beforeEach(() => {
  // Consume a marker left behind by a failed assertion before resetting.
  initInvocationOptions();
  opt.noShell = 0;
  search.message = '';
  search.messageQueue.length = 0;
  option.pending = '';
  option.name = null;
  option.spec = null;
});

describe('--no-shell invocation defaults', () => {
  it('defaults JavaScript entry points to disabled shell commands', () => {
    initInvocationOptions();

    expect(opt.noShell).toBe(1);
  });

  it('defaults a marked terminal invocation to ordinary shell access', () => {
    opt.noShell = 1;
    markTerminalInvocation();
    initInvocationOptions();

    expect(opt.noShell).toBe(0);

    // The marker applies to one call only; a later package call is safe.
    initInvocationOptions();
    expect(opt.noShell).toBe(1);
  });
});

describe('--no-shell option behavior', () => {
  it('can be enabled at startup and reset by startup syntax', () => {
    scanOptions('--no-shell', [], false);
    expect(opt.noShell).toBe(1);

    scanOptions('--+no-shell', [], false);
    expect(opt.noShell).toBe(0);
  });

  it('can be queried but not changed from inside the pager', () => {
    opt.noShell = 1;

    enterOption('__no-shell\r');
    expect(search.message).toBe('Shell commands are disabled');

    search.message = '';
    enterOption('--no-shell\r');
    expect(search.message)
      .toBe('Cannot change the --no-shell option');
    expect(opt.noShell).toBe(1);
  });

  it('reports the enabled state without accidentally enabling the gate', () => {
    enterOption('__no-shell\r');

    expect(search.message).toBe('Shell commands are enabled');
    expect(opt.noShell).toBe(0);
  });
});
