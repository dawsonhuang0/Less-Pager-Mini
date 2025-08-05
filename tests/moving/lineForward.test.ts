import { beforeEach, describe, expect, it } from 'vitest';

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

  mode.INIT = true;
  mode.EOF = false;
});

describe('chopLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = true;
  });

  it('does not forward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    let output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineForward(lessContent, 1);
  
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineForward(lessContent, 9999);
  
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards 1 line', () => {
    lineForward(content, 1);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('2 ABCD');

    lineForward(content, 1);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('3 你好');
  });

  it('forwards 2 lines', () => {
    lineForward(content, 1);
    lineForward(content, 1);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('3 你好');

    lineForward(content, 2);
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe('5 Hello こんにちは 안녕하세요 你好 😀😃😄😁😆');
  });

  it('forwards multiple lines into chopped line', () => {
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

  const lastLine = '28 Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur vel hendr\x1b[7m>\x1b[0m';

  it('forwards 64 lines on key press but does not exceed EOF', () => {
    for (let i = 0; i < 64; i++) lineForward(content, 1);

    const output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards many lines but does not exceed EOF', () => {
    lineForward(content, 9999);

    const output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });
});

describe('wrapLongLines', () => {
  beforeEach(() => {
    config.chopLongLines = false;
  });

  it('does not forward when content lines are less than window', () => {
    const lessContent = content.slice(0, 6);

    let output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineForward(lessContent, 1);
  
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    lineForward(lessContent, 9999);
  
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards to wrapped line and continue until exit wrapped line', () => {
    lineForward(content, 22);
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('21 hashMap[13]:');

    const expectOutputs = [
      `22 {"key":"apple","value":1} -> {"key":"cherry","value":5} -> {"key":"mango","va`,
      `lue":7} -> {"key":"strawberry","value":2} -> {"key":"pineapple","value":6} -> {"`,
      `key":"blueberry","value":3} -> {"key":"raspberry","value":10} -> {"key":"blackbe`,
      `rry","value":7} -> null`,
      '23 Another long one: 🧵🧶🪡🪢🪣🪤🪥🪦🪧🪨🪩🪪🪫🪬🪭🪮🪯🪰🪱🪲🪳🪴🪵'
    ];

    for (const expectOutput of expectOutputs) {
      lineForward(content, 1);
      output = formatContent(content);
      expect(output.split('\n')[0]).toBe(expectOutput);
    }
  });

  const lastLine = '31 混合行包括各种字符和符号，用于终端宽度测试。';

  it('forwards 64 lines on key press but does not exceed EOF', () => {
    for (let i = 0; i < 64; i++) lineForward(content, 1);

    const output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards many lines but does not exceed EOF', () => {
    lineForward(content, 9999);

    const output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });
});
