import os, subprocess, sys, time
S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, S)
import fastpty
P = '/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
CLI = sys.argv[1] if len(sys.argv) > 1 else f'{P}/dist/cli.js'
def env(term):
    return dict(TERM=term, LESS='', LESSNOCONFIG='', LESSOPEN='',
                LESSCLOSE='', LESSHISTFILE='/dev/null',
                LC_ALL='en_US.UTF-8')


# runpty.py's ONE write - these cases assert the shape of a whole burst
# arriving at once, and feeding the keys one at a time asks a different
# question. What goes is the FIXED wait it typed after: 0.8s per pty,
# 468 of them, whether the pager needed it or not. QUIET must outlast
# the pager's own settle timers (PROMPT_SETTLE_MS 150, EDGE_DWELL 120).
QUIET = float(os.environ.get('QUIET', '0.30'))


def run(cmd, keys, term):
    return fastpty.burst(cmd, keys, 24, 80, env(term), cwd=S,
                         quiet=QUIET, first=3.0, dead=25)
cases = ['j','jj','jjjj','k','jjk','f','b','g','gg','G','GG','Gjj','d','u',
         '5g','3g','12g','56g','','majb','Gb','bb','ff','Gg','5gg','3g5g']
suites = [('xterm-256color', ['-X'], ''),
          ('xterm-256color', ['-X','-c'], ''),
          ('xterm-256color', ['-X','-h5'], ''),
          ('xterm-256color', ['-X','-y3'], ''),
          ('xterm-256color', ['-X','+5g'], ''),
          ('xterm-256color', ['-X','+G'], ''),
          ('xterm-256color', ['-X','-q'], ''),
          ('xterm-256color', ['-X','-N'], ''),
          ('dumb', [], '\r')]
# The DRIVER stays runpty.py: these cases assert the shape of one write
# arriving at once, and fastpty's key-at-a-time feed asks a different
# question - swapping it took the xterm suites from 26/26 to 5/26. What
# cost the time is that 468 pty sessions ran one after another, each
# sleeping 0.8s before it typed, and they do not depend on each other.
work = [(term, tuple(o), pre, c)
        for term, o, pre in suites for c in cases]


def one(item):
    term, o, pre, c = item
    kb = (pre + c + 'q').encode()
    return (run([f'{P}/less/less'] + list(o) + ['lines.txt'], kb, term),
            run(['node', CLI] + list(o) + ['lines.txt'], kb, term))


def main():
    started = time.time()
    results = dict(zip(work, fastpty.imap(one, work)))
    out = []

    for term, o, pre in suites:
        bad = 0

        for c in cases:
            a, b = results[(term, tuple(o), pre, c)]

            if a != b:
                bad += 1
                out.append(f'DIFF {term} {" ".join(o)} [{c}] '
                           f'less={len(a)} ours={len(b)}')

        out.append(f'{term} {" ".join(o)}: '
                   f'{len(cases)-bad}/{len(cases)} identical')

    out.append(f'[{time.time()-started:.1f}s]')
    print('\n'.join(out))


if __name__ == '__main__':
    main()
