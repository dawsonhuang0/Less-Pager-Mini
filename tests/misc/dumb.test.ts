import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { option } from '../../src/options';

import { render, resetRender, calculateEOF } from '../../src/helpers';

const written: string[] = [];

vi.spyOn(process.stdout, 'write').mockImplementation(data => {
  written.push(String(data));
  return true;
});

const content = Array.from({ length: 30 }, (_, i) => `d${i + 1}`);

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.blankTop = 0;
  config.screenWidth = 40;
  config.halfScreenWidth = 20;
  config.window = 6;
  config.chopLongLines = true;
  config.keyPrefix = '';
  config.attnRow = -1;

  mode.INIT = false;
  mode.EOF = false;
  mode.HELP = false;
  mode.BUFFERING = false;
  mode.DUMB = true;

  search.message = '';
  search.input = null;
  option.pending = '';

  initContent(content);
  calculateEOF(content);
  resetRender();
  written.length = 0;
});

describe('dumb terminal rendering', () => {
  it('paints with newlines only, attributes stripped', () => {
    render(content, []);
    const frame = written.join('');

    // the first paint prints directly, like og's initial forw
    expect(frame.startsWith('d1')).toBe(true);

    // no cursor addressing or attribute escapes at all
    expect(frame).not.toContain('\x1B');
  });

  it('scrolls forward by printing only the new lines', () => {
    render(content, []);
    written.length = 0;

    config.row = 1;
    render(content, []);
    const frame = written.join('');

    // og lets the terminal scroll: CR, the newly exposed line, prompt
    expect(frame.startsWith('\r')).toBe(true);
    expect(frame).toContain('d6\n');
    expect(frame).not.toContain('d2\n');
    expect(frame).not.toContain('\x1B');
  });

  it('overwrites a changed bottom line in place without clearing', () => {
    render(content, []);
    written.length = 0;

    search.message = 'hello there';
    render(content, []);
    const frame = written.join('');

    // a bare CR then the new line; no erase, so old tails would stay
    expect(frame.startsWith('\r')).toBe(true);
    expect(frame).toContain('hello there');
    expect(frame).not.toContain('\n');
    expect(frame).not.toContain('\x1B');
  });

  it('repaints in full behind two newlines on backward moves', () => {
    config.row = 3;
    render(content, []);
    written.length = 0;

    config.row = 0;
    render(content, []);
    const frame = written.join('');

    expect(frame.startsWith('\n\n')).toBe(true);
    expect(frame).toContain('d1');
    expect(frame).not.toContain('\x1B');
  });

  it('keeps cursor-addressed frames on smart terminals', () => {
    mode.DUMB = false;
    render(content, []);

    expect(written.join('')).toContain('\x1B[');
  });
});
