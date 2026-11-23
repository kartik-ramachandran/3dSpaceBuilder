import json, os, sys, math

def qmat(q):
    x, y, z, w = q
    return [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]

def mul(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def local(n):
    if 'matrix' in n:
        m = n['matrix']; return [[m[c*4+r] for c in range(4)] for r in range(4)]
    t = n.get('translation', [0, 0, 0]); r = qmat(n.get('rotation', [0, 0, 0, 1])); s = n.get('scale', [1, 1, 1])
    return [[r[i][0]*s[0], r[i][1]*s[1], r[i][2]*s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]

root = sys.argv[1]
for mid in sorted(os.listdir(root)):
    p = os.path.join(root, mid, mid + '.gltf')
    g = json.load(open(p, encoding='utf-8'))
    lo = [1e9]*3; hi = [-1e9]*3; tris = 0
    def walk(i, M):
        global tris
        n = g['nodes'][i]; W = mul(M, local(n))
        if 'mesh' in n:
            for pr in g['meshes'][n['mesh']]['primitives']:
                a = g['accessors'][pr['attributes']['POSITION']]
                if 'indices' in pr: tris += g['accessors'][pr['indices']]['count'] // 3
                mn, mx = a['min'], a['max']
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            v = [W[r][0]*cx + W[r][1]*cy + W[r][2]*cz + W[r][3] for r in range(3)]
                            for k in range(3): lo[k] = min(lo[k], v[k]); hi[k] = max(hi[k], v[k])
        for c in n.get('children', []): walk(c, W)
    I = [[1 if i == j else 0 for j in range(4)] for i in range(4)]
    for s in g['scenes'][g.get('scene', 0)]['nodes']: walk(s, I)
    print(f"{mid:28s} size x={hi[0]-lo[0]:.2f} y={hi[1]-lo[1]:.2f} z={hi[2]-lo[2]:.2f}  min=({lo[0]:.2f},{lo[1]:.2f},{lo[2]:.2f})  tris={tris}")
