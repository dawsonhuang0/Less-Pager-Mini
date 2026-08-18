import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

/**
 * Searches with JavaScript's own RegExp instead of the POSIX engine.
 *
 * NOT an og option — og has no such switch, because og has no such
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
    messages: [
      'Search with POSIX regular expressions',
      "Search with JavaScript's RegExp",
    ],
    defaultValue: 0,
    set: value => {
      opt.useJsRegexp = value as number;

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
    },
    get: () => opt.useJsRegexp,
  };
