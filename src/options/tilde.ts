import { OptionSpec } from './spec';

import { opt } from './state';

export const tilde: OptionSpec = {
    letter: '~',
    names: ['tilde'],
    type: 'bool',
    messages: [
      "Don't show tildes after end of file",
      'Show tildes after end of file',
    ],
    defaultValue: 1,
    get: () => opt.tildes,
    set: value => { opt.tildes = value as number; },
  };
