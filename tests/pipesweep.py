import os, subprocess, sys
S = os.path.dirname(os.path.abspath(__file__))
P = '/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
CLI = sys.argv[1] if len(sys.argv) > 1 else f'{P}/dist/cli.js'
env = dict(os.environ, TERM='xterm-256color', RUNPTY_DELAY='1.2',
           RUNPTY_STAGE='1.2', LESS='',
           LESSOPEN='', LESSCLOSE='', LESSHISTFILE='/dev/null',
           LC_ALL='en_US.UTF-8', LINES='24', COLUMNS='80')
def run(sh, keys):
    # each key its own stage: a burst lets `q` overtake a pipe read
    groups = ','.join(bytes([k]).hex() for k in keys)
    return subprocess.run(['python3', f'{P}/tests/runpty_staged.py', '24',
                           '80', groups, '--', '/bin/sh', '-c', sh], cwd=S,
                          env=env, capture_output=True).stdout
cases = ['j','jj','k','jjk','f','g','G','d','5g','']
bad = 0
for c in cases:
    kb = (c + 'q').encode()
    a = run(f'cat lines.txt | {P}/less/less -X', kb)
    b = run(f'cat lines.txt | node {CLI} -X', kb)
    if a != b:
        bad += 1
        print(f'DIFF pipe -X [{c}] og={len(a)} ours={len(b)}')
print(f'pipe -X: {len(cases)-bad}/{len(cases)} identical')
