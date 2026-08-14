import json, sys, re
cs = [c for c in json.load(open('audit/core-commits.json')) if c['body']]
cs.sort(key=lambda c: -c['n'])
a, b = int(sys.argv[1]), int(sys.argv[2])
for c in cs[a:b]:
    body = re.sub(r'\s+', ' ', c['body'])[:520]
    print(f"[{c['n']}] {c['sha']} {c['subj']}\n    {body}\n    ~ {','.join(c.get('corefiles', c['files'])[:6])}")
print(f"--- shown {a}..{min(b,len(cs))} of {len(cs)}")
