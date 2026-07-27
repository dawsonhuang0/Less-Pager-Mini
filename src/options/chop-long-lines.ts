import { OptionSpec } from './spec';

import { config } from '../state/config';

import { getLayout } from '../lines/lineLayout';

import { hook, recalculateEOF } from './shared';

export const chopLongLines: OptionSpec = {
    letter: 'S',
    names: ['chop-long-lines'],
    type: 'bool',
    messages: ['Fold long lines', 'Chop long lines'],
    defaultValue: 0,
    get: () => (config.chopLongLines ? 1 : 0),
    set: (value, content) => {
      // og's opt__S calls pos_rehead(TRUE) on toggle (optfunc.c): the
      // screen top moves back to the BEGINNING of its line, and the
      // horizontal shift becomes the column that top used to be at
      // (position.c:329, pos_shift counts characters). So a chopped
      // screen keeps showing the same text, now scrolled sideways
      // instead of wrapped. A top already at a line start changes
      // nothing - pos_rehead returns early and hshift survives.
      if (config.subRow > 0) {
        const line = content[config.row];

        if (line !== undefined) {
          config.col = getLayout(line).rowStart[config.subRow] ?? config.col;
        }

        config.subRow = 0;
      }

      config.chopLongLines = Boolean(value);
      recalculateEOF(content);

      // chopline carries O_REPAINT (opttbl.c:423). og repaints from
      // the file, so it simply reads what the new shape needs; our
      // stream engine materializes a slice sized for the OLD shape,
      // and a chopped screen wants one whole line per row where a
      // wrapped one wanted a few lines' worth of sub-rows
      hook.rebuildContent();
    },
  };
