/**
 * What an editor offers for `pager(input, args, env)`, checked.
 *
 * Not a vitest file - vitest does not type-check, and eslint here is
 * not type-aware, so these assertions would be decoration anywhere
 * else. `npm run typecheck` compiles them.
 */
import pager, { pagerPipe, NamedArg, PagerArg, PagerEnv }
  from '../../src/index';

// The long names are spelled into the union so an editor can list
// them, in each form og accepts. Asserted against NamedArg, not
// PagerArg: PagerArg accepts any string, so it would accept these
// even if the suggestion were gone.
const bare: NamedArg = '--chop-long-lines';
const valued: NamedArg = '--tabs=4';
const reset: NamedArg = '--+chop-long-lines';

// This library's own two, which never reach the option table.
const ours: NamedArg = '--tab-object';
const alsoOurs: NamedArg = '--examine-file';

// @ts-expect-error - not an option name, so nothing should suggest it
const unknown: NamedArg = '--not-an-option';
void unknown;

// Option letters are suggested too - the table knows them.
const letter: NamedArg = '-R';
const alsoLetter: NamedArg = '-N';

// @ts-expect-error - not an option letter
const noSuchLetter: NamedArg = '-Z';
void noSuchLetter;

// Bundles and initial commands are legal but have nothing to suggest,
// so they ride the string escape hatch.
const bundle: PagerArg = '-NS';
const initial: PagerArg = '+G';
const search: PagerArg = '+/pattern';

// Env: the names less reads, and the three prefixed families.
const env: PagerEnv = {
  LESS: '-S',
  LESSSECURE: '1',
  LESS_TERMCAP_md: '\x1b[1m',
  LESS_OSC8_OPEN_https: 'open',
};

// A name the pager never reads is a typo, not a feature: an overlay
// that silently does nothing is worse than one that fails to compile.
// @ts-expect-error - LESS_TYPOO is not an environment the pager reads
const typo: PagerEnv = { LESS_TYPOO: 'x' };

// Both entry points take the same three parameters.
void pager([], [bare, valued, reset, ours, letter, alsoLetter, initial], env);
void pagerPipe(process.stdin, [alsoOurs, bundle, search], { LESS: '-R' });
void [bare, valued, reset, ours, alsoOurs, letter, alsoLetter, bundle,
  initial, search, env, typo];
