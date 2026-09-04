import { OptionSpec } from './spec';

import { hook, optUseGnuRegexp } from './shared';

import { clearForcePosix, search } from '../features/searching';

import { opt } from './state';

/**
 * Searches with JavaScript's own RegExp instead of the POSIX engine.
 *
 * NOT a less option — less has no such switch, because less has no such
 * choice: it links whatever regcomp its libc ships and that is the end
 * of it. This exists so the two engines can be compared from one
 * binary, and because a JS RegExp is the faster of the two on patterns
 * it can express.
 *
 * Turning it on changes the LANGUAGE, not just the implementation:
 * `a|ab` matches "a" rather than the longer "ab", `[[:alpha:]]` stops
 * being a character class, `\d` becomes a digit again rather than the
 * letter, and a pattern like `(a+)+b` can hang the engine outright.
 */
export const useJsRegexp: OptionSpec = {
    letter: '',
    names: ['use-js-regexp'],
    type: 'bool',
    // a GETTER, and asking the dialect rather than the host: turning
    // this off returns to whatever --use-gnu-regexp says, which is
    // not the libc's answer once the user has said otherwise. Built
    // once at module load it reported the host forever, so
    // "--use-gnu-regexp, JS on, JS off" claimed POSIX while searching
    // with GNU
    get messages() {
      return [
        `Search with ${optUseGnuRegexp() ? 'GNU' : 'POSIX'} `
          + 'regular expressions',
        'Search with JavaScript regular expressions',
      ];
    },
    defaultValue: 0,
    set: value => {
      // this option NEVER writes --use-gnu-regexp. It sits on top: it
      // picks the engine, and the dialect flag underneath keeps
      // saying whatever it said, so turning JS off uncovers the
      // reading the user already chose instead of guessing at one.
      // That flag is the memory, so there is none to keep here
      opt.useJsRegexp = value as number;

      // an explicit toggle overrides a "yes, use POSIX for this one"
      clearForcePosix();

      // said BEFORE the work below, not after it. The option
      // machinery sets the message once set() returns, so a toggle
      // that re-highlights a screenful first looks like a toggle that
      // did nothing - and the whole question the user is asking is
      // "did it land"
      hook.flashMessage(useJsRegexp.messages[value as number]);

      // the compiled pattern belongs to the old engine; drop it so the
      // next search — and the highlighting of the current screen —
      // goes through the new one
      hook.recompilePattern();

      // ...and then ASK it again. Recompiling only changes what the
      // NEXT search would do; the pattern already on screen keeps the
      // answer the old engine gave it, which is the one thing this
      // option exists to compare.
      //
      // Stacked, not shown: the flash above is a "(press RETURN)"
      // message and owns the row until a key takes it back, so the
      // answer waits behind it. toggle_option would overwrite it here
      // anyway - the bool branch assigns search.message outright,
      // where the string branch queues (options/index.ts)
      const answer = hook.repeatSearch(useJsRegexp.messages[value as number]);

      if (answer) search.messageQueue.push(answer);
    },
    get: () => opt.useJsRegexp,
  };
