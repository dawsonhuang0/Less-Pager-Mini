import { OptionSpec } from './spec';

import {
  EMOUSE_LCLICK,
  EMOUSE_RCLICK,
  EMOUSE_VDRAG,
  EMOUSE_VSCROLL,
  applyMouse
} from './shared';

import { opt } from './state';

export const mouse: OptionSpec = {
    letter: '',
    names: ['mouse'],
    type: 'triple',
    messages: [
      'Ignore mouse input',
      'Use the mouse for scrolling vertically',
      'Use the mouse for scrolling vertically (reverse)',
    ],
    defaultValue: 0,
    get: () => opt.mouseMode,
    set: value => {
      opt.mouseMode = value as number;

      // og's opt_mouse drives the --emouse bitmap and, when enabled,
      // the --rmouse state ("vmove,click" or "-")
      opt.emouse = opt.mouseMode
        ? EMOUSE_VSCROLL | EMOUSE_VDRAG | EMOUSE_LCLICK | EMOUSE_RCLICK
        : 0;
      if (opt.mouseMode) opt.mouseReverse = opt.mouseMode === 2 ? 1 : 0;

      applyMouse();
    },
  };
