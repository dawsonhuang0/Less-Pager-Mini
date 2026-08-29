#!/usr/bin/env python3
"""The help page as a position in the file list, on a real terminal.

The page is not an entry in files.list - there is no file to open,
stat or log - but it IS a place you can be, and files.helpAt is where.
Everything below is a consequence of that one fact, and none of it is
testable in process: the counting shows up on the bottom row, and the
bottom row only exists on a terminal.

    python3 tests/helppage.py

Typed key by key. A burst reaches the prompt hold, which collapses the
frames this reads - the same trap that made a run of this look broken
three times over.

Deliberately NOT less's model. less keeps the -?/--help page as a
FAKE_HELPFILE input file: opening help again from file 2 lands back on
file 1, and q there quits the pager whatever else is open. Ours is one
page per session, wherever it was last opened, and its q is the :p that
spends it.
"""
import os, pty, fcntl, termios, struct, select, time, signal, sys
import shutil
import tempfile
import pyte

ROWS, COLS = 24, 80
QUIT = 'EXITED'
CLI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'dist', 'cli.js')


def bottom(args, steps, cwd):
    """The bottom row after each step; QUIT once the pager is gone."""
    pid, fd = pty.fork()

    if pid == 0:
        os.chdir(cwd)
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSHISTFILE='/dev/null', LESSNOCONFIG='1',
                          LESSKEY='/nonexistent', LESSKEYIN='/nonexistent',
                          LINES=str(ROWS), COLUMNS=str(COLS))
        os.execvp('node', ['node', CLI, *args])

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    sc = pyte.Screen(COLS, ROWS)
    stream = pyte.Stream(sc)
    gone = []

    def drain(sec):
        end = time.time() + sec
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], max(0, end - time.time()))
            if not r:
                continue
            try:
                data = os.read(fd, 65536)
            except OSError:
                gone.append(1)
                return
            if not data:
                gone.append(1)
                return
            stream.feed(data.decode('utf8', 'replace'))

    drain(1.0)
    out = []

    for keys in steps:
        if gone:
            out.append(QUIT)
            continue
        for ch in keys:
            try:
                os.write(fd, ch.encode())
            except OSError:
                gone.append(1)
                break
            drain(0.15)
        drain(0.8)
        out.append(QUIT if gone else sc.display[ROWS - 1].rstrip())

    try:
        os.kill(pid, signal.SIGKILL)
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass

    return out


HELP = 'HELP -- Press RETURN for more, or q when done'

# a.txt and b.txt fit one screen, so their prompts end in (END);
# `long` does not, which is how a step onto it is told apart
CASES = [
    # `lmn --help`: the page IS the session, so q has nowhere to go
    ('--help; q', ['--help'], ['q'], [QUIT]),
    # a file named too: the page is over it, and q comes back to it
    ('a --help; q', ['a.txt', '--help'], ['q'], ['a.txt (END)']),
    ('a; h; q', ['a.txt'], ['h', 'q'], [HELP, 'a.txt (END)']),
    # :e ADDS a file; the page keeps its slot, so b is the third place
    ('a; h; :e b', ['a.txt'], ['h', ':e b.txt\n'],
     [HELP, 'b.txt (file 3 of 3) (END)']),
    # 2:p passes THROUGH the page without spending it - and the file
    # before the page names it as its "Next", which is where less's
    # own name for the page reaches the screen (less.h:627). Both rows
    # are byte-identical to the binary
    ('a; h; :e b; 2:p; 2:n', ['a.txt'], ['h', ':e b.txt\n', '2:p', '2:n'],
     [HELP, None,
      'a.txt (file 1 of 3) (END) - Next: @/\\less/\\help/\\file/\\@',
      'b.txt (file 3 of 3) (END)']),
    # :p LANDS on it: the page comes back, prompt and all
    ('a; h; :e b; :p', ['a.txt'], ['h', ':e b.txt\n', ':p'],
     [HELP, None, HELP]),
    # ...and moving on from it spends it: two files left
    ('a; h; :e b; :p; :n', ['a.txt'], ['h', ':e b.txt\n', ':p', ':n'],
     [HELP, None, HELP, 'b.txt (file 2 of 2) (END)']),
    # q on the page is :p that also spends it
    ('a; h; :e b; :p; q', ['a.txt'], ['h', ':e b.txt\n', ':p', 'q'],
     [HELP, None, HELP, 'a.txt (file 1 of 2) (END) - Next: b.txt']),
    # ...and with the page spent, "Next" is the ordinary file again

    # :e from the page inserts after the PAGE, not after the last file
    ('a; h; :e b; :p; :e long', ['a.txt'],
     ['h', ':e b.txt\n', ':p', ':e long\n'],
     [HELP, None, HELP, 'long (file 3 of 4)']),
    # --help then :e: the page is file 1 and stays
    ('--help; :e a', ['--help'], [':e a.txt\n'],
     ['a.txt (file 2 of 2) (END)']),
    ('--help; :e a; :p', ['--help'], [':e a.txt\n', ':p'], [None, HELP]),
    ('--help; :e a; :p; q', ['--help'], [':e a.txt\n', ':p', 'q'],
     [None, HELP, QUIT]),
    # a second h closes the first page wherever it was
    ('a; h; :e b; h; q', ['a.txt'], ['h', ':e b.txt\n', 'h', 'q'],
     [HELP, None, HELP, 'b.txt (file 2 of 2) (END)']),
    # :x names it by number like any other file
    ('a; h; :e b; 2:x', ['a.txt'], ['h', ':e b.txt\n', '2:x'],
     [HELP, None, HELP]),
    # the lesskey syntax page is the same page, with other text in it
    ('--lesskey-help; q', ['--lesskey-help'], ['q'], [QUIT]),
    ('a; --lesskey-help; q', ['a.txt'], ['--lesskey-help\n', 'q'],
     [HELP, 'a.txt (END)']),
]


def fixtures(root):
    """Files of this session's own, so a stray a.txt cannot decide it."""
    with open(os.path.join(root, 'a.txt'), 'w') as handle:
        handle.write('a one\na two\n')

    with open(os.path.join(root, 'b.txt'), 'w') as handle:
        handle.write('b one\nb two\n')

    with open(os.path.join(root, 'long'), 'w') as handle:
        handle.write(''.join(f'line {n}\n' for n in range(1, 101)))


def run():
    if not os.path.exists(CLI):
        print(f'missing {CLI} - run npm run build')
        return 2

    root = tempfile.mkdtemp(prefix='lpm-helppage-')
    fixtures(root)
    bad = 0

    for title, args, steps, want in CASES:
        got = bottom(args, steps, root)
        ok = all(w is None or g == w for g, w in zip(got, want))
        bad += not ok
        print(f'{"ok  " if ok else "FAIL"} {title}')

        for keys, g, w in zip(steps, got, want):
            mark = ' ' if w is None or g == w else '!'
            print(f'     {mark} {keys!r:<14} {g!r}')
            if mark == '!':
                print(f'       {"":<14} want {w!r}')

    shutil.rmtree(root, ignore_errors=True)
    print('all clear' if not bad else f'{bad} case(s) wrong')

    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(run())
