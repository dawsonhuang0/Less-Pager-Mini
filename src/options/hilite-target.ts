import { OptionSpec } from './spec';

import { opt } from './state';

export const hiliteTarget: OptionSpec = {
    letter: '',
    names: ['hilite-target'],
    type: 'bool',
    messages: [
      "Don't highlight target line",
      'Highlight target line',
    ],
    defaultValue: 0,
    // the target screen row redraws with the next repaint, like og's
    // opt_hilite_target calling draw_target_attn
    get: () => opt.hiliteTarget,
    set: value => { opt.hiliteTarget = value as number; },
  };
