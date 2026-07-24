import { afterEach, describe, expect, it } from 'vitest';

import { homeDir, shellArgv } from '../../src/tty/platform';

const realPlatform = process.platform;
const saved: Record<string, string | undefined> = {};

const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value });
};

const setEnv = (name: string, value: string | undefined): void => {
  if (!(name in saved)) saved[name] = process.env[name];

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

afterEach(() => {
  setPlatform(realPlatform);

  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('homeDir, like og lgetenv("HOME") + main.c WIN32', () => {
  it('prefers $HOME on any platform', () => {
    setEnv('HOME', '/somewhere');
    expect(homeDir()).toBe('/somewhere');
  });

  it('falls back to HOMEDRIVE+HOMEPATH on windows', () => {
    setPlatform('win32');
    setEnv('HOME', undefined);
    setEnv('HOMEDRIVE', 'C:');
    setEnv('HOMEPATH', '\\Users\\og');
    expect(homeDir()).toBe('C:\\Users\\og');
  });
});

describe('shellArgv, like og lsystem/HAVE_SHELL', () => {
  it('unix: $SHELL -c, with LESS_SHELL_COPTION overrides', () => {
    setPlatform('linux');
    setEnv('SHELL', '/bin/zsh');
    setEnv('LESS_SHELL_COPTION', undefined);
    expect(shellArgv('ls -l')).toEqual(['/bin/zsh', ['-c', 'ls -l']]);

    // an empty command opens the shell itself
    expect(shellArgv('')).toEqual(['/bin/zsh', []]);

    setEnv('LESS_SHELL_COPTION', '-fc');
    expect(shellArgv('ls')).toEqual(['/bin/zsh', ['-fc', 'ls']]);

    // "-" drops the $SHELL wrapper, like og calling system()
    setEnv('LESS_SHELL_COPTION', '-');
    expect(shellArgv('ls')).toEqual(['/bin/sh', ['-c', 'ls']]);
  });

  it('windows: %COMSPEC% /c, like og system() with HAVE_SHELL=0', () => {
    setPlatform('win32');
    setEnv('COMSPEC', 'C:\\Windows\\system32\\cmd.exe');
    expect(shellArgv('dir')).toEqual(
      ['C:\\Windows\\system32\\cmd.exe', ['/c', 'dir']]
    );

    // an empty ! command opens COMSPEC itself (lsystem.c)
    expect(shellArgv('')).toEqual(
      ['C:\\Windows\\system32\\cmd.exe', []]
    );

    setEnv('COMSPEC', undefined);
    expect(shellArgv('dir')).toEqual(['cmd.exe', ['/c', 'dir']]);
  });
});
