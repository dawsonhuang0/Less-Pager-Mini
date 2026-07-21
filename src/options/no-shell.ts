import { OptionSpec } from './spec';

import { opt } from './state';

/**
 * Disables interactive commands which can launch another process.
 * It is deliberately startup-only: an embedding application must not
 * hand control of this policy back to a user already inside the pager.
 */
export const noShell: OptionSpec = {
  letter: '',
  names: ['no-shell'],
  type: 'bool',
  noToggle: true,
  messages: [
    'Shell commands are enabled',
    'Shell commands are disabled',
  ],
  defaultValue: 0,
  get: () => opt.noShell,
  set: value => { opt.noShell = value as number; },
};
