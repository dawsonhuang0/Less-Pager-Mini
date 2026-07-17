import os from 'os';

/**
 * Platform differences, like og's per-platform defines headers
 * (defines.h for unix, defines.wn for Windows, defines.ds/o2 for the
 * DOS and OS/2 builds): file names, shells, editors and quoting all
 * differ between the Windows console world and unix. Node's unix
 * family (linux, darwin, the BSDs, aix, sunos) takes og's autoconf
 * build values; win32 takes defines.wn's.
 */

export const isWindows = process.platform === 'win32';

/**
 * The home directory, like og resolving $HOME with main.c's Windows
 * fallback to HOMEDRIVE+HOMEPATH; $HOME wins when set on either
 * platform, like lgetenv("HOME").
 */
export function homeDir(): string {
  if (process.env.HOME) return process.env.HOME;

  if (process.platform === 'win32') {
    const drive = process.env.HOMEDRIVE;
    const rest = process.env.HOMEPATH;
    if (drive && rest) return drive + rest;
  }

  return os.homedir();
}

/** The history file name (LESSHISTFILE: ".lesshst" / "_lesshst"). */
export const HISTFILE_NAME = isWindows ? '_lesshst' : '.lesshst';

/** The lesskey source name (DEF_LESSKEYINFILE: ".lesskey"/"_lesskey"). */
export const LESSKEYIN_NAME = isWindows ? '_lesskey' : '.lesskey';

/** The binary lesskey name (LESSKEYFILE: ".less" / "_less"). */
export const LESSKEYFILE_NAME = isWindows ? '_less' : '.less';

/** The system-wide lesskey source (LESSKEYINFILE_SYS). */
export const LESSKEYIN_SYS = isWindows
  ? 'c:\\_syslesskey'
  : '/usr/local/etc/syslesskey';

/** The default editor (EDIT_PGM: "vi", "edit" on Windows). */
export const EDIT_PGM = isWindows ? 'edit' : 'vi';

/**
 * True where og's --exit-follow-on-close can actually fire: check_poll
 * (os.c:167) exits the F wait only on a BARE POLLHUP — a drained,
 * closed pipe reports exactly that on Linux, but Darwin adds POLLIN
 * (EOF counts as readable) and og's Windows build has no HUP check at
 * all, so og's F on a closed pipe just keeps waiting there — and so
 * do we.
 */
export const POLLHUP_EXITS_F = process.platform === 'linux';

/** Shell metacharacters (DEF_METACHARS, defines.wn's smaller set). */
export const DEF_METACHARS = isWindows
  ? "; *?\t\n'\"()<>|&"
  : "; *?\t\n'\"()<>[]|&^`#\\$%=~{},";

/** The metachar escape (DEF_METAESCAPE): the Windows shell has no
 *  backslash escaping, so names quote-wrap instead. */
export const DEF_METAESCAPE = isWindows ? '' : '\\';

/**
 * The shell argv for a ! command or a preprocessor pipe: unix runs
 * `$SHELL -c cmd` (og's HAVE_SHELL, with LESS_SHELL_COPTION replacing
 * -c and a bare "-" dropping the wrapper); og's Windows build has
 * HAVE_SHELL=0 and hands the command to system(), i.e. %COMSPEC% /c,
 * with an empty command opening the shell itself (lsystem.c).
 */
export function shellArgv(cmd: string): [string, string[]] {
  if (process.platform === 'win32') {
    const comspec = process.env.COMSPEC || 'cmd.exe';
    return [comspec, cmd ? ['/c', cmd] : []];
  }

  const shell = process.env.SHELL || '/bin/sh';
  const copt = process.env.LESS_SHELL_COPTION || '-c';

  if (copt === '-') return ['/bin/sh', cmd ? ['-c', cmd] : []];
  return [shell, cmd ? [copt, cmd] : []];
}
