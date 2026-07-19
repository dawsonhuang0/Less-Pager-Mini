import { OptionSpec } from './spec';

import { opt } from './state';

export const noNumberHeaders: OptionSpec = {
    letter: '',
    names: ['no-number-headers'],
    type: 'bool',
    messages: [
      'Number header lines',
      "Don't number header lines",
    ],
    defaultValue: 0,
    get: () => opt.nonumHeaders,
    set: value => { opt.nonumHeaders = value as number; },
  };
