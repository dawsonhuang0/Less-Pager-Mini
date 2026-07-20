import { OptionSpec } from './spec';

import { opt } from './state';

export const modelines: OptionSpec = {
    letter: '',
    names: ['modelines'],
    type: 'number',
    messages: [],
    prompt: 'Lines to read looking for modelines: ',
    report: 'Read %d lines looking for modelines',
    defaultValue: 0,
    get: () => opt.modelines,
    set: value => { opt.modelines = value as number; },
  };
