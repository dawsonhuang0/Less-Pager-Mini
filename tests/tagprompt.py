#!/usr/bin/env python3
"""What a -t session does, measured against the binary.

A tag session has two lists in it at once - the tags less found and
the files it has open - and the prompt has to say which one it is
reporting. less answers with ntags(): while a tag list is loaded it
counts tags, and `?x` is FALSE outright (prompt.c:265) so no "Next:"
appears beside a tag number. Naming a file by hand ends the tag list
entirely - A_EXAMINE closes with cleantags() (command.c:318) - and
from there the prompt counts files again.

A STARTUP -t also has four ways to fail, and less quit(QUIT_ERROR)s on
every one (main.c:415-428) - before the errmsgs gate and before
term_init, so the message is all there is: no screen, no "press
RETURN", exit 1. The runtime t/T and the -t prompt report and stay.

    python3 tests/tagprompt.py

Nothing is hardcoded: every case runs less/less and dist/cli.js over
the same fixture and their answers must match. The binary is the
answer, so this cannot rot into asserting our own old behaviour.

None of it is testable in process. What the FILE LIST holds at startup
is built only by the real -t path, the counting is read off the bottom
row, and the failure cases are about bytes nobody wrote.
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

# tags that fail in each of less's three gates, plus one whose pattern
# is the FIRST line of its file - the shape that rang a bell, because
# the jump landed where the screen already was and nothing had told it
# the file was freshly opened
EXTRA_TAGS = (
    'lost\tmissing.txt\t/^x$/\n'
    'nopat\ta.txt\t/^never here$/\n'
)


def fixtures(root):
    with open(os.path.join(root, 'a.txt'), 'w') as handle:
        handle.write('a one\na two\n')

    with open(os.path.join(root, 'b.txt'), 'w') as handle:
        handle.write('b one\nb two\n')

    # the same tag name in two files, so ntags() is 2
    with open(os.path.join(root, 'tags'), 'w') as handle:
        handle.write('mytag\ta.txt\t/^a one$/\nmytag\tb.txt\t/^b one$/\n'
                     + EXTRA_TAGS)


def raw(binary, args, cwd, seconds=1.6):
    """Everything written, and how the process ended.

    Bytes rather than a screen: what the failure cases are about is
    that nothing is painted at all, which a rendered screen cannot
    show - and a stray bell only exists in the byte stream.
    """
    pid, fd = pty.fork()

    if pid == 0:
        os.chdir(cwd)
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSHISTFILE='/dev/null', LESSNOCONFIG='1',
                          LESSKEY='/nonexistent', LESSKEYIN='/nonexistent',
                          LINES=str(ROWS), COLUMNS=str(COLS))
        os.execvp(binary[0], binary + args)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    out = b''
    end = time.time() + seconds
    alive = True

    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], max(0, end - time.time()))

        if not ready:
            continue

        try:
            data = os.read(fd, 65536)
        except OSError:
            alive = False
            break

        if not data:
            alive = False
            break

        out += data

    status = None

    if not alive:
        try:
            _, status = os.waitpid(pid, 0)
        except OSError:
            pass

    if alive:
        try:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        except OSError:
            pass

    try:
        os.close(fd)
    except OSError:
        pass

    if alive:
        return 'running', out

    code = os.waitstatus_to_exitcode(status) if status is not None else '?'

    return f'exit {code}', out


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


# every way a startup -t can fail, and the one way it works. The
# whole byte stream is compared: less prints the message and is gone,
# with no terminal init behind it - and none of these may ring, which
# `-t` on a tag at the top of its file used to do
FAILURES = [
    ('tag not in the tags file', ['-t', 'nope']),
    ('no tags file at all', ['-T', 'nosuchtags', '-t', 'mytag']),
    ('the tag names a missing file', ['-t', 'lost']),
    ('the pattern is not in the file', ['-t', 'nopat']),
]


def rings(binary, root):
    """Whether the startup jump rang.

    `mytag` is the FIRST line of a.txt, so the jump lands where the
    screen already is - and jump_loc's already-there branch is the one
    that rings. less's edit_ifile pos_clear()s the table before it, so
    onscreen() cannot return that branch after an edit, and less is
    silent. Ours rang until the tag jump said the file was fresh.
    """
    _, out = raw(binary, ['-t', 'mytag'], root, 1.2)

    return b'\x07' in out


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

    theirs = rings(OG, root)
    ours = rings(OURS, root)
    ok = theirs == ours
    bad += not ok
    print(f'{"ok  " if ok else "FAIL"} the startup jump does not ring')
    print(f'      bell={ours}')

    if not ok:
        print(f'       less bell={theirs}')

    for title, args in FAILURES:
        their_end, their_out = raw(OG, args, root)
        our_end, our_out = raw(OURS, args, root)
        ok = (their_end, their_out) == (our_end, our_out)
        bad += not ok
        print(f'{"ok  " if ok else "FAIL"} {title}')
        print(f'      {our_end:<10} {our_out[:70]!r}')

        if not ok:
            print(f'       {"less":<10} {their_end} {their_out[:70]!r}')

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
