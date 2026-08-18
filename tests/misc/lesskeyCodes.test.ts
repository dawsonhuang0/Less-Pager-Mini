import { describe, expect, it } from 'vitest';

import {
  A_EXTRA,
  EV_OK,
  COMMAND_CODES,
  COMMAND_NAMES,
  EDIT_ACTION_CODES,
  EDIT_ACTION_NAMES,
} from '../../src/features/lesskeyCodes';

/*
 * The generated name/code table (tools/gen-lesskey-codes.py).
 *
 * A generator can produce a table that is internally tidy and still
 * wrong, so these check it against og's own numbers rather than
 * against itself -- the values below are read off cmd.h.
 */
describe('lesskey action codes', () => {
  it('carries og\'s numbers for the actions a binary names', () => {
    expect({
      forwLine: COMMAND_CODES['forw-line'],       // A_F_LINE 12
      quit: COMMAND_CODES['quit'],                // A_QUIT 24
      gotoPos: COMMAND_CODES['goto-pos'],         // A_GOPOS 51
      nextTag: COMMAND_CODES['next-tag'],         // A_NEXT_TAG 53
      noaction: COMMAND_CODES['noaction'],        // A_NOACTION 101
      invalid: COMMAND_CODES['invalid'],          // A_UINVALID 102
      debug: COMMAND_CODES['debug'],              // A_DEBUG 8
    }).toEqual({
      forwLine: 12,
      quit: 24,
      gotoPos: 51,
      nextTag: 53,
      noaction: 101,
      invalid: 102,
      debug: 8,
    });

    expect({
      backspace: EDIT_ACTION_CODES['backspace'],  // EC_BACKSPACE 1
      up: EDIT_ACTION_CODES['up'],                // EC_UP 13
      abort: EDIT_ACTION_CODES['abort'],          // EC_ABORT 20
      // the #line-edit section borrows A_NOACTION, not an EC_ of its
      // own (lesskey_parse.c's editnames)
      noaction: EDIT_ACTION_CODES['noaction'],
    }).toEqual({ backspace: 1, up: 13, abort: 20, noaction: 101 });

    expect([A_EXTRA, EV_OK]).toEqual([0x80, 0x01]);
  });

  it('names a code the same way round in both directions', () => {
    for (const [code, name] of Object.entries(COMMAND_NAMES)) {
      expect([name, COMMAND_CODES[name]]).toEqual([name, Number(code)]);
    }

    for (const [code, name] of Object.entries(EDIT_ACTION_NAMES)) {
      expect([name, EDIT_ACTION_CODES[name]]).toEqual([name, Number(code)]);
    }
  });

  it('keeps the synonyms og keeps, pointing at one code', () => {
    // several names share a code; the reverse table picks one, and
    // the others still have to compile to the same byte
    for (const [a, b] of [
      ['end', 'goto-end'],
      ['firstcmd', 'first-cmd'],
      ['flush-repaint', 'repaint-flush'],
      ['toggle-option', 'toggle-flag'],
      ['display-option', 'display-flag'],
    ]) {
      expect([a, COMMAND_CODES[a]]).toEqual([a, COMMAND_CODES[b]]);
    }
  });

  it('leaves the mouse actions unnamed, like og', () => {
    // A_F_MOUSE(66)/A_B_MOUSE(67)/A_L_MOUSE(78)/A_R_MOUSE(79) are what
    // the DECODER resolves a wheel report to, so lesskey_parse.c never
    // names them - only a hand-written binary can carry one, and a
    // decompiler has nothing to call it
    for (const code of [66, 67, 78, 79]) {
      expect([code, COMMAND_NAMES[code]]).toEqual([code, undefined]);
    }
  });
});
