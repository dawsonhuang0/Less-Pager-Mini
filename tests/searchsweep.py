import os,binascii,sys,time
S=os.path.dirname(os.path.abspath(__file__)); P='/Users/huangdarwin/Desktop/Programming/webdev/terminal-pager/package'
sys.path.insert(0, S)
import fastpty
env=dict(LESS='',LESSNOCONFIG='',LESSHISTFILE='/dev/null')

# QUIET has to outlast the pager's own settle timers (PROMPT_SETTLE_MS
# 150, EDGE_DWELL_MS 120) or the sweep reads a half-drawn screen
QUIET=float(os.environ.get('QUIET','0.30'))
def run(cmd,keys):
    return fastpty.run(cmd,list(keys),24,80,env,cwd=S,
                       quiet=QUIET,first=2.5,step=2.5,dead=40)
def esc(b):
    return ' '.join({27:'ESC',13:'\\r',10:'\\n',8:'\\b',7:'\\a'}.get(c, chr(c) if 32<=c<127 else '\\x%02x'%c) for c in b)
def hx(s): return ','.join(binascii.hexlify(c.encode()).decode() for c in s)
CASES = [a.encode().decode('unicode_escape') for a in sys.argv[1:]] or [
    '/l\rq', '/zz\rq', '/line 5\rq', '/5\rnq', '?9\rq', '/9\rq',
    '/line 30\rq', '/5\rNq', '/9\rNq', '/5\rnNq', '?5\rnq',
    '/zz\rnq', '/5\rnnq', '/line 30\rNq', '?line 90\rq',
]
def one(keys):
    return (run([f'{P}/less/less','-X','lines.txt'],keys),
            run(['node',f'{P}/dist/cli.js','-X','lines.txt'],keys))

started=time.time()
bad=0
for keys,(a,b) in zip(CASES, fastpty.imap(one, CASES)):
    i=0
    while i<min(len(a),len(b)) and a[i]==b[i]: i+=1
    ok = a==b
    if not ok: bad+=1
    print(f'{keys!r:14} less={len(a):5} ours={len(b):5} {"SAME" if ok else "DIFF@"+str(i)}')
    if not ok:
        print('  less  :',esc(a[i-14:i+55])); print('  ours:',esc(b[i-14:i+55]))
print(f'{len(CASES)-bad}/{len(CASES)} identical   [{time.time()-started:.1f}s]')
