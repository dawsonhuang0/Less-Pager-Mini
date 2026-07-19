import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const useColor: OptionSpec = {
    letter: '',
    names: ['use-color'],
    type: 'bool',
    messages: [
      "Don't use color",
      'Use color',
    ],
    defaultValue: 0,
    get: () => opt.useColor,
    set: value => {
      opt.useColor = value as number;

      // colored carets are baked into the derived content
      hook.rebuildContent();
    },
  };
