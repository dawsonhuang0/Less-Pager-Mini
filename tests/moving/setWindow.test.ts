import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/config';

import { content } from '../utils/mockContent';

import {
  lineForward,
  windowForward,
  windowBackward,
  setWindowForward,
  setWindowBackward
} from '../../src/features/moving';

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.setWindow = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.chopLongLines = true;

  mode.INIT = true;
  mode.EOF = false;
});

describe('setWindowForward', () => {
  it('sets window to buffer value and moves forward by it', () => {
    setWindowForward(content, ['5']);

    expect(config.row).toBe(5);
    expect(config.setWindow).toBe(5);
  });

  it('reuses the set window size for subsequent window moves', () => {
    setWindowForward(content, ['5']);
    windowForward(content, []);

    expect(config.row).toBe(10);

    windowBackward(content, []);

    expect(config.row).toBe(5);
  });

  it('falls back to full window when no size was ever set', () => {
    setWindowForward(content, []);

    expect(config.row).toBe(config.window - 1);
    expect(config.setWindow).toBe(0);
  });
});

describe('setWindowBackward', () => {
  it('sets window to buffer value and moves backward by it', () => {
    lineForward(content, 20);
    setWindowBackward(content, ['8']);

    expect(config.row).toBe(12);
    expect(config.setWindow).toBe(8);
  });

  it('does not move above BOF', () => {
    lineForward(content, 3);
    setWindowBackward(content, ['9']);

    expect(config.row).toBe(0);
  });
});
