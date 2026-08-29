#!/usr/bin/env python3
"""This build against the last one of OURS, on a real terminal.

Every other sweep here measures us against less. That is the right
question for parity and the wrong one for regressions: v1.13.0 moved
the keyboard, the capabilities and the wheel onto mechanisms less
uses, was more correct about less in all three, and shipped a pager
that could not take a keystroke on Windows. Nothing went red, because
nothing was comparing us to the last version that worked.

This does. It builds a previous tag into a cached worktree, runs the
same keys through both builds on a pty, and diffs the settled screen.

    python3 tests/regress.py                  # against the newest tag
    python3 tests/regress.py v1.12.1          # against any ref
    python3 tests/regress.py v1.15.1 wheel    # one case
    REGRESS_SHOW=1 python3 tests/regress.py   # print both screens

A diff is not automatically a bug - a deliberate fix shows up here too,
and should. What this buys is that you SEE it and decide, instead of
finding out on a platform the suite cannot reach.

What it cannot see is the platform itself. Both builds run on THIS
machine, so a Windows-only break is invisible here exactly as it was
in v1.13.0. Run it on the machine you are worried about.

Needs pyte (pip3 install pyte).
"""

import fcntl
import os
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

try:
    import pyte
except ImportError:
    sys.exit('regress needs pyte: pip3 install pyte')

import pty

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TESTS)
ROWS, COLS = 24, 80

# The corpus is chosen from what has actually been amputated before,
# plus every path the current session touched. Each case is
#   (label, args, keys sent one at a time)
CASES = [
    # the first paint, which is where a missing capability shows
    ('startup', ['lines.txt'], []),
    ('scroll', ['lines.txt'], ['j', 'j', 'j']),
    ('page', ['lines.txt'], [' ', 'b']),
    ('bottom and back', ['lines.txt'], ['G', 'g']),
    # arrows and the wheel: dead in v1.13.0 on Windows, and the wheel
    # everywhere its terminal defaults alternate scroll off
    ('arrow keys', ['lines.txt'], ['\x1b[B', '\x1b[B', '\x1b[A']),
    ('arrow keys, application', ['lines.txt'], ['\x1bOB', '\x1bOB']),
    ('wheel burst', ['w2.txt'], ['\x1bOB'] * 12),
    ('page keys', ['lines.txt'], ['\x1b[6~', '\x1b[5~']),
    # prompts and messages
    ('search', ['lines.txt'], ['/', 'l', 'i', 'n', 'e', '\r']),
    ('search miss', ['lines.txt'], ['/', 'z', 'z', 'z', '\r']),
    ('file info', ['lines.txt'], ['=']),
    # the help page, rebuilt this session
    ('help in and out', ['lines.txt'], ['h', 'q']),
    ('help then examine', ['lines.txt'], ['h', ':', 'e', ' ', 'w', '2',
                                          '.', 't', 'x', 't', '\r']),
    ('help then step', ['lines.txt'], ['h', ':', 'n']),
    # a gate that waits for RETURN - warnReturn, touched this session
    ('unknown option gate', ['--bogus-option', 'lines.txt'], ['\r']),
    ('missing file', ['nosuchfile.txt'], ['\r']),
    # options that change the whole paint
    ('-N line numbers', ['-N', 'lines.txt'], ['j']),
    ('-S chop', ['-S', 'w2.txt'], ['j']),
    ('-X no init', ['-X', 'lines.txt'], ['j']),
    ('dumb terminal', ['lines.txt'], ['j']),
]

DUMB = {'dumb terminal': 'dumb'}


def build(ref):
    """A cached build of `ref`, as a path to its dist/cli.js."""
    work = f'/tmp/lmn-regress-{ref.replace("/", "-")}'
    cli = os.path.join(work, 'dist', 'cli.js')

    if os.path.exists(cli):
        return cli

    if not os.path.exists(work):
        subprocess.run(['git', 'worktree', 'add', '-q', '--detach', work, ref],
                       cwd=ROOT, check=True)

    modules = os.path.join(work, 'node_modules')

    if not os.path.exists(modules):
        os.symlink(os.path.join(ROOT, 'node_modules'), modules)

    print(f'building {ref} in {work} ...')
    subprocess.run(['npx', 'tsc', '--removeComments', '--declaration', 'false'],
                   cwd=work, check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not os.path.exists(cli):
        sys.exit(f'could not build {ref}')

    return cli


def capture(cli, args, keys, term):
    """The settled screen after each key, on a real pty."""
    pid, fd = pty.fork()

    if pid == 0:
        os.environ.update(TERM=term, LESS='', LESSHISTFILE='/dev/null',
                          LESSNOCONFIG='1', LESSKEY='/nonexistent',
                          LESSKEYIN='/nonexistent',
                          LINES=str(ROWS), COLUMNS=str(COLS))
        os.chdir(TESTS)
        os.execvp('node', ['node', cli, *args])

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

    drain(0.9)

    # one key at a time: a burst reaches the prompt hold, and what it
    # collapses is exactly the frames being compared
    for key in keys:
        if gone:
            break

        try:
            os.write(fd, key.encode('latin-1'))
        except OSError:
            break

        drain(0.3)

    drain(0.3)

    try:
        os.write(fd, b'q')
        drain(0.2)
    except OSError:
        pass

    # killed rather than waited for: a case can end at a gate that `q`
    # is not the answer to, and waitpid on a child still sitting there
    # hangs the whole sweep
    try:
        os.kill(pid, signal.SIGKILL)
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass

    return tuple(line.rstrip() for line in screen.display)


def show(label, rows):
    print(f'    --- {label}')

    for row in rows:
        print(f'    |{row}')


def run():
    args = [a for a in sys.argv[1:]]
    ref = args.pop(0) if args and args[0].startswith('v') else None
    only = args[0] if args else None

    if ref is None:
        tags = subprocess.run(['git', 'tag', '--sort=-v:refname'], cwd=ROOT,
                              capture_output=True, text=True).stdout.split()
        ref = tags[0] if tags else None

        if ref is None:
            sys.exit('no tags to compare against; name a ref')

    here = os.path.join(ROOT, 'dist', 'cli.js')

    if not os.path.exists(here):
        sys.exit(f'missing {here} - run npm run build')

    there = build(ref)
    print(f'this build vs {ref}\n')
    bad = 0

    for label, cargs, keys in CASES:
        if only and only not in label:
            continue

        term = DUMB.get(label, 'xterm-256color')
        mine = capture(here, cargs, keys, term)
        theirs = capture(there, cargs, keys, term)
        ok = mine == theirs
        bad += not ok
        print(f'{"ok  " if ok else "DIFF"} {label}')

        if not ok or os.environ.get('REGRESS_SHOW'):
            for n, (a, b) in enumerate(zip(theirs, mine)):
                if a != b:
                    print(f'     row {n}\n       {ref}: {a!r}\n       now:     {b!r}')

            if os.environ.get('REGRESS_SHOW'):
                show(ref, theirs)
                show('now', mine)

    print('\nno change' if not bad else
          f'\n{bad} case(s) differ - read them and decide')

    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(run())
