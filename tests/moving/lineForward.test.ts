import { beforeEach, describe, expect, test } from 'vitest';

import { formatContent } from '../../src/helpers';

import { lineForward } from '../../src/features/moving';

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

  test('does not forward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    lineForward(lessContent, 1);
    let output = formatContent(lessContent);
    expect(output.split('\n')[0]).toBe('1 A');

    lineForward(lessContent, 9999);
    output = formatContent(lessContent);
    expect(output.split('\n')[0]).toBe('1 A');
  });

  test('forwards 1 line', () => {
    lineForward(content, 1);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('2 ABCD');

    lineForward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('3 你好');
  });

  test('forwards 2 lines', () => {
    lineForward(content, 1);
    lineForward(content, 1);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('3 你好');

    lineForward(content, 2);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('5 Hello こんにちは 안녕하세요 你好 😀😃😄😁😆');
  });

  test('forwards multiple lines into chopped line', () => {
      lineForward(content, 12);
      let output = formatContent(content);
      expect(output.split('\n')[0]).toBe('13 1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ🌈🔥💧❄️🍀🌸');

      lineForward(content, 1);
      output = formatContent(content);
      expect(output.split('\n')[0]).toBe('14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些\x1b[7m>\x1b[0m');

      lineForward(content, 1);
      output = formatContent(content);
      expect(output.split('\n')[0]).toBe('15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬');
    });

  const lastLine = '15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬';

  test('forwards 64 lines on key press but does not exceed EOF', () => {
    for (let i = 0; i < 64; i++) lineForward(content, 1);

    const output = formatContent(content);
    expect(output.split('\n')[0]).toBe(lastLine);
  });

  test('forwards many lines but does not exceed EOF', () => {
    lineForward(content, 9999);
    const output = formatContent(content);
    expect(output.split('\n')[0]).toBe(lastLine);
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  test('forwards to wrapped line and forward 1 line', () => {
    lineForward(content, 12);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('13 1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ🌈🔥💧❄️🍀🌸');
    
    lineForward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些');

    lineForward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('复杂的字符。');

    lineForward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬');
  });

  const lastLine = '20 A line with CJK + emoji + ASCII to push the limits: 编程测试';

  test('forwards 64 lines on key press but does not exceed EOF', () => {
    for (let i = 0; i < 64; i++) lineForward(content, 1);

    const output = formatContent(content);
    expect(output.split('\n')[0]).toBe(lastLine);
  });

  test('forwards many lines but does not exceed EOF', () => {
    lineForward(content, 9999);
    const output = formatContent(content);
    expect(output.split('\n')[0]).toBe(lastLine);
  });
});
