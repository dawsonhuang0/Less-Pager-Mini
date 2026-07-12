import { OptionSpec } from './spec';

import { opt } from './state';

export const noKeypad: OptionSpec = {
    letter: '',
    names: ['no-keypad'],
    type: 'bool',
    noToggle: true,
    messages: [
      'Use keypad mode',
      "Don't use keypad mode",
    ],
    defaultValue: 0,
    get: () => opt.noKeypad,
    set: value => { opt.noKeypad = value as number; },
  };
