import { OptionSpec } from './spec';

import { opt } from './state';

export const noLessopen: OptionSpec = {
    letter: 'L',
    names: ['no-lessopen'],
    type: 'bool',
    messages: [
      "Don't use the LESSOPEN filter",
      'Use the LESSOPEN filter',
    ],
    defaultValue: 1,
    get: () => opt.useLessopen,
    set: value => { opt.useLessopen = value as number; },
  };
