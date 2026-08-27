import { OptionSpec } from './spec';

import { opt } from './state';

/**
 * Expands a filename with zsh's globbing rules, in process, instead of
 * handing it to $SHELL.
 *
 * NOT a less option — less has no such switch, because less has no such
 * choice. Its lglob builds a command and runs it through $SHELL
 * (filename.c:750); glob(3) appears exactly once in all of less, under
 * `#if MSDOS_COMPILER==DJGPPC` (lglob.h:34). The answer therefore
 * depends on WHICH shell the user runs, down to the setopts its startup
 * file applies to a non-interactive one.
 *
 * Two places already do the matching themselves: Windows, where there
 * is no $SHELL to delegate to, and a unix box whose shell cannot be
 * executed at all. This makes that path reachable on purpose, so the
 * two can be compared from one binary, and so a session can glob the
 * same way whatever $SHELL happens to be.
 *
 * It changes the GRAMMAR, not just who runs it. Brace expansion goes
 * away - `{a,b}.txt` is word splitting, which a shell does BEFORE
 * globbing, so an in-process globber never sees it - while `~` and `$`
 * survive, being expanded before this. What zsh does inside a pattern,
 * bracket expressions and `**` included, is kept: shell-glob is a port
 * of zsh's matcher.
 */
export const useZshGlob: OptionSpec = {
  letter: '',
  names: ['use-zsh-glob'],
  type: 'bool',
  messages: [
    'Expand filenames with $SHELL',
    'Expand filenames with zsh globbing',
  ],
  defaultValue: 0,
  get: () => opt.useZshGlob,
  set: value => {
    // nothing is compiled or cached: the next name to expand asks
    // again, so the switch is the whole change
    opt.useZshGlob = value as number;
  },
};
