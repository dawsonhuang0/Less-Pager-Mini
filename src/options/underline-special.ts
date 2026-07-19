import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const underlineSpecial: OptionSpec = {
    letter: 'u',
    names: ['underline-special'],
    type: 'triple',
    messages: [
      'Display underlined text in underline mode',
      'Backspaces cause overstrike',
      'Print backspace as ^H',
    ],
    defaultValue: 0,
    get: () => opt.bsMode,
    set: value => {
      opt.bsMode = value as number;

      // O_REPAINT|O_HL_REPAINT: the overstrike/caret shape of the
      // derived content changes
      hook.rebuildContent();
    },
  };
