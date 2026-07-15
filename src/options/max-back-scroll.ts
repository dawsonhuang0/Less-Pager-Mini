import { OptionSpec } from './spec';

import { opt } from './state';

export const maxBackScroll: OptionSpec = {
    letter: 'h',
    names: ['max-back-scroll'],
    type: 'number',
    messages: [],
    prompt: 'Backwards scroll limit: ',
    report: 'Backwards scroll limit is %d lines',
    defaultValue: -1,
    get: () => opt.backScroll,
    set: value => { opt.backScroll = value as number; },
  };
