import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';
import { session } from '../../src/state/session';

import { hook } from '../../src/options/shared';

import { help } from '../../src/startup/lessHelp';
import { lesskeyHelp } from '../../src/startup/lesskeyHelp';

// importing the pager installs hook.showLesskeyHelp
import '../../src/pager/core';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const FILE = ['line 1', 'line 2', 'line 3'];

/*
 * Two help pages, one level.
 *
 * less has a single help file, so its h is a plain "already there,
 * do nothing" when the help is up. We have two pages and no key for
 * the second, so --lesskey-help has to work from inside the first -
 * and the trap is the bookkeeping: entering help PARKS the file in
 * session.prev*, and a switch that parks again would bury the file
 * under the page it is replacing, leaving `q` to unwind into a help
 * screen the user cannot get out of.
 */
describe('switching between the help pages', () => {
  beforeEach(() => {
    // the state entering help leaves behind: the file parked, one
    // page on screen
    session.prevConfig = { ...config };
    session.prevMode = { ...mode, DUMB: false };
    session.prevContent = FILE;
    session.content = help;
    session.helpSource = help;
    mode.HELP = true;
  });

  it('replaces the page on screen, without re-parking the file', () => {
    hook.showLesskeyHelp();

    expect(session.helpSource).toBe(lesskeyHelp);
    expect(mode.HELP).toBe(true);

    // the file is still what waits underneath - NOT the command help
    // this just replaced
    expect(session.prevContent).toBe(FILE);
  });

  it('leaves the page alone when it is already the one showing', () => {
    hook.showLesskeyHelp();
    const shown = session.content;

    // less's h inside help does nothing at all, position included
    hook.showLesskeyHelp();

    expect(session.helpSource).toBe(lesskeyHelp);
    expect(session.content).toBe(shown);
    expect(session.prevContent).toBe(FILE);
  });

  it('opens from the file with the file parked, as it always did', () => {
    mode.HELP = false;
    session.content = FILE;
    session.helpSource = [];

    hook.showLesskeyHelp();

    expect(session.helpSource).toBe(lesskeyHelp);
    expect(mode.HELP).toBe(true);
    expect(session.prevContent).toBe(FILE);
  });
});
