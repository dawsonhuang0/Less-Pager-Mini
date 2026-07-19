import { OptionSpec } from './spec';

import { searchTypeNames } from './shared';

import { setSearchType } from './shared';

export const searchOptions: OptionSpec = {
    letter: '',
    names: ['search-options'],
    type: 'string',
    messages: [],
    prompt: 'Search options: ',
    validchars: 's',
    defaultValue: '-',
    get: () => `search options: ${searchTypeNames()}`,
    set: value => setSearchType(String(value)),
  };
