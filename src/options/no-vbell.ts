import { OptionSpec } from './spec';

import { opt } from './state';

export const noVbell: OptionSpec = {
    letter: '',
    names: ['no-vbell'],
    type: 'bool',
    messages: [
      'Display visual bell',
      "Don't display visual bell",
    ],
    defaultValue: 0,
    get: () => opt.noVbell,
    set: value => { opt.noVbell = value as number; },
  };
