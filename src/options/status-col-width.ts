import { OptionSpec } from './spec';

import { applyGutter } from './shared';

import { opt } from './state';

export const statusColWidth: OptionSpec = {
    letter: '',
    names: ['status-col-width'],
    type: 'number',
    messages: [],
    prompt: 'Status column width: ',
    report: 'Status column width is %d chars',
    max: 4,
    maxMessage: 'Status column width must not be larger than %d',
    maxFallback: 2,
    defaultValue: 2,
    get: () => opt.statusColWidth,
    set: (value, content) => {
      opt.statusColWidth = value as number;
      applyGutter(content);
    },
  };
