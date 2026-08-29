import { OptionSpec } from './spec';

import { opt } from './state';

export const quitOnIntr: OptionSpec = {
    letter: 'K',
    names: ['quit-on-intr'],
    type: 'bool',
    messages: [
      'Interrupt (ctrl-C) returns to prompt',
      'Interrupt (ctrl-C) exits less-pager-mini',
    ],
    defaultValue: 0,
    get: () => opt.quitOnIntr,
    set: value => { opt.quitOnIntr = value as number; },
  };
