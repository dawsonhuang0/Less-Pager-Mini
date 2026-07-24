import { OptionSpec } from './spec';

import { config } from '../state/config';

export const window: OptionSpec = {
    letter: 'z',
    names: ['window'],
    type: 'number',
    messages: [],
    prompt: 'Scroll window size: ',
    report: 'Scroll window size is %d lines',
    negok: true,
    defaultValue: -1,
    get: () => config.setWindow,
    set: value => { config.setWindow = value as number; },
  };
