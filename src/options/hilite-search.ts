import { OptionSpec } from './spec';

import { opt } from './state';

export const hiliteSearch: OptionSpec = {
    letter: 'g',
    names: ['hilite-search'],
    type: 'triple',
    messages: [
      "Don't highlight search matches",
      'Highlight matches for previous search only',
      'Highlight all matches for previous search pattern',
    ],
    defaultValue: 2,
    get: () => opt.hiliteSearch,
    set: value => { opt.hiliteSearch = value as number; },
  };
