import os, sys, time
S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, S)
import fastpty
P = '/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
env = dict(LESS='', LESSOPEN='', LESSCLOSE='', LESSNOCONFIG='',
           LESSHISTFILE='/dev/null', LC_ALL='en_US.UTF-8')

# was: one python + one runpty_staged per pager per case, sleeping 0.8s
# before the first key and 0.7s between the rest whatever the pager was
# actually doing. fastpty reads until it has been silent for QUIET,
# which is the same question answered as soon as it is true.
# QUIET must outlast the pager's own timers, or the sweep reads a
# half-settled screen: PROMPT_SETTLE_MS is 150ms and EDGE_DWELL_MS 120,
# so the 150 default raced both and turned 22/25 into 16/25.
QUIET = float(os.environ.get('QUIET', '0.30'))


def run(cmd, groups):
    keys = [bytes.fromhex(g).decode('latin-1')
            for g in groups.split(',') if g]
    return fastpty.run(cmd, keys, 24, 80, env, cwd=S,
                       quiet=QUIET, first=2.5, step=2.5, dead=40)
CASES = [
    ('03,71', '^C q'), ('2f,03,71', '/ ^C q'), ('2f,78,03,71', '/ x ^C q'),
    ('35,03,71', '5 ^C q'), ('6a,03,71', 'j ^C q'), ('03,03,71', '^C ^C q'),
    ('47,03,71', 'G ^C q'), ('03,6a,71', '^C j q'),
    ('35,03,6a,71', '5 ^C j q'), ('6d,61,03,71', 'm a ^C q'),
    ('18,71', '^X q'), ('3a,71', ': q'), ('18,18,71', '^X ^X q'),
    ('3a,6e,71', ': n q'), ('0f,71', '^O q'), ('18,6a,71', '^X j q'),
    ('3a,64,71', ': d q'), ('18,47,71', '^X G q'),
    ('1b,71', 'ESC q'), ('1b,1b,71', 'ESC ESC q'), ('1b,76,71', 'ESC v q'),
    ('1b6a,71', 'ESC-j q'), ('1b4f42,71', 'down-arrow q'),
    ('35,1b,71', '5 ESC q'), ('6d,25,0d,71', 'm % RET q'),
]
CLI = sys.argv[1] if len(sys.argv) > 1 else f'{P}/dist/cli.js'


def one(case):
    groups, label = case
    return (run([f'{P}/less/less', '-X', 'lines.txt'], groups),
            run(['node', CLI, '-X', 'lines.txt'], groups))


def main():
    started = time.time()
    bad = 0

    for (groups, label), (a, b) in zip(CASES, fastpty.imap(one, CASES)):
        if a != b:
            bad += 1
            print(f'DIFF {label}  less={len(a)} ours={len(b)}')

    print(f'{len(CASES)-bad}/{len(CASES)} identical'
          f'   [{time.time()-started:.1f}s]')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
