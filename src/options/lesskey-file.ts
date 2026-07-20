import { OptionSpec } from './spec';

export const lesskeyFile: OptionSpec = {
    letter: 'k',
    names: ['lesskey-file'],
    type: 'string',
    noToggle: true,
    noQuery: true,
    messages: [],
    defaultValue: '',
    get: () => '',
    set: () => {},
  };
