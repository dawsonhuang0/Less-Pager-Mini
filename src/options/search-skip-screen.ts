import { OptionSpec } from './spec';

import { opt } from './state';

export const searchSkipScreen: OptionSpec = {
    letter: 'a',
    names: ['search-skip-screen'],
    type: 'triple',
    messages: [
      'Search includes displayed screen',
      'Search skips displayed screen',
      'Search includes all of displayed screen',
    ],
    defaultValue: 2,
    get: () => opt.howSearch,
    set: value => { opt.howSearch = value as number; },
  };
