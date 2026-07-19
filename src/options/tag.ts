import { OptionSpec } from './spec';

import { search } from '../features/searching';

import { secureAllow } from '../features/secure';

import { findTag, requestTagJump } from '../features/tags';

export const tag: OptionSpec = {
    letter: 't',
    names: ['tag'],
    type: 'string',
    noQuery: true,
    messages: [],
    prompt: 'tag: ',
    defaultValue: '',
    get: () => '',
    set: value => {
      if (!secureAllow('tags')) {
        search.message = 'tags support is not available';
        return;
      }

      // like opt_t: load the tag list, then the pager jumps to it;
      // og's skipspc strips leading blanks only
      const error = findTag(String(value).replace(/^[ \t]+/, ''));

      if (error) {
        search.message = error;
      } else {
        requestTagJump();
      }
    },
  };
