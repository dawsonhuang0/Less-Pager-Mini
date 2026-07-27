import { OptionSpec } from './spec';

import { hook } from './shared';

import { opt } from './state';

export const procTab: OptionSpec = {
    letter: '',
    names: ['proc-tab'],
    type: 'triple',
    messages: [
      'Tab handling is specified by the -U option',
      'Expand tabs to spaces',
      'Print tabs as ^I',
    ],
    defaultValue: 0,
    get: () => opt.procTab,
    set: value => {
      opt.procTab = value as number;
      hook.rebuildContent();

      // og's O_HL_REPAINT (opttbl.c): chg_hilite runs before the
      // option's message and repaints the screen through
      // repaint_hilite, so the new shape shows UNDER the message
      hook.hiliteRepaint();
    },
  };
