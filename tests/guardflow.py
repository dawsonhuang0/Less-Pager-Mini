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
generate. Nothing here touches og: og has no such option, and og's own
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
    """Enough of a terminal to know what the bottom row says."""

    def __init__(self):
        self.rows = [[' '] * COLS for _ in range(ROWS)]
        self.r = self.c = 0

    def feed(self, data):
        text = data.decode('latin-1', 'replace')
        i = 0

        while i < len(text):
            ch = text[i]

            if ch == '\x1b':
                i += self._escape(text[i:])
                continue

            if ch == '\r':
                self.c = 0
            elif ch == '\n':
                self.r = min(ROWS - 1, self.r + 1)
            elif ch == '\b':
                self.c = max(0, self.c - 1)
            elif ch != '\x07':
                if self.r < ROWS and self.c < COLS:
                    self.rows[self.r][self.c] = ch
                self.c += 1

            i += 1

    def _escape(self, text):
        csi = re.match(r'\x1b\[([0-9;?]*)([a-zA-Z])', text)

        if csi:
            params, final = csi.group(1), csi.group(2)

            if final == 'H':
                nums = [int(n) for n in params.split(';') if n] or [1]
                self.r = nums[0] - 1
                self.c = (nums[1] - 1) if len(nums) > 1 else 0
            elif final == 'K':
                for x in range(self.c, COLS):
                    self.rows[self.r][x] = ' '
            elif final == 'J':
                self.rows = [[' '] * COLS for _ in range(ROWS)]
                self.r = self.c = 0

            return csi.end()

        other = re.match(r'\x1b[()][A-Z0-9]|\x1b[=><]', text)

        return other.end() if other else 1

    def bottom(self):
        return ''.join(self.rows[ROWS - 1]).rstrip()


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
