import { OptionSpec } from './spec';

import { opt } from './state';

export const oldBot: OptionSpec = {
    letter: '',
    names: ['old-bot'],
    type: 'bool',
    messages: [
      'Use new bottom of screen behavior',
      'Use old bottom of screen behavior',
    ],
    defaultValue: 0,
    get: () => opt.oldBot,
    set: value => { opt.oldBot = value as number; },
  };
