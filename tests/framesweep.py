#!/usr/bin/env python3
"""What the SCREEN shows, and how many writes it took to get there.

The byte sweeps compare the whole output stream and are blind to WHEN
it arrives -- which is the wrong blind spot. A pager emitting less's
exact bytes in five writes where less used one flickers; a pager whose
first screen never leaves the buffer looks dead. Both are byte-
identical, and both were green under every other sweep here while the
screen was visibly wrong.

Two measurements, chosen because they hold still. Frame COUNTS do not:
the pty coalesces reads however it likes, so the same session gives 65
chunks one run and 70 the next, for less as much as for us.

  SCREEN   the emulated screen and cursor once everything settles,
           against less. Catches a wrong cursor column, a blank paint,
           a stale prompt -- anything the eye would catch.

  WRITES   keys sent far enough apart that each command's output
           arrives on its own, so the chunk count IS the write count.
           less emits one write per command (cmd_exec flushes before
           each, command.c:128). Several per command is fragmentation,
           and fragmentation on a fast burst is what flicker IS.

    python3 tests/framesweep.py
    python3 tests/framesweep.py search        # one case
    FRAMESWEEP_SHOW=1 python3 tests/framesweep.py

Needs pyte (pip3 install pyte), less/less, and the fixtures here.
"""
import os, sys, pty, time, select, fcntl, termios, struct

try:
    import pyte
except ImportError:
    sys.exit('framesweep needs pyte: pip3 install pyte')

S = os.path.dirname(os.path.abspath(__file__))
P = os.path.dirname(S)
ROWS, COLS = 24, 80


def capture(argv, keys, delay=0.8, stage=0.4):
    """Run argv on a pty; return the chunks that arrived, in order."""
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSHISTFILE='/dev/null',
                          LINES=str(ROWS), COLUMNS=str(COLS))
        os.chdir(S)
        os.execvp(argv[0], argv)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))

    chunks, pending = [], list(keys)
    send_at = time.time() + delay
    deadline = time.time() + delay + stage * len(pending) + 3

    while time.time() < deadline:
        if pending and time.time() >= send_at:
            os.write(fd, pending.pop(0))
            send_at = time.time() + stage
            if not pending:
                deadline = time.time() + 2

        r, _, _ = select.select([fd], [], [], 0.02)
        if not r:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        chunks.append(data)

    try:
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass

    return chunks


def settled(chunks):
    """The screen and cursor after every chunk has been fed."""
    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.Stream(screen)
    stream.feed(b''.join(chunks).decode('utf8', 'replace'))
    return (tuple(l.rstrip() for l in screen.display),
            (screen.cursor.y, screen.cursor.x))


# (label, fixture, options, keys-as-one-string, keys-sent-singly)
CASES = [
    ('startup only',         'lines.txt', [],               '',        'q'),
    ('scroll one line',      'lines.txt', [],               'j',       'jq'),
    ('scroll a burst',       'lines.txt', [],               'jjjjjjjj', 'jjjjq'),
    ('wheel burst, wrapped', 'w2.txt',    [],               '\x1bOB' * 40, ''),
    ('search',               'lines.txt', [],               '/line 5\r', ''),
    ('message, --use-color', 'lines.txt', ['--use-color'],  '/zzzz\r',  ''),
    ('help in and out',      'lines.txt', [],               'hq',       ''),
]

want = sys.argv[1:]
bad = 0

for label, fixture, opts, burst, singly in CASES:
    if want and not any(a in label for a in want):
        continue

    run = ['-X'] + opts + [fixture]
    note = ''

    # SCREEN: everything in one go, then compare where both settled
    keys = [k.encode() for k in ([burst] if burst else []) + ['q']]
    a = settled(capture([f'{P}/less/less'] + run, keys))
    b = settled(capture(['node', f'{P}/dist/cli.js'] + run, keys))

    if a != b:
        bad += 1
        print(f'  DIFF {label:22} the settled screen differs')
        for n, (x, y) in enumerate(zip(a[0], b[0])):
            if x != y:
                print(f'         row {n:2} less |{x[:66]}')
                print(f'         row {n:2} our  |{y[:66]}')
        if a[1] != b[1]:
            print(f'         cursor less={a[1]} ours={b[1]}')
        if os.environ.get('FRAMESWEEP_SHOW'):
            for n, row in enumerate(b[0]):
                print(f'         our {n:2} |{row[:66]}')
        continue

    # WRITES: one key per stage, so a chunk IS a write
    if singly:
        one = [k.encode() for k in singly]
        wa = len(capture([f'{P}/less/less'] + run, one, stage=0.6))
        wb = len(capture(['node', f'{P}/dist/cli.js'] + run, one, stage=0.6))

        if wb > wa + 1:
            bad += 1
            print(f'  DIFF {label:22} writes less={wa} ours={wb}'
                  f'  -- {wb - wa} more than less, per {len(one)} keys')
            continue

        note = f'  writes less={wa} ours={wb}'

    print(f'  ok   {label:22} screen matches{note}')

print(f'\n{"all clear" if not bad else str(bad) + " differing"}')
sys.exit(1 if bad else 0)
