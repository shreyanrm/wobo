import json, urllib.request, urllib.parse, time, pathlib, sys, string, random
SC = pathlib.Path(sys.argv[1]); OUT = SC / 'harvest.json'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
def google(q):
    u = 'https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=in&q=' + urllib.parse.quote(q)
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=8)
        d = json.loads(r.read().decode('utf-8', 'ignore'))
        return d[1] if isinstance(d, list) and len(d) > 1 else []
    except Exception: return []
def bing(q):
    u = 'https://api.bing.com/osjson.aspx?market=en-IN&query=' + urllib.parse.quote(q)
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=8)
        d = json.loads(r.read().decode('utf-8', 'ignore'))
        return d[1] if isinstance(d, list) and len(d) > 1 else []
    except Exception: return []
cur = json.loads((SC / 'curriculum.json').read_text())
units = [r for r in cur if r['kind'] == 'unit']
PRODUCT = [
 'ai tutor app','learning app','learn online','online learning app','best learning app',
 'doubt solving app','homework help app','study app','education app india','ai teacher app',
 'ai tutor for cbse','best app for class 10','free learning app','app to solve maths questions',
 'photo se question solve','padhai wala app','doubt clear karne wala app','online tuition app',
 'ncert solutions app','study app for students','ai study buddy','best study app for class 12',
 'app that explains chapters','learn with ai','ai homework helper','maths solving app',
]
SYLL = []
for cls in ['Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12']:
    n = cls.split()[-1]
    for sub in ['maths','science','physics','chemistry','biology','social science','english']:
        SYLL += [f'class {n} {sub}', f'ncert solutions class {n} {sub}', f'class {n} {sub} notes',
                 f'class {n} {sub} chapter', f'{sub} class {n} important questions']
CHAP = []
seen = set()
for u in units:
    if not u['class'] or not u['subject']: continue
    n = u['class'].split()[-1]
    k = (n, u['name'][:40])
    if k in seen: continue
    seen.add(k)
    CHAP.append(f"{u['name']} class {n}")
random.seed(7); random.shuffle(CHAP)
seeds = PRODUCT + SYLL + CHAP[:260]
MODS = ['', ' how', ' best', ' free', ' for cbse', ' pdf', ' explained', ' vs']
found = {}
t0 = time.time(); n = 0
for s in seeds:
    for m in (MODS if s in PRODUCT else ['', ' solutions', ' notes', ' explanation']):
        q = (s + m).strip()
        for fn, src in ((google, 'g'), (bing, 'b')):
            for r in fn(q):
                r = r.strip().lower()
                if len(r) > 3: found.setdefault(r, set()).add(src)
            n += 1
            time.sleep(0.12)
    if len(found) % 500 < 20:
        OUT.write_text(json.dumps({k: sorted(v) for k, v in found.items()}, indent=0))
OUT.write_text(json.dumps({k: sorted(v) for k, v in found.items()}, indent=0))
print('queries', n, 'unique keywords', len(found), 'seconds', round(time.time()-t0))
