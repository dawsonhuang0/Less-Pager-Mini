import { OptionSpec } from './spec';

import { hook } from './shared';

import { search } from '../features/searching';

export const lesskeyFile: OptionSpec = {
    letter: 'k',
    names: ['lesskey-file'],
    type: 'string',
    noToggle: true,
    noQuery: true,
    messages: [],
    defaultValue: '',
    get: () => '',
    set: value => {
      // og's opt_k at INIT: `if (lesskey(s, 0)) error("Cannot use
      // lesskey file \"%s\"")` (optfunc.c:283). We accepted -k and
      // silently did nothing, even though the compiled-lesskey reader
      // it needs already existed for the default files.
      const file = String(value);
      if (!file) return;

      if (!hook.loadLesskeyFile(file)) {
        search.message = `Cannot use lesskey file "${file}"`;
      }
    },
  };
