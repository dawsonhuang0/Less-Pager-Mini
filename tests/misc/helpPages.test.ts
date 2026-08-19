import { beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { config, mode } from '../../src/state/config';
import { session } from '../../src/state/session';

import { hook } from '../../src/options/shared';

import { files, initFiles } from '../../src/features/files';
import { exitLesskeyView } from '../../src/lesskey/view';
import { loadLesskey, resetLesskey } from '../../src/lesskey';
import { switchToFile } from '../../src/commands';

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


/*
 * The lesskey view opened from a help screen.
 *
 * Both are stashes over the same file, so the view has to open OVER
 * the file rather than over the page: left in help, the view painted
 * the lesskey bindings under "HELP -- Press RETURN for more, or q
 * when done", and every command that rings in help rang here too.
 */
describe('the lesskey view opened from a help screen', () => {
  it('is a file view, not a help screen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-helpview-'));
    const keys = path.join(dir, 'keys.lesskey');
    const target = path.join(dir, 'target.txt');

    fs.writeFileSync(keys, 'x quit\n');
    fs.writeFileSync(target, 'line 1\nline 2\n');

    process.env.LESSKEYIN = keys;
    process.env.LESSKEY = path.join(dir, 'none');
    resetLesskey();
    loadLesskey(true);
    initFiles([target]);
    switchToFile(0);

    // in help, with the file parked underneath
    session.prevConfig = { ...config };
    session.prevMode = { ...mode, DUMB: false };
    session.prevContent = FILE;
    session.content = help;
    session.helpSource = help;
    mode.HELP = true;

    hook.viewLesskey();

    // the view really opened: the lesskey file is what is being paged
    expect(files.list.map(entry => entry.path)).toContain(keys);

    // ...and the reported symptom is gone. Left on, mode.HELP put
    // "HELP -- Press RETURN for more, or q when done" under a screen
    // of key bindings
    expect(mode.HELP).toBe(false);

    // the file is still parked for the page to come back to
    expect(session.prevContent).toBe(FILE);

    // and the view unwinds, so the EXIT action can put the page back
    expect(exitLesskeyView(707)).toBe(true);
  });
});
