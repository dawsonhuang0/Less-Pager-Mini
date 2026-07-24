import { OptionSpec } from './spec';

import { config } from '../state/config';

import { recalculateEOF } from './shared';

import { opt } from './state';

export const wordwrap: OptionSpec = {
    letter: '',
    names: ['wordwrap'],
    type: 'bool',
    messages: [
      'Wrap lines at any character',
      'Wrap lines at spaces',
    ],
    defaultValue: 0,
    get: () => opt.wordwrap,
    set: (value, content) => {
      opt.wordwrap = value as number;

      // the sub-row boundaries changed shape
      config.subRow = 0;
      recalculateEOF(content);
    },
  };
