import { OptionSpec } from './spec';

export const pattern: OptionSpec = {
    letter: 'p',
    names: ['pattern'],
    type: 'string',
    noToggle: true,
    noQuery: true,
    messages: [],
    defaultValue: '',
    get: () => '',
    set: () => {},
  };
