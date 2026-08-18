import { beforeEach, describe, expect, it } from 'vitest';

import { config, mode } from '../../src/state/config';

import { opt } from '../../src/options';

import { initCharset } from '../../src/features/charset';

import { initTerminalCapabilities } from '../../src/state/constants';

import { transformContent } from '../../src/lines/helpers';

import { LtScreen } from '../lesstest/ltScreen';

/**
 * nroff overstrikes: `X\bX` prints bold, `_\bX` underlined. Both
 * attributes leave through the same reset, so a run of one must not
 * swallow the run of the other that follows it - less's own help
 * ("|X\bX_\bc_\bo..." for the pipe command) is bold X then an
 * underlined "command", and used to come out bold throughout.
 *
 * The attribute strings here were captured from less (less/less) at
 * 24x80 with the same input.
 */
const WIDTH = 20;

/** The attributes a transformed line paints, one letter per cell. */
function attrsOf(line: string): string {
  const screen = new LtScreen(WIDTH, 2);
  screen.feed(transformContent([line])[0]);

  return screen.snapshot().cells[0]
    .map((cell: { ch: string, attr: number }) =>
      cell.ch === '_' ? '.' : cell.attr === 1 ? 'b'
        : cell.attr === 2 ? 'u' : cell.attr === 0 ? '-' : String(cell.attr))
    .join('')
    .replace(/\.+$/, '');
}

beforeEach(() => {
  config.screenWidth = WIDTH;
  mode.DUMB = false;
  opt.ctldisp = 0;
  opt.bsMode = 0;
  opt.procBackspace = 0;
  opt.squeeze = 0;
  initCharset();

  // a session's capabilities collapse BOTH attribute exits to sgr0;
  // without this they differ (ESC[m vs ESC[24m) and the boundary bug
  // cannot reproduce
  initTerminalCapabilities();
});

describe('nroff overstrike runs', () => {
  it('keeps bold and underline apart across a boundary', () => {
    // less: "Xcom" with attributes b u u u
    expect(attrsOf('X\bX_\bc_\bo_\bm')).toBe('buuu');
  });

  it('switches back from underline to bold', () => {
    // less: "cXY" with attributes u b b
    expect(attrsOf('_\bcX\bXY\bY')).toBe('ubb');
  });

  it('alternates as many times as the line does', () => {
    // less: "XcYo" with attributes b u b u
    expect(attrsOf('X\bX_\bcY\bY_\bo')).toBe('bubu');
  });

  it('still merges a run of one attribute', () => {
    expect(attrsOf('_\bc_\bo_\bm')).toBe('uuu');
    expect(attrsOf('X\bXY\bYZ\bZ')).toBe('bbb');
  });
});
