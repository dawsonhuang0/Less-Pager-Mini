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

  mode.EOF = false;
});

describe('chopLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = true;
  });

  test('does not backward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    lineBackward(lessContent, 1);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');

    lineBackward(lessContent, 9999);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
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

  test('backwards 64 lines on key press but does not exceed BOF', () => {
    lineForward(content, 9999);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬');

    for (let i = 0; i < 64; i++) lineBackward(content, 1);

    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
  });

  test('backwards many lines but does not exceed BOF', () => {
    lineForward(content, 9999);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬');

    lineBackward(content, 99999);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  test('forwards into wrapped line then backward 1 line', () => {
    lineForward(content, 15);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬');

    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('复杂的字符。');

    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些');

    lineBackward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('13 1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ🌈🔥💧❄️🍀🌸');
  });

  test('backwards 64 lines on key press but does not exceed BOF', () => {
    lineForward(content, 9999);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('20 A line with CJK + emoji + ASCII to push the limits: 编程测试');

    for (let i = 0; i < 64; i++) lineBackward(content, 1);

    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
  });

  test('backwards many lines but does not exceed BOF', () => {
    lineForward(content, 9999);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('20 A line with CJK + emoji + ASCII to push the limits: 编程测试');

    lineBackward(content, 99999);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('1 A');
  });
});
