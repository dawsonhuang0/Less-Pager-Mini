import { OptionSpec } from './spec';

import { setColor } from '../features/color';

import { search } from '../features/searching';

import { hook } from './shared';

export const color: OptionSpec = {
    letter: 'D',
    names: ['color'],
    type: 'string',
    noQuery: true,
    messages: [],
    prompt: 'color desc: ',
    validchars: 's',
    defaultValue: '',
    get: () => '',
    set: value => {
      const error = setColor(String(value));

      if (error) {
        search.message = error;
      } else {
        // control char carets are baked into the derived content
        hook.rebuildContent();
      }
    },
  };
