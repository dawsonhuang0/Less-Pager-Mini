import { OptionSpec } from './spec';

import { opt } from './state';

import { expandHomeEnv, glob } from '../features/files';

export const tagFile: OptionSpec = {
    letter: 'T',
    names: ['tag-file'],
    type: 'string',
    messages: [],
    prompt: 'tags file: ',
    defaultValue: 'tags',
    get: () => `Tags file "${opt.tagsFile}"`,
    set: value => {
      // opt__T's TOGGLE: leading blanks stripped (skipspc), then
      // lglob + shell_unquote expand ~, $VAR and glob patterns;
      // the INIT store stays unexpanded (applyScanString)
      const name = String(value).replace(/^[ \t]+/, '');
      opt.tagsFile = glob(expandHomeEnv(name)).join(' ');
    },
  };
