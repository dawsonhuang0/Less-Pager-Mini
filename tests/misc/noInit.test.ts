import { beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { opt, option } from '../../src/options';

import { render, resetRender, resetDumbPaint, calculateEOF }
  from '../../src/helpers';

const written: string[] = [];

vi.spyOn(process.stdout, 'write').mockImplementation(data => {
  written.push(String(data));
  return true;
});

const content = Array.from({ length: 30 }, (_, i) => `x${i + 1}`);

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
  mode.DUMB = false;

  search.message = '';
  search.input = null;
  option.pending = '';

  opt.noInit = 1;
  opt.oldBot = 0;

  initContent(content);
  calculateEOF(content);
  resetRender();
  resetDumbPaint();
  written.length = 0;
});

describe('-X main-screen rendering', () => {
  it('prints the first paint in place, never homing', () => {
    render(content, []);
    const frame = written.join('');

    // og's term_init line_left, then the lines scroll naturally
    expect(frame.startsWith('\rx1\n')).toBe(true);
    expect(frame).not.toContain('\x1B[H');
    expect(frame).not.toContain('\x1B[1;1H');
    expect(frame).not.toContain('\x1B[?2026');
  });

  it('scrolls forward by printing only the new lines', () => {
    render(content, []);
    written.length = 0;

    config.row = 1;
    render(content, []);
    const frame = written.join('');

    // og's clear_bot erases the prompt row, forw prints the new line
    expect(frame.startsWith('\r\x1B[Kx6\n')).toBe(true);
    expect(frame).not.toContain('x2\n');
  });

  it('scrolls backward with home + reverse index, then lower_left', () => {
    config.row = 2;
    render(content, []);
    written.length = 0;

    config.row = 0;
    render(content, []);
    const frame = written.join('');

    // og's back(): each line inserts at the top, nearest first
    expect(frame).toContain('\x1B[H\x1BMx2\n\x1B[H\x1BMx1\n');
    expect(frame).toContain(`\x1B[${config.window};1H`);
  });

  it('prints "...skipping..." on far forward jumps', () => {
    render(content, []);
    written.length = 0;

    config.row = 20;
    render(content, []);
    const frame = written.join('');

    // og's repaint()/forw without top_scroll
    expect(frame.startsWith('\r\x1B[K...skipping...\n')).toBe(true);
    expect(frame).toContain('x21');
  });

  it('clears and paints in reverse on far backward jumps', () => {
    config.row = 20;
    render(content, []);
    written.length = 0;

    config.row = 0;
    render(content, []);
    const frame = written.join('');

    // jump_loc's lclear, then back() inserting rows bottom-up
    expect(frame).toContain('\x1B[H\x1B[2J');
    expect(frame).toContain('\x1B[H\x1BMx5');
    expect(frame).toContain('\x1B[H\x1BMx1');
    expect(frame.indexOf('\x1BMx5')).toBeLessThan(frame.indexOf('\x1BMx1'));
  });

  it('rewrites only the bottom line for messages', () => {
    render(content, []);
    written.length = 0;

    search.message = 'hello there';
    render(content, []);
    const frame = written.join('');

    // og's clear_bot then the message; the content rows stay put
    expect(frame.startsWith('\r\x1B[K')).toBe(true);
    expect(frame).toContain('hello there');
    expect(frame).not.toContain('\n');
  });

  it('clear_bots at the physical bottom row with --old-bot', () => {
    render(content, []);
    written.length = 0;

    opt.oldBot = 1;
    search.message = 'way down';
    render(content, []);
    opt.oldBot = 0;
    const frame = written.join('');

    // og's lower_left instead of line_left (screen.c:2703)
    expect(frame.startsWith(`\x1B[${config.window};1H\x1B[K`)).toBe(true);
    expect(frame).toContain('way down');
  });

  it('keeps full-frame rendering when -X is off', () => {
    opt.noInit = 0;
    render(content, []);

    expect(written.join('')).toContain('\x1B[?2026h');
  });
});
