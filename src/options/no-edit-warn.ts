import { OptionSpec } from './spec';

import { opt } from './state';

export const noEditWarn: OptionSpec = {
    letter: '',
    names: ['no-edit-warn', 'no-warn-edit'],
    type: 'bool',
    messages: [
      'Warn when editing a file opened via LESSOPEN',
      "Don't warn when editing a file opened via LESSOPEN",
    ],
    defaultValue: 0,
    get: () => opt.noEditWarn,
    set: value => { opt.noEditWarn = value as number; },
  };
