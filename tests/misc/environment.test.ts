import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  actualEnv,
  envDelay,
  initEnvironment,
  lgetenv,
  setLesskeyEnv,
  terminalEnv,
} from '../../src/environment';

import {
  ALTERNATE_CONSOLE_ON,
  BOLD_ON,
  BRACKETED_PASTE_ON,
  CLEAR_LINE,
  CURSOR_TO,
  MOUSE_ON,
  VISUAL_BELL,
  initTerminalCapabilities,
} from '../../src/constants';

import { getAction, kentToNewline } from '../../src/keys';

import { terminalCapability, terminalFlag, terminalNumber }
  from '../../src/terminal';

import { cmdChar, cmdClose, cmdOpen, cmdText }
  from '../../src/features/cmdbuf';

import { filenameComplete, glob } from '../../src/features/files';

const NAMES = [
  'LESSNOCONFIG', 'TERM', 'EMPTY_REAL', 'ORDER',
  'LESS_DATA_DELAY', 'LESS_SCREENFILL_TIME',
  'LESSECHO', 'LESSSEPARATOR',
  'LESS_TERMINFO_smcup', 'LESS_TERMCAP_ti', 'LESS_TERMCAP_md',
  'LESS_TERMINFO_el', 'LESS_TERMCAP_ce',
  'LESS_TERMINFO_cup', 'LESS_TERMCAP_cm',
  'LESS_TERMINFO_flash', 'LESS_TERMCAP_vb',
  'LESS_TERMINFO_MOUSE_START', 'LESS_TERMCAP_MOUSE_START',
  'LESS_TERMINFO_BRACKETED_PASTE_START',
  'LESS_TERMCAP_BRACKETED_PASTE_START',
  'LESS_TERMINFO_kcuu1', 'LESS_TERMCAP_ku',
  'LESS_TERMINFO_kent', 'LESS_TERMCAP_@8',
  'LESS_TERMCAP_DEBUG', 'TERMCAP',
] as const;

const saved = Object.fromEntries(NAMES.map(name => [name, process.env[name]]));

beforeEach(() => {
  for (const name of NAMES) delete process.env[name];
  initEnvironment();
});

afterEach(() => {
  for (const name of NAMES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  initEnvironment();
  initTerminalCapabilities();
});

describe('OG lgetenv precedence and filtering', () => {
  it('uses user lesskey, nonempty real env, then system lesskey', () => {
    setLesskeyEnv('ORDER', 'system', true);
    expect(lgetenv('ORDER')).toBe('system');

    process.env.ORDER = 'real';
    expect(lgetenv('ORDER')).toBe('real');

    setLesskeyEnv('ORDER', 'user');
    expect(lgetenv('ORDER')).toBe('user');
  });

  it('treats an empty real value as absent but preserves empty tables', () => {
    process.env.EMPTY_REAL = '';
    setLesskeyEnv('EMPTY_REAL', 'system', true);
    expect(lgetenv('EMPTY_REAL')).toBe('system');

    setLesskeyEnv('EMPTY_REAL', '');
    expect(lgetenv('EMPTY_REAL')).toBe('');
  });

  it('filters everything under dash and admits only a comma allow-list', () => {
    process.env.ORDER = 'real';
    process.env.TERM = 'xterm-test';
    process.env.LESSNOCONFIG = '-';
    initEnvironment();

    expect(lgetenv('ORDER')).toBeUndefined();
    expect(terminalEnv()).toBe('xterm-test');

    process.env.LESSNOCONFIG = ' ORDER , TERM ';
    initEnvironment();
    expect(lgetenv('ORDER')).toBe('real');
    expect(lgetenv('EMPTY_REAL')).toBeUndefined();
  });

  it('keeps POSIX-style direct getenv available outside filtering', () => {
    process.env.ORDER = 'real';
    process.env.LESSNOCONFIG = '-';
    initEnvironment();
    expect(actualEnv('ORDER')).toBe('real');
  });

  it('provides OG defaults and positive-only timing overrides', () => {
    // og's unix build bakes LIBEXECDIR into dflt_vartable; only the
    // Windows build falls back to the bare PATH lookup
    expect(lgetenv('LESS_OSC8_OPEN_ANY')).toBe(
      process.platform === 'win32'
        ? '-less-osc8-open'
        : '-/usr/local/libexec/less-osc8-open'
    );
    expect(envDelay('LESS_DATA_DELAY', 4000)).toBe(4000);
    process.env.LESS_DATA_DELAY = '-2';
    expect(envDelay('LESS_DATA_DELAY', 4000)).toBe(4000);
    process.env.LESS_DATA_DELAY = '17ms';
    expect(envDelay('LESS_DATA_DELAY', 4000)).toBe(17);
  });
});

describe('dynamic terminal capability families', () => {
  it('prefers LESS_TERMINFO over LESS_TERMCAP over inline TERMCAP', () => {
    process.env.TERMCAP = 'xterm:ce=\\E[K:co#91:am:';
    expect(terminalCapability('el', 'ce')).toBe('\x1b[K');
    expect(terminalNumber('cols', 'co')).toBe(91);
    expect(terminalFlag('am', 'am')).toBe(true);

    process.env.LESS_TERMCAP_ce = 'termcap';
    expect(terminalCapability('el', 'ce')).toBe('termcap');
    process.env.LESS_TERMINFO_el = 'terminfo';
    expect(terminalCapability('el', 'ce')).toBe('terminfo');
  });

  it('preserves TERMCAP capability cancellation instead of falling back',
    () => {
      process.env.TERMCAP = 'xterm:ce@:';
      expect(terminalCapability('el', 'ce')).toBe('');

      initTerminalCapabilities();
      expect(CLEAR_LINE).toBe('');
    });

  it('loads the selected TERM entry from a TERMCAP file path', () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'lmn-termcap-')), 'termcap');
    fs.writeFileSync(file,
      '# ignored\nother|o:ce=wrong:\n' +
      'base|b:ce=\\E[9K:\nmyterm|mine:tc=base:\n');
    process.env.TERM = 'mine';
    process.env.TERMCAP = file;
    expect(terminalCapability('el', 'ce')).toBe('\x1b[9K');
  });

  it('returns debug markers for arbitrary capability names', () => {
    process.env.LESS_TERMCAP_DEBUG = '1';
    expect(terminalCapability('made_up', 'zz')).toBe('<zz>');
    expect(terminalCapability('made_up', null)).toBe('<made_up>');
  });

  it('applies screen, mode, mouse and paste overrides', () => {
    process.env.LESS_TERMINFO_smcup = '<alternate>';
    process.env.LESS_TERMCAP_md = '<bold>';
    process.env.LESS_TERMCAP_ce = '<clear>';
    process.env.LESS_TERMCAP_MOUSE_START = '<mouse>';
    process.env.LESS_TERMCAP_BRACKETED_PASTE_START = '<paste>';
    process.env.LESS_TERMINFO_cup = '<%i%p1%d,%p2%d>';
    process.env.LESS_TERMCAP_vb = '<flash>';
    initTerminalCapabilities();

    expect(ALTERNATE_CONSOLE_ON).toBe('<alternate>');
    expect(BOLD_ON).toBe('<bold>');
    expect(CLEAR_LINE).toBe('<clear>');
    expect(MOUSE_ON).toBe('<mouse>');
    expect(BRACKETED_PASTE_ON).toBe('<paste>');
    expect(CURSOR_TO(2, 3)).toBe('<3,4>');
    expect(VISUAL_BELL).toBe('<flash>');
  });

  it('uses overridden terminal key and keypad-enter strings', () => {
    process.env.LESS_TERMINFO_kcuu1 = '<up>';
    process.env.LESS_TERMINFO_kent = '<enter>';
    expect(getAction('<up>')).toBe('LINE_BACKWARD');
    expect(kentToNewline('<enter>')).toBe('\n');
  });
});

describe('filename helper environment', () => {
  it('appends LESSSEPARATOR to completed directories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmn-separator-'));
    const child = path.join(dir, 'child');
    fs.mkdirSync(child);
    process.env.LESSSEPARATOR = '::';

    cmdOpen('Examine: ', { complete: filenameComplete });
    for (const char of path.join(dir, 'chi')) cmdChar(char);
    cmdChar('\t');
    expect(cmdText()).toBe(child + '::');
    cmdClose();
  });

  it('invokes a configured LESSECHO for metachar expansion', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmn-lessecho-'));
    fs.writeFileSync(path.join(dir, 'match'), '');
    process.env.LESSECHO = "sh -c 'echo custom'";
    expect(glob(path.join(dir, '*'))).toEqual(['custom']);
  });
});
