import { OptionSpec } from './spec';

import { config } from '../config';

import { parseFraction, queryFraction } from './shared';

import { opt } from './state';

export const shift: OptionSpec = {
    letter: '#',
    names: ['shift'],
    type: 'string',
    validchars: '.d',
    messages: [],
    prompt: 'Horizontal shift: ',
    defaultValue: '0',
    get: () => queryFraction(config.setCol, opt.shiftFraction,
      'Horizontal shift %d columns',
      'Horizontal shift %s of screen width'),
    set: value => {
      const parsed = parseFraction(String(value), '-#', false);
      if (!parsed) return;

      if (parsed.frac >= 0) {
        opt.shiftFraction = parsed.frac;
      } else {
        config.setCol = parsed.num;
        opt.shiftFraction = -1;
      }
    },
  };
