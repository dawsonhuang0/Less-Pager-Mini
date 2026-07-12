import { OptionSpec } from './spec';

import { applyMouse, emouseNames, parseEmouse } from './shared';

import { opt } from './state';

export const emouse: OptionSpec = {
    letter: '',
    names: ['emouse'],
    type: 'string',
    messages: [],
    prompt: 'Mouse features: ',
    validchars: 's',
    defaultValue: '-',
    get: () => {
      const names = emouseNames();
      return names ? `Mouse features enabled: ${names}` : 'Ignore mouse input';
    },
    set: value => {
      const bits = parseEmouse(String(value));

      if (bits !== null) {
        opt.emouse = bits;
        applyMouse();
      }
    },
  };
