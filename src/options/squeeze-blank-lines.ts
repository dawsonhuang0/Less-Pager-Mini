import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const squeezeBlankLines: OptionSpec = {
    letter: 's',
    names: ['squeeze-blank-lines'],
    type: 'bool',
    messages: [
      'Display all blank lines',
      'Squeeze multiple blank lines',
    ],
    defaultValue: 0,
    get: () => opt.squeeze,
    set: value => {
      opt.squeeze = value as number;
      hook.rebuildContent();
    },
  };
