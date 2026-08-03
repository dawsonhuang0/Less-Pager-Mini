import subprocess, os, sys
S = os.path.dirname(os.path.abspath(__file__))
P = '/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
env = dict(os.environ, TERM='xterm-256color', RUNPTY_DELAY='0.8',
           RUNPTY_STAGE='0.7', LESS='', LESSOPEN='', LESSCLOSE='',
           LESSHISTFILE='/dev/null', LC_ALL='en_US.UTF-8',
           LINES='24', COLUMNS='80')
def run(cmd, groups):
    return subprocess.run(['python3', f'{P}/tests/runpty_staged.py', '24',
                           '80', groups, '--'] + cmd, cwd=S, env=env,
                          capture_output=True).stdout
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
bad = 0
for groups, label in CASES:
    a = run([f'{P}/less/less', '-X', 'lines.txt'], groups)
    b = run(['node', CLI, '-X', 'lines.txt'], groups)
    if a != b:
        bad += 1
        print(f'DIFF {label}  og={len(a)} ours={len(b)}')
print(f'{len(CASES)-bad}/{len(CASES)} identical')
