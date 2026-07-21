import { OptionSpec } from './spec';

import { opt } from './state';

export const longPrompt: OptionSpec = {
    letter: 'm',
    names: ['long-prompt'],
    type: 'triple',
    messages: [
      'Short prompt',
      'Medium prompt',
      'Long prompt',
    ],
    defaultValue: 0,
    get: () => opt.prType,
    set: value => { opt.prType = value as number; },
  };
