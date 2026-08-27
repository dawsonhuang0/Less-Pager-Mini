#!/usr/bin/env python3
"""
The --use-js-regexp guard, end to end on a real terminal.

A host RegExp is one synchronous call into the engine, so everything
about this feature is timing: what the bottom row says at one second
and at three, whether one interrupt is enough, and whether the key
answering the question reaches the question. None of that survives a
unit test - the thread the assertions would run on is the thread the
regex has stopped - so it is measured here, through a pty, by reading
the bottom row exactly as a user would.

    python3 tests/guardflow.py

Wants tests/redos-long.txt, which tests/REDOS-PATTERNS.txt says how to
generate. Nothing here touches less: less has no such option, and less's own
answer to a catastrophic pattern is to hang until it finishes.
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

try:
    import pyte
except ImportError:
    sys.exit('guardflow needs pyte: pip3 install pyte')

ROWS, COLS = 24, 80
FIXTURE = 'tests/redos-long.txt'

# what the plan asks for, step by step: the toggle's message holds
# until RETURN; the search says nothing for two seconds and then says
# what it is doing; one interrupt ends it and raises the offer; "y"
# runs the pattern again on the engine that can finish it
EXPECTED = [
    ('startup', None, 1.5, 'redos-long.txt'),
    ('toggle --use-js-regexp', '--use-js-regexp\n', 1.0,
     "Search with JavaScript's RegExp  (press RETURN)"),
    ('RETURN dismisses', '\n', 0.6, ':'),
    ('search, 1.0s in', '/(a+)+b\n', 1.0, ''),
    ('search, 2.5s in', None, 1.5, 'Searching... (interrupt to abort)'),
    ('one ^C', '\x03', 1.5,
     'Pattern too complex.  Try again with POSIX RegExp?'),
    ('y retries on POSIX', 'y', 4.0, 'Pattern not found: (a+)+b  (press RETURN)'),
    ('RETURN', '\n', 0.6, ':'),
    # the one that was reported: the search AFTER a retry used to want
    # two interrupts, because the first was eaten by a match left
    # running from the search before it
    ('search again, 2.5s in', '/(a+)+b\n', 2.5,
     'Searching... (interrupt to abort)'),
    ('one ^C again', '\x03', 1.5,
     'Pattern too complex.  Try again with POSIX RegExp?'),
]


class Screen:
    """The bottom row, through a real terminal emulator.

    This used to be forty lines of hand-rolled escape handling, and it
    had no auto-wrap: past the last column it advanced the column and
    never moved to the next row. The fixture is one 10000-character
    line, so the pager's very first screen wraps and the toy lost track
    of which row was the bottom - it reported the startup step as
    failing while both pagers were printing the file name there
    correctly. Every other sweep in this directory uses pyte; so does
    this one now.
    """

    def __init__(self):
        self.screen = pyte.Screen(COLS, ROWS)
        self.stream = pyte.Stream(self.screen)

    def feed(self, data):
        self.stream.feed(data.decode('latin-1', 'replace'))

    def bottom(self):
        return self.screen.display[ROWS - 1].rstrip()


def run():
    if not os.path.exists(FIXTURE):
        print(f'missing {FIXTURE} - see tests/REDOS-PATTERNS.txt')
        return 2

    pid, fd = pty.fork()

    if pid == 0:
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSKEY='/nonexistent', LESSKEYIN='/nonexistent')
        os.execvp('node', ['node', 'dist/cli.js', FIXTURE])

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    screen = Screen()
    bad = 0

    def drain(seconds):
        end = time.time() + seconds

        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], max(0, end - time.time()))

            if not ready:
                continue

            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return

            if not chunk:
                return

            screen.feed(chunk)

    for label, keys, wait, want in EXPECTED:
        if keys:
            os.write(fd, keys.encode('latin-1'))

        drain(wait)
        got = screen.bottom()
        ok = want in got if want else got == ''

        if not ok:
            bad += 1

        print(f'{"ok  " if ok else "FAIL"} {label:<24} | {got!r}')

        if not ok:
            print(f'{"":>5}{"":<24} | want {want!r}')

    os.write(fd, b'q')
    drain(0.8)
    os.close(fd)

    print('\nall clear' if not bad else f'\n{bad} step(s) wrong')

    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(run())
