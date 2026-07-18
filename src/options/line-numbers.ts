import { OptionSpec } from './spec';

import { applyGutter } from './shared';

import { opt } from './state';

export const lineNumbers: OptionSpec = {
    letter: 'n',
    names: ['line-numbers'],
    type: 'triple',
    messages: [
      "Don't use line numbers",
      'Use line numbers',
      'Constantly display line numbers',
    ],
    defaultValue: 1,
    get: () => opt.linenums,
    set: (value, content) => {
      opt.linenums = value as number;
      applyGutter(content);
    },
  };
