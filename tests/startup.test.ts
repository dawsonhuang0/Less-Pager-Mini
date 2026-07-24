import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../src/state/config';

import { search } from '../src/features/searching';

import { getFirstCmd } from '../src/features/misc';

import { opt, setCliOptions } from '../src/options';

import {
  startupErrors,
  startupInit,
  printStartupError,
  warnReturn
} from '../src/startup/startup';

const stdoutWrite = vi.spyOn(process.stdout, 'write')
  .mockImplementation(() => true);

const ENV_NAMES = [
  'LESS',
  'MORE',
  'LESS_IS_MORE',
  'LESS_UNSUPPORT',
  'LESSNOCONFIG',
  'LESSKEY_CONTENT',
  'LESSSECURE',
  'LESSSECURE_ALLOW',
  'LESSSECURE_DISALLOW',
  'TERM',
] as const;

const originalEnv = Object.fromEntries(
  ENV_NAMES.map(name => [name, process.env[name]])
);

beforeEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.LESSNOCONFIG = ENV_NAMES
    .filter(name => name !== 'LESSNOCONFIG')
    .join(',');
  process.env.TERM = 'xterm-256color';

  stdoutWrite.mockClear();
  search.message = '';
  search.messageQueue.length = 0;
  startupErrors.count = 0;
  config.chopLongLines = false;
  config.setWindow = -1;
  opt.squeeze = 0;
  opt.knowDumb = 0;
  opt.lessIsMore = 0;
  setCliOptions([]);
});

afterEach(() => {
  setCliOptions([]);

  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('startup option orchestration', () => {
  it('applies $LESS before each CLI argument and merges startup flags', () => {
    process.env.LESS = '-S +G$';
    setCliOptions(['-s', '--help', '+g']);

    const startup = startupInit([]);

    expect(config.chopLongLines).toBe(true);
    expect(opt.squeeze).toBe(1);
    expect(startup.dohelp).toBe(true);
    expect(startup.version).toBe(false);
    expect(startup.firstCmds).toEqual(['G', 'g']);
  });

  it('selects $MORE and gives -p every-file-command semantics', () => {
    process.env.LESS = '-S';
    process.env.MORE = '-n7 -pG$';
    process.env.LESS_IS_MORE = 'yes';

    const startup = startupInit([]);

    expect(opt.lessIsMore).toBe(1);
    expect(config.chopLongLines).toBe(false);
    expect(config.setWindow).toBe(7);
    expect(startup.firstCmds).toEqual([]);
    expect(getFirstCmd()).toBe('G');
  });

  it('treats empty and zero LESS_IS_MORE as ordinary less mode', () => {
    process.env.LESS_IS_MORE = '0';
    process.env.LESS = '-S';

    startupInit([]);

    expect(opt.lessIsMore).toBe(0);
    expect(config.chopLongLines).toBe(true);
  });

  it('applies LESS_UNSUPPORT before scanning the environment', () => {
    process.env.LESS_UNSUPPORT = '--chop-long-lines';
    process.env.LESS = '-S';

    startupInit([]);

    expect(config.chopLongLines).toBe(false);
    expect(search.message).toBe('');
  });

  it('prints and counts scan errors, then drains their queue', () => {
    process.env.LESS = '-Y';
    setCliOptions(['-P']);

    startupInit([]);

    expect(stdoutWrite.mock.calls.map(call => call[0])).toEqual([
      'There is no -Y option ("less --help" for help)\n',
      'Value is required after -P (--prompt)\n',
    ]);
    expect(startupErrors.count).toBe(2);
    expect(search.message).toBe('');
    expect(search.messageQueue).toEqual([]);
  });

  it('prints the dumb-terminal warning only for an interactive tty', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    process.env.TERM = 'dumb';

    try {
      startupInit([]);
      expect(stdoutWrite).toHaveBeenCalledWith(
        'WARNING: terminal is not fully functional\n'
      );

      stdoutWrite.mockClear();
      opt.knowDumb = 0;
      process.env.LESS = '-d';
      startupInit([]);
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      if (descriptor) {
        Object.defineProperty(process.stdin, 'isTTY', descriptor);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
    }
  });
});

describe('pre-screen error gate helpers', () => {
  it('prints one startup error per call', () => {
    printStartupError('first');
    printStartupError('second');

    expect(stdoutWrite.mock.calls.map(call => call[0]))
      .toEqual(['first\n', 'second\n']);
    expect(startupErrors.count).toBe(2);
  });

  it('takes one key and pushes the remaining bytes back', async () => {
    const input = process.stdin;
    const raw = vi.fn();
    const resume = vi.spyOn(input, 'resume').mockImplementation(() => input);
    const pause = vi.spyOn(input, 'pause').mockImplementation(() => input);
    const unshift = vi.spyOn(input, 'unshift').mockImplementation(() => true);
    const descriptor = Object.getOwnPropertyDescriptor(input, 'setRawMode');
    Object.defineProperty(input, 'setRawMode', {
      value: raw,
      configurable: true,
    });

    try {
      const answer = warnReturn();
      input.emit('data', Buffer.from('xy'));

      await expect(answer).resolves.toBe('x');
      expect(raw).toHaveBeenCalledWith(true);
      expect(resume).toHaveBeenCalled();
      expect(pause).toHaveBeenCalledOnce();
      expect(unshift).toHaveBeenCalledWith(Buffer.from('y'));
    } finally {
      if (descriptor) Object.defineProperty(input, 'setRawMode', descriptor);
      else delete (input as { setRawMode?: unknown }).setRawMode;
    }
  });

  it('lets SIGWINCH dismiss the wait without consuming a key', async () => {
    if (process.platform === 'win32') return;

    const input = process.stdin;
    const descriptor = Object.getOwnPropertyDescriptor(input, 'setRawMode');
    Object.defineProperty(input, 'setRawMode', {
      value: vi.fn(),
      configurable: true,
    });
    vi.spyOn(input, 'resume').mockImplementation(() => input);

    try {
      const answer = warnReturn();
      process.emit('SIGWINCH');
      await expect(answer).resolves.toBe('');
    } finally {
      if (descriptor) Object.defineProperty(input, 'setRawMode', descriptor);
      else delete (input as { setRawMode?: unknown }).setRawMode;
    }
  });
});
