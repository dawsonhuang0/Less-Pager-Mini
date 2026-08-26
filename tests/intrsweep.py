#!/usr/bin/env python3
"""Interrupting the line-number walk, against less, on a real pty.

Everything here needs three things at once that no other sweep has: a
file big enough that counting its lines takes SECONDS, a keypress timed
against the two-second message rather than against a settled screen,
and a terminal whose ISIG is set one way or the other. Miss any one and
the case passes vacuously -- which is why every one of these bugs was
found by hand and none of them by a corpus.

What it pins down:

  * an interrupt BEFORE the message stops the walk, and the walk is not
    started again -- "Calculating line numbers..." must never appear
    after the abort (it did, seconds later, having run the whole file)
  * without -N the rows are already painted, so the view stays at the
    end; with -N they are not, and less falls back to the top
  * an interrupt AFTER the message turns line numbers off and SAYS so,
    on a cleared row -- the reply used to print on the end of the note
  * ^C on a terminal with ISIG off: less cannot be interrupted at all
    there, and we deliberately can. Marked, not hidden.

KNOWN FAILING, and it is the to-do rather than a flake:

  before, -N, ^X, isig on   less ':'   ours '(END)'

    With -N the rows cannot go up before the walk - the gutter needs
    the numbers - so less's forw paints nothing, its position table
    stays empty, and make_display falls back to jump_loc(ch_zero(), 1):
    the top. We paint the destination with blank numbers first, so the
    interrupt leaves us at the end instead. Fixing it means not
    painting under -N until the walk is done.

SERIAL by default. Every case here is timed against the two-second
message rather than against a settled screen, and eight workers on a
1.1GB file make the walk slow enough that "before" and "after" stop
meaning anything - it read 6/10 that way, all four of them harness.

usage: intrsweep.py            (needs ./loong, or set FIXTURE)
       JOBS=4 intrsweep.py     if you have the cores to spare
"""
import os, sys, pty, fcntl, termios, struct, select, signal, time

S = os.path.dirname(os.path.abspath(__file__))
P = os.path.dirname(S)
sys.path.insert(0, S)

import fastpty
import pyte

# big enough that counting lines runs past the two-second message; the
# walk is IO bound, so this is a size and not a line count
FIXTURE = os.environ.get('FIXTURE', os.path.join(P, 'loong'))
NEED = 600 * 1024 * 1024

MSG = 'Calculating line numbers...'
OFF = 'Line numbers turned off'


def drive(who, opts, key, at, isig, watch):
    """G, then `key` - at `at` seconds, or once the note is up.

    Returns the screen sampled once a second afterwards, so a case can
    assert both where it settled AND that the note never came back.
    """
    argv = ([f'{P}/less/less'] if who == 'less' else ['node', f'{P}/dist/cli.js'])
    argv = argv + opts + [FIXTURE]

    pid, fd = pty.fork()

    if pid == 0:
        os.environ.update(TERM='xterm-256color', LESS='', LESSNOCONFIG='1',
                          LESSHISTFILE='/dev/null', LINES='24', COLUMNS='80')
        os.execvp(argv[0], argv)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
    mode = termios.tcgetattr(fd)
    mode[3] = (mode[3] | termios.ISIG) if isig else (mode[3] & ~termios.ISIG)
    termios.tcsetattr(fd, termios.TCSANOW, mode)

    buf = bytearray()

    def drain(seconds):
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if not r:
                continue
            try:
                data = os.read(fd, 1 << 20)
            except OSError:
                return
            if not data:
                return
            buf.extend(data)

    def rows():
        screen = pyte.Screen(80, 24)
        pyte.Stream(screen).feed(bytes(buf).decode('utf8', 'replace'))
        return [line.rstrip() for line in screen.display]

    drain(1.5)
    os.write(fd, b'G')

    if at == AFTER:
        # WAIT FOR THE MESSAGE, do not guess at a delay. The walk is IO
        # bound, so a warm page cache finishes it in a second where a
        # cold one takes four - and a fixed 3s pressed after the walk
        # had ended, which tests nothing. Give up after a while and let
        # the case fail honestly rather than pass by accident.
        end = time.time() + 12

        while time.time() < end and not any(MSG in r for r in rows()):
            drain(0.2)
    else:
        drain(at)

    os.write(fd, key.encode())

    # sample until the bottom row has held still twice, not for a fixed
    # count: less without -N takes SECONDS longer than we do on some of
    # these, and comparing at a fixed instant compares two different
    # moments of the same story
    seen = []
    for _ in range(watch):
        drain(1.0)
        seen.append(rows())

        if len(seen) >= 3 and seen[-1][23] == seen[-2][23] == seen[-3][23]:
            break

    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    try:
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass

    return seen


# (label, opts, key, when, isig, same-as-less?, ours must end with)
#
# `same` false marks a DELIBERATE divergence: the row is asserted
# against ours and never against less, and the reason is written beside
# it. Nothing here is marked so to make a failure go quiet.
BEFORE, AFTER = 0.5, 3.0
CASES = [
    ('before, no -N, ^X, isig on',  [],     '\x18', BEFORE, True,  True,  '(END)'),
    ('before, no -N, ^X, isig off', [],     '\x18', BEFORE, False, True,  '(END)'),
    ('before, -N,    ^X, isig on',  ['-N'], '\x18', BEFORE, True,  True,  ':'),
    ('after,  no -N, ^X, isig on',  [],     '\x18', AFTER,  True,  True,  OFF),
    ('after,  no -N, ^C, isig on',  [],     '\x03', AFTER,  True,  True,  OFF),
    ('after,  -N,    ^X, isig on',  ['-N'], '\x18', AFTER,  True,  True,  OFF),
    ('after,  -N,    ^C, isig on',  ['-N'], '\x03', AFTER,  True,  True,  OFF),

    # less cannot be interrupted with ISIG off: no signal is ever raised
    # and check_poll compares the byte against intr_char (^X) alone. We
    # read the byte as the interrupt anyway - see intrIsByte in core.ts,
    # which says why.
    ('before, no -N, ^C, isig off', [],     '\x03', BEFORE, False, False, '(END)'),
    ('after,  -N,    ^C, isig off', ['-N'], '\x03', AFTER,  False, False, OFF),

    # A ^C landing BEFORE the walk starts is consumed by psignals and
    # the walk then runs to the end - measured: less shows the note at
    # +5s and reaches (END) at +7s. Ours holds ISIG off from 200ms, so
    # the byte reaches the poll and stops the walk where ^X does. Same
    # destination, seconds earlier.
    ('before, no -N, ^C, isig on',  [],     '\x03', BEFORE, False, False, '(END)'),
]


def one(case):
    label, opts, key, at, isig, same, want = case
    watch = 12
    ours = drive('ours', opts, key, at, isig, watch)
    less = drive('less', opts, key, at, isig, watch) if same else None
    return (ours, less)


def main():
    if not os.path.exists(FIXTURE) or os.path.getsize(FIXTURE) < NEED:
        print(f'intrsweep needs a file of at least {NEED >> 20}MB at '
              f'{FIXTURE!r}\n'
              f'  the line-number walk has to run past its own two-second '
              f'message, and that is a SIZE\n'
              f'  make one with:  yes 1234567890123456789 | '
              f'head -c {NEED + (100 << 20)} > loong', file=sys.stderr)
        return 2

    started = time.time()
    bad = 0

    for case, (ours, less) in zip(CASES, fastpty.imap(one, CASES, jobs=1)):
        label, opts, key, at, isig, same, want = case
        bot = ours[-1][23]
        why = []

        # the walk must not start again: once an interrupt has stopped
        # it the note may not come back, which is what it did - seconds
        # after the abort, having run the whole file a second time
        settled = [i for i, rows in enumerate(ours) if rows[23] == bot]
        late = [i for i, rows in enumerate(ours)
                if i > (settled[0] if settled else 0)
                and any(MSG in line for line in rows)]

        if late:
            why.append(f'note returned at +{late[0]}s')

        if not bot.startswith(want):
            why.append(f'bottom {bot[:46]!r} wanted {want!r}')

        if same and less is not None and less[-1][23] != bot:
            why.append(f'less {less[-1][23][:46]!r}')

        if why:
            bad += 1
            print(f'  DIFF {label:30} ' + '; '.join(why))
        else:
            mark = 'ok  ' if same else 'ok* '
            print(f'  {mark} {label:30} {bot[:46]!r}')

    print(f'\n{len(CASES)-bad}/{len(CASES)} identical'
          f'   [{time.time()-started:.1f}s]   '
          f'(* = deliberate divergence, asserted against ours)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
