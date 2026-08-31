#!/usr/bin/env python3
"""The prompt row when a whole command arrives in ONE read.

    python3 tests/burstprompt.py

Every key a person presses arrives in a read of its own, so the pager's
burst handling never engages and everything below already agreed with
less. Input that arrives in a single write does not: a terminal's
send-text binding, a lesskey macro, a +cmd replay, a program writing to
the tty. `:n` sent that way used to lose the new file's NAME from the
prompt - "(END)" where less says "fb.txt (file 2 of 2) (END)" - because
a frame that was overwritten inside the same flush had already spent
files.newFile.

So the burst cases below are the fix, and the rest are what the fix
must not break: the same commands typed, the prompt HOLD that keeps the
":" off the screen through a fast scroll, the startup and help prompts,
and -E quitting at EOF.

Differential against the vendored less/less, which must be built:

    cd less && ./configure && make less

The fixtures are made here, so nothing depends on what is lying around.
"""
import os, pty, fcntl, termios, struct, select, time, signal, sys
import tempfile
import pyte

ROWS, COLS = 24, 80
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'dist', 'cli.js')
OG = os.path.join(ROOT, 'less', 'less')

WORK = tempfile.mkdtemp(prefix='burstprompt.')
open(os.path.join(WORK, 'nums.txt'), 'w').write(
    ''.join('line %d\n' % i for i in range(1, 41)))
open(os.path.join(WORK, 'fb.txt'), 'w').write('beta one\nbeta two\n')
open(os.path.join(WORK, 'fc.txt'), 'w').write('gamma one\ngamma two\n')


def screen(argv, chunks, gap):
    """Row 0 and the bottom row after writing each chunk."""
    pid, fd = pty.fork()

    if pid == 0:
        os.chdir(WORK)
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSHISTFILE='/dev/null', LESSNOCONFIG='1',
                          LESSKEY='/nonexistent', LESSKEYIN='/nonexistent',
                          LINES=str(ROWS), COLUMNS=str(COLS))
        os.execvp(argv[0], argv)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    sc = pyte.Screen(COLS, ROWS)
    st = pyte.Stream(sc)
    gone = False

    def drain(seconds):
        nonlocal gone
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], max(0, end - time.time()))
            if not r:
                continue
            try:
                data = os.read(fd, 65536)
            except OSError:
                gone = True
                return
            if not data:
                gone = True
                return
            st.feed(data.decode('utf8', 'replace'))

    drain(1.2)
    for chunk in chunks:
        if gone:
            break
        try:
            os.write(fd, chunk)
        except OSError:
            gone = True
            break
        drain(gap)
    drain(0.6)

    out = ('EXITED', 'EXITED') if gone else (
        sc.display[0].rstrip(), sc.display[ROWS - 1].rstrip())

    try:
        os.kill(pid, signal.SIGKILL)
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass

    return out


# one write, like a send-text binding; the typed form is the control
BURST, TYPED = 0.05, 0.35


def burst(text):
    return ([text.encode()], BURST)


def typed(text):
    return ([bytes([b]) for b in text.encode()], TYPED)


CASES = [
    # the fix: a whole command in one read still names the new file
    ('burst  :n',            ['nums.txt', 'fb.txt'],  burst(':n')),
    ('burst  :n :n',         ['nums.txt', 'fb.txt', 'fc.txt'], burst(':n:n')),
    ('burst  :n then :p',    ['nums.txt', 'fb.txt'],  burst(':n:p')),
    ('burst  :e fb.txt',     ['nums.txt'],            burst(':efb.txt\r')),
    ('burst  :x',            ['nums.txt', 'fb.txt'],  burst(':n:x')),

    # ...and typed, which always worked and must keep working
    ('typed  :n',            ['nums.txt', 'fb.txt'],  typed(':n')),
    ('typed  :n :n',         ['nums.txt', 'fb.txt', 'fc.txt'], typed(':n:n')),
    ('typed  :n then :p',    ['nums.txt', 'fb.txt'],  typed(':n:p')),
    ('typed  :e fb.txt',     ['nums.txt'],            typed(':efb.txt\r')),

    # the prompt HOLD, which is what this area exists for: a burst of
    # scrolling keeps the ":" off the screen and settles back to it
    ('burst  jjjjjjjjjj',    ['nums.txt'],            burst('j' * 10)),
    ('burst  30 j',          ['nums.txt'],            burst('j' * 30)),
    ('burst  ffff',          ['nums.txt'],            burst('f' * 4)),
    ('burst  G then bbbb',   ['nums.txt'],            burst('G' + 'b' * 4)),
    ('typed  jjj',           ['nums.txt'],            typed('jjj')),

    # the other prompts that read files.newFile
    ('startup, no keys',     ['nums.txt', 'fb.txt'],  ([], BURST)),
    ('startup one file',     ['nums.txt'],            ([], BURST)),
    ('burst  h then q',      ['nums.txt', 'fb.txt'],  burst('hq')),
    ('typed  h then q',      ['nums.txt', 'fb.txt'],  typed('hq')),
    ('burst  :n then =',     ['nums.txt', 'fb.txt'],  burst(':n=')),

    # -E quits at EOF; the prompt must not outlive it either way
    ('-E burst G',           ['-E', 'nums.txt'],      burst('G')),
    ('-E typed G',           ['-E', 'nums.txt'],      typed('G')),
]


def main():
    if not os.path.exists(OG):
        sys.exit('no oracle at %s - build it: cd less && make less' % OG)

    bad = 0
    for name, args, (chunks, gap) in CASES:
        want = screen([OG] + args, chunks, gap)
        got = screen(['node', CLI] + args, chunks, gap)

        if want == got:
            print('ok   %-20s %r' % (name, want[1]))
            continue

        bad += 1
        print('DIFF %-20s' % name)
        print('       less: row0=%-24r bot=%r' % want)
        print('       ours: row0=%-24r bot=%r' % got)

    print('\n%s (%d/%d)' % ('all clear' if not bad else '%d DIFF' % bad,
                            len(CASES) - bad, len(CASES)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
