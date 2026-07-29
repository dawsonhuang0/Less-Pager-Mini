import { OptionSpec } from './spec';

import { recalculateEOF, hook } from './shared';

import { opt } from './state';

export const wordwrap: OptionSpec = {
    letter: '',
    names: ['wordwrap'],
    type: 'bool',
    messages: [
      'Wrap lines at any character',
      'Wrap lines at spaces',
    ],
    defaultValue: 0,
    get: () => opt.wordwrap,
    set: (value, content) => {
      // og's --wordwrap is O_BOOL|O_REPAINT with no ofunc at all
      // (opttbl.c:754), so it never moves table[TOP]: the screen keeps
      // its byte and forw_line re-wraps from there. Ours indexes wrap
      // BOUNDARIES, and this option reshapes them - breaking at spaces
      // instead of at the width - so the offset has to be carried
      // across exactly as a width change carries it. Resetting the
      // sub-row instead threw the screen back to the line's start, and
      // left a stale zero for the next option to capture.
      const carry = hook.topOffset(content);

      opt.wordwrap = value as number;

      carry();
      recalculateEOF(content);
    },
  };
