import { OptionSpec } from './spec';

import { opt } from './state';

export const noHistdups: OptionSpec = {
    letter: '',
    names: ['no-histdups'],
    type: 'bool',
    messages: [
      'Allow duplicates in history list',
      'Remove duplicates from history list',
    ],
    defaultValue: 0,
    get: () => opt.noHistDups,
    set: value => { opt.noHistDups = value as number; },
  };
