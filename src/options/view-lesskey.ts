import { OptionSpec } from './spec';

import { hook } from './shared';

/**
 * Opens this session's lesskey files in a pager of their own.
 *
 * NOT an og option. og leaves you to find your own lesskey files,
 * which works when a distribution put them somewhere known; an npm
 * install did not, and six sources can be live at once (system and
 * user, source and compiled, and two content variables). This answers
 * "which lesskey am I actually running" by showing them.
 *
 * It views rather than edits: the pager already moves between files
 * with :n and :p, and `v` opens the one on screen in $VISUAL or
 * $EDITOR. Typed at the runtime `-` prompt the nested pager makes `q`
 * mean "done looking", leaving the session underneath untouched.
 */
export const viewLesskey: OptionSpec = {
    letter: '',
    names: ['view-lesskey'],
    type: 'novar',
    messages: [],
    defaultValue: 0,
    get: () => 0,
    set: () => { hook.viewLesskey(); },
  };
