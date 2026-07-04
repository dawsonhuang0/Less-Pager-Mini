import { beforeEach, describe, it } from 'vitest';

import { config, mode } from '../../src/config';

import { text, content } from '../utils/mockContent';

import { implementLineForward } from '../utils/testUtils';

import { calculateEOF } from '../../src/helpers';

import { INVERSE_ON, INVERSE_OFF, END_MARKER } from '../../src/constants';

import { CYAN, RESET, YELLOW, MAGENTA, UNDERLINE } from '../utils/constants';

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

    calculateEOF(lessContent);

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

    implementLineForward(content, 1, false, ['14 ' + CYAN + '这是一段非常非常长的中文文本' + RESET + '，用于模拟宽度测试，看看换行逻辑是否正确处理这些' + COL_END_MARKER]);
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

    calculateEOF(lessContent);

    // `(END)` should not be at bottom at first load with content rows less than window
    implementLineForward(lessContent, 0, false, [line1, END_MARKER], [0, 6]);

    implementLineForward(lessContent, 1, false, [line1, END_MARKER], [0, 6]);
    implementLineForward(lessContent, 9999, false, [line1, END_MARKER], [0, 6]);
  });

  it('forwards to wrapped line and continue until exit wrapped line', () => {
    calculateEOF(content);

    implementLineForward(content, 22, false, [text[20]]);

    const line22 = text[21];

    const expectOutputs = [
      line22.slice(0, 103),
      YELLOW + line22.slice(103, 210),
      MAGENTA + line22.slice(210, 306),
      UNDERLINE + line22.slice(306),
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
