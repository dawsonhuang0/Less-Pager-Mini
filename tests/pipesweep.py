import os, sys, time
S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, S)
import fastpty
P = '/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
CLI = sys.argv[1] if len(sys.argv) > 1 else f'{P}/dist/cli.js'
env = dict(LESS='', LESSNOCONFIG='', LESSOPEN='', LESSCLOSE='',
           LESSHISTFILE='/dev/null', LC_ALL='en_US.UTF-8')

# a pipe pager waits on its writer as well as on the user, so it gets a
# longer leash than the file sweeps; QUIET still has to clear the
# pager's own settle timers (PROMPT_SETTLE_MS 150, EDGE_DWELL_MS 120)
QUIET = float(os.environ.get('QUIET', '0.40'))


def run(sh, keys):
    # each key on its own: a burst lets `q` overtake a pipe read
    return fastpty.run(['/bin/sh', '-c', sh],
                       [chr(k) for k in keys], 24, 80, env, cwd=S,
                       quiet=QUIET, first=3.0, step=3.0, dead=40)
cases = ['j','jj','k','jjk','f','g','G','d','5g','']


def one(c):
    kb = (c + 'q').encode()
    return (run(f'cat lines.txt | {P}/less/less -X', kb),
            run(f'cat lines.txt | node {CLI} -X', kb))


started = time.time()
bad = 0
for c, (a, b) in zip(cases, fastpty.imap(one, cases)):
    if a != b:
        bad += 1
        print(f'DIFF pipe -X [{c}] less={len(a)} ours={len(b)}')
print(f'pipe -X: {len(cases)-bad}/{len(cases)} identical'
      f'   [{time.time()-started:.1f}s]')
