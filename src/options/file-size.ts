import { OptionSpec } from './spec';

import { opt } from './state';

import { hook } from './shared';

export const fileSize: OptionSpec = {
    letter: '',
    names: ['file-size'],
    type: 'bool',
    messages: [
      "Don't get size of each file",
      'Get size of each file',
    ],
    defaultValue: 0,
    get: () => opt.wantFileSize,
    set: value => {
      opt.wantFileSize = value as number;

      // less's opt_filesize runs scan_eof when the current input's
      // length is unknown; each session's hook carries its own
      // ch_length knowledge
      if (opt.wantFileSize) hook.scanFileSize();
    },
  };
