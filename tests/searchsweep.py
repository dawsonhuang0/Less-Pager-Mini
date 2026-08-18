import subprocess,os,binascii,sys
S=os.path.dirname(os.path.abspath(__file__)); P='/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
env=dict(os.environ,TERM='xterm-256color',RUNPTY_DELAY='0.8',RUNPTY_STAGE='0.6',LESS='',LESSHISTFILE='/dev/null',LINES='24',COLUMNS='80')
def run(cmd,groups):
    return subprocess.run(['python3',f'{P}/tests/runpty_staged.py','24','80',groups,'--']+cmd,cwd=S,env=env,capture_output=True).stdout
def esc(b):
    return ' '.join({27:'ESC',13:'\\r',10:'\\n',8:'\\b',7:'\\a'}.get(c, chr(c) if 32<=c<127 else '\\x%02x'%c) for c in b)
def hx(s): return ','.join(binascii.hexlify(c.encode()).decode() for c in s)
CASES = [a.encode().decode('unicode_escape') for a in sys.argv[1:]] or [
    '/l\rq', '/zz\rq', '/line 5\rq', '/5\rnq', '?9\rq', '/9\rq',
    '/line 30\rq', '/5\rNq', '/9\rNq', '/5\rnNq', '?5\rnq',
    '/zz\rnq', '/5\rnnq', '/line 30\rNq', '?line 90\rq',
]
bad=0
for keys in CASES:
    a=run([f'{P}/less/less','-X','lines.txt'],hx(keys))
    b=run(['node',f'{P}/dist/cli.js','-X','lines.txt'],hx(keys))
    i=0
    while i<min(len(a),len(b)) and a[i]==b[i]: i+=1
    ok = a==b
    if not ok: bad+=1
    print(f'{keys!r:14} less={len(a):5} ours={len(b):5} {"SAME" if ok else "DIFF@"+str(i)}')
    if not ok:
        print('  less  :',esc(a[i-14:i+55])); print('  ours:',esc(b[i-14:i+55]))
print(f'{len(CASES)-bad}/{len(CASES)} identical')
