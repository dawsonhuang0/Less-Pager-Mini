import { OptionSpec } from './spec';

import { endPrompts } from './shared';

import { opt } from './state';

export const endPrompt: OptionSpec = {
    letter: '',
    names: ['end-prompt'],
    type: 'string',
    messages: [],
    prompt: 'Print after prompt: ',
    validchars: 's',
    defaultValue: '-',
    get: () => {
      const styles = ['short', 'medium', 'long'];
      const text = endPrompts[opt.prType] ?? '(nothing)';
      return `Print after ${styles[opt.prType]} prompt: ${text}`;
    },
    set: value => {
      let text = String(value);
      let style = 0;

      if ('smM'.includes(text[0] ?? '')) {
        style = text[0] === 'm' ? 1 : text[0] === 'M' ? 2 : 0;
        text = text.slice(1);
      }

      endPrompts[style] = text === '-' ? null : text;
    },
  };
