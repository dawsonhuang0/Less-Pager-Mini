import { OptionSpec } from './spec';

import {
  EMOUSE_LCLICK,
  EMOUSE_RCLICK,
  EMOUSE_VDRAG,
  EMOUSE_VSCROLL,
  applyMouse,
  emouseNames
} from './shared';

import { search } from '../features/searching';

import { opt } from './state';

// what --mouse itself turns on: less's opt_emouse(type, "vmove,click")
const MOUSE_BITS =
  EMOUSE_VSCROLL | EMOUSE_VDRAG | EMOUSE_LCLICK | EMOUSE_RCLICK;

export const mouse: OptionSpec = {
    letter: '',
    names: ['mouse'],
    type: 'triple',

    // less's opttbl entry carries LM_NULL for all three states
    // (e89bbf6): what to say depends on the --emouse BITMAP and not on
    // --mouse's own value, so opt_mouse prints it itself - by falling
    // through into its QUERY case - and toggle_option's generic odesc
    // message is skipped
    messages: [],
    defaultValue: 0,
    get: () => opt.mouseMode,
    set: value => {
      opt.mouseMode = value as number;

      // less's opt_mouse (optfunc.c:1033, 249e497): --mouse turns the
      // mouse on only when nothing has enabled it yet. Over an
      // --emouse it turns it OFF instead and spends its own value
      // doing so - which is why the press after that enables again
      if (opt.emouse === 0) {
        opt.emouse = MOUSE_BITS;
        opt.mouseReverse = opt.mouseMode === 2 ? 1 : 0;
      } else {
        opt.emouse = 0;
        opt.mouseMode = 0;
      }

      applyMouse();
    },

    // less's opt_mouse QUERY (optfunc.c:1045): --mouse answers in its
    // own words only when the bitmap is exactly the one it sets.
    // Anything else was --emouse's doing and answers in --emouse's
    // words, which is what "__mouse after --emouse=click" reports
    query: () => {
      if (opt.emouse !== MOUSE_BITS) {
        const names = emouseNames();

        search.message = names
          ? `Mouse features enabled: ${names}`
          : 'Ignore mouse input';

        return;
      }

      search.message = opt.mouseReverse
        ? 'Use the mouse for scrolling vertically (reverse)'
        : 'Use the mouse for scrolling vertically';
    },
  };
