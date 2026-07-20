import { OptionSpec } from './spec';

import { noSearchHeadersMessage, setNoSearchHeaders } from './shared';

export const noSearchHeaderLines: OptionSpec = {
    letter: '',
    names: ['no-search-header-lines'],
    type: 'novar',
    messages: [],
    defaultValue: 0,
    get: () => 0,
    set: () => {
      setNoSearchHeaders(1, 0);
      noSearchHeadersMessage();
    },
    query: () => noSearchHeadersMessage(),
  };
