import { OptionSpec } from './spec';

import { opt } from './state';

export const useBackslash: OptionSpec = {
    letter: '',
    names: ['use-backslash'],
    type: 'bool',
    messages: [
      "Don't use backslash escaping in command line parameters",
      'Use backslash escaping in command line parameters',
    ],
    defaultValue: 0,
    get: () => opt.useBackslash,
    set: value => { opt.useBackslash = value as number; },
  };
