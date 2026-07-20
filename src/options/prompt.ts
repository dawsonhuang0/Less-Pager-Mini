import { OptionSpec } from './spec';

import { opt } from './state';

import { prProto } from '../features/prompt';

import { setProto } from '../features/prompt';

export const prompt: OptionSpec = {
    letter: 'P',
    names: ['prompt'],
    type: 'string',
    messages: [],
    prompt: 'prompt: ',
    defaultValue: '',
    get: () => {
      const kinds = ['short', 'medium', 'long'];
      return `Prompt (${kinds[opt.prType]}): ${prProto(opt.prType)}`;
    },
    set: value => setProto(String(value)),
  };
