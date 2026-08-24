#!/usr/bin/env python3
"""
How MANY bytes a scroll costs, against less, on wrapped lines.

framesweep compares the screen, and cannot see this: a full repaint
paints exactly what a one-row scroll paints. The difference is only in
what was sent - 1965 bytes against less's 104 - so the count is the
measurement.

    python3 tests/scrollbytes.py

Scrolling UP is the direction that matters. The top crosses a wrapped
line's boundary every few rows, and the block engine leaves config.row
at 0 throughout, so the top's own arithmetic once read the sub-row
rising as a FORWARD move and repainted the screen for it.

A per-keystroke count within TOLERANCE of less's is a delta scroll; a
multiple of it is a repaint. The absolute numbers differ by a constant
- our synchronised-output markers - so the test is the ratio.
"""

import fcntl
import os
import pty
import select
import shutil
import struct
import sys
import termios
import time

ROWS, COLS = 24, 80
HERE = os.path.dirname(os.path.abspath(__file__))
LESS = os.path.join(os.path.dirname(HERE), 'less', 'less')
CLI = os.path.join(os.path.dirname(HERE), 'dist', 'cli.js')
FIXTURE = os.path.join(HERE, 'w2.txt')

# ours carries ESC[?2026h/l around each paint, which less does not
TOLERANCE = 40


def counts(argv, keys, presses):
    pid, fd = pty.fork()

    if pid == 0:
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSKEY='/nonexistent', LESSKEYIN='/nonexistent')
        os.execv(argv[0], argv[1:])

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))

    def drain(seconds):
        end, out = time.time() + seconds, b''

        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], max(0, end - time.time()))

            if not ready:
                continue

            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break

            if not chunk:
                break

            out += chunk

        return out

    drain(1.4)
    os.write(fd, keys)
    drain(1.2)
    sizes = []

    for _ in range(presses):
        os.write(fd, b'k')
        sizes.append(len(drain(0.85)))

    try:
        os.write(fd, b'q')
        drain(0.3)
        os.close(fd)
    except OSError:
        pass

    return sizes


def main():
    if not os.path.exists(FIXTURE):
        print(f'missing {FIXTURE}')
        return 2

    if not os.path.exists(LESS):
        print(f'missing {LESS} - the vendored less is not built')
        return 2

    node = shutil.which('node')
    theirs = counts([LESS, 'less', FIXTURE], b'G', 8)
    ours = counts([node, 'node', CLI, FIXTURE], b'G', 8)

    print(f'  less : {theirs}')
    print(f'  ours : {ours}')

    bad = 0

    for i, (t, o) in enumerate(zip(theirs, ours), 1):
        if o > t + TOLERANCE:
            bad += 1
            print(f'  FAIL k#{i}: {o} bytes against less\'s {t} '
                  f'- a repaint where less scrolls')

    print('\nall clear' if not bad else f'\n{bad} scroll(s) repainted')

    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
