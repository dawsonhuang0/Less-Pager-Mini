import { OptionSpec } from './spec';

import { opt } from './state';

export const quitIfOneScreen: OptionSpec = {
    letter: 'F',
    names: ['quit-if-one-screen'],
    type: 'bool',
    messages: [
      "Don't quit if end-of-file on first screen",
      'Quit if end-of-file on first screen',
    ],
    defaultValue: 0,
    get: () => opt.quitIfOneScreen,
    set: value => { opt.quitIfOneScreen = value as number; },
  };
