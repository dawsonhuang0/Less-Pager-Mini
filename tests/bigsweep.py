import os, subprocess, sys
S = os.path.dirname(os.path.abspath(__file__))
P = '/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
CLI = sys.argv[1] if len(sys.argv) > 1 else f'{P}/dist/cli.js'
def env(term):
    return dict(os.environ, TERM=term, RUNPTY_DELAY='0.8', LESS='',
                LESSOPEN='', LESSCLOSE='', LESSHISTFILE='/dev/null',
                LC_ALL='en_US.UTF-8', LINES='24', COLUMNS='80')
def run(cmd, keys, term):
    return subprocess.run(['python3', f'{P}/tests/runpty.py', '24', '80',
                           keys.hex(), '--'] + cmd, cwd=S, env=env(term),
                          capture_output=True).stdout
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
out = []
for term, o, pre in suites:
    bad = 0
    for c in cases:
        kb = (pre + c + 'q').encode()
        a = run([f'{P}/less/less']+o+['lines.txt'], kb, term)
        b = run(['node', CLI]+o+['lines.txt'], kb, term)
        if a != b:
            bad += 1
            out.append(f'DIFF {term} {" ".join(o)} [{c}] less={len(a)} ours={len(b)}')
    out.append(f'{term} {" ".join(o)}: {len(cases)-bad}/{len(cases)} identical')
print('\n'.join(out))
