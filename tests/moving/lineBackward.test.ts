import { beforeEach, describe, expect, test } from 'vitest';

import { formatContent } from '../../src/helpers';

import { lineForward, lineBackward } from '../../src/features/moving';

import { config, mode } from '../../src/pagerConfig';

import { content } from '../textContent';

beforeEach(() => {
  config.row = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.halfScreenWidth = 40;
  config.halfWindow = 12;

  mode.INIT = true;
  mode.EOF = false;
});

describe('chopLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = true;
  });

  test('does not backward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    let output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineBackward(lessContent, 1);
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineBackward(lessContent, 9999);
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');
  });

  test('backwards 1 line', () => {
    lineForward(content, 2);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('3 你好');

    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('2 ABCD');

    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
  });

  test('backwards 2 lines', () => {
    lineForward(content, 6);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('7 这是一段中文，用于测试宽度显示效果。');

    lineBackward(content, 1);
    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('5 Hello こんにちは 안녕하세요 你好 😀😃😄😁😆');

    lineBackward(content, 2);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('3 你好');
  });

  test('forwards multiple lines then backwards 1 line into chopped line', () => {
    lineForward(content, 14);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬');

    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些\x1b[7m>\x1b[0m');

    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('13 1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ🌈🔥💧❄️🍀🌸');
  });

  const lastLine = '28 Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur vel hendr\x1b[7m>\x1b[0m';

  test('backwards 64 lines on key press but does not exceed BOF', () => {
    lineForward(content, 9999);

    let output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');

    for (let i = 0; i < 64; i++) lineBackward(content, 1);

    output = formatContent(content).split('\n');
    expect(output[0]).toBe('1 A');
  });

  test('backwards many lines but does not exceed BOF', () => {
    lineForward(content, 9999);
    
    let output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');

    lineBackward(content, 99999);
    output = formatContent(content).split('\n');
    expect(output[0]).toBe('1 A');
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  test('does not backward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    let output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineBackward(lessContent, 1);

    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineBackward(lessContent, 9999);

    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');
  });

  test('forwards to the end of wrapped line and backwards until exit wrapped line', () => {
    lineForward(content, 27);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('23 Another long one: 🧵🧶🪡🪢🪣🪤🪥🪦🪧🪨🪩🪪🪫🪬🪭🪮🪯🪰🪱🪲🪳🪴🪵');

    const expectOutputs = [
      `rry","value":7} -> null`,
      `key":"blueberry","value":3} -> {"key":"raspberry","value":10} -> {"key":"blackbe`,
      `lue":7} -> {"key":"strawberry","value":2} -> {"key":"pineapple","value":6} -> {"`,
      `22 {"key":"apple","value":1} -> {"key":"cherry","value":5} -> {"key":"mango","va`,
      '21 hashMap[13]:'
    ];

    for (const expectOutput of expectOutputs) {
      lineBackward(content, 1);
      output = formatContent(content);
      expect(output.split('\n')[0]).toBe(expectOutput);
    }
  });

  const lastLine = '31 混合行包括各种字符和符号，用于终端宽度测试。';

  test('backwards 64 lines on key press but does not exceed BOF', () => {
    lineForward(content, 9999);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe(lastLine);

    for (let i = 0; i < 64; i++) lineBackward(content, 1);

    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
  });

  test('backwards many lines but does not exceed BOF', () => {
    lineForward(content, 9999);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe(lastLine);

    lineBackward(content, 99999);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
  });
});
