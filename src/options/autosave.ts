import { OptionSpec } from './spec';

import { opt } from './state';

export const autosave: OptionSpec = {
    letter: '',
    names: ['autosave'],
    type: 'string',
    messages: [],
    prompt: 'Autosave actions: ',
    validchars: 's',
    defaultValue: '-',
    get: () => `Autosave actions: ${opt.autosave}`,
    set: value => { opt.autosave = String(value) || '-'; },
  };
