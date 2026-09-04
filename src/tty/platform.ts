import os from 'os';

import { flavors, type Dialect } from 'posix-regex';

import { actualEnv, lgetenv } from '../startup/environment';

/**
 * Platform differences, like less's per-platform defines headers
 * (defines.h for unix, defines.wn for Windows, defines.ds/o2 for the
 * DOS and OS/2 builds): file names, shells, editors and quoting all
 * differ between the Windows console world and unix. Node's unix
 * family (linux, darwin, the BSDs, aix, sunos) takes less's autoconf
 * build values; win32 takes defines.wn's.
 */

export const isWindows = process.platform === 'win32';

/**
 * The home directory, like less resolving $HOME with main.c's Windows
 * fallback to HOMEDRIVE+HOMEPATH; $HOME wins when set on either
 * platform, like lgetenv("HOME").
 */
export function homeDir(): string {
  const home = lgetenv('HOME');
  if (home) return home;

  if (process.platform === 'win32') {
    const drive = lgetenv('HOMEDRIVE');
    const rest = lgetenv('HOMEPATH');
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

/** The default system-wide compiled lesskey file (LESSKEYFILE_SYS). */
export const LESSKEYFILE_SYS = isWindows
  ? 'c:\\_sysless'
  : '/usr/local/etc/sysless';

/** The default editor (EDIT_PGM: "vi", "edit" on Windows). */
export const EDIT_PGM = isWindows ? 'edit' : 'vi';

/**
 * True where less's --exit-follow-on-close can actually fire: check_poll
 * (os.c:167) exits the F wait only on a BARE POLLHUP — a drained,
 * closed pipe reports exactly that on Linux, but Darwin adds POLLIN
 * (EOF counts as readable) and less's Windows build has no HUP check at
 * all, so less's F on a closed pipe just keeps waiting there — and so
 * do we.
 */
export const POLLHUP_EXITS_F = process.platform === 'linux';

/**
 * True on the BSDs, whose libc regex is Henry Spencer's — one family,
 * one set of answers, and NOT only Darwin: FreeBSD, OpenBSD and NetBSD
 * ship the same lineage, and macOS's copy came from FreeBSD's.
 */
const IS_BSD_LIBC = ['darwin', 'freebsd', 'openbsd', 'netbsd']
  .includes(process.platform);

/**
 * The regex dialect less's own search would use here.
 *
 * configure.ac tries POSIX regcomp FIRST and only falls through to
 * PCRE2/PCRE/GNU when it is missing or broken, so less links whatever
 * regcomp the platform's libc ships: Spencer's on the BSDs, glibc
 * everywhere else. The two disagree on what POSIX leaves undefined, so
 * the dialect is a platform fact like DEF_METACHARS, not a preference.
 * The library's own default IS the glibc shape, so only the BSDs need
 * saying and everything else falls through to it.
 *
 * (less's Windows build links neither — defines.wn takes Spencer's V8
 * regcomp, which has no {n,m} intervals at all. We keep the POSIX
 * reading there rather than give a JS user a pager whose search has
 * lost counted repetition.)
 */
export const REGEX_DIALECT: Dialect = {
  // less compiles with REG_EXTENDED (pattern.h's REGCOMP_FLAG), and this
  // must be spelled out rather than left to the "e" flag: an explicit
  // flavor overrides that flag, and a partial one merges onto POSIX's
  // default BASIC, where "(a)|(b)" is nine literal characters that
  // quietly match nothing
  ...flavors.extended,

  ...(IS_BSD_LIBC
    ? {
        // \w \b and friends are GNU additions BSD does not read
        gnuOperators: false,
        // a**, a+?, a++ ... one duplication symbol upon another
        repeatedRepeats: false,
        // \1 is the character '1'
        backreferences: false,
        // a{a} is text, but a{1 commits to an interval and is refused
        malformedIntervalIsText: true,
        danglingInterval: 'unless-committed' as const,
        // x| and (d|) have no derivation in the grammar
        emptyBranch: false,
        // a{,3} is text, not {0,3}
        openMinimum: false,
      }
    : {}),
};

/**
 * What -V calls the pattern matcher, as og's pattern_lib_name does.
 *
 * og reports the library configure LINKED (pattern.c:493), which is a
 * build-time fact; we have one engine, so this reports the dialect it
 * was given instead. That lands on the same word for the same reason
 * a user would care: on glibc `\\w` is a word character and on BSD it
 * is the letter w, which is exactly what the label predicts.
 *
 * It is not always the word og prints on the same machine - a glibc
 * less built --with-regex=posix says POSIX and still reads `\\w`,
 * because glibc's regcomp passes RE_SYNTAX_POSIX_EXTENDED, which
 * omits RE_NO_GNU_OPS. Ours describes behaviour; og's describes a
 * link line.
 */
export function patternLibName(): string {
  return REGEX_DIALECT.gnuOperators ? 'GNU' : 'POSIX';
}

/** Shell metacharacters (DEF_METACHARS, defines.wn's smaller set). */
export const DEF_METACHARS = isWindows
  ? "; *?\t\n'\"()<>|&"
  : "; *?\t\n'\"()<>[]|&^`#\\$%=~{},";

/** The metachar escape (DEF_METAESCAPE): the Windows shell has no
 *  backslash escaping, so names quote-wrap instead. */
export const DEF_METAESCAPE = isWindows ? '' : '\\';

/**
 * The shell argv for a ! command or a preprocessor pipe: unix runs
 * `$SHELL -c cmd` (less's HAVE_SHELL, with LESS_SHELL_COPTION replacing
 * -c and a bare "-" dropping the wrapper); less's Windows build has
 * HAVE_SHELL=0 and hands the command to system(), i.e. %COMSPEC% /c,
 * with an empty command opening the shell itself (lsystem.c).
 */
export function shellArgv(cmd: string): [string, string[]] {
  if (process.platform === 'win32') {
    const comspec = actualEnv('COMSPEC') || 'cmd.exe';
    return [comspec, cmd ? ['/c', cmd] : []];
  }

  const shell = lgetenv('SHELL') || '/bin/sh';
  const copt = lgetenv('LESS_SHELL_COPTION') || '-c';

  if (copt === '-') return ['/bin/sh', cmd ? ['-c', cmd] : []];
  return [shell, cmd ? [copt, cmd] : []];
}
