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
    set: (value, content) => {
      // og's -r is O_BOOL|O_REPAINT with no ofunc (opttbl.c): it
      // trashes the screen and the next make_display repaints from
      // table[TOP], a BYTE, so the top stays on the same SOURCE
      // character while what that character displays as changes
      // underneath it. Ours indexes the DISPLAY line, and this option
      // rewrites that line - the escape codes become visible
      // characters - so the same offset would name a different place.
      // The carry re-derives it from the source index, and has to run
      // after the rebuild, since that is what produces the new line.
      const carry = hook.topOffset(content);

      opt.ctldisp = value as number;

      hook.rebuildContent();
      carry();
    },
  };
