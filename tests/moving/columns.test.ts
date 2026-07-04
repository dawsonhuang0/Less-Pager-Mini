import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/config';

import {
  lastCol,
  firstCol,
  setHalfScreenRight,
  setHalfScreenLeft
} from '../../src/features/moving';

beforeEach(() => {
  config.row = 0;
  config.col = 0;
  config.setCol = 0;
  config.screenWidth = 80;
  config.halfScreenWidth = 40;
  config.window = 24;

  mode.INIT = true;
});

describe('lastCol', () => {
  it('scrolls right so the longest displayed line ends at the right edge', () => {
    const content = ['short', 'x'.repeat(120), 'y'.repeat(100)];

    lastCol(content);

    expect(config.col).toBe(40);
    expect(mode.INIT).toBe(false);
  });

  it('accounts for wide characters', () => {
    const content = ['好'.repeat(50)];

    lastCol(content);

    expect(config.col).toBe(20);
  });

  it('stays at first column when content fits the screen', () => {
    const content = ['short', 'also short'];

    lastCol(content);

    expect(config.col).toBe(0);
  });

  it('ignores lines below the displayed window', () => {
    config.window = 2;

    const content = ['short', 'x'.repeat(120)];

    lastCol(content);

    expect(config.col).toBe(0);
  });

  it('ignores lines above the current row', () => {
    config.row = 1;

    const content = ['x'.repeat(120), 'y'.repeat(100)];

    lastCol(content);

    expect(config.col).toBe(20);
  });
});

describe('firstCol', () => {
  it('scrolls back to the first column', () => {
    config.col = 55;

    firstCol();

    expect(config.col).toBe(0);
  });
});

describe('setHalfScreenRight', () => {
  it('moves right by half screen width by default', () => {
    setHalfScreenRight([]);

    expect(config.col).toBe(40);
    expect(mode.INIT).toBe(false);

    setHalfScreenRight([]);

    expect(config.col).toBe(80);
  });

  it('sets scroll step to buffer value and remembers it', () => {
    setHalfScreenRight(['1', '0']);

    expect(config.col).toBe(10);
    expect(config.setCol).toBe(10);

    setHalfScreenRight([]);

    expect(config.col).toBe(20);
  });
});

describe('setHalfScreenLeft', () => {
  it('moves left by half screen width by default', () => {
    config.col = 100;

    setHalfScreenLeft([]);

    expect(config.col).toBe(60);
    expect(mode.INIT).toBe(false);
  });

  it('sets scroll step to buffer value and remembers it', () => {
    config.col = 20;

    setHalfScreenLeft(['3']);

    expect(config.col).toBe(17);
    expect(config.setCol).toBe(3);

    setHalfScreenLeft([]);

    expect(config.col).toBe(14);
  });

  it('clamps at the first column', () => {
    config.col = 5;

    setHalfScreenLeft([]);

    expect(config.col).toBe(0);
  });
});
