import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { search } from '../../src/features/searching';

import {
  userBinding,
  userIsPrefix,
  userStop,
  translateEditKey,
  resetLesskey,
  parseLesskey,
  parseLesskeyBinary,
  loadLesskey
} from '../../src/features/lesskey';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-lesskey-'));

const saved = {
  LESSKEYIN: process.env.LESSKEYIN,
  LESSKEY: process.env.LESSKEY,
  LESSKEY_CONTENT: process.env.LESSKEY_CONTENT,
  LESSNOCONFIG: process.env.LESSNOCONFIG,
};

/** Parses lesskey source under the test file name. */
const parse = (text: string) => parseLesskey(text, 'test');

beforeEach(() => {
  resetLesskey();
  search.message = '';
  search.messageQueue.length = 0;

  delete process.env.LESSKEYIN;
  delete process.env.LESSKEY;
  delete process.env.LESSKEY_CONTENT;
  delete process.env.LESSNOCONFIG;
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('#command bindings', () => {
  it('binds a plain key to an action', () => {
    parse('N forw-line');
    expect(userBinding('N')).toEqual({
      action: 'LINE_FORWARD',
      key: undefined,
      extra: undefined,
    });
  });

  it('understands ^X, \\e and octal escapes', () => {
    parse('^A quit\n\\ez help\n\\177 back-line');

    expect(userBinding('\x01')?.action).toBe('EXIT');
    expect(userBinding('\x1Bz')?.action).toBe('HELP');
    expect(userBinding('\x7F')?.action).toBe('LINE_BACKWARD');
  });

  it('resolves \\k special key names to terminal sequences', () => {
    parse('\\ku forw-line\n\\kD forw-screen');

    expect(userBinding('\x1B[A')?.action).toBe('LINE_FORWARD');
    expect(userBinding('\x1B[6~')?.action).toBe('WINDOW_FORWARD');
  });

  it('reports an invalid \\k name like og', () => {
    parse('\\kz quit');
    expect(search.message).toBe(
      'test: line 1: invalid escape sequence "\\kz"'
    );
  });

  it('keeps the extra string, like A_EXTRA', () => {
    parse('« forw-bracket {}');
    expect(userBinding('«')).toEqual({
      action: 'CUSTOM_BRACKET_RIGHT',
      key: undefined,
      extra: '{}',
    });
  });

  it('carries a canonical key for the option commands', () => {
    parse('t toggle-option\nT display-option');

    expect(userBinding('t')).toEqual({
      action: 'TAG_COMMAND',
      key: '-',
      extra: undefined,
    });
    expect(userBinding('T')?.key).toBe('_');
  });

  it('accepts unsupported og actions as invalid bindings', () => {
    parse('P goto-pos');
    expect(search.message).toBe('');
    expect(userBinding('P')).toEqual({
      action: undefined,
      key: undefined,
      extra: undefined,
    });
  });

  it('reports unknown actions and missing actions like og', () => {
    parse('q blah\nq');
    expect(search.message).toBe('test: line 1: unknown action: "blah"');
    expect(search.messageQueue).toContain('test: line 2: missing action');
  });

  it('keeps the first binding for a key, like cmd_search', () => {
    parse('x quit\nx help');
    expect(userBinding('x')?.action).toBe('EXIT');
  });

  it('stores multi-key sequences and answers prefixes', () => {
    parse('gg goto-line\nzz quit');

    expect(userBinding('gg')?.action).toBe('FIRST_LINE');
    expect(userIsPrefix('g')).toBe(true);
    expect(userIsPrefix('z')).toBe(true);
    expect(userIsPrefix('gg')).toBe(false);
    expect(userIsPrefix('q')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    parse('# a comment\n\n  x quit # trailing\n');
    expect(userBinding('x')?.action).toBe('EXIT');
  });
});

describe('#env section', () => {
  it('sets session environment variables', () => {
    parse('#env\nLPM_TEST_VAR = hello world');
    expect(process.env.LPM_TEST_VAR).toBe('hello world');
    delete process.env.LPM_TEST_VAR;
  });

  it('appends with +=, like og', () => {
    parse('#env\nLPM_TEST_VAR = -i\nLPM_TEST_VAR += " -S"');
    expect(process.env.LPM_TEST_VAR).toBe('-i" -S"');
    delete process.env.LPM_TEST_VAR;
  });

  it('reports a missing =', () => {
    parse('#env\nLPM_TEST_VAR hello');
    expect(search.message).toBe(
      'test: line 2: missing = in variable definition'
    );
  });

  it('expands ${NAME} from the environment, like evar.c', () => {
    process.env.LPM_SRC = 'value';
    parse('#env\nLPM_TEST_VAR = pre ${LPM_SRC} post');
    expect(process.env.LPM_TEST_VAR).toBe('pre value post');

    delete process.env.LPM_TEST_VAR;
    delete process.env.LPM_SRC;
  });

  it('expands an unset variable to nothing', () => {
    parse('#env\nLPM_TEST_VAR = a${LPM_NOT_SET}b');
    expect(process.env.LPM_TEST_VAR).toBe('ab');
    delete process.env.LPM_TEST_VAR;
  });

  it('drops the var and all later vars on a missing }', () => {
    // probed: og's expand_evars break truncates the whole table
    process.env.LPM_SRC = 'value';
    parse(
      '#env\nLPM_TEST_VAR = keep${LPM_SRC\nLPM_AFTER = later'
    );

    expect(process.env.LPM_TEST_VAR).toBeUndefined();
    expect(process.env.LPM_AFTER).toBeUndefined();
    delete process.env.LPM_SRC;
  });

  it('rewrites with ${NAME/pat/repl} pairs, later pairs first', () => {
    process.env.LPM_SRC = 'aaXcc';
    parse('#env\nLPM_TEST_VAR = ${LPM_SRC/aa/bb/cc/dd}');
    expect(process.env.LPM_TEST_VAR).toBe('bbXdd');

    delete process.env.LPM_TEST_VAR;
    delete process.env.LPM_SRC;
  });

  it('allows an empty replacement without the second slash', () => {
    process.env.LPM_SRC = 'a:b:c';
    parse('#env\nLPM_TEST_VAR = ${LPM_SRC/:}');
    expect(process.env.LPM_TEST_VAR).toBe('abc');

    delete process.env.LPM_TEST_VAR;
    delete process.env.LPM_SRC;
  });

  it('sees variables defined earlier in the same file', () => {
    parse('#env\nLPM_A = one\nLPM_TEST_VAR = ${LPM_A} two');
    expect(process.env.LPM_TEST_VAR).toBe('one two');

    delete process.env.LPM_TEST_VAR;
    delete process.env.LPM_A;
  });
});

describe('#line-edit section', () => {
  it('rebinds supported editing keys', () => {
    parse('#line-edit\n^H backspace\n^N down\n^G abort');

    expect(translateEditKey('\x08')).toBe('\x7F');
    expect(translateEditKey('\x0E')).toBe('\x1B[B');
    expect(translateEditKey('\x07')).toBe('\x03');
    expect(translateEditKey('a')).toBe('a');
  });

  it('accepts og edit names our prompts cannot honor', () => {
    parse('#line-edit\n^W word-left');
    expect(search.message).toBe('');
    expect(translateEditKey('\x17')).toBe('\x17');
  });

  it('reports unknown edit actions', () => {
    parse('#line-edit\n^W zigzag');
    expect(search.message).toBe('test: line 2: unknown action: "zigzag"');
  });
});

describe('#stop and #version', () => {
  it('discards the built-in bindings with #stop', () => {
    parse('q quit\n#stop');
    expect(userStop()).toBe(true);
  });

  it('guards lines with #version, like og at 707', () => {
    parse('#version >= 600 x quit\n#version < 600 y quit');

    expect(userBinding('x')?.action).toBe('EXIT');
    expect(userBinding('y')).toBeUndefined();
  });

  it('reports a bad #version operator', () => {
    parse('#version ~600 x quit');
    expect(search.message).toBe(
      "test: line 1: invalid operator '~' in #version line"
    );
  });
});

describe('binary lesskey files', () => {
  /** Builds a new-format binary: "\0M+G" + sections + "x" + "End". */
  function binary(...sections: number[][]): Buffer {
    const bytes = [0x00, 0x4D, 0x2B, 0x47];

    for (const section of sections) bytes.push(...section);

    bytes.push(0x78, 0x45, 0x6E, 0x64);
    return Buffer.from(bytes);
  }

  /** Wraps a table body in a typed section with its gint length. */
  const section = (type: string, body: number[]): number[] =>
    [type.charCodeAt(0), body.length % 64, Math.floor(body.length / 64),
      ...body];

  it('reads command bindings from the new format', () => {
    // "x" -> A_QUIT(24); "P" -> A_GOLINE(17)|A_EXTRA with extra "5"
    parseLesskeyBinary(binary(section('c', [
      0x78, 0x00, 24,
      0x50, 0x00, 17 | 0x80, 0x35, 0x00,
    ])));

    expect(userBinding('x')?.action).toBe('EXIT');
    expect(userBinding('P')).toEqual({
      action: 'FIRST_LINE',
      key: undefined,
      extra: '5',
    });
  });

  it('translates SK special key blobs to terminal sequences', () => {
    // SK blob: SK_SPECIAL_KEY, SK_UP_ARROW(3), 6, 1, 1, 1
    parseLesskeyBinary(binary(section('c', [
      0x0B, 3, 6, 1, 1, 1, 0x00, 24,
    ])));

    expect(userBinding('\x1B[A')?.action).toBe('EXIT');
  });

  it('reads edit and var sections', () => {
    parseLesskeyBinary(binary(
      // "^H" -> EC_BACKSPACE(1)
      section('e', [0x08, 0x00, 1]),
      // LPMBIN = yes (EV_OK|A_EXTRA marker 0x81)
      section('v', [
        0x4C, 0x50, 0x4D, 0x42, 0x49, 0x4E, 0x00, 0x81,
        0x79, 0x65, 0x73, 0x00,
      ])
    ));

    expect(translateEditKey('\x08')).toBe('\x7F');
    expect(process.env.LPMBIN).toBe('yes');
    delete process.env.LPMBIN;
  });

  it('honors a compiled #stop', () => {
    // an empty entry with A_END_LIST(103)
    parseLesskeyBinary(binary(section('c', [0x00, 103])));
    expect(userStop()).toBe(true);
  });

  it('reads the old raw table format', () => {
    parseLesskeyBinary(Buffer.from([0x78, 0x00, 24]));
    expect(userBinding('x')?.action).toBe('EXIT');
  });

  it('ignores files with a broken end magic', () => {
    parseLesskeyBinary(Buffer.from([0x00, 0x4D, 0x2B, 0x47, 0x78]));
    expect(userBinding('x')).toBeUndefined();
  });

  it('falls back to the $LESSKEY binary without a source file', () => {
    const file = path.join(dir, 'compiled.less');
    fs.writeFileSync(file, binary(section('c', [0x78, 0x00, 24])));

    process.env.LESSKEYIN = path.join(dir, 'no-such-source');
    process.env.LESSKEY = file;

    loadLesskey();
    expect(userBinding('x')?.action).toBe('EXIT');
    delete process.env.LESSKEY;
  });
});

describe('loadLesskey', () => {
  it('reads the file named by $LESSKEYIN', () => {
    const file = path.join(dir, 'keys');
    fs.writeFileSync(file, 'x quit\n');
    process.env.LESSKEYIN = file;

    loadLesskey();
    expect(userBinding('x')?.action).toBe('EXIT');
  });

  it('prefers $LESSKEY_CONTENT bindings over the file, like og', () => {
    const file = path.join(dir, 'keys2');
    fs.writeFileSync(file, 'x help\ny quit\n');
    process.env.LESSKEYIN = file;
    process.env.LESSKEY_CONTENT = 'x quit';

    loadLesskey();
    expect(userBinding('x')?.action).toBe('EXIT');
    expect(userBinding('y')?.action).toBe('EXIT');
  });

  it('skips everything under $LESSNOCONFIG', () => {
    process.env.LESSKEY_CONTENT = 'x quit';
    process.env.LESSNOCONFIG = '1';

    loadLesskey();
    expect(userBinding('x')).toBeUndefined();
  });
});
