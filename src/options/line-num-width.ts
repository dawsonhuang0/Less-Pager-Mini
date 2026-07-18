import { OptionSpec } from './spec';

import { applyGutter } from './shared';

import { opt } from './state';

export const lineNumWidth: OptionSpec = {
    letter: '',
    names: ['line-num-width'],
    type: 'number',
    messages: [],
    prompt: 'Line number width: ',
    report: 'Line number width is %d chars',
    max: 16,
    maxMessage: 'Line number width must not be larger than %d',
    maxFallback: 7,
    defaultValue: 7,
    get: () => opt.linenumWidth,
    set: (value, content) => {
      opt.linenumWidth = value as number;
      applyGutter(content);
    },
  };
