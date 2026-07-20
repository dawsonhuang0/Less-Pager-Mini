import { OptionSpec } from './spec';

import { queryFraction, setMatchShift } from './shared';

import { opt } from './state';

export const matchShift: OptionSpec = {
    letter: '',
    names: ['match-shift'],
    type: 'string',
    messages: [],
    prompt: 'Search match shift: ',
    validchars: '.d',
    defaultValue: '0',
    get: () => queryFraction(opt.matchShift, opt.matchShiftFraction,
      'Search match shift is %d',
      'Search match shift is %s of screen width'),
    set: value => setMatchShift(String(value)),
  };
