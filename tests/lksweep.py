#!/usr/bin/env python3
"""Compile lesskey sources with ours and with GNU lesskey, compare bytes.

The pager needs a compiler for --edit-lesskey, which has to write a
binary back where it found one. og ships the real thing in the vendored
tree, so the port can be checked the only way worth checking: byte for
byte, on the same source.

og's lesskey writes NOTHING when a source has errors ("N errors; no
output produced", lesskey.c:316), so a source that should fail is
compared on its MESSAGES instead.

usage:  python3 tests/lksweep.py          (from the repo root)
"""
import os
import re
import subprocess
import sys
import tempfile

LESSKEY = 'less/lesskey'
DRIVER = '''
import fs from 'fs';
import { compileLesskey } from '%s/src/features/lesskeyCompile';
const { data, errors } = compileLesskey(
  fs.readFileSync(process.argv[2], 'utf8'), 707);
if (data && !errors.length) fs.writeFileSync(process.argv[3], data);
for (const e of errors) process.stderr.write(e + '\\n');
'''

CASES = [
    ('plain binding',       '#command\nx quit\n'),
    ('several keys',        '#command\nj forw-line\nk back-line\nZZ quit\n'),
    ('control notation',    '#command\n^G repaint\n^X^X quit\n'),
    ('literal control-K',   '#command\n^K quit\n\\13 help\n'),
    ('escape sequence',     '#command\n\\e[15~ forw-search\n'),
    ('extra string',        '#command\nzz quit 5j\nq forw-search ERROR\\n\n'),
    ('octal and literals',  '#command\n\\40 forw-screen\n\\\\ quit\n\\# help\n\\^ repaint\n'),
    ('special keys',        '#command\n\\ku back-line\n\\kd forw-line\n\\kx quit\n'),
    ('keypad keys',         '#command\n\\kp1 goto-line\n\\kp* quit\n\\kpe help\n'),
    ('modified keys',       '#command\n\\k^d forw-line\n\\k+u back-line\n\\kL no-scroll\n'),
    ('line-edit section',   '#line-edit\n\\kl left\n\\kr right\n^A home\n'),
    ('section switching',   '#command\nx quit\n#line-edit\ny up\n#command\nz help\n'),
    ('env assignment',      '#env\nLESS = -R\nEDITOR = vim\n'),
    ('env append',          '#env\nA = 1\nA += 2\nA += 3\n'),
    ('env append first',    '#env\nFOO += bar\n'),
    ('stop directive',      '#command\nx quit\n#stop\ny help\n'),
    ('version guards',      '#version > 600\na quit\n#version < 600\nb quit\n#version = 707\nc help\n'),
    ('version 2-char ops',  '#version >= 707\na quit\n#version <= 706\nb quit\n#version != 1\nc help\n'),
    ('comments and blanks', '# a comment\n\n   x quit # trailing\n'),
    ('synonym names',       '#command\na end\nb goto-end\nc firstcmd\nd first-cmd\n'),
    ('extra is not xlated', '#command\nx forw-line \\ku\ny forw-line \\e[A\n'),
    ('mouse introducers',   '#command\na mouse\nb mouse6\nc digit\n'),
    ('every command name',  None),
    # these must FAIL, and fail the same way
    ('unknown action',      '#command\nx blah\ny quit\n'),
    ('missing action',      '#command\nx\ny quit\n'),
    ('bad special key',     '#command\n\\kz quit\n'),
    ('missing equals',      '#env\nBAZ\n'),
    ('bad version op',      '#version ~ 600\nx quit\n'),
    ('non-numeric version', '#version > abc\nx quit\n'),
]


def every_name():
    """One binding per name og knows, so no entry goes unchecked."""
    import re as _re
    src = open('less/lesskey_parse.c').read()
    body = _re.search(r'cmdnames\[\]\s*=\s*\{(.*?)\{ NULL', src, _re.S)
    names = _re.findall(r'\{\s*"([^"]+)"', body.group(1))

    # a distinct 2-char key per name, so nothing collides
    lines = ['#command']
    for i, name in enumerate(names):
        lines.append('%s%s %s' % (chr(ord('a') + i // 26),
                                  chr(ord('a') + i % 26), name))
    return '\n'.join(lines) + '\n'


def og_errors(text):
    """og's stderr, minus the deprecation note and the error count."""
    drop = ('NOTE: lesskey', 'It is no longer necessary', 'when using less',
            'errors; no output produced')
    return [line for line in text.splitlines()
            if line.strip() and not any(d in line for d in drop)]


def main():
    if not os.path.exists(LESSKEY):
        sys.exit('%s not found: build the vendored less first' % LESSKEY)

    root = os.getcwd()
    tmp = tempfile.mkdtemp(prefix='lksweep-')
    driver = os.path.join(tmp, 'compile.ts')
    open(driver, 'w').write(DRIVER % root)

    same = 0

    for name, source in CASES:
        if source is None:
            source = every_name()

        src = os.path.join(tmp, 'in.src')
        og_out = os.path.join(tmp, 'og.bin')
        us_out = os.path.join(tmp, 'us.bin')

        open(src, 'w').write(source)
        for stale in (og_out, us_out):
            if os.path.exists(stale):
                os.remove(stale)

        og = subprocess.run([LESSKEY, '-o', og_out, src],
                            capture_output=True, text=True)
        us = subprocess.run(['npx', 'tsx', driver, src, us_out],
                            capture_output=True, text=True)

        og_wrote = os.path.exists(og_out)
        us_wrote = os.path.exists(us_out)

        if og_wrote and us_wrote:
            a, b = open(og_out, 'rb').read(), open(us_out, 'rb').read()
            ok = a == b
            detail = '' if ok else 'og=%d ours=%d bytes' % (len(a), len(b))
        elif not og_wrote and not us_wrote:
            # both refused: the messages have to agree, minus the
            # file-name prefix og puts in front of every one
            a = [re.sub(r'^.*?: (line \d+: )', r'\1', l)
                 for l in og_errors(og.stderr)]
            b = og_errors(us.stderr)
            ok = a == b
            detail = '' if ok else '%r vs %r' % (a, b)
        else:
            ok = False
            detail = 'og wrote %s, ours wrote %s' % (og_wrote, us_wrote)

        same += ok
        print('%-22s %s %s' % (name, 'same' if ok else 'DIFFER', detail))

    print('%d/%d identical' % (same, len(CASES)))
    return 0 if same == len(CASES) else 1


if __name__ == '__main__':
    sys.exit(main())
