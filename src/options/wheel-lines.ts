import { OptionSpec } from './spec';

import { opt } from './state';

export const wheelLines: OptionSpec = {
    letter: '',
    names: ['wheel-lines'],
    type: 'number',
    messages: [],
    prompt: 'Lines to scroll on mouse wheel: ',
    report: 'Scroll %d line(s) on mouse wheel',
    defaultValue: 1,
    get: () => opt.wheelLines,
    set: value => { opt.wheelLines = value as number; },
    // less's opt_wheel_lines resets a non-positive value to the default
    // single line at INIT and TOGGLE (but not for a pendopt value)
    handler: () => { if (opt.wheelLines <= 0) opt.wheelLines = 1; },
  };
