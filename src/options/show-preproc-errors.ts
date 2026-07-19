import { OptionSpec } from './spec';

import { opt } from './state';

export const showPreprocErrors: OptionSpec = {
    letter: '',
    names: ['show-preproc-errors'],
    type: 'bool',
    messages: [
      "Don't show error message if preprocessor fails",
      'Show error message if preprocessor fails',
    ],
    defaultValue: 0,
    get: () => opt.showPreprocError,
    set: value => { opt.showPreprocError = value as number; },
  };
