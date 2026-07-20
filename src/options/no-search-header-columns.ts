import { OptionSpec } from './spec';

import { noSearchHeadersMessage, setNoSearchHeaders } from './shared';

export const noSearchHeaderColumns: OptionSpec = {
    letter: '',
    names: ['no-search-header-columns'],
    type: 'novar',
    messages: [],
    defaultValue: 0,
    get: () => 0,
    set: () => {
      setNoSearchHeaders(0, 1);
      noSearchHeadersMessage();
    },
    query: () => noSearchHeadersMessage(),
  };
