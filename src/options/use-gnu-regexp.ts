import { OptionSpec } from './spec';

import { hook } from './shared';

import { search } from '../features/searching';

import { opt } from './state';

import { hasGnuLibc } from '../tty/platform';

/**
 * Searches with glibc's dialect on a host whose libc has none of it.
 *
 * NOT a less option, and not a choice less could offer: less reads
 * whatever regcomp its libc ships, and on glibc that regcomp passes
 * RE_SYNTAX_POSIX_EXTENDED, which leaves RE_NO_GNU_OPS clear. So a
 * Linux user's less takes `\w`, `\b`, `\s`, `\<` and `\>` no matter
 * which regex API it was built against, and a BSD user's cannot.
 * Being one binary on both, we can hand the BSD user the Linux
 * dialect if they ask for it.
 *
 * It is the WHOLE dialect, not the operators alone. glibc and BSD
 * differ on seven points - backreferences, `a**`, an empty branch,
 * `a{,3}`, a malformed interval, a dangling one, and the GNU
 * operators - and turning on one of them would invent a dialect no
 * libc has, which is no use to a user and worse than useless as an
 * oracle.
 *
 * On a glibc host it changes nothing: that is already the default.
 */
export const useGnuRegexp: OptionSpec = {
    letter: '',
    names: ['use-gnu-regexp'],
    type: 'bool',
    messages: [
      'Search with POSIX regular expressions',
      'Search with GNU regular expressions',
    ],
    // the HOST's answer, so a fresh session searches the way the less
    // on the same machine does. Naming a bool sets it to the opposite
    // of its default (options/index.ts:1538, og's OPT_SET = !odefault
    // at option.c:317), so the flag means "the other dialect": POSIX
    // where glibc gave GNU, GNU where it did not.
    //
    // og reads the same way for the three bools that start on: naming
    // --tilde HIDES tildes, naming --auto-buffers stops auto
    // buffering. A bool that starts on has nowhere else to go.
    //
    // A getter, so the libc is only probed if something asks
    get defaultValue() { return hasGnuLibc() ? 1 : 0; },
    set: value => {
      // either direction: naming a dialect is naming the engine that
      // HAS dialects, so JS steps aside. That is also what makes the
      // later flag win, the way less scans options left to right
      const wasJs = opt.useJsRegexp > 0;
      opt.useJsRegexp = 0;

      // ...and stepping aside is ALL it does. While JS was on, the
      // dialect underneath was invisible, so flipping it would flip
      // something the user cannot see: `-` on this option after a
      // --use-gnu-regexp would land on POSIX because the hidden value
      // was already 1. The first press uncovers the dialect; a second
      // one changes it
      if (!wasJs) opt.useGnuRegexp = value as number;

      // the message names the state we LANDED on, never the one asked
      // for: a press that only uncovered the dialect would otherwise
      // announce the flip it did not make. The option machinery reads
      // it back through stateOf() for the same reason
      const landed = useGnuRegexp.get!() as number;

      // said BEFORE the work below: the option machinery sets the
      // message once set() returns, so a toggle that re-highlights a
      // screenful first looks like a toggle that did nothing
      hook.flashMessage(useGnuRegexp.messages[landed]);

      // the compiled pattern belongs to the old dialect; drop it so
      // the next search - and the highlighting on screen now - is
      // read by the new one
      hook.recompilePattern();

      // ...then ask it again, because recompiling only changes what
      // the NEXT search would do, and the pattern already on screen
      // keeps the answer the old dialect gave it
      const answer = hook.repeatSearch(useGnuRegexp.messages[landed]);

      if (answer) search.messageQueue.push(answer);
    },
    // resolved, not raw: the toggle path reads this to decide which
    // way to flip, so an untouched session has to answer with the
    // dialect it is actually using
    get: () => opt.useGnuRegexp < 0 ? (hasGnuLibc() ? 1 : 0)
      : opt.useGnuRegexp,
  };
