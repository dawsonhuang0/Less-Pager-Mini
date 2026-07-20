import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const procReturn: OptionSpec = {
    letter: '',
    names: ['proc-return'],
    type: 'triple',
    messages: [
      'Carriage return handling is specified by the -U option',
      'Delete carriage return before newline',
      'Print carriage return as ^M',
    ],
    defaultValue: 0,
    get: () => opt.procReturn,
    set: value => {
      opt.procReturn = value as number;
      hook.rebuildContent();
    },
  };
