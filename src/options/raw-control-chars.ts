import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const rawControlChars: OptionSpec = {
    letter: 'r',
    names: ['raw-control-chars'],
    type: 'triple',
    messages: [
      'Display control characters as ^X',
      'Display control characters directly (not recommended)',
      'Display ANSI sequences directly, other control characters as ^X',
    ],
    defaultValue: 0,
    get: () => opt.ctldisp,
    set: value => {
      opt.ctldisp = value as number;
      hook.rebuildContent();
    },
  };
