import { OptionSpec } from './spec';

import { config } from '../state/config';

import { getLayout } from '../lines/lineLayout';

import { sourceLine, sourceIndexAt } from '../lines/helpers';

import { hook, recalculateEOF } from './shared';

export const chopLongLines: OptionSpec = {
    letter: 'S',
    names: ['chop-long-lines'],
    type: 'bool',
    messages: ['Fold long lines', 'Chop long lines'],
    defaultValue: 0,
    get: () => (config.chopLongLines ? 1 : 0),
    set: (value, content) => {
      // less's opt__S calls pos_rehead(TRUE) on toggle (optfunc.c): the
      // screen top moves back to the BEGINNING of its line, and the
      // horizontal shift becomes the column that top used to be at
      // (position.c:329, pos_shift counts characters). So a chopped
      // screen keeps showing the same text, now scrolled sideways
      // instead of wrapped. A top already at a line start changes
      // nothing - pos_rehead returns early and hshift survives.
      if (config.subRow > 0 || config.subShift > 0) {
        const line = content[config.row];

        if (line !== undefined) {
          // less's pos_rehead(TRUE) sets hshift = pos_shift(linepos,
          // tpos - linepos), and pos_shift counts the characters
          // between the line's start and the top AFTER cvt_text
          // (position.c:271) - which folds backspaces and CR but does
          // NOT expand tabs. So the shift counts RAW characters, not
          // the columns they occupy: a tab is one, however wide it
          // draws. Measuring the display line instead shifted a
          // tab-indented file far too far.
          const shown = (getLayout(line).rowStart[config.subRow] ?? 0) +
            config.subShift;
          const raw = sourceLine(line);

          config.col = raw === undefined
            ? shown
            : sourceIndexAt(raw, shown);
        }

        config.subRow = 0;
        config.subShift = 0;
        config.screen = [];
      }

      config.chopLongLines = Boolean(value);
      recalculateEOF(content);

      // chopline carries O_REPAINT (opttbl.c:423). less repaints from
      // the file, so it simply reads what the new shape needs; our
      // stream engine materializes a slice sized for the OLD shape,
      // and a chopped screen wants one whole line per row where a
      // wrapped one wanted a few lines' worth of sub-rows
      hook.rebuildContent();
    },
  };
