import { OptionSpec } from './spec';

import { opt } from './state';

export const redrawOnQuit: OptionSpec = {
    letter: '',
    names: ['redraw-on-quit'],
    type: 'bool',
    messages: [
      "Don't redraw screen when quitting",
      'Redraw last screen when quitting',
    ],
    defaultValue: 0,
    get: () => opt.redrawOnQuit,
    set: value => { opt.redrawOnQuit = value as number; },
  };
