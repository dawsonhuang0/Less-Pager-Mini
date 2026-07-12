import { OptionSpec } from './spec';

import { opt } from './state';

export const pastEof: OptionSpec = {
    letter: '',
    names: ['past-eof'],
    type: 'bool',
    messages: [
      'Stop scrolling at end of file',
      "Don't stop scrolling at end of file",
    ],
    defaultValue: 0,
    get: () => opt.pastEof,
    set: value => { opt.pastEof = value as number; },
  };
