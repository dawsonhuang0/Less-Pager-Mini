#!/usr/bin/env python3
"""
The help screens and the lesskey view, on a real terminal.

Three things can be on screen over a file - the command help, the
lesskey syntax page, and the lesskey view - and each is a stash over
the same session. What matters is that they compose: opening one from
another must not leave the last one's mode on, and every q must undo
exactly one thing the user opened.

    python3 tests/helpflow.py

None of it is testable in-process. The state lives in module globals
that the pager only puts together on a terminal, and the symptom is
which prompt is on the bottom row - so the prompt is what this reads.
Nothing here touches less: less has one help file, no lesskey page and
no view, so there is no parity to measure.
"""

import fcntl
import os
import pty
import re
import select
import struct
import sys
import termios
import time

ROWS, COLS = 24, 80
KEYS = '/tmp/lpm-helpflow.lesskey'
FILE = 'tests/lines.txt'

# an expected screen of QUIT means the pager should be gone: there was
# nothing left under the last thing q closed
QUIT = 'the pager exits'

# what is on screen, by something only that screen says
MARKS = [
    ('command help', 'Commands marked with'),
    ('lesskey help', 'means operator'),
    ('lesskey view', 'forw-line'),
    ('the file', 'line 1'),
]

FLOWS = [
    # asking for the view CLOSES the page it was asked from, so what is
    # under it is the file - not the help, which nobody is reading any
    # more
    ('the view, opened from the command help', [FILE], [
        ('h', 'h', 'command help'),
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('q', 'q', 'the file'),
    ]),
    ('the view, opened from the lesskey help', [FILE], [
        ('--lesskey-help', '--lesskey-help\n', 'lesskey help'),
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('q', 'q', 'the file'),
    ]),
    # -? is the session's own input rather than an overlay, and asking
    # for the view CLOSES it: there is nothing left for q to go back to
    ('the view, opened from -?', ['-?'], [
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('q', 'q', QUIT),
    ]),
    ('the view, opened from the file', [FILE], [
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('q', 'q', 'the file'),
    ]),
    # h opens a real overlay from INSIDE the view, so the two can be
    # stacked in either order - and q has to undo the LAST one either
    # way. A fixed unwind order took the view out from under the help
    # on top of it, leaving the file's text under a "HELP --" prompt
    ('help opened from inside the view', [FILE], [
        ('h', 'h', 'command help'),
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('h', 'h', 'command help'),
        # this h IS over the view, so it goes back to it - and the one
        # the view was opened from closed on the way in
        ('q', 'q', 'lesskey view'),
        ('q', 'q', 'the file'),
    ]),
    # the same ladder from a --help session: h over the view still has
    # somewhere to go back to, and only the last q finds nothing
    ('help opened from the view, from -?', ['-?'], [
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('h', 'h', 'command help'),
        ('q', 'q', 'lesskey view'),
        ('q', 'q', QUIT),
    ]),
    # asking for the view while a help page is over it: the view is
    # already underneath, so closing the page is the whole request
    ('the view asked for again, from a page over it', [FILE], [
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('h', 'h', 'command help'),
        ('--view-lesskey', '--view-lesskey\n', 'lesskey view'),
        ('q', 'q', 'the file'),
    ]),
    ('switching pages inside help', [FILE], [
        ('h', 'h', 'command help'),
        ('--lesskey-help', '--lesskey-help\n', 'lesskey help'),
        ('h', 'h', 'command help'),
        ('q', 'q', 'the file'),
    ]),
]


def where(text):
    """Which screen the pager just painted, by its own words."""
    for name, mark in MARKS:
        if mark in text:
            return name

    return '(unrecognised)'


def held_prompt(text):
    """The bottom row, which is where a stale mode shows itself."""
    rows = [row for row in text.replace('\r', '\n').split('\n') if row.strip()]

    return rows[-1][:44] if rows else ''


def flow(title, args, steps):
    pid, fd = pty.fork()

    if pid == 0:
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSKEY='/nonexistent', LESSKEYIN=KEYS)
        os.execvp('node', ['node', 'dist/cli.js', *args])

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    gone = []

    def drain(seconds):
        end, out = time.time() + seconds, b''

        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], max(0, end - time.time()))

            if not ready:
                continue

            try:
                chunk = os.read(fd, 65536)
            except OSError:
                gone.append(True)
                break

            if not chunk:
                gone.append(True)
                break

            out += chunk

        return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '',
                      out.decode('latin-1', 'replace'))

    print(title)
    drain(1.2)
    bad = 0

    for label, keys, want in steps:
        if gone:
            print(f'  FAIL {label:<16} -> the pager had already exited')
            bad += 1
            continue

        try:
            os.write(fd, keys.encode('latin-1'))
        except OSError:
            gone.append(True)

        text = drain(1.6)
        got = QUIT if gone else where(text)
        ok = got == want

        if not ok:
            bad += 1

        print(f'  {"ok  " if ok else "FAIL"} {label:<16} -> {got:<14}'
              f' | {held_prompt(text)!r}')

        if not ok:
            print(f'       {"":<16}    want {want}')

    try:
        os.write(fd, b'q')
        drain(0.4)
        os.close(fd)
    except OSError:
        pass

    print()

    return bad


def run():
    if not os.path.exists(FILE):
        print(f'missing {FILE}')
        return 2

    # a lesskey with something recognisable in it, so the view is
    # telling apart from the page that documents it
    with open(KEYS, 'w', encoding='utf-8') as handle:
        handle.write('j forw-line\nk back-line\n')

    bad = sum(flow(*case) for case in FLOWS)
    print('all clear' if not bad else f'{bad} step(s) wrong')

    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(run())
