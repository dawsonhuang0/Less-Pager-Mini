import { OptionSpec } from './spec';

import { opt } from './state';

export const saveMarks: OptionSpec = {
    letter: '',
    names: ['save-marks'],
    type: 'bool',
    messages: [
      "Don't save marks in history file",
      'Save marks in history file',
    ],
    defaultValue: 0,
    get: () => opt.permaMarks,
    set: value => { opt.permaMarks = value as number; },
  };
