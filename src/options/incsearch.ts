import { OptionSpec } from './spec';

import { opt } from './state';

export const incsearch: OptionSpec = {
    letter: '',
    names: ['incsearch'],
    type: 'bool',
    messages: [
      'Incremental search is off',
      'Incremental search is on',
    ],
    defaultValue: 0,
    get: () => opt.incrSearch,
    set: value => { opt.incrSearch = value as number; },
  };
