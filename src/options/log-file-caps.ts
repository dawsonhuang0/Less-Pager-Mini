import { OptionSpec } from './spec';

import { logFileName, startLogFile } from '../features/misc';

export const logFileCaps: OptionSpec = {
    letter: 'O',
    names: ['LOG-FILE'],
    type: 'string',
    messages: [],
    defaultValue: '',
    enter: () => startLogFile(true),
    get: () => (logFileName() ? `Log file "${logFileName()}"` : 'No log file'),
    set: () => {},
  };
