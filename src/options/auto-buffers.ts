import { OptionSpec } from './spec';

import { opt } from './state';

export const autoBuffers: OptionSpec = {
    letter: 'B',
    names: ['auto-buffers'],
    type: 'bool',
    messages: [
      "Don't automatically allocate buffers",
      'Automatically allocate buffers when needed',
    ],
    defaultValue: 1,
    get: () => opt.autoBuffers,
    set: value => { opt.autoBuffers = value as number; },
  };
