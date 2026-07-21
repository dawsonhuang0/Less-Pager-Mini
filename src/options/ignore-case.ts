import { OptionSpec } from './spec';

import { chgCaseless, search } from '../features/searching';

import { CASELESS_MESSAGES } from './shared';

export const ignoreCase: OptionSpec = {
    letter: 'i',
    names: ['ignore-case'],
    type: 'bool',
    messages: CASELESS_MESSAGES,
    // og's -i/-I are one TRIPLE over caseless: the _ query reports
    // the shared three-state message, not a per-flag boolean
    query: () => { search.message = CASELESS_MESSAGES[search.caseless]; },
    defaultValue: 0,
    get: () => (search.caseless === 1 ? 1 : 0),
    set: value => chgCaseless(value ? 1 : 0),
  };
