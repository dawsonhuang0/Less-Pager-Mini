import { OptionSpec } from './spec';

import { opt } from './state';

export const force: OptionSpec = {
    letter: 'f',
    names: ['force'],
    type: 'bool',
    messages: [
      'Open only regular files',
      'Open even non-regular files',
    ],
    defaultValue: 0,
    get: () => opt.forceOpen,
    set: value => { opt.forceOpen = value as number; },
  };
