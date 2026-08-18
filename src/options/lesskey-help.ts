import { OptionSpec } from './spec';

import { hook } from './shared';

/**
 * Pages the lesskey syntax page, like -? pages the command help.
 *
 * NOT a less option. less documents lesskey in lesskey.nro, a man page
 * that ships with the less distribution - so `man lesskey` answers the
 * question there and no switch is needed. An npm install brings no man
 * pages with it, which would leave every lesskey feature we implement
 * undiscoverable.
 *
 * It behaves like less's -? rather than like --help output: the page is
 * paged as its own input file, so it scrolls and searches.
 */
export const lesskeyHelp: OptionSpec = {
    letter: '',
    names: ['lesskey-help'],
    type: 'novar',
    messages: [],
    defaultValue: 0,
    get: () => 0,
    // typed at the runtime `-` prompt this OPENS the page, where less's
    // -? can only say "Use h for help": less's help is reachable by key,
    // ours has no key of its own
    set: () => { hook.showLesskeyHelp(); },
  };
