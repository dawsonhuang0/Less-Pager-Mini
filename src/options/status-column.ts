import { OptionSpec } from './spec';

import { applyGutter } from './shared';

import { opt } from './state';

export const statusColumn: OptionSpec = {
    letter: 'J',
    names: ['status-column'],
    type: 'bool',
    messages: [
      "Don't display a status column",
      'Display a status column',
    ],
    defaultValue: 0,
    get: () => opt.statusCol,
    set: (value, content) => {
      opt.statusCol = value as number;
      applyGutter(content);
    },
  };
