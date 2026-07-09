import { beforeEach, describe, it } from 'vitest';

import { config, mode } from '../../src/config';

import { text, content } from '../utils/mockContent';

import { implementLineForward, implementLineBackward } from '../utils/testUtils';

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

  it('does not backward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    calculateEOF(lessContent);

    // `(END)` should not be at bottom at first load with content rows less than window
    implementLineBackward(lessContent, 0, false, [line1, END_MARKER], [0, 6]);

    implementLineBackward(lessContent, 1, false, [line1, END_MARKER], [0, 23]);
    implementLineBackward(lessContent, 9999, false, [line1, END_MARKER], [0, 23]);
  });

  it('backwards 2 lines', () => {
    implementLineForward(content, 6, false, [text[6]]);

    implementLineBackward(content, 1, false, [text[5]]);
    implementLineBackward(content, 1, false, [text[4]]);

    implementLineBackward(content, 2, false, [text[2]]);
  });

  it('forwards multiple lines then backwards 1 line into chopped line', () => {
    implementLineForward(content, 14, false, [text[14]]);

    implementLineBackward(content, 1, false, ['14 ' + CYAN + '这是一段非常非常长的中文文本' + RESET + '，用于模拟宽度测试，看看换行逻辑是否正确处理这些' + COL_END_MARKER]);
    implementLineBackward(content, 1, false, [text[12]]);
  });

  const lastLine = text[27].slice(0, 79)+ COL_END_MARKER;

  it('backwards 64 lines on key press but does not exceed BOF', () => {
    implementLineForward(content, 9999, false, [lastLine, END_MARKER], [0, 23]);

    implementLineBackward(content, 64, true, [line1]);
  });

  it('backwards many lines but does not exceed BOF', () => {
    implementLineForward(content, 9999, false, [lastLine, END_MARKER], [0, 23]);

    implementLineBackward(content, 99999, false, [line1]);
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  it('does not backward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    calculateEOF(lessContent);

    // `(END)` should not be at bottom at first load with content rows less than window
    implementLineBackward(lessContent, 0, false, [line1, END_MARKER], [0, 6]);

    implementLineBackward(lessContent, 1, false, [line1, END_MARKER], [0, 23]);
    implementLineBackward(lessContent, 9999, false, [line1, END_MARKER], [0, 23]);
  });

  it('forwards to the end of wrapped line and backwards until exit wrapped line', () => {
    calculateEOF(content);

    implementLineForward(content, 27, false, [text[22]]);

    const line22 = text[21];

    const expectOutputs = [
      UNDERLINE + line22.slice(306),
      MAGENTA + line22.slice(210, 306),
      YELLOW + line22.slice(103, 210),
      line22.slice(0, 103),
      text[20]
    ];

    for (let i = 0; i < expectOutputs.length; i++) {
      implementLineBackward(content, 1, false, [expectOutputs[i]]);
    }
  });

  const lastLine = text[30];

  it('backwards 64 lines on key press but does not exceed BOF', () => {
    implementLineForward(content, 9999, false, [lastLine, END_MARKER], [0, 23]);

    implementLineBackward(content, 64, true, [line1]);
  });

  it('backwards many lines but does not exceed BOF', () => {
    implementLineForward(content, 9999, false, [lastLine, END_MARKER], [0, 23]);

    implementLineBackward(content, 99999, false, [line1]);
  });
});
