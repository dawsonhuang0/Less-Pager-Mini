import { OptionSpec } from './spec';

import { config } from '../state/config';

import { recalculateEOF } from './shared';

export const chopLongLines: OptionSpec = {
    letter: 'S',
    names: ['chop-long-lines'],
    type: 'bool',
    messages: ['Fold long lines', 'Chop long lines'],
    defaultValue: 0,
    get: () => (config.chopLongLines ? 1 : 0),
    set: (value, content) => {
      config.chopLongLines = Boolean(value);
      config.subRow = 0;
      recalculateEOF(content);
    },
  };
