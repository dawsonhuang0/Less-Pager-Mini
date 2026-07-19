import { OptionSpec } from './spec';

import { opt } from './state';

import { setHeader } from './shared';

export const header: OptionSpec = {
    letter: '',
    names: ['header'],
    type: 'string',
    messages: [],
    prompt: 'Header lines: ',
    validchars: 'd,',
    defaultValue: '-',
    get: () => 'Header (lines,columns,line-number) is ' +
      `${opt.headerLines},${opt.headerCols},${opt.headerStart + 1}`,
    set: (value, content) => setHeader(String(value), content),
  };
