import { OptionSpec } from './spec';

import { logFileName, startLogFile } from '../features/misc';

export const logFile: OptionSpec = {
    letter: 'o',
    names: ['log-file'],
    type: 'string',
    messages: [],
    defaultValue: '',
    enter: () => startLogFile(false),
    get: () => (logFileName() ? `Log file "${logFileName()}"` : 'No log file'),
    set: () => {},
  };
