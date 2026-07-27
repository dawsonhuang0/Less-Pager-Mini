import { keyboard, dumbTerminal, watchWinch, unwatchWinch }
  from '../tty/keyboard';

import { opt, scanOptions, initUnsupport, takeCliOptions,
  flushPendopt, onRebuild, optKnowDumb } from '../options';

import { search } from '../features/searching';

import { resetMisc } from '../features/misc';

import { resetBellTimer, resetPrompting } from '../helpers';

import { initSecure, secureAllow } from '../features/secure';

import { loadLesskey } from '../features/lesskey';

import { initCharset } from '../features/charset';

import { initAnsiChars, initTerminalCapabilities } from '../state/constants';

import { resetProtos } from '../features/prompt';

import { initEnvironment, lgetenv, fromSessionEnv } from './environment';

import { lockLibraryShell } from './invocation';

import { resetOsc8 } from '../features/osc8';

// error() calls before the screen initializes, counted for og's
// main errmsgs gate ("Press RETURN to continue" before the screen
// erases them)
export const startupErrors = { count: 0 };

/**
 * Applies $LESS/$MORE and the command line options, like og's main()
 * before edit_first: session state resets first so ++cmd and -o
 * survive to startup, and the rebuild hook drops so -s/-x/-r cannot
 * fire a previous session's pipeline.
 *
 * @param content - Loaded lines for immediate handlers, or [] when
 *   scanning before any file opens.
 */
export function startupInit(content: string[]): ReturnType<typeof scanOptions> {
  initEnvironment();
  startupErrors.count = 0;
  resetMisc();
  resetBellTimer();
  resetPrompting();
  resetOsc8();
  onRebuild(() => {});

  // lesskey loads before $LESS scans, like og's init_cmds preceding
  // scan_option: its #env lines can set $LESS itself
  initSecure();

  // like decode.c: lesskey files are ignored under LESSSECURE
  if (secureAllow('lesskey')) loadLesskey();

  // the charset comes from the (possibly lesskey-set) environment,
  // like init_charset before the first file opens
  initCharset();
  initAnsiChars();
  initTerminalCapabilities();

  // $LESS_IS_MORE selects more compatibility and the $MORE options,
  // like og's init_option and main reading the right variable
  const lim = lgetenv('LESS_IS_MORE');
  opt.lessIsMore = lim !== undefined && lim !== '' && lim !== '0' ? 1 : 0;

  // like og's init_prompt after less_is_more is known; $MORE below may
  // still override the prototypes with -P
  resetProtos();

  // $LESS_UNSUPPORT lists options the scan must ignore (init_unsupport)
  initUnsupport(lgetenv('LESS_UNSUPPORT') ?? '');

  // whether the option string the scan is about to read belongs to
  // the CALLER (its config map) or to the ambient environment
  const optionsEnv = opt.lessIsMore ? 'MORE' : 'LESS';
  const callerOptions = fromSessionEnv(optionsEnv);

  const startup = scanOptions(lgetenv(optionsEnv) ?? '', content);

  // command line options follow the env, one scan per argument like
  // og's main; -r keeps its command line meaning there
  for (const arg of takeCliOptions()) {
    const extra = scanOptions(arg, content, false);
    startup.firstCmds.push(...extra.firstCmds);
    if (extra.dohelp) startup.dohelp = true;
    if (extra.version) startup.version = true;
  }

  // a still-dangling string/number option reports now (og nopendopt)
  flushPendopt();

  // the scan is over: nothing the AMBIENT environment supplied may
  // hand shell escapes back to a library call, though the caller's
  // own overlay may ask for them
  lockLibraryShell(callerOptions);

  // og's pre-screen error() prints scan errors right away, ahead of
  // any binary-file question edit_first may ask
  while (search.message || search.messageQueue.length) {
    if (search.message) printStartupError(search.message);
    search.message = search.messageQueue.shift() ?? '';
  }

  // og's missing_cap warning follows the scan (main.c), still before
  // edit_first's binary question; -d (know_dumb) suppresses it
  if (dumbTerminal() && keyboard().isTTY && !optKnowDumb()) {
    printStartupError('WARNING: terminal is not fully functional');
  }

  return startup;
}

// error() calls before the screen initializes, for og's main errmsgs
// gate ("Press RETURN to continue" before the screen erases them)


export function printStartupError(message: string): void {
  process.stdout.write(message + '\n');
  startupErrors.count++;
}

export function warnReturn(): Promise<string> {
  keyboard().setRawMode(true);
  keyboard().resume();

  return new Promise(resolve => {
    const onKey = (data: Buffer): void => {
      unwatchWinch(onWinch);

      // og reads a single char; anything typed behind it stays
      // buffered as ordinary input (paused, or the re-emit would
      // fire with no listener attached and vanish)
      if (data.length > 1) {
        keyboard().pause();
        keyboard().unshift(data.subarray(1));
      }

      resolve(data.toString()[0] ?? '');
    };

    // og's lwinch longjmps out of get_return: a resize passes the
    // gate with no key
    const onWinch = (): void => {
      unwatchWinch(onWinch);
      keyboard().off('data', onKey);
      resolve('');
    };

    keyboard().once('data', onKey);
    watchWinch(onWinch);
  });
}
