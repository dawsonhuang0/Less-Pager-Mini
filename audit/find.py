import json, re, sys
cs = json.load(open('audit/commits.json'))
pat = re.compile(sys.argv[1], re.I)
hits = [c for c in cs if pat.search(c['subj']) or pat.search(c['body'])]
for c in hits:
    body = re.sub(r'\s+', ' ', c['body'])
    print(f"* {c['sha']} {c['subj']}")
    if body: print(f"    {body[:300]}")
print(f"--- {len(hits)} hits for /{sys.argv[1]}/")
