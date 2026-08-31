import { describe, expect, it } from 'vitest';

import {
  A_EXTRA,
  EV_OK,
  COMMAND_CODES,
  COMMAND_NAMES,
  EDIT_ACTION_CODES,
  EDIT_ACTION_NAMES,
  SK_SPECIAL_KEY,
  SK_CONTROL_K,
  SPECIAL_KEY_CODES,
  DEFAULT_KEYMAP,
} from '../../src/lesskey/codes';

import { compileLesskey } from '../../src/lesskey/compile';

/*
 * The generated name/code table (tools/gen-lesskey-codes.py).
 *
 * A generator can produce a table that is internally tidy and still
 * wrong, so these check it against less's own numbers rather than
 * against itself -- the values below are read off cmd.h.
 */
describe('lesskey action codes', () => {
  it('carries less\'s numbers for the actions a binary names', () => {
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

  it('keeps the synonyms less keeps, pointing at one code', () => {
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

  it('carries every \\k form a compiled file can hold', () => {
    // the pager's own \\k handling resolves through terminfo and so
    // only knows the keys a terminal describes; this table is what
    // COMPILES, and less's tstr accepts the keypad forms too
    // 55, plus less 710's four page-key forms (2a2eca2)
    expect(Object.keys(SPECIAL_KEY_CODES)).toHaveLength(59);

    expect({
      up: SPECIAL_KEY_CODES['u'],        // SK_UP_ARROW 3
      ctrlDown: SPECIAL_KEY_CODES['^d'], // SK_CTL_DOWN_ARROW 45
      shiftUp: SPECIAL_KEY_CODES['+u'],  // SK_SHIFT_UP_ARROW 42
      padEnter: SPECIAL_KEY_CODES['pe'], // SK_PAD_ENTER 41
      padStar: SPECIAL_KEY_CODES['p*'],  // SK_PAD_STAR 27
    }).toEqual({ up: 3, ctrlDown: 45, shiftUp: 42, padEnter: 41, padStar: 27 });

    // less's lesskey.nro prints "\k^U shift-PAGE UP" and "\k+U
    // ctrl-PAGE UP", which is a typo in the MAN PAGE: lesskey_parse.c
    // reads '^' as ctrl and '+' as shift for every one of these,
    // page keys included (:287, :301)
    expect({
      shiftPageUp: SPECIAL_KEY_CODES['+U'],   // SK_SHIFT_PAGE_UP 47
      shiftPageDown: SPECIAL_KEY_CODES['+D'], // SK_SHIFT_PAGE_DOWN 48
      ctlPageUp: SPECIAL_KEY_CODES['^U'],     // SK_CTL_PAGE_UP 49
      ctlPageDown: SPECIAL_KEY_CODES['^D'],   // SK_CTL_PAGE_DOWN 50
    }).toEqual({
      shiftPageUp: 47, shiftPageDown: 48, ctlPageUp: 49, ctlPageDown: 50,
    });

    // a blob opens with CONTROL('K'), which is why a literal ^K has to
    // be stored as SK_CONTROL_K instead of as itself
    expect([SK_SPECIAL_KEY, SK_CONTROL_K]).toEqual([0x0B, 40]);
  });

  it('writes less\'s built-in bindings as source that compiles', () => {
    // --edit-lesskey opens this when a session has no lesskey at all,
    // so it has to be a real file, not a description of one
    const { data, errors } = compileLesskey(
      DEFAULT_KEYMAP.join('\n') + '\n', 707);

    expect(errors).toEqual([]);
    expect(data).not.toBeNull();

    // nothing in less's table went untranslated
    expect(DEFAULT_KEYMAP.filter(line => line.includes('<?'))).toEqual([]);

    // the only commented lines are the two paste markers, which have
    // no lesskey name (A_START_PASTE / A_END_PASTE)
    expect(DEFAULT_KEYMAP.filter(line => line.startsWith('# ')))
      .toHaveLength(4);

    expect(DEFAULT_KEYMAP).toContain('j\tforw-line');
    expect(DEFAULT_KEYMAP).toContain('q\tquit');
    expect(DEFAULT_KEYMAP).toContain('\\ku\tback-line');
    // the bracket commands carry their pair as an extra string
    expect(DEFAULT_KEYMAP).toContain('{\tforw-bracket\t{}');
    expect(DEFAULT_KEYMAP.filter(l => l === '#command' || l === '#line-edit'))
      .toEqual(['#command', '#line-edit']);
  });

  it('leaves the mouse actions unnamed, like less', () => {
    // A_F_MOUSE(66)/A_B_MOUSE(67)/A_L_MOUSE(78)/A_R_MOUSE(79) are what
    // the DECODER resolves a wheel report to, so lesskey_parse.c never
    // names them - only a hand-written binary can carry one, and a
    // decompiler has nothing to call it
    for (const code of [66, 67, 78, 79]) {
      expect([code, COMMAND_NAMES[code]]).toEqual([code, undefined]);
    }
  });
});
