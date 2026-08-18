import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, mode } from '../../src/state/config';

import { search } from '../../src/features/searching';

import { initContent } from '../../src/features/files';

import { opt, option } from '../../src/options';

import { render, resetRender, resetDumbPaint, calculateEOF, freezeFrame,
  markPosClear } from '../../src/helpers';

import { initTerminalCapabilities, INVERSE_ON, INVERSE_OFF, BOLD_ON,
  UNDERLINE_ON } from '../../src/state/constants';

import { resetTerminfo } from '../../src/tty/terminal';

// mode.DUMB alone is a state no terminal is ever in: less reaches it by
// loading an entry with no capabilities, which is also what empties
// its attribute strings. Setting the flag while the CAPABILITIES still
// come from a real xterm (tests/setup.ts forces one) leaves standout
// and bold on the rows, and the frames below would be asserting
// against a terminal that cannot exist.
const realTerm = process.env.TERM;

const useTerm = (term: string): void => {
  process.env.TERM = term;
  resetTerminfo();
  initTerminalCapabilities();
};

afterAll(() => {
  process.env.TERM = realTerm;
  resetTerminfo();
  initTerminalCapabilities();
});

const written: string[] = [];

vi.spyOn(process.stdout, 'write').mockImplementation(data => {
  written.push(String(data));
  return true;
});

const content = Array.from({ length: 30 }, (_, i) => `d${i + 1}`);

beforeEach(() => {
  useTerm('dumb');

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
  // resetRender does not clear it: dumbPainted is what tells the dumb
  // painter a screen is already up, and it survives a session the way
  // less's own statics do. Left standing between tests, the first paint
  // of the next one opens with a repaint's CR
  resetDumbPaint();
  written.length = 0;
});

describe('dumb terminal rendering', () => {
  it('has no attribute strings to draw with, like less tmodes', () => {
    // the entry has no smso, so less's tmodes leaves standout empty -
    // and hands that same empty pair to underline and bold
    // (screen.c:1645). Nothing on this terminal stands out, which is
    // why the frames below carry no attribute bytes of their own
    expect(INVERSE_ON).toBe('');
    expect(INVERSE_OFF).toBe('');
    expect(BOLD_ON).toBe('');
    expect(UNDERLINE_ON).toBe('');
  });

  it('still passes the file\'s own -R escapes to the terminal', () => {
    // less's put_line hands an AT_ANSI char to putchr whatever the
    // terminal is (line.c:1300), so -R colours a dumb terminal just
    // as it colours an xterm; measured against less at TERM=dumb. Its
    // pdone closes every line with a literal "\033[m" too
    const coloured = ['\x1b[31mred', 'plain'];
    opt.ctldisp = 2;
    initContent(coloured);
    calculateEOF(coloured);
    resetRender();
    written.length = 0;

    render(coloured, []);
    const frame = written.join('');
    opt.ctldisp = 0;

    expect(frame).toContain('\x1b[31mred\x1b[m');
    expect(frame).toContain('plain\x1b[m');
  });

  it('paints with newlines only, attributes stripped', () => {
    render(content, []);
    const frame = written.join('');

    // the first paint prints directly, like less's initial forw,
    // behind the CR term_init has already written
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

    // less lets the terminal scroll: CR, the newly exposed line, prompt
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

  it('never marks its own first screen, whatever was echoed first', () => {
    // less clears first_time at the END of the first forw (forwback.c:381)
    // and tests it before printing the marker (:272), so nothing
    // written before that first paint can make the paint look like a
    // repaint. The startup error gate ungets whatever key was typed
    // at it, and a "-" opens a command line: those echo frames paint
    // no content - they are prompt() returning early - but each still
    // left a previous frame behind, and the first real forw then
    // printed "...skipping..." over its own opening screen.
    freezeFrame();
    render(content, []);
    expect(written.join('')).not.toBe('');
    written.length = 0;

    // the mca closing repaints through less's pos_clear'd forw, which
    // is the path that carries the marker
    markPosClear();
    render(content, []);
    const frame = written.join('');

    expect(frame).toContain('d1');
    expect(frame).not.toContain('...skipping...');
  });

  it('repaints behind "...skipping..." on backward moves, like less', () => {
    // less's repaint() forw is non-contiguous and, without top_scroll,
    // prints the skipping marker instead of clearing
    config.row = 3;
    render(content, []);
    written.length = 0;

    config.row = 0;
    render(content, []);
    const frame = written.join('');

    expect(frame.startsWith('\r...skipping...\n')).toBe(true);
    expect(frame).toContain('d1');
    expect(frame).not.toContain('\x1B');
  });

  it('clears with two newlines and homes with "|\\b^" under -c', () => {
    config.row = 3;
    render(content, []);
    written.length = 0;

    opt.clearRepaint = 1;
    config.row = 0;
    render(content, []);
    opt.clearRepaint = 0;
    const frame = written.join('');

    expect(frame.startsWith('\r\n\n|\b^')).toBe(true);
    expect(frame).toContain('d1');
  });

  it('keeps cursor-addressed frames on smart terminals', () => {
    useTerm('xterm-256color');
    mode.DUMB = false;
    resetRender();
    written.length = 0;
    render(content, []);

    expect(written.join('')).toContain('\x1B[');
  });
});
