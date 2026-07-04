import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../src/config';

import { formatContent } from '../src/helpers';

import { INVERSE_ON, INVERSE_OFF } from '../src/constants';

// ZWJ sequence: 4 emoji joined by zero-width joiners, display width 2
const FAMILY = '👨‍👩‍👧‍👦';

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.screenWidth = 4;
  config.window = 24;

  mode.INIT = true;
  mode.EOF = false;
  mode.BUFFERING = false;
  mode.HELP = false;
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  it('keeps ZWJ sequences intact across wrap boundaries', () => {
    const output = formatContent([FAMILY.repeat(3)]);

    expect(output[0]).toBe(FAMILY.repeat(2));
    expect(output[1]).toBe(FAMILY);
  });
});

describe('chopLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = true;
  });

  it('keeps ZWJ sequences intact when chopping', () => {
    const output = formatContent([FAMILY.repeat(3)]);

    expect(output[0]).toBe(FAMILY + INVERSE_ON + ' >' + INVERSE_OFF);
  });
});
