import { afterAll, afterEach, beforeEach, describe, expect, it }
  from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { search } from '../../src/features/searching';

import { openAltFile } from '../../src/features/lessopen';

import { initEnvironment } from '../../src/startup/environment';

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

import { startupInit } from '../../src/startup/startup';

import { setSessionEnv } from '../../src/startup/environment';

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

describe('the library shell lock', () => {
  // through the session's own startup, so the guard fails if the lock
  // is ever left unwired rather than merely uncalled
  const startSession = (less: string | undefined, terminal = false): void => {
    if (less === undefined) delete process.env.LESS;
    else process.env.LESS = less;

    if (terminal) markTerminalInvocation();
    initInvocationOptions();
    startupInit([]);
  };

  it('lets the CALLER ask for shell access in its own config map', () => {
    // pager(x, { LESS: '--+no-shell' }): the overlay is the embedding
    // application's own configuration, not the shell it was launched
    // from, so this one is deliberate and allowed
    setSessionEnv({ LESS: '--+no-shell' });
    startSession(undefined);
    setSessionEnv(null);

    expect(opt.noShell).toBe(0);
  });

  it('ignores an ambient $LESS even when the caller sets other options',
    () => {
      setSessionEnv({ LESS: '-S' });
      startSession('--+no-shell');
      setSessionEnv(null);

      expect(opt.noShell).toBe(1);
    });

  it('lets a hardened environment outrank the caller', () => {
    // a deployment that sets LESS=--no-shell everywhere keeps the
    // hold: an application must not configure its way around it,
    // even though its overlay otherwise replaces the string
    setSessionEnv({ LESS: '--+no-shell' });
    startSession('--no-shell');
    setSessionEnv(null);

    expect(opt.noShell).toBe(1);
  });

  it('reads that policy through option abbreviations too', () => {
    setSessionEnv({ LESS: '--+no-shell' });
    startSession('--no-sh');
    setSessionEnv(null);

    expect(opt.noShell).toBe(1);
  });

  it('survives $LESS trying to reset it', () => {
    // the scan reads an environment the embedding application does
    // not necessarily control, so --+no-shell there must not lift a
    // library call's safe default
    startSession('--+no-shell');

    expect(opt.noShell).toBe(1);
  });

  it('leaves the terminal command alone', () => {
    startSession('--+no-shell', true);
    expect(opt.noShell).toBe(0);

    // and the executable's own --no-shell still applies
    startSession('--no-shell', true);
    expect(opt.noShell).toBe(1);
  });

  it('reads the lock from a lesskey #env too', () => {
    // og scans $LESS after init_cmds, so a #env line is one of the
    // tiers the option string can come from (decode.c lgetenv). The
    // file belongs to whoever RUNS the application, so it is ambient
    // policy, and the caller's overlay must not lift it
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-lockkey-'));
    const key = path.join(keyDir, 'ambient.lesskey');
    fs.writeFileSync(key, '#env\nLESS = --no-shell\n');
    process.env.LESSKEYIN = key;

    try {
      setSessionEnv({ LESS: '--+no-shell' });
      startSession(undefined);
    } finally {
      setSessionEnv(null);
      delete process.env.LESSKEYIN;
    }

    expect(opt.noShell).toBe(1);
  });
});

describe('--no-shell blocks every process launch, not just commands', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-noshell-'));
  const file = path.join(dir, 'plain.txt');
  const proof = path.join(dir, 'ran');
  const script = path.join(dir, 'pre.sh');

  fs.writeFileSync(file, 'real content\n');
  fs.writeFileSync(script,
    `#!/bin/sh\necho ran > ${proof}\necho preprocessed\n`);
  fs.chmodSync(script, 0o755);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    fs.rmSync(proof, { force: true });
    process.env.LESSOPEN = `|${script} %s`;
    initEnvironment();
  });

  afterEach(() => {
    delete process.env.LESSOPEN;
  });

  it('refuses $LESSOPEN, which the caller never asked to run', () => {
    // the environment belongs to whoever launched the program, not to
    // the application that chose the safe API: a preprocessor is a
    // process, so --no-shell means it does not run
    opt.noShell = 1;

    expect(openAltFile(file)).toBe(null);
    expect(fs.existsSync(proof)).toBe(false);
  });

  it('still preprocesses when shell access is allowed', () => {
    opt.noShell = 0;

    expect(openAltFile(file)).not.toBe(null);
    expect(fs.existsSync(proof)).toBe(true);
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
