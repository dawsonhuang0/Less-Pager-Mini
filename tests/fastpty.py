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


def run(argv, keys, rows=24, cols=80, env=None, cwd=None,
        quiet=None, first=None, step=None, dead=None):
    """Run argv on a pty of the given size, feeding keys one at a time.

    The caps are per call as well as per module: a sweep that drives a
    3GB file needs a longer leash than one that drives twenty lines,
    and passing them beats mutating globals that parallel workers
    would then fight over.
    """
    quiet = QUIET if quiet is None else quiet
    first = FIRST if first is None else first
    step = STEP if step is None else step
    dead = DEAD if dead is None else dead
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
    out = _drain(fd, quiet, first, need=True)

    for key in keys:
        if time.time() - started > dead:
            break
        try:
            os.write(fd, key.encode())
        except OSError:
            break
        out += _drain(fd, quiet, step)

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


def burst(argv, keys, rows=24, cols=80, env=None, cwd=None,
          quiet=None, first=None, step=None, dead=None):
    """runpty.py's shape: wait for the first screen, then ONE write.

    Not the same test as feeding keys one at a time - a pager that
    reads a byte at a time echoes each key where it stands, while a
    whole string arriving at once is a burst it may collapse. Sweeps
    built on runpty.py are asserting the burst shape, so keep it.
    """
    quiet = QUIET if quiet is None else quiet
    first = FIRST if first is None else first
    step = STEP if step is None else step

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

    out = _drain(fd, quiet, first, need=True)

    try:
        os.write(fd, keys if isinstance(keys, bytes) else keys.encode())
    except OSError:
        pass

    out += _drain(fd, quiet, dead or step)

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


def imap(fn, items, jobs=None):
    """`fn` over `items` in worker PROCESSES, order preserved.

    A case is a pty session or two that only ever wait on the pager, so
    they parallelise cleanly. PROCESSES, not threads: every session
    forks, and forking out of a thread holding the interpreter's locks
    is a way to hang for reasons that have nothing to do with the
    pager. FORK, not macOS's default spawn, which re-imports the
    caller's __main__ in every worker and re-runs the sweep inside
    itself. JOBS=1 turns it off.
    """
    items = list(items)
    jobs = int(os.environ.get('JOBS', jobs or min(8, os.cpu_count() or 4)))

    if jobs <= 1 or len(items) < 2:
        return [fn(x) for x in items]

    import multiprocessing
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(
            max_workers=jobs,
            mp_context=multiprocessing.get_context('fork')) as pool:
        return list(pool.map(fn, items))


def screen(argv, keys, rows=24, cols=80, env=None, cwd=None):
    """The settled screen, as rstripped rows."""
    import pyte
    sc = pyte.Screen(cols, rows)
    pyte.Stream(sc).feed(
        run(argv, keys, rows, cols, env, cwd).decode('utf8', 'replace'))
    return [l.rstrip() for l in sc.display]
