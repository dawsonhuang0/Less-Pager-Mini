import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const procBackspace: OptionSpec = {
    letter: '',
    names: ['proc-backspace'],
    type: 'triple',
    messages: [
      'Backspace handling is specified by the -U option',
      'Display underline text in underline mode',
      'Print backspaces as ^H',
    ],
    defaultValue: 0,
    get: () => opt.procBackspace,
    set: value => {
      opt.procBackspace = value as number;
      hook.rebuildContent();
    },
  };
