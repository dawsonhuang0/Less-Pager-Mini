import { OptionSpec } from './spec';

import { opt } from './state';

export const clearScreen: OptionSpec = {
    letter: 'c',
    names: ['clear-screen'],
    type: 'triple',
    messages: [
      'Repaint by scrolling from bottom of screen',
      'Repaint by painting from top of screen',
      'Repaint by painting from top of screen',
    ],
    defaultValue: 0,
    get: () => opt.clearRepaint,
    set: value => { opt.clearRepaint = value as number; },
  };
