import { OptionSpec } from './spec';

import { opt } from './state';

export const rmouse: OptionSpec = {
    letter: '',
    names: ['rmouse'],
    type: 'bool',
    messages: [
      'Normal mouse scroll direction',
      'Reverse mouse scroll direction',
    ],
    defaultValue: 0,
    get: () => opt.mouseReverse,
    set: value => { opt.mouseReverse = value as number; },
  };
