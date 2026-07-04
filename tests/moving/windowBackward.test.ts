import { beforeEach, describe, it } from 'vitest';

import { config, mode } from '../../src/config';

import { text, content } from '../utils/mockContent';

import {
  implementWindowForward,
  implementWindowBackward
} from '../utils/testUtils';

import { calculateEOF } from '../../src/helpers';

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.setWindow = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.halfScreenWidth = 40;
  config.halfWindow = 12;

  mode.INIT = true;
  mode.EOF = false;
});

const line1 = text[0];

describe('chopLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = true;
  });

  it('does not backward at BOF', () => {
    implementWindowBackward(content, '', false, [line1]);
    implementWindowBackward(content, '9999', false, [line1]);
  });

  it('backwards by buffer', () => {
    implementWindowForward(content, '10', false, [text[10]]);

    implementWindowBackward(content, '4', false, [text[6]]);
    implementWindowBackward(content, '6', false, [line1]);
  });

  it('backwards one window back to BOF', () => {
    implementWindowForward(content, '23', false, [text[23]]);
    implementWindowBackward(content, '', false, [line1]);
  });

  it('backwards consecutively but does not exceed BOF', () => {
    implementWindowForward(content, '10', false, [text[10]]);
    implementWindowBackward(content, '64', true, [line1]);
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  it('does not backward at BOF', () => {
    calculateEOF(content);

    implementWindowBackward(content, '', false, [line1]);
    implementWindowBackward(content, '9999', false, [line1]);
  });

  it('backwards by buffer through unwrapped lines', () => {
    calculateEOF(content);

    implementWindowForward(content, '7', false, [text[7]]);
    implementWindowBackward(content, '7', false, [line1]);
  });

  it('backwards one window back to BOF', () => {
    calculateEOF(content);

    implementWindowForward(content, '', false, [], []);
    implementWindowBackward(content, '', false, [line1]);
  });
});
