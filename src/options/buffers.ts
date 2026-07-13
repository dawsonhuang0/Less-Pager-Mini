import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const buffers: OptionSpec = {
    letter: 'b',
    names: ['buffers'],
    type: 'number',
    messages: [],
    prompt: 'Max buffer space per file (K): ',
    report: 'Max buffer space per file: %dK',
    defaultValue: 64,
    get: () => opt.bufSpace,
    set: value => {
      opt.bufSpace = value as number;

      // og's opt_b calls ch_setbufspace right away
      hook.trimBufSpace();
    },
  };
