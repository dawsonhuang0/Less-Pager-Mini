import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  size: null as [number, number] | null,
  keyboard: {
    setRawMode: vi.fn(),
    pause: vi.fn(),
  },
}));

vi.mock('../src/keyboard', async importOriginal => ({
  ...await importOriginal<typeof import('../src/keyboard')>(),
  keyboard: () => fake.keyboard,
  freshWindowSize: () => fake.size,
}));

import { config, mode, DEFAULT_COLUMN, DEFAULT_WINDOW }
  from '../src/config';

import {
  ALTERNATE_CONSOLE_ON,
  ALTERNATE_CONSOLE_OFF,
  ALTERNATE_SCROLL_ON,
  ALTERNATE_SCROLL_OFF,
  KEYPAD_ON,
  KEYPAD_OFF,
  MOUSE_ON,
  MOUSE_OFF,
  MOUSE_SGR_ON,
  MOUSE_SGR_OFF,
  BRACKETED_PASTE_ON,
  BRACKETED_PASTE_OFF
} from '../src/constants';

import { opt, hook } from '../src/options';

import { initEnvironment } from '../src/environment';

import {
  suspendTerminal,
  enterScreen,
  calculateDimensions
} from '../src/screen';

const stdoutWrite = vi.spyOn(process.stdout, 'write')
  .mockImplementation(() => true);

const originalLines = process.env.LESS_LINES;
const originalColumns = process.env.LESS_COLUMNS;
const originalGenericLines = process.env.LINES;
const originalGenericColumns = process.env.COLUMNS;

beforeEach(() => {
  fake.size = null;
  fake.keyboard.setRawMode.mockClear();
  fake.keyboard.pause.mockClear();
  stdoutWrite.mockClear();

  mode.DUMB = false;
  opt.mouseMode = 0;
  opt.emouse = 0;
  opt.noPaste = 0;
  opt.noKeypad = 0;
  opt.noInit = 0;
  opt.statusCol = 0;
  opt.linenums = 1;
  opt.appliedGutter = 0;
  hook.screenActive = false;

  delete process.env.LESS_LINES;
  delete process.env.LESS_COLUMNS;
  delete process.env.LINES;
  delete process.env.COLUMNS;
  initEnvironment();
});

afterEach(() => {
  if (originalLines === undefined) delete process.env.LESS_LINES;
  else process.env.LESS_LINES = originalLines;

  if (originalColumns === undefined) delete process.env.LESS_COLUMNS;
  else process.env.LESS_COLUMNS = originalColumns;

  if (originalGenericLines === undefined) delete process.env.LINES;
  else process.env.LINES = originalGenericLines;

  if (originalGenericColumns === undefined) delete process.env.COLUMNS;
  else process.env.COLUMNS = originalGenericColumns;
});

const writes = (): unknown[] => stdoutWrite.mock.calls.map(call => call[0]);

describe('terminal mode transitions', () => {
  it('leaves mouse, paste, keypad, and alternate modes in og order', () => {
    opt.mouseMode = 1;
    opt.noPaste = 1;
    hook.screenActive = true;

    suspendTerminal();

    expect(writes()).toEqual([
      MOUSE_OFF + MOUSE_SGR_OFF,
      BRACKETED_PASTE_OFF,
      KEYPAD_OFF,
      ALTERNATE_SCROLL_OFF,
      ALTERNATE_CONSOLE_OFF,
    ]);
    expect(fake.keyboard.setRawMode).toHaveBeenCalledWith(false);
    expect(fake.keyboard.pause).toHaveBeenCalledOnce();
    expect(hook.screenActive).toBe(false);
  });

  it('keeps hardcoded mouse/paste teardown on a dumb terminal', () => {
    mode.DUMB = true;
    opt.emouse = 1;
    opt.noPaste = 1;

    suspendTerminal();

    expect(writes()).toEqual([
      MOUSE_OFF + MOUSE_SGR_OFF,
      BRACKETED_PASTE_OFF,
    ]);
  });

  it('honors --no-init and --no-keypad independently', () => {
    opt.noInit = 1;
    opt.noKeypad = 1;

    suspendTerminal();

    expect(writes()).toEqual([]);
    expect(fake.keyboard.setRawMode).toHaveBeenCalledWith(false);
  });

  it('enters every enabled screen mode and marks the screen active', () => {
    opt.emouse = 1;
    opt.noPaste = 1;

    enterScreen();

    expect(writes()).toEqual([
      ALTERNATE_CONSOLE_ON,
      ALTERNATE_SCROLL_ON,
      KEYPAD_ON,
      MOUSE_SGR_ON + MOUSE_ON,
      BRACKETED_PASTE_ON,
    ]);
    expect(hook.screenActive).toBe(true);
  });

  it('writes no terminal capabilities in dumb mode with features off', () => {
    mode.DUMB = true;

    enterScreen();

    expect(writes()).toEqual([]);
    expect(hook.screenActive).toBe(true);
  });
});

describe('terminal dimensions', () => {
  it('prefers the fresh kernel size and derives halves', () => {
    fake.size = [101, 41];

    calculateDimensions();

    expect(config.window).toBe(41);
    expect(config.screenWidth).toBe(101);
    expect(config.halfWindow).toBe(20);
    expect(config.halfScreenWidth).toBe(50);
  });

  it('applies positive and negative LESS dimension overrides', () => {
    fake.size = [100, 40];
    process.env.LESS_LINES = '-3';
    process.env.LESS_COLUMNS = '72';

    calculateDimensions();

    expect(config.window).toBe(37);
    expect(config.screenWidth).toBe(72);
  });

  it('uses LINES/COLUMNS only when the kernel reports no size', () => {
    process.env.LINES = '31';
    process.env.COLUMNS = '93';

    calculateDimensions();
    expect(config.window).toBe(31);
    expect(config.screenWidth).toBe(93);

    fake.size = [100, 40];
    calculateDimensions();
    expect(config.window).toBe(40);
    expect(config.screenWidth).toBe(100);
  });

  it('falls back after zero or over-negative overrides', () => {
    fake.size = [20, 10];
    process.env.LESS_LINES = '-10';
    process.env.LESS_COLUMNS = '0';

    calculateDimensions();

    expect(config.window).toBe(DEFAULT_WINDOW);
    expect(config.screenWidth).toBe(DEFAULT_COLUMN);
  });

  it('reserves status and line-number gutters inside detected width', () => {
    fake.size = [80, 24];
    opt.statusCol = 1;
    opt.statusColWidth = 3;
    opt.linenums = 2;
    opt.linenumWidth = 5;

    calculateDimensions();

    expect(config.screenWidth).toBe(71);
    expect(config.halfScreenWidth).toBe(35);
    expect(opt.appliedGutter).toBe(9);
  });
});
