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
    // og's set_header keeps NO start position when there are no
    // header LINES (search.c:572), and find_linenum answers 0 for a
    // position the caller does not know (linenum.c) - so a
    // columns-only header reports line-number 0, not 1
    get: () => 'Header (lines,columns,line-number) is ' +
      `${opt.headerLines},${opt.headerCols},` +
      `${opt.headerLines === 0 ? 0 : opt.headerStart + 1}`,
    set: (value, content) => setHeader(String(value), content),
  };
