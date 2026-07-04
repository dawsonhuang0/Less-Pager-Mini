import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/config';

import { content } from '../utils/mockContent';

import {
  lineForward,
  setHalfWindowForward,
  setHalfWindowBackward
} from '../../src/features/moving';

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.setHalfWindow = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.halfWindow = 12;
  config.chopLongLines = true;

  mode.INIT = true;
  mode.EOF = false;
});

describe('setHalfWindowForward', () => {
  it('moves forward by half window by default', () => {
    setHalfWindowForward(content, []);

    expect(config.row).toBe(12);
    expect(config.setHalfWindow).toBe(0);
  });

  it('sets half window to buffer value and remembers it', () => {
    setHalfWindowForward(content, ['5']);

    expect(config.row).toBe(5);
    expect(config.setHalfWindow).toBe(5);

    setHalfWindowForward(content, []);

    expect(config.row).toBe(10);
  });
});

describe('setHalfWindowBackward', () => {
  it('moves backward by half window by default', () => {
    lineForward(content, 20);
    setHalfWindowBackward(content, []);

    expect(config.row).toBe(8);
  });

  it('sets half window to buffer value and remembers it', () => {
    lineForward(content, 20);

    setHalfWindowBackward(content, ['6']);

    expect(config.row).toBe(14);
    expect(config.setHalfWindow).toBe(6);

    setHalfWindowBackward(content, []);

    expect(config.row).toBe(8);
  });

  it('does not move above BOF', () => {
    lineForward(content, 3);
    setHalfWindowBackward(content, ['9']);

    expect(config.row).toBe(0);
  });
});
