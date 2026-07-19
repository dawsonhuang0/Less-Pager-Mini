import { OptionSpec } from './spec';

import { setCmdAtPrompt } from '../features/misc';

export const cmd: OptionSpec = {
    letter: '',
    names: ['cmd'],
    type: 'string',
    noToggle: true,
    noQuery: true,
    messages: [],
    defaultValue: '',
    get: () => '',
    set: value => setCmdAtPrompt(String(value)),
  };
