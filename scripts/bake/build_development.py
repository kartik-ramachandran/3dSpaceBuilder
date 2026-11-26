"""
Realistic building shells for the builder's residential development (app.html), with ambient occlusion
baked in Cycles. The app keeps its own real-time sun, shadows, apartments, values and site layers; these
models replace its box facades.

    blender -b -P scripts/bake/build_development.py -- [--samples 64] [--size 2048] [--quick] [--preview]

Dimensions follow src/spec/site-layout.js (DEV): low-rise blocks of 4 apartments × 7.5 m (30 m wide,
11 m deep, 3.2 m floors, 0.6 m plinth) and 26 × 14 m towers. Each module is modelled once at the origin:
the app repeats the typical floors with instancing (4 per low-rise block, 100 per tower).

Output (assets/development/):  buildings.glb  modules tagged module=lowrise_base | lowrise_floor |
lowrise_roof | tower_floor | tower_crown, with a TEXCOORD_1 set for  buildings_ao.jpg.
Axes: Blender Z up; the balcony front faces -Y, which is +Z (the front) in the app.
"""
import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bakelib as L

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
arg = lambda n, d: type(d)(ARGS[ARGS.index(n) + 1]) if n in ARGS else d
QUICK = '--quick' in ARGS
SAMPLES = 16 if QUICK else arg('--samples', 64)
SIZE = 1024 if QUICK else arg('--size', 2048)
OUT = os.path.join(L.ROOT, 'assets', 'development'); os.makedirs(OUT, exist_ok=True)

UW, D, FH, BASE, BAL = 7.5, 11.0, 3.2, 0.6, 1.6      # must match src/spec/site-layout.js
UNITS = 4; BX = UNITS * UW
TW, TD = 26.0, 14.0                                   # tower footprint (layout.towerWidth / towerDepth)

scene = L.reset()
col = L.collection('Modules'); ctx = L.collection('Bake context')

M = {
    'render': L.material('Render', (0.87, 0.85, 0.81), 0.85, tex='white_plaster_02', normal_strength=0.4, use_diffuse=False),
    'slab': L.material('Slab edge', (0.9, 0.89, 0.86), 0.7),
    'soffit': L.material('Soffit', (0.93, 0.92, 0.9), 0.9),
    'frame': L.material('Charcoal frame', (0.11, 0.11, 0.12), 0.4, 0.7),
    'glass': L.material('Glazing', (0.62, 0.72, 0.76), 0.04, 0.2),
    'balustrade': L.material('Balustrade glass', (0.8, 0.88, 0.9), 0.03),
    'rail': L.material('Handrail', (0.16, 0.16, 0.17), 0.35, 0.8),
    'stone': L.material('Stone', rough=0.7, tex='stacked_stone_wall', tint=(1.12, 1.08, 1.02)),
    'stone_smooth': L.material('Limestone', (0.82, 0.77, 0.69), 0.55, tex='marble_01', tint=(1.0, 0.94, 0.84), normal_strength=0.3),
    'bronze': L.material('Bronze', (0.36, 0.29, 0.21), 0.35, 0.85),
    'concrete': L.material('Roof concrete', (0.62, 0.61, 0.58), 0.9),
    'oak': L.material('Interior oak', rough=0.55, tex='oak_wood_planks', tint=(1.15, 1.06, 0.94)),
    'inner': L.material('Interior wall', (0.9, 0.87, 0.82), 0.9),
    'linen': L.material('Curtain', (0.93, 0.9, 0.84), 0.95),
}
EXTERIOR = {'Render', 'Charcoal frame', 'Glazing', 'Stone', 'Limestone', 'Bronze', 'Slab edge'}

def tag(objs, module):
    for o in objs: o['module'] = module
    return objs

def B(name, *a, **k):
    return L.box(col, name, *a, **k)

def wall_with_windows(name, axis, fixed, a0, a1, z0, z1, t, windows, mat, glass_inset, side):
    """A wall along x (axis='x', at y=fixed) or y (axis='y', at x=fixed) with rectangular openings
    [(a_centre, width, sill, head)], each glazed and framed. side = +1/-1: the outward direction."""
    objs = []; cur = a0
    def piece(p, q, zz0, zz1):
        if q - p < 0.01 or zz1 - zz0 < 0.01: return
        if axis == 'x': objs.append(B(name, p, fixed - t / 2, zz0, q, fixed + t / 2, zz1, mat, tile=2.5))
        else: objs.append(B(name, fixed - t / 2, p, zz0, fixed + t / 2, q, zz1, mat, tile=2.5))
    for c, w, sill, head in sorted(windows):
        p, q = c - w / 2, c + w / 2
        piece(cur, p, z0, z1); piece(p, q, z0, z0 + sill); piece(p, q, z0 + head, z1); cur = q
        g = fixed + side * (t / 2 - glass_inset)
        if axis == 'x':
            objs.append(B(name + ' glass', p, min(g, g + side * 0.02), z0 + sill, q, max(g, g + side * 0.02), z0 + head, M['glass']))
            for x in (p, q - 0.05): objs.append(B(name + ' frame', x, min(g, g + side * 0.07), z0 + sill, x + 0.05, max(g, g + side * 0.07), z0 + head, M['frame']))
            for z in (z0 + sill, z0 + head - 0.05): objs.append(B(name + ' frame', p, min(g, g + side * 0.07), z, q, max(g, g + side * 0.07), z + 0.05, M['frame']))
            objs.append(B(name + ' sill', p - 0.05, min(fixed + side * t / 2, fixed + side * (t / 2 + 0.06)), z0 + sill - 0.05, q + 0.05, max(fixed + side * t / 2, fixed + side * (t / 2 + 0.06)), z0 + sill, M['slab']))
        else:
            objs.append(B(name + ' glass', min(g, g + side * 0.02), p, z0 + sill, max(g, g + side * 0.02), q, z0 + head, M['glass']))
            for y in (p, q - 0.05): objs.append(B(name + ' frame', min(g, g + side * 0.07), y, z0 + sill, max(g, g + side * 0.07), y + 0.05, z0 + head, M['frame']))
            for z in (z0 + sill, z0 + head - 0.05): objs.append(B(name + ' frame', min(g, g + side * 0.07), p, z, max(g, g + side * 0.07), q, z + 0.05, M['frame']))
    piece(cur, a1, z0, z1)
    return objs

# ---------------------------------------------------------------- low-rise block: one typical floor (z 0 … FH)
def lowrise_floor():
    o = []; hx, hy = BX / 2, D / 2
    o.append(B('LR slab', -hx - 0.3, -hy - 0.3, 0, hx + 0.3, hy + 0.3, 0.3, M['slab']))
    o.append(B('LR soffit', -hx + 0.2, -hy + 0.2, FH - 0.03, hx - 0.2, hy - 0.2, FH - 0.01, M['soffit']))
    for k in range(UNITS):
        x0, x1 = -hx + k * UW, -hx + (k + 1) * UW
        # front: floor-to-ceiling sliding doors onto a balcony
        g = -hy + 0.2
        o.append(B('LR front glass', x0 + 0.15, g - 0.01, 0.3, x1 - 0.15, g + 0.01, FH - 0.35, M['glass']))
        o.append(B('LR head', x0 + 0.15, g - 0.06, FH - 0.35, x1 - 0.15, g + 0.06, FH, M['frame']))
        for i in range(6):
            x = x0 + 0.15 + (UW - 0.3) * i / 5
            o.append(B('LR mullion', x - 0.03, g - 0.05, 0.3, x + 0.03, g + 0.05, FH - 0.35, M['frame']))
        o.append(B('LR balcony', x0 + 0.3, -hy - BAL, 0.0, x1 - 0.3, -hy, 0.2, M['slab']))
        o.append(B('LR balustrade', x0 + 0.35, -hy - BAL + 0.04, 0.2, x1 - 0.35, -hy - BAL + 0.06, 1.12, M['balustrade']))
        o.append(B('LR handrail', x0 + 0.35, -hy - BAL + 0.02, 1.12, x1 - 0.35, -hy - BAL + 0.09, 1.17, M['rail']))
        for x in (x0 + 0.35, x1 - 0.39):
            o.append(B('LR post', x, -hy - BAL + 0.02, 0.2, x + 0.04, -hy - BAL + 0.09, 1.12, M['rail']))
        # back: two framed windows per apartment in a rendered wall
        o += wall_with_windows('LR back', 'x', hy - 0.12, x0, x1, 0.3, FH, 0.24, [(x0 + 1.9, 1.6, 0.75, 2.35), (x0 + 5.6, 1.6, 0.75, 2.35)], M['render'], 0.1, +1)
        # interior hint behind the glass
        o.append(B('LR interior floor', x0 + 0.1, -hy + 0.2, 0.3, x1 - 0.1, hy - 0.25, 0.31, M['oak'], tile=2.4))
        cw = 0.7 + (k * 0.55) % 1.6
        o.append(B('LR curtain', x0 + 0.25, -hy + 0.32, 0.35, x0 + 0.25 + cw, -hy + 0.37, FH - 0.4, M['linen']))
    for k in range(1, UNITS):                                     # fins between the balconies
        x = -hx + k * UW
        o.append(B('LR fin', x - 0.12, -hy - BAL, 0.2, x + 0.12, -hy + 0.2, FH, M['render'], tile=2.5))
    for side in (-1, 1):                                          # ends: rendered with one window per floor
        o += wall_with_windows('LR end', 'y', side * (hx - 0.12), -hy + 0.2, hy, 0.3, FH, 0.24, [(1.5, 1.2, 0.9, 2.3)], M['render'], 0.1, side)
        o.append(B('LR end pier', min(side * hx, side * (hx - 0.3)), -hy - 0.25, 0.3, max(side * hx, side * (hx - 0.3)), -hy + 0.25, FH, M['render']))
    return tag(o, 'lowrise_floor')

def lowrise_base():
    hx, hy = BX / 2, D / 2
    o = [B('LR plinth', -hx - 0.6, -hy - 0.6, 0, hx + 0.6, hy + 0.6, BASE, M['stone'], tile=1.6),
         B('LR plinth cap', -hx - 0.65, -hy - 0.65, BASE - 0.06, hx + 0.65, hy + 0.65, BASE, M['stone_smooth']),
         B('LR entrance step', -1.6, -hy - 2.6, 0, 1.6, -hy - 0.6, 0.3, M['stone_smooth'])]
    return tag(o, 'lowrise_base')

def lowrise_roof():
    hx, hy = BX / 2, D / 2
    o = [B('LR roof', -hx - 0.4, -hy - 0.4, 0, hx + 0.4, hy + 0.4, 0.35, M['concrete'], tile=3)]
    for side in (-1, 1):
        o.append(B('LR parapet', -hx - 0.4, min(side * (hy + 0.4), side * (hy + 0.15)), 0.35, hx + 0.4, max(side * (hy + 0.4), side * (hy + 0.15)), 0.75, M['render']))
        o.append(B('LR parapet', min(side * (hx + 0.4), side * (hx + 0.15)), -hy - 0.4, 0.35, max(side * (hx + 0.4), side * (hx + 0.15)), hy + 0.4, 0.75, M['render']))
    o.append(B('LR coping', -hx - 0.45, -hy - 0.45, 0.75, hx + 0.45, -hy - 0.1, 0.8, M['frame']))
    o.append(B('LR lift overrun', -hx + 3, hy - 4.2, 0.35, -hx + 6.5, hy - 1.2, 2.6, M['render']))
    return tag(o, 'lowrise_roof')

# ---------------------------------------------------------------- tower: one typical floor, and the crown
def tower_floor():
    o = []; hx, hy = TW / 2, TD / 2; bw = TW * 0.35
    o.append(B('T slab', -hx - 0.3, -hy - 0.3, 0, hx + 0.3, hy + 0.3, 0.25, M['slab']))
    o.append(B('T soffit', -hx + 0.3, -hy + 0.3, FH - 0.03, hx - 0.3, hy - 0.3, FH - 0.01, M['soffit']))
    for side in (-1, 1):
        g = side * (hy - 0.25)
        o.append(B('T glass', -hx + 0.9, min(g, g + side * 0.02), 0.25, hx - 0.9, max(g, g + side * 0.02), FH - 0.4, M['glass']))
        o.append(B('T head', -hx + 0.9, min(g - side * 0.05, g + side * 0.08), FH - 0.4, hx - 0.9, max(g - side * 0.05, g + side * 0.08), FH, M['bronze']))
        for i in range(17):
            x = -hx + 0.9 + (TW - 1.8) * i / 16
            o.append(B('T mullion', x - 0.035, min(g - side * 0.03, g + side * 0.1), 0.25, x + 0.035, max(g - side * 0.03, g + side * 0.1), FH - 0.4, M['bronze']))
        yo = side * hy; yb = side * (hy + 1.3)
        o.append(B('T balcony', -bw, min(yo, yb), 0, bw, max(yo, yb), 0.2, M['stone_smooth']))
        yr = yb - side * 0.05
        o.append(B('T balustrade', -bw + 0.05, min(yr, yr + side * 0.02), 0.2, bw - 0.05, max(yr, yr + side * 0.02), 1.12, M['balustrade']))
        o.append(B('T handrail', -bw + 0.05, min(yr - side * 0.02, yr + side * 0.06), 1.12, bw - 0.05, max(yr - side * 0.02, yr + side * 0.06), 1.17, M['bronze']))
        # interior hint: oak floor, a central core and curtains drawn to different widths
        o.append(B('T interior floor', -hx + 0.9, min(g, side * 2.6), 0.25, hx - 0.9, max(g, side * 2.6), 0.26, M['oak'], tile=2.4))
        for k in range(4):
            x = -hx + 1.4 + k * 6.2; cw = 0.8 + (k * 0.7 + (side > 0) * 0.9) % 1.9
            o.append(B('T curtain', x, min(g - side * 0.12, g - side * 0.17), 0.3, x + cw, max(g - side * 0.12, g - side * 0.17), FH - 0.45, M['linen']))
    o.append(B('T core', -4.5, -2.6, 0.25, 4.5, 2.6, FH, M['inner']))
    for x in (-hx, -TW * 0.3, TW * 0.3, hx):                      # stone piers running the full height
        o.append(B('T pier', x - 0.45, -hy - 0.55, 0, x + 0.45, hy + 0.55, FH, M['stone_smooth'], tile=1.6))
    for side in (-1, 1):                                          # ends: stone with a slot window
        o += wall_with_windows('T end', 'y', side * (hx - 0.15), -hy + 0.55, hy - 0.55, 0.25, FH, 0.3, [(0.0, 1.4, 0.4, 2.6)], M['stone_smooth'], 0.1, side)
    return tag(o, 'tower_floor')

def tower_crown():
    o = []; hx, hy = TW / 2, TD / 2
    o.append(B('T roof', -hx - 0.4, -hy - 0.6, 0, hx + 0.4, hy + 0.6, 0.45, M['concrete'], tile=3))
    for x in (-hx, -TW * 0.3, TW * 0.3, hx):
        o.append(B('T crown pier', x - 0.5, -hy - 0.6, 0, x + 0.5, hy + 0.6, 7.2, M['stone_smooth'], tile=1.6))
    o.append(B('T crown band', -hx - 0.8, -hy - 0.9, 6.6, hx + 0.8, hy + 0.9, 7.6, M['stone_smooth'], tile=1.6))
    o.append(B('T crown fascia', -hx - 0.85, -hy - 0.95, 7.6, hx + 0.85, hy + 0.95, 7.75, M['bronze']))
    o.append(B('T plant room', -6, -3, 0.45, 6, 3, 4.2, M['render']))
    for side in (-1, 1):
        o.append(B('T crown glass', -hx + 0.9, min(side * (hy + 0.3), side * (hy + 0.32)), 0.45, hx - 0.9, max(side * (hy + 0.3), side * (hy + 0.32)), 1.6, M['balustrade']))
    return tag(o, 'tower_crown')

modules = {'lowrise_floor': lowrise_floor(), 'lowrise_base': lowrise_base(), 'lowrise_roof': lowrise_roof(),
           'tower_floor': tower_floor(), 'tower_crown': tower_crown()}
L.apply_modifiers([o for objs in modules.values() for o in objs])

# ---------------------------------------------------------------- bake arrangement: real neighbours for occlusion
# low-rise stack at x = -70: plinth, three floors (the middle one is baked), roof; tower stack at x = +70: three floors, crown
def place(objs, dx, dz):
    for o in objs: o.location.x += dx; o.location.z += dz
def ghost(objs, dx, dz):
    for o in objs:
        d = o.copy(); d.location.x += dx; d.location.z += dz; ctx.objects.link(d)
LX, TX = -70.0, 70.0
place(modules['lowrise_base'], LX, 0)
place(modules['lowrise_floor'], LX, BASE + FH)                 # level 2 of 3: baked
ghost(modules['lowrise_floor'], 0, -FH); ghost(modules['lowrise_floor'], 0, FH)
place(modules['lowrise_roof'], LX, BASE + 3 * FH)
place(modules['tower_floor'], TX, FH)                          # middle of three: baked
ghost(modules['tower_floor'], 0, -FH); ghost(modules['tower_floor'], 0, FH)
place(modules['tower_crown'], TX, 3 * FH)
L.box(ctx, 'Ground', -140, -60, -0.2, 140, 60, 0, M['concrete'])

world = bpy.data.worlds.new('Sky'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.8, 0.85, 0.9, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
L.use_gpu(scene)

if '--preview' in ARGS:
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); sun.data.energy = 4; scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    L.preview(scene, (LX - 40, -45, 22), (LX, 0, 8), 34, os.path.join(OUT, 'preview_lowrise.jpg'))
    L.preview(scene, (TX - 30, -40, 18), (TX, 0, 6), 34, os.path.join(OUT, 'preview_tower.jpg'))
    raise SystemExit

# ---------------------------------------------------------------- bake ambient occlusion into one shared atlas
targets = [o for objs in modules.values() for o in objs if o.type == 'MESH' and o.material_slots[0].material not in (M['glass'], M['balustrade'])]
L.lightmap_uvs(targets)
L.bake_ao(scene, targets, SIZE, SAMPLES, os.path.join(OUT, 'buildings_ao.jpg'), distance=1.6)

# ---------------------------------------------------------------- export every module at its own origin
place(modules['lowrise_base'], -LX, 0); place(modules['lowrise_floor'], -LX, -(BASE + FH)); place(modules['lowrise_roof'], -LX, -(BASE + 3 * FH))
place(modules['tower_floor'], -TX, -FH); place(modules['tower_crown'], -TX, -3 * FH)
everything = [o for objs in modules.values() for o in objs]
for o in everything:
    mat = o.material_slots[0].material
    o['exterior'] = mat.name in EXTERIOR or mat.name.startswith('Glazing')
L.export_glb(everything, os.path.join(OUT, 'buildings.glb'))
