import { OptionSpec } from './spec';

import { search } from '../features/searching';

import { opt } from './state';

export const quotes: OptionSpec = {
    letter: '"',
    names: ['quotes'],
    type: 'string',
    messages: [],
    prompt: 'quotes: ',
    validchars: 's',
    defaultValue: '"',
    get: () => `quotes ${opt.quoteOpen}${opt.quoteClose}`,
    set: value => {
      const text = String(value);

      if (!text) {
        opt.quoteOpen = opt.quoteClose = '';
      } else if (text.length > 2) {
        search.message = '-" must be followed by 1 or 2 chars';
      } else {
        opt.quoteOpen = text[0];
        opt.quoteClose = text[1] ?? text[0];
      }
    },
  };
