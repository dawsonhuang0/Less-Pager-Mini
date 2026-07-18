import { OptionSpec } from './spec';

import { setTabs } from './shared';

import { hook } from './shared';

import { opt } from './state';

export const tabs: OptionSpec = {
    letter: 'x',
    names: ['tabs'],
    type: 'string',
    messages: [],
    prompt: 'Tab stops: ',
    validchars: 'd,',
    defaultValue: '',
    get: () => {
      const list = opt.tabStops.slice(1);
      return 'Tab stops ' +
        (list.length > 1 ? `${list.join(',')} and then ` : '') +
        `every ${opt.tabDefault} spaces`;
    },
    set: value => {
      setTabs(String(value));
      hook.rebuildContent();
    },
  };
