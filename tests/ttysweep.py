"""Which descriptors are terminals, compared against less/less.

less keys its whole mode on isatty(1) (main.c:259) and takes its
keyboard from open_tty's cascade - ttyname(2), then /dev/tty, then fd
2 whatever it is (ttyin.c:67). Every combination below is a different
step of that cascade; the last one reaches the end of it, where less
paints the screen and then quits on EOF (ttyin.c:220).

Needs the vendored less/less and a lines.txt of 100 numbered lines.
"""
import subprocess, os, sys
S = os.path.dirname(os.path.abspath(__file__))
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
bad = 0
for harness, redir, keys, label in CASES:
    a = pty(f'{P}/less/less -X lines.txt {redir}; echo "[rc $?]"', keys, harness)
    b = pty(f'node {CLI} -X lines.txt {redir}; echo "[rc $?]"', keys, harness)
    if a != b:
        bad += 1
        print(f'DIFF {label}  less={len(a)} ours={len(b)}')

# stdout not a terminal: less copies the files out and never pages
for sh, label in [('%s -X lines.txt', 'stdout not a terminal'),
                  ('echo hi | %s -X', 'stdout+stdin not terminals')]:
    a = plain(sh % f'{P}/less/less')
    b = plain(sh % f'node {CLI}')
    if a != b:
        bad += 1
        print(f'DIFF {label}  less={len(a)} ours={len(b)}')

total = len(CASES) + 2
print(f'{total-bad}/{total} identical')
