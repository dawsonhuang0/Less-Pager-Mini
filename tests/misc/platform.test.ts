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

describe('homeDir, like less lgetenv("HOME") + main.c WIN32', () => {
  it('prefers $HOME on any platform', () => {
    setEnv('HOME', '/somewhere');
    expect(homeDir()).toBe('/somewhere');
  });

  it('falls back to HOMEDRIVE+HOMEPATH on windows', () => {
    setPlatform('win32');
    setEnv('HOME', undefined);
    setEnv('HOMEDRIVE', 'C:');
    setEnv('HOMEPATH', '\\Users\\less');
    expect(homeDir()).toBe('C:\\Users\\less');
  });
});

describe('shellArgv, like less lsystem/HAVE_SHELL', () => {
  it('unix: $SHELL -c, with LESS_SHELL_COPTION overrides', () => {
    setPlatform('linux');
    setEnv('SHELL', '/bin/zsh');
    setEnv('LESS_SHELL_COPTION', undefined);
    expect(shellArgv('ls -l')).toEqual(['/bin/zsh', ['-c', 'ls -l']]);

    // an empty command opens the shell itself
    expect(shellArgv('')).toEqual(['/bin/zsh', []]);

    setEnv('LESS_SHELL_COPTION', '-fc');
    expect(shellArgv('ls')).toEqual(['/bin/zsh', ['-fc', 'ls']]);

    // "-" drops the $SHELL wrapper, like less calling system()
    setEnv('LESS_SHELL_COPTION', '-');
    expect(shellArgv('ls')).toEqual(['/bin/sh', ['-c', 'ls']]);
  });

  it('unix: falls back to /bin/sh when $SHELL says nothing', () => {
    // less's shellcmd tests isnullenv(shell) - NULL or "" alike - and
    // drops to plain popen(cmd) (filename.c:583), whose shell is
    // /bin/sh. So an unset $SHELL still globs, it just globs by POSIX
    // rules rather than the user's own.
    setPlatform('linux');
    setEnv('LESS_SHELL_COPTION', undefined);

    setEnv('SHELL', undefined);
    expect(shellArgv('ls')).toEqual(['/bin/sh', ['-c', 'ls']]);

    // isnullenv counts "" as nothing, so an emptied $SHELL is not a
    // shell named "" - it is no shell at all
    setEnv('SHELL', '');
    expect(shellArgv('ls')).toEqual(['/bin/sh', ['-c', 'ls']]);
  });

  it('windows: %COMSPEC% /c, like less system() with HAVE_SHELL=0', () => {
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
