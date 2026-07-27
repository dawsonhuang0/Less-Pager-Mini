import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const procBackspace: OptionSpec = {
    letter: '',
    names: ['proc-backspace'],
    type: 'triple',
    messages: [
      'Backspace handling is specified by the -U option',
      'Display underline text in underline mode',
      'Print backspaces as ^H',
    ],
    defaultValue: 0,
    get: () => opt.procBackspace,
    set: value => {
      opt.procBackspace = value as number;
      hook.rebuildContent();

      // og's O_HL_REPAINT (opttbl.c): chg_hilite runs before the
      // option's message and repaints the screen through
      // repaint_hilite, so the new shape shows UNDER the message
      hook.hiliteRepaint();
    },
  };
