import base64, json, os, sys

root = sys.argv[1]
models = os.path.join(root, 'assets', 'models')
for mid in os.listdir(models):
    d = os.path.join(models, mid)
    gp = os.path.join(d, mid + '.gltf')
    g = json.load(open(gp, encoding='utf-8'))
    for b in g.get('buffers', []):
        uri = b.get('uri', '')
        if uri and not uri.startswith('data:'):
            bp = os.path.join(d, uri)
            b['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(open(bp, 'rb').read()).decode('ascii')
            os.remove(bp)
    json.dump(g, open(os.path.join(d, mid + '.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    os.remove(gp)
hd = os.path.join(root, 'assets', 'hdri')
for f in os.listdir(hd):
    if f.endswith('.hdr'):
        p = os.path.join(hd, f)
        open(p[:-4] + '.txt', 'w', encoding='ascii').write(base64.b64encode(open(p, 'rb').read()).decode('ascii'))
        os.remove(p)
total = sum(os.path.getsize(os.path.join(a, f)) for a, _, fs in os.walk(root) for f in fs)
print('packed; total MB', round(total / 1e6, 1))
