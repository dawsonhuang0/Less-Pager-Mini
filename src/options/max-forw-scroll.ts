import { OptionSpec } from './spec';

import { opt } from './state';

export const maxForwScroll: OptionSpec = {
    letter: 'y',
    names: ['max-forw-scroll'],
    type: 'number',
    messages: [],
    prompt: 'Forward scroll limit: ',
    report: 'Forward scroll limit is %d lines',
    defaultValue: -1,
    get: () => opt.forwScroll,
    set: value => { opt.forwScroll = value as number; },
  };
