import { OptionSpec } from './spec';

import { applyBracketedPaste } from './shared';

import { opt } from './state';

export const noPaste: OptionSpec = {
    letter: '',
    names: ['no-paste'],
    type: 'bool',
    messages: [
      'Accept pasted input',
      'Ignore pasted input',
    ],
    defaultValue: 0,
    get: () => opt.noPaste,
    set: value => {
      opt.noPaste = value as number;
      applyBracketedPaste();
    },
  };
