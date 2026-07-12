import { OptionSpec } from './spec';

import { opt } from './state';

export const quitAtEof: OptionSpec = {
    letter: 'e',
    names: ['quit-at-eof'],
    type: 'triple',
    messages: [
      "Don't quit at end-of-file",
      'Quit at end-of-file',
      'Quit immediately at end-of-file',
    ],
    defaultValue: 0,
    get: () => opt.quitAtEof,
    set: value => { opt.quitAtEof = value as number; },
  };
