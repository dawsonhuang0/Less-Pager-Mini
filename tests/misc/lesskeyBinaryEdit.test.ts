import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { initFiles, files } from '../../src/features/files';
import { resetLesskey, loadLesskey, userBinding } from '../../src/lesskey';
import { openLesskeyView, refreshLesskeyView, exitLesskeyView }
  from '../../src/lesskey/view';
import { switchToFile, runEditor } from '../../src/commands';

import { initEnvironment } from '../../src/startup/environment';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

// runShell suspends the terminal, which wants a real keyboard
vi.mock('../../src/tty/keyboard', async original => {
  const actual = await original<Record<string, unknown>>();

  return {
    ...actual,
    keyboard: () => ({
      setRawMode: () => {}, pause: () => {}, resume: () => {},
      on: () => {}, off: () => {}, once: () => {},
    }),
  };
});

/*
 * Editing a COMPILED lesskey through the view.
 *
 * Its own file because the ladder decides whether a binary is even
 * reachable: a source file in the same tier wins and the binary is
 * never loaded, so a session with ~/.lesskey present will not show
 * ~/.less at all. This one leaves no source anywhere.
 */
describe('editing a compiled lesskey through the view', () => {
  it('renders it, takes the edit, and writes the bytes back', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-bin-'));
    const binary = path.join(dir, 'keys.bin');
    const target = path.join(dir, 'target.txt');

    fs.writeFileSync(target, 'line 1\nline 2\n');
    fs.writeFileSync(binary, Buffer.from([
      0x00, 0x4D, 0x2B, 0x47,
      0x63, 3, 0, 0x78, 0x00, 24,
      0x65, 0, 0, 0x76, 0, 0,
      0x78, 0x45, 0x6E, 0x64,
    ]));

    process.env.LESSKEYIN = path.join(dir, 'none');
    process.env.LESSKEY = binary;
    resetLesskey();
    loadLesskey(true);
    initFiles([target]);
    switchToFile(0);

    expect(userBinding('x')?.action).toBe('EXIT');
    expect(openLesskeyView()).toBe(true);

    // what `v` leaves behind, on the temp the view opened
    const shown = files.list[files.index].path;
    fs.writeFileSync(shown, '#command\nZ help\n');

    expect(refreshLesskeyView(707)).toEqual([]);
    expect(userBinding('Z')?.action).toBe('HELP');

    exitLesskeyView(707);

    // and the binary on disk carries it
    resetLesskey();
    loadLesskey(true);
    expect(userBinding('Z')?.action).toBe('HELP');
    expect(userBinding('x')).toBeUndefined();
  });

  it('writes the binary through v itself, editor and all', async () => {
    // a "v" that really spawns something: the editor is a copy, and
    // the file it copies in is what the user would have typed
    fs.writeFileSync('/tmp/lpm-view-edit', '#command\nZ help\n');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-ed-'));
    const bin = path.join(dir, 'b.bin');
    const target = path.join(dir, 't.txt');
    fs.writeFileSync(target, 'line 1\nline 2\n');
    fs.writeFileSync(bin, Buffer.from([0,0x4D,0x2B,0x47, 0x63,3,0,0x78,0,24,
      0x65,0,0, 0x76,0,0, 0x78,0x45,0x6E,0x64]));

    process.env.LESSKEY = bin;
    process.env.LESSKEYIN = path.join(dir, 'none');
    // the "editor": rewrites whatever file it is handed
    // a literal '.' in a prompt string is an ENDIF and vanishes
    // (prompt.c:588), in less too - so the fixture has no extension
    process.env.LESSEDIT = 'cp /tmp/lpm-view-edit %g';
    initEnvironment();
    resetLesskey(); loadLesskey(true);
    initFiles([target]); switchToFile(0);

    expect(openLesskeyView()).toBe(true);
    const shown = files.list[files.index].path;
    console.log('viewing:', shown);

    const { editCommand } = await import('../../src/features/prompt');
    console.log('cmd:', editCommand(['a']));

    runEditor();

    console.log('temp now:', JSON.stringify(fs.readFileSync(shown, 'utf8')));
    console.log('bin size:', fs.statSync(bin).size);
    expect(userBinding('Z')?.action).toBe('HELP');

    // and on DISK, not just in the tables this session happens to
    // hold: read the binary again from nothing
    resetLesskey();
    loadLesskey(true);
    expect(userBinding('Z')?.action).toBe('HELP');
    expect(userBinding('x')).toBeUndefined();
  });
});
