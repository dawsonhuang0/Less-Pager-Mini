import { OptionSpec } from './spec';

import { opt } from './state';

export const formFeed: OptionSpec = {
    letter: '',
    names: ['form-feed'],
    type: 'bool',
    messages: [
      "Don't stop on form feed",
      'Stop on form feed',
    ],
    defaultValue: 0,
    get: () => opt.stopOnFormFeed,
    set: value => { opt.stopOnFormFeed = value as number; },
  };
