import { beforeEach, describe, it } from 'vitest';

import { config, mode } from '../../src/pagerConfig';

import { text, content } from '../utils/mockContent';

import { implementLineForward } from '../utils/testUtils';

import { INVERSE_ON, INVERSE_OFF, END_MARKER } from '../utils/constants';

const COL_END_MARKER = INVERSE_ON + '>' + INVERSE_OFF;

beforeEach(() => {
  config.row = 0;
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

  it('does not forward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    // `(END)` should not be at bottom at first load with content rows less than window
    implementLineForward(lessContent, 0, false, [line1, END_MARKER], [0, 6]);

    implementLineForward(lessContent, 1, false, [line1, END_MARKER], [0, 6]);
    implementLineForward(lessContent, 9999, false, [line1, END_MARKER], [0, 6]);
  });

  it('forwards 2 lines', () => {
    implementLineForward(content, 1, false, [text[1]]);
    implementLineForward(content, 1, false, [text[2]]);

    implementLineForward(content, 2, false, [text[4]]);
  });

  it('forwards multiple lines into chopped line', () => {
    implementLineForward(content, 12, false, [text[12]]);

    implementLineForward(content, 1, false, ['14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些' + COL_END_MARKER]);
    implementLineForward(content, 1, false, [text[14]]);
  });

  const lastLine = text[27].slice(0, 79) + COL_END_MARKER;

  it('forwards 64 lines on key press but does not exceed EOF', () => {
    implementLineForward(content, 64, true, [lastLine, END_MARKER], [0, 23]);
  });

  it('forwards many lines but does not exceed EOF', () => {
    implementLineForward(content, 9999, false, [lastLine, END_MARKER], [0, 23]);
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  it('does not forward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    // `(END)` should not be at bottom at first load with content rows less than window
    implementLineForward(lessContent, 0, false, [line1, END_MARKER], [0, 6]);

    implementLineForward(lessContent, 1, false, [line1, END_MARKER], [0, 6]);
    implementLineForward(lessContent, 9999, false, [line1, END_MARKER], [0, 6]);
  });

  it('forwards to wrapped line and continue until exit wrapped line', () => {
    implementLineForward(content, 22, false, [text[20]]);

    const line22 = text[21];

    const expectOutputs = [
      line22.slice(0, 80),
      line22.slice(80, 160),
      line22.slice(160, 240),
      line22.slice(240),
      text[22]
    ];

    for (let i = 0; i < expectOutputs.length; i++) {
      implementLineForward(content, 1, false, [expectOutputs[i]]);
    }
  });

  const lastLine = text[30];

  it('forwards 64 lines on key press but does not exceed EOF', () => {
    implementLineForward(content, 64, true, [lastLine, END_MARKER], [0, 23]);
  });

  it('forwards many lines but does not exceed EOF', () => {
    implementLineForward(content, 9999, false, [lastLine, END_MARKER], [0, 23]);
  });
});
