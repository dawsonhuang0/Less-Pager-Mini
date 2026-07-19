import { OptionSpec } from './spec';

import { prChar } from './shared';

import { opt } from './state';

export const intr: OptionSpec = {
    letter: '',
    names: ['intr'],
    type: 'string',
    messages: [],
    prompt: 'interrupt character: ',
    validchars: 's',
    defaultValue: '\x18',
    get: () => `interrupt character is ${prChar(opt.intrChar)}`,
    set: value => {
      const text = String(value);
      opt.intrChar = text[1] && text[0] === '^'
        ? String.fromCharCode(text.charCodeAt(1) % 0x20)
        : text[0] ?? '\x18';
    },
  };
