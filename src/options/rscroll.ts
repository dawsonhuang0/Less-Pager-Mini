import { OptionSpec } from './spec';

import { prChar } from './shared';

import { opt } from './state';

import { search } from '../features/searching';

import { visualWidth } from '../lines/helpers';

export const rscroll: OptionSpec = {
    letter: '',
    names: ['rscroll'],
    type: 'string',
    messages: [],
    prompt: 'rscroll character: ',
    validchars: 's',
    defaultValue: '>',
    get: () =>
      `rscroll character is ${opt.rscrollChar ? prChar(opt.rscrollChar) : '-'}`,
    set: value => {
      // like opt_rscroll with setfmt("*s>"): a "*x" prefix selects the
      // attribute, "-" disables the marker, empty means the default ">"
      let text = String(value);
      let attr: typeof opt.rscrollAttr = 's';

      if (text[0] === '*' && text.length > 1) {
        const kind = text[1];
        attr = kind === 'd' || kind === 'k' || kind === 's' || kind === 'u'
          ? kind
          : 'n';
        text = text.slice(2);
      }

      if (text === '-') {
        opt.rscrollChar = '';
        return;
      }

      opt.rscrollAttr = attr;

      if (!text) {
        opt.rscrollChar = '>';
        return;
      }

      const char = [...text][0];

      if (visualWidth(char) > 1) {
        search.message = 'cannot set rscroll to a wide character';
      } else {
        opt.rscrollChar = char;
      }
    },
  };
