import { OptionSpec } from './spec';

import { search } from '../features/searching';

export const help: OptionSpec = {
    letter: '?',
    names: ['help'],
    type: 'novar',
    messages: [],
    defaultValue: 0,
    get: () => 0,
    set: () => { search.message = 'Use "h" for help'; },
  };
