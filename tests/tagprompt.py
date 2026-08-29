#!/usr/bin/env python3
"""What a -t session's prompt counts, measured against the binary.

A tag session has two lists in it at once - the tags less found and
the files it has open - and the prompt has to say which one it is
reporting. less answers with ntags(): while a tag list is loaded it
counts tags, and `?x` is FALSE outright (prompt.c:265) so no "Next:"
appears beside a tag number. Naming a file by hand ends the tag list
entirely - A_EXAMINE closes with cleantags() (command.c:318) - and
from there the prompt counts files again.

    python3 tests/tagprompt.py

Nothing is hardcoded: every case runs less/less and dist/cli.js over
the same fixture and the bottom rows must match. The binary is the
answer, so this cannot rot into asserting our own old behaviour.

None of it is testable in process. Two of the three cases are about
what the FILE LIST holds at startup, which only the real -t path
builds, and all three are read off the bottom row.
"""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time

import pyte

ROWS, COLS = 24, 80
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OURS = ['node', os.path.join(ROOT, 'dist', 'cli.js')]
OG = [os.path.join(ROOT, 'less', 'less')]

CASES = [
    # ONE ifile, not two: less's -t opens the tag's file and nothing
    # else. Ours paged an empty value to get a session started and
    # left its `-` entry in front, so every count was one too many
    (':e ends the tag list', ['-t', 'mytag'], [':e b.txt\n', ':p']),
    # ?x is false while tags are loaded, so no "Next:" beside a tag
    ('no Next beside a tag number', ['-t', 'mytag'], ['T', ':p']),
    ('the same under -M', ['-t', 'mytag'], ['T', '-M\n', ':p']),
    # the ordinary shape, so a regression in the common path shows
    ('a plain tag session', ['-t', 'mytag'], ['G', ':n']),
]


def fixtures(root):
    with open(os.path.join(root, 'a.txt'), 'w') as handle:
        handle.write('a one\na two\n')

    with open(os.path.join(root, 'b.txt'), 'w') as handle:
        handle.write('b one\nb two\n')

    # the same tag name in two files, so ntags() is 2
    with open(os.path.join(root, 'tags'), 'w') as handle:
        handle.write('mytag\ta.txt\t/^a one$/\nmytag\tb.txt\t/^b one$/\n')


def bottom(binary, args, steps, cwd):
    """The bottom row after each step, typed key by key."""
    pid, fd = pty.fork()

    if pid == 0:
        os.chdir(cwd)
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSHISTFILE='/dev/null', LESSNOCONFIG='1',
                          LESSKEY='/nonexistent', LESSKEYIN='/nonexistent',
                          LINES=str(ROWS), COLUMNS=str(COLS))
        os.execvp(binary[0], binary + args)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.Stream(screen)
    gone = []

    def drain(seconds):
        end = time.time() + seconds

        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], max(0, end - time.time()))

            if not ready:
                continue

            try:
                data = os.read(fd, 65536)
            except OSError:
                gone.append(True)
                return

            if not data:
                gone.append(True)
                return

            stream.feed(data.decode('utf8', 'replace'))

    drain(1.0)
    rows = []

    for keys in steps:
        if gone:
            rows.append('EXITED')
            continue

        # one key at a time: a burst reaches the prompt hold, which
        # collapses the very frames this reads
        for char in keys:
            try:
                os.write(fd, char.encode())
            except OSError:
                gone.append(True)
                break

            drain(0.15)

        drain(0.7)
        rows.append('EXITED' if gone else screen.display[ROWS - 1].rstrip())

    try:
        os.kill(pid, signal.SIGKILL)
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass

    return rows


def run():
    if not os.path.exists(OURS[1]):
        print(f'missing {OURS[1]} - run npm run build')
        return 2

    if not os.path.exists(OG[0]):
        print(f'missing {OG[0]} - nothing to measure against')
        return 2

    root = tempfile.mkdtemp(prefix='lpm-tagprompt-')
    fixtures(root)
    bad = 0

    for title, args, steps in CASES:
        theirs = bottom(OG, args, steps, root)
        ours = bottom(OURS, args, steps, root)
        ok = theirs == ours
        bad += not ok
        print(f'{"ok  " if ok else "FAIL"} {title}')

        for keys, want, got in zip(steps, theirs, ours):
            mark = ' ' if want == got else '!'
            print(f'     {mark} {keys!r:<16} {got!r}')

            if mark == '!':
                print(f'       {"":<16} less {want!r}')

    print('all clear' if not bad else f'{bad} case(s) wrong')

    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(run())
