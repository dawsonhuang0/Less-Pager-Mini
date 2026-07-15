import { OptionSpec } from './spec';

import { opt } from './state';

export const noInit: OptionSpec = {
    letter: 'X',
    names: ['no-init'],
    type: 'bool',
    noToggle: true,
    messages: [
      'Send init/deinit strings to terminal',
      "Don't use init/deinit strings",
    ],
    defaultValue: 0,
    get: () => opt.noInit,
    set: value => { opt.noInit = value as number; },
  };
