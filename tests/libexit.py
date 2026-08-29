#!/usr/bin/env python3
"""The library contract: `await pager(...)` comes back, and the host lives.

A CLI may end the process however it likes. A library may not - the
caller has code after the await, and a `finally` it expects to run. Two
things used to break that promise, and neither was reachable from the
executable, which is why nothing here caught them:

  * an unreadable keyboard raised EBADF with no listener, so node made
    it an uncaughtException and the pager's own handler exited 1
  * `-o` on an existing file answered `Q` called process.exit(0) from
    inside the call

    python3 tests/libexit.py

The no-keyboard case needs a session with NO controlling terminal and a
write-only fd 2 - less's last resort is fd 2 whatever it is
(ttyin.c:71), so that is the keyboard it ends up with, and reading it
fails. os.setsid() in the child is what takes the terminal away; it
cannot be done from inside the test runner's own process.
"""

import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRY = os.path.join(ROOT, 'dist', 'index.js')

# Each case is a consumer program. It appends a line per step to a log
# so the assertions read what the CALLER saw, not what the pager
# printed - the point is the code after the await.
CASES = {
    'resolves with no keyboard at all': '''
        await probe('plain', () => pager('one\\ntwo'));
        await probe('missing file', () => pager('nope.txt', ['--examine-file']));
        await probe('unknown option', () => pager('x', ['--bogus-option']));
        log('alive');
    ''',
    "-o answered Q ends the session, not the process": '''
        fs.writeFileSync(LOG_DIR + '/exists.log', 'old\\n');
        try {
          await pager('one\\ntwo', ['-o', LOG_DIR + '/exists.log']);
          log('resolved');
        } finally {
          log('finally ran');
        }
        log('alive');
    ''',
}

# what each case's log must contain, in order
WANT = {
    'resolves with no keyboard at all': [
        'plain resolved', 'missing file resolved', 'unknown option resolved',
        'alive',
    ],
    "-o answered Q ends the session, not the process": [
        'resolved', 'finally ran', 'alive',
    ],
}

PROGRAM = '''
import fs from 'fs';
import pager from '%(entry)s';
const LOG_DIR = '%(dir)s';
const log = (s) => fs.appendFileSync(LOG_DIR + '/steps.log', s + '\\n');
async function probe(name, fn) {
  try { await fn(); log(name + ' resolved'); }
  catch (e) { log(name + ' THREW ' + (e && e.message)); }
}
%(body)s
'''


def run_headless(body, root):
    """The consumer, with no controlling terminal and fd 2 write-only."""
    with open(os.path.join(root, 'prog.mjs'), 'w') as handle:
        handle.write(PROGRAM % {'entry': ENTRY, 'dir': root, 'body': body})

    pid = os.fork()

    if pid == 0:
        os.setsid()                       # no controlling terminal
        null = os.open(os.devnull, os.O_RDONLY)
        out = os.open(os.path.join(root, 'out'), os.O_WRONLY | os.O_CREAT)
        os.dup2(null, 0)
        os.dup2(out, 1)
        os.dup2(out, 2)                   # write-only: reading it is EBADF
        os.chdir(root)
        os.execvp('node', ['node', 'prog.mjs'])

    for _ in range(200):
        done, status = os.waitpid(pid, os.WNOHANG)

        if done:
            return os.waitstatus_to_exitcode(status)

        time.sleep(0.05)

    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)

    return 'HUNG'


def run_terminal(body, root):
    """The same consumer on a real terminal, answering every prompt."""
    with open(os.path.join(root, 'prog.mjs'), 'w') as handle:
        handle.write(PROGRAM % {'entry': ENTRY, 'dir': root, 'body': body})

    pid, fd = pty.fork()

    if pid == 0:
        os.chdir(root)
        os.environ.update(TERM='xterm-256color', LESS='',
                          LESSHISTFILE='/dev/null', LINES='24', COLUMNS='80')
        os.execvp('node', ['node', 'prog.mjs'])

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
    gone = []

    def drain(seconds):
        end = time.time() + seconds

        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], max(0, end - time.time()))

            if not ready:
                continue

            try:
                if not os.read(fd, 65536):
                    gone.append(True)
                    return
            except OSError:
                gone.append(True)
                return

    drain(1.2)

    # Q answers the -o query and quits any page that is up
    for _ in range(8):
        if gone:
            break

        try:
            os.write(fd, b'Q')
        except OSError:
            break

        drain(0.7)

    try:
        os.kill(pid, signal.SIGKILL)
        os.close(fd)
        os.waitpid(pid, 0)
    except OSError:
        pass


def steps(root):
    path = os.path.join(root, 'steps.log')

    if not os.path.exists(path):
        return []

    with open(path) as handle:
        return [line.strip() for line in handle if line.strip()]


def run():
    if not os.path.exists(ENTRY):
        print(f'missing {ENTRY} - run npm run build')
        return 2

    bad = 0

    for title, body in CASES.items():
        for mode, driver in (('no keyboard', run_headless),
                             ('a terminal', run_terminal)):
            root = tempfile.mkdtemp(prefix='lpm-libexit-')
            outcome = driver(body, root)
            got = steps(root)
            want = WANT[title]
            ok = got == want and outcome != 'HUNG'
            bad += not ok
            label = f'{title} ({mode})'
            print(f'{"ok  " if ok else "FAIL"} {label}')
            print(f'      {got}')

            if not ok:
                print(f'       want {want}'
                      + ('  and it HUNG' if outcome == 'HUNG' else ''))

    print('all clear' if not bad else f'{bad} case(s) wrong')

    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(run())
