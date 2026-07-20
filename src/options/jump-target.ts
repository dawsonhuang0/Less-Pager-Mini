import { OptionSpec } from './spec';

import { parseFraction, queryFraction } from './shared';

import { opt } from './state';

export const jumpTarget: OptionSpec = {
    letter: 'j',
    names: ['jump-target'],
    type: 'string',
    validchars: '-.d',
    messages: [],
    prompt: 'Target line: ',
    defaultValue: '0',
    get: () => queryFraction(opt.jumpTarget, opt.jumpFraction,
      'Position target at screen line %d',
      'Position target at screen position %s'),
    set: value => {
      const parsed = parseFraction(String(value), '-j', true);
      if (!parsed) return;

      if (parsed.frac >= 0) {
        opt.jumpFraction = parsed.frac;
      } else {
        opt.jumpTarget = parsed.num;
        opt.jumpFraction = -1;
      }
    },
  };
