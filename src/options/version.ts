import { OptionSpec } from './spec';

import { versionMessage } from '../features/misc';

export const version: OptionSpec = {
    letter: 'V',
    names: ['version'],
    type: 'novar',
    messages: [],
    defaultValue: 0,
    get: () => 0,
    set: () => versionMessage(),
  };
