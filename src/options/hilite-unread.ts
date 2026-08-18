import { OptionSpec } from './spec';

import { opt } from './state';

export const hiliteUnread: OptionSpec = {
    letter: 'w',
    names: ['hilite-unread'],
    type: 'triple',
    messages: [
      "Don't highlight first unread line",
      'Highlight first unread line after forward-screen',
      'Highlight first unread line after any forward movement',
    ],
    defaultValue: 0,
    // less keeps the current attn highlight when -w turns off; the
    // next movement clears it (clear_attn), not the toggle
    get: () => opt.showAttn,
    set: value => { opt.showAttn = value as number; },
  };
