import { OptionSpec } from './spec';

import { opt } from './state';

export const statusLine: OptionSpec = {
    letter: '',
    names: ['status-line'],
    type: 'bool',
    messages: [
      'Line highlight applies to text only',
      'Line highlight applies to entire width of screen',
    ],
    defaultValue: 0,
    get: () => opt.statusLine,
    set: value => { opt.statusLine = value as number; },
  };
