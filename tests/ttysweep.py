"""Which descriptors are terminals, compared against less/less.

less keys its whole mode on isatty(1) (main.c:259) and takes its
keyboard from open_tty's cascade - ttyname(2), then /dev/tty, then fd
2 whatever it is (ttyin.c:67). Every combination below is a different
step of that cascade; the last one reaches the end of it, where less
paints the screen and then quits on EOF (ttyin.c:220).

Needs the vendored less/less and a lines.txt of 100 numbered lines.
"""
import subprocess, os, sys, time
S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, S)
import fastpty
P = '/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
env = dict(os.environ, TERM='xterm-256color', RUNPTY_DELAY='1.0', LESS='',
           LESSOPEN='', LESSCLOSE='', LESSHISTFILE='/dev/null',
           LINES='24', COLUMNS='80')

def pty(sh, keys, harness):
    return subprocess.run(['python3', f'{S}/{harness}', '24', '80',
                           keys.encode().hex(), '--', '/bin/sh', '-c', sh],
                          cwd=S, env=env, capture_output=True).stdout

def plain(sh):
    r = subprocess.run(['/bin/sh', '-c', sh], cwd=S, env=env,
                       capture_output=True)
    return r.stdout + b'[rc %d]' % r.returncode

CASES = [
    ('runpty.py', '',            'q', 'all three a terminal'),
    ('runpty.py', '< /dev/null', 'q', 'stdin not a terminal'),
    ('runpty.py', '2>/dev/null', 'q', 'stderr not a terminal'),
    ('runpty.py', '< /dev/null 2>/dev/null', 'q', 'stdin+stderr redirected'),
    ('nosid.py',  '',            'q', 'no controlling terminal'),
    ('nosid.py',  '< /dev/null', 'q', 'no ctty, stdin redirected'),
    ('nosid.py',  '2>/dev/null', 'q', 'no ctty, stderr redirected'),
    ('nosid.py',  '< /dev/null 2>/dev/null', '', 'no ctty, no keyboard left'),
]
CLI = sys.argv[1] if len(sys.argv) > 1 else f'{P}/dist/cli.js'

# The harnesses stay: nosid.py builds a session with no controlling
# terminal, which is the whole point of half these cases and not
# something fastpty can stand in for. What cost the time is that each
# one slept RUNPTY_DELAY before typing, one after another - and they
# are independent, so they need not be.
PLAIN = [('%s -X lines.txt', 'stdout not a terminal'),
         ('echo hi | %s -X', 'stdout+stdin not terminals')]


def one(case):
    kind, arg = case

    if kind == 'pty':
        harness, redir, keys, label = arg
        return (pty(f'{P}/less/less -X lines.txt {redir}; echo "[rc $?]"',
                    keys, harness),
                pty(f'node {CLI} -X lines.txt {redir}; echo "[rc $?]"',
                    keys, harness))

    sh, label = arg
    return (plain(sh % f'{P}/less/less'), plain(sh % f'node {CLI}'))


def main():
    started = time.time()
    work = ([('pty', c) for c in CASES] +
            [('plain', c) for c in PLAIN])
    bad = 0

    for (kind, arg), (a, b) in zip(work, fastpty.imap(one, work)):
        if a != b:
            bad += 1
            print(f'DIFF {arg[-1]}  less={len(a)} ours={len(b)}')

    total = len(work)
    print(f'{total-bad}/{total} identical   [{time.time()-started:.1f}s]')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
