import { OptionSpec } from './spec';

import { opt } from './state';

export const quiet: OptionSpec = {
    letter: 'q',
    names: ['quiet', 'silent'],
    type: 'triple',
    messages: [
      'Ring the bell for errors AND at eof/bof',
      'Ring the bell for errors but not at eof/bof',
      'Never ring the bell',
    ],
    defaultValue: 0,
    get: () => opt.quiet,
    set: value => { opt.quiet = value as number; },
  };
