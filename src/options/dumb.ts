import { OptionSpec } from './spec';

import { opt } from './state';

export const dumb: OptionSpec = {
    letter: 'd',
    names: ['dumb'],
    type: 'bool',
    noToggle: true,
    messages: [
      'Assume intelligent terminal',
      'Assume dumb terminal',
    ],
    defaultValue: 0,
    get: () => opt.knowDumb,
    set: value => { opt.knowDumb = value as number; },
  };
