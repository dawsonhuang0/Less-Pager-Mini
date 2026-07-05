import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../src/config';

import { render, resetRender } from '../src/helpers';

import { search } from '../src/features/searching';

const content = Array.from({ length: 60 }, (_, i) => `line ${i}`);

let writes: string[] = [];
const originalWrite = process.stdout.write;

beforeEach(() => {
  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.bufferOffset = 0;
  config.screenWidth = 80;
  config.window = 24;
  config.chopLongLines = true;

  mode.INIT = false;
  mode.EOF = false;
  mode.BUFFERING = false;
  mode.HELP = false;

  search.input = null;
  search.message = '';

  writes = [];
  process.stdout.write = ((chunk: string) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  resetRender();
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

describe('render', () => {
  it('draws a full frame first, then scrolls incrementally', () => {
    config.row = 10;
    render(content, []);

    // first frame: full redraw from home, no screen clear
    expect(writes[0]).toContain('\x1b[H');
    expect(writes[0]).not.toContain('\x1b[2J');
    expect(writes[0]).toContain('line 10');

    config.row = 11;
    render(content, []);

    // one line forward: scroll up 1, redraw only the exposed rows
    expect(writes[1]).toContain('\x1b[1S');
    expect(writes[1]).not.toContain('\x1b[H\x1b[K');
    expect(writes[1]).toContain('line 33');
    expect(writes[1]).not.toContain('line 12\n');
  });

  it('scrolls down when moving backward', () => {
    config.row = 10;
    render(content, []);

    config.row = 8;
    render(content, []);

    expect(writes[1]).toContain('\x1b[2T');
    expect(writes[1]).toContain('line 8');
    expect(writes[1]).toContain('line 9');
    expect(writes[1]).not.toContain('line 20');
  });

  it('falls back to a full frame on jumps', () => {
    config.row = 10;
    render(content, []);

    config.row = 36;
    render(content, []);

    expect(writes[1]).toContain('\x1b[H');
    expect(writes[1]).not.toContain('S');
    expect(writes[1]).toContain('line 36');
  });

  it('redraws fully after a reset', () => {
    config.row = 10;
    render(content, []);

    resetRender();
    config.row = 11;
    render(content, []);

    expect(writes[1]).toContain('\x1b[H');
    expect(writes[1]).not.toContain('\x1b[1S');
  });

  it('writes nothing when the frame is unchanged (scroll at limit)', () => {
    config.row = 10;
    render(content, []);
    render(content, []);

    expect(writes.length).toBe(1);
  });

  it('parks the cursor after the prompt on every frame', () => {
    config.row = 10;
    render(content, []);

    // prompt row 24 shows ':' so the cursor parks at column 2
    expect(writes[0]).toContain('\x1b[24;2H');

    config.row = 11;
    render(content, []);

    expect(writes[1]).toContain('\x1b[24;2H');
  });
});
