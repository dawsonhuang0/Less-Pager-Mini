import { beforeEach, describe, it } from 'vitest';

import { config, mode } from '../../src/config';

import { text, content } from '../utils/mockContent';

import { implementWindowForward } from '../utils/testUtils';

import { INVERSE_ON, INVERSE_OFF, END_MARKER } from '../../src/constants';

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
    implementWindowForward(lessContent, '0', false, [line1, END_MARKER], [0, 6]);

    implementWindowForward(lessContent, '', false, [line1, END_MARKER], [0, 6]);
    implementWindowForward(lessContent, '9999', false, [line1, END_MARKER], [0, 6]);
  });

  const lastLine = text[27].slice(0, 79) + COL_END_MARKER;

  it('forwards to EOF', () => {
    implementWindowForward(content, '', false, [text[23]]);
    implementWindowForward(content, '', false, [lastLine, END_MARKER], [0, 23]);
  });

  it('forwards by buffer', () => {
    implementWindowForward(content, '1', false, [text[1]]);
    implementWindowForward(content, '5', false, [text[6]]);
  });

  it('forwards into chopped line', () => {
    implementWindowForward(content, '12', false, [text[12]]);

    implementWindowForward(content, '1', false, ['14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些' + COL_END_MARKER]);
    implementWindowForward(content, '1', false, [text[14]]);
  });

  it('forwards 64 windows on key press but does not exceed EOF', () => {
    implementWindowForward(content, '64', true, [lastLine, END_MARKER], [0, 23]);
  });

  it('forwards by large buffer but does not exceed EOF', () => {
    implementWindowForward(content, '9999', false, [lastLine, END_MARKER], [0, 23]);
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  it('does not forward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    // `(END)` should not be at bottom at first load with content rows less than window
    implementWindowForward(lessContent, '0', false, [line1, END_MARKER], [0, 6]);

    implementWindowForward(lessContent, '', false, [line1, END_MARKER], [0, 6]);
    implementWindowForward(lessContent, '9999', false, [line1, END_MARKER], [0, 6]);
  });

  const lastLine = text[30];

  it('forwards to wrapped line and continue until exit wrapped line', () => {
    implementWindowForward(content, '1', false, [text[1]]);

    implementWindowForward(content, '', false, [text[21].slice(80, 160)]);
    implementWindowForward(content, '', false, [lastLine, END_MARKER], [0, 23]);
  });

  it('forwards 64 windows on key press but does not exceed EOF', () => {
    implementWindowForward(content, '64', true, [lastLine, END_MARKER], [0, 23]);
  });

  it('forwards by large buffer but does not exceed EOF', () => {
    implementWindowForward(content, '9999', false, [lastLine, END_MARKER], [0, 23]);
  });
});
