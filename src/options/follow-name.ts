import { OptionSpec } from './spec';

import { opt } from './state';

export const followName: OptionSpec = {
    letter: '',
    names: ['follow-name'],
    type: 'bool',
    messages: [
      'F command follows file descriptor',
      'F command follows file name',
    ],
    defaultValue: 0,
    get: () => opt.followName,
    set: value => { opt.followName = value as number; },
  };
