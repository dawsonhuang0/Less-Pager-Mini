import { OptionSpec } from './spec';

import { noSearchHeadersMessage, setNoSearchHeaders } from './shared';

export const noSearchHeaders: OptionSpec = {
    letter: '',
    names: ['no-search-headers'],
    type: 'novar',
    messages: [],
    defaultValue: 0,
    get: () => 0,
    set: () => {
      setNoSearchHeaders(1, 1);
      noSearchHeadersMessage();
    },
    query: () => noSearchHeadersMessage(),
  };
