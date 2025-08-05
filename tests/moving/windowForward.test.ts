import { beforeEach, describe, expect, it } from 'vitest';

import { formatContent } from '../../src/helpers';

import { windowForward } from '../../src/features/moving';

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

    windowForward(lessContent, '');

    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    windowForward(lessContent, '9999');
  
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards 1 window', () => {
    windowForward(content, '');
    const output = formatContent(content);
    expect(output.split('\n')[0]).toBe('24 Hello world! 👋 你好世界！こんにちは世界！안녕하세요 세상! 🌍🌎🌏');
  });

  const lastLine = '28 Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur vel hendr\x1b[7m>\x1b[0m';

  it('forwards to EOF', () => {
    windowForward(content, '');
    let output = formatContent(content).split('\n');
    expect(output[0]).toBe('24 Hello world! 👋 你好世界！こんにちは世界！안녕하세요 세상! 🌍🌎🌏');

    windowForward(content, '');

    output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards by buffer', () => {
    windowForward(content, '1');
    let output = formatContent(content).split('\n');
    expect(output[0]).toBe('2 ABCD');

    windowForward(content, '5');
    output = formatContent(content).split('\n');
    expect(output[0]).toBe('7 这是一段中文，用于测试宽度显示效果。');
  });

  it('forwards into chopped line', () => {
    windowForward(content, '12');
    let output = formatContent(content).split('\n');
    expect(output[0]).toBe('13 1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ🌈🔥💧❄️🍀🌸');

    windowForward(content, '1');
    output = formatContent(content).split('\n');
    expect(output[0]).toBe('14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些\x1b[7m>\x1b[0m');

    windowForward(content, '1');
    output = formatContent(content).split('\n');
    expect(output[0]).toBe('15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬');
  });

  it('forwards 64 windows on key press but does not exceed EOF', () => {
    for (let i = 0; i < 64; i++) windowForward(content, '');

    const output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards by large buffer but does not exceed EOF', () => {
    windowForward(content, '9999');

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

    windowForward(lessContent, '');

    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');

    windowForward(lessContent, '9999');
  
    output = formatContent(lessContent).split('\n');
    expect(output[0]).toBe('1 A');
    expect(output[6]).toBe('\x1b[7m(END)\x1b[0m');
  });

  const lastLine = '31 混合行包括各种字符和符号，用于终端宽度测试。';

  it('forwards to wrapped line and continue until exit wrapped line', () => {
    windowForward(content, '1');
    let output = formatContent(content);
    expect(output.split('\n')[0]).toBe('2 ABCD');

    windowForward(content, '');
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe(`lue":7} -> {"key":"strawberry","value":2} -> {"key":"pineapple","value":6} -> {"`);

    windowForward(content, '');
    output = formatContent(content);
    expect(output.split('\n')[0]).toBe(lastLine);
  });

  it('forwards 64 windows on key press but does not exceed EOF', () => {
    for (let i = 0; i < 64; i++) windowForward(content, '');

    const output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });

  it('forwards by large buffer but does not exceed EOF', () => {
    windowForward(content, '9999');

    const output = formatContent(content).split('\n');
    expect(output[0]).toBe(lastLine);
    expect(output[23]).toBe('\x1b[7m(END)\x1b[0m');
  });
});
