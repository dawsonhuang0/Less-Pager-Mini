"""Drive a pager on a pty, waiting for it to go QUIET rather than sleeping.

The old harnesses spend ~2.4 seconds per case doing nothing: 0.9s before
the first key so the first screen is surely drawn, 0.22s between keys,
1.3s at the end for output to settle. Node itself starts in 66ms and
less in 2ms, so nearly all of a sweep's wall clock was sleep.

A pager is quiet when it has stopped writing. Reading until the fd has
had nothing for QUIET seconds answers the same question the sleeps were
guessing at, and answers it as soon as it is true.
"""
import os, pty, select, fcntl, termios, struct, signal, time

QUIET = float(os.environ.get('QUIET', '0.15'))       # no bytes for this long means the pager is done
FIRST = 1.2        # cap on waiting for the first screen
STEP  = 1.2        # cap on waiting after one key
DEAD  = 8.0        # total cap, so a wedged child cannot hang a sweep


def _drain(fd, quiet, cap, need=False):
    """Read until the fd is silent for `quiet`, or `cap` elapses.

    `need` waits for the first byte before silence counts. Nothing at
    all is not a pager that has finished drawing, it is one that has
    not started - node takes ~66ms to boot, and keys written into that
    gap land in the tty before raw mode is on, where the SHELL echoes
    them. That is what "stream=\'jj\'" looks like in a diff.
    """
    out = b''
    last = time.time()
    end = last + cap

    while time.time() < end:
        r, _, _ = select.select([fd], [], [], quiet)

        if not r:
            if need and not out:
                continue
            if time.time() - last >= quiet:
                break
            continue

        try:
            data = os.read(fd, 65536)
        except OSError:
            break

        if not data:
            break

        out += data
        last = time.time()

    return out


def run(argv, keys, rows=24, cols=80, env=None, cwd=None):
    """Run argv on a pty of the given size, feeding keys one at a time."""
    pid, fd = pty.fork()

    if pid == 0:
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSHISTFILE='/dev/null', LESSNOCONFIG='1',
                          LINES=str(rows), COLUMNS=str(cols))
        os.environ.update(env or {})
        if cwd:
            os.chdir(cwd)
        os.execvp(argv[0], argv)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    started = time.time()
    out = _drain(fd, QUIET, FIRST, need=True)

    for key in keys:
        if time.time() - started > DEAD:
            break
        try:
            os.write(fd, key.encode())
        except OSError:
            break
        out += _drain(fd, QUIET, STEP)

    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    try:
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass

    return out


def screen(argv, keys, rows=24, cols=80, env=None, cwd=None):
    """The settled screen, as rstripped rows."""
    import pyte
    sc = pyte.Screen(cols, rows)
    pyte.Stream(sc).feed(
        run(argv, keys, rows, cols, env, cwd).decode('utf8', 'replace'))
    return [l.rstrip() for l in sc.display]
