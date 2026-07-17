import { OptionSpec } from './spec';

import { opt } from './state';

export const exitFollowOnClose: OptionSpec = {
    letter: '',
    names: ['exit-follow-on-close'],
    type: 'bool',
    messages: [
      "Don't exit F command when input closes",
      'Exit F command when input closes',
    ],
    defaultValue: 0,
    get: () => opt.exitFollowOnClose,
    set: value => { opt.exitFollowOnClose = value as number; },
  };
