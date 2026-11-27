"""
Street life and neighbourhood for the builder's residential development (app.html), modelled in Blender:
cars (sedan, SUV, hatchback), a truck, people (jointed for walking), trees (branching skin-modifier wood
with leaf cards from the Poly Haven jacaranda atlas), street lamps and detached houses (AO baked).

    blender -b -P scripts/bake/build_props.py -- [--samples 64] [--size 2048] [--quick] [--preview]

Output (assets/development/):  props.glb  every object tagged module=<name> (and part=<limb> for people);
props_ao.jpg ambient occlusion for the houses (TEXCOORD_1). Each module sits at its own origin, on the ground.
Axes: Blender Z up. Vehicles face +X. People face -Y (the app's +Z) with limbs pivoting at hip / shoulder.
"""
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import bakelib as L

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
arg = lambda n, d: type(d)(ARGS[ARGS.index(n) + 1]) if n in ARGS else d
QUICK = '--quick' in ARGS
SAMPLES = 16 if QUICK else arg('--samples', 64)
SIZE = 1024 if QUICK else arg('--size', 2048)
OUT = os.path.join(L.ROOT, 'assets', 'development'); os.makedirs(OUT, exist_ok=True)
MODELS = os.path.join(L.SRC, 'models')

scene = L.reset()
col = L.collection('Props'); ctx = L.collection('Bake context')
MODULES = {}

def tag(objs, module, part=None):
    for o in objs:
        o['module'] = module
        if part: o['part'] = part
    MODULES.setdefault(module, []).extend(objs)
    return objs

def tex_material(name, diff, nor=None, rough=0.8, tint=None, keep=False):
    m = L.material(name, rough=rough)
    if L.SMOOTH and not keep:                 # smooth: average colour, no image
        c = L.mean_colour(diff); m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1)
        return m, None
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(diff, check_existing=True)
    if tint:
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
        nt.links.new(t.outputs['Color'], mix.inputs['A']); mix.inputs['B'].default_value = (*tint, 1); nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    else: nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if nor:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(nor, check_existing=True); n.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m, t

JT = os.path.join(MODELS, 'jacaranda_tree', 'textures')
M = {
    # vehicles: paint is white so the app tints it per car
    'paint': L.material('Paint', (0.92, 0.92, 0.92), 0.25, 0.3, coat=1.0),
    'car_glass': L.material('Car glass', (0.04, 0.05, 0.06), 0.05, 0.4),
    'tyre': L.material('Tyre', (0.03, 0.03, 0.03), 0.9),
    'rim': L.material('Rim', (0.75, 0.76, 0.78), 0.25, 1.0),
    'trim': L.material('Trim', (0.05, 0.05, 0.055), 0.6),
    'headlight': L.material('Headlight', (0.95, 0.95, 0.9), 0.1, emission=((1, 0.95, 0.8), 0.6)),
    'taillight': L.material('Taillight', (0.6, 0.03, 0.02), 0.2, emission=((1, 0.05, 0.02), 0.5)),
    'trailer': L.material('Trailer', (0.88, 0.87, 0.84), 0.5),
    # people: white so the app tints each person's clothes, skin and hair
    'shirt': L.material('Shirt', (0.92, 0.92, 0.92), 0.85),
    'trousers': L.material('Trousers', (0.92, 0.92, 0.92), 0.85),
    'skin': L.material('Skin', (0.92, 0.92, 0.92), 0.6),
    'hair': L.material('Hair', (0.92, 0.92, 0.92), 0.7),
    'shoes': L.material('Shoes', (0.06, 0.06, 0.06), 0.5),
    # houses
    'render': L.material('House render', (0.86, 0.84, 0.8), 0.85, tex='white_plaster_02', normal_strength=0.4, use_diffuse=False),
    'cladding': L.material('Timber cladding', rough=0.7, tex='exterior_wall_cladding', tint=(1.0, 0.95, 0.9)),
    'roof': L.material('Roof tiles', rough=0.8, tex='grey_roof_tiles', tint=(0.8, 0.8, 0.82)),
    'metal_roof': L.material('Metal roof', (0.18, 0.19, 0.2), 0.45, 0.6),
    'window': L.material('House glass', (0.1, 0.13, 0.15), 0.05, 0.3),
    'frame': L.material('House frame', (0.12, 0.12, 0.13), 0.45, 0.3),
    'door': L.material('Front door', rough=0.5, tex='dark_wood'),
    'garage': L.material('Garage door', (0.55, 0.55, 0.55), 0.5, 0.4),
    'concrete': L.material('Path concrete', (0.66, 0.65, 0.62), 0.9),
    'deck': L.material('Deck', rough=0.7, tex='wood_floor_deck'),
}
M['bark'], _ = tex_material('Bark', os.path.join(JT, 'jacaranda_tree_trunk_diff_1k.jpg'), os.path.join(JT, 'jacaranda_tree_trunk_nor_gl_1k.jpg'), 0.9)
M['leaves'], leaf_tex = tex_material('Leaves', os.path.join(JT, 'jacaranda_tree_leaves_diff_1k.jpg'), None if L.SMOOTH else os.path.join(JT, 'jacaranda_tree_leaves_nor_gl_1k.jpg'), 0.7, keep=True)   # the leaf cards need their atlas for shape
# alpha from the atlas' black background (for the Blender previews; the app uses an alpha test on the same map)
lm = M['leaves']; nt = lm.node_tree
ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.06; ramp.color_ramp.elements[1].position = 0.12
nt.links.new(leaf_tex.outputs['Color'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Alpha'])
lm.blend_method = 'CLIP' if hasattr(lm, 'blend_method') else lm.blend_method

# ---------------------------------------------------------------- mesh helpers
def mesh_obj(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat); col.objects.link(ob)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    return ob

def extrude(name, pts, a0, a1, mat, axis='y', bevel=0.0, tile=1.0):
    """A prism: polygon pts in (x, z) extruded along y (axis='y'), or pts in (y, z) extruded along x (axis='x')."""
    bm = bmesh.new()
    def v(u, z, a): return bm.verts.new((u, a, z) if axis == 'y' else (a, u, z))
    lo = [v(u, z, a0) for u, z in pts]; hi = [v(u, z, a1) for u, z in pts]
    bm.faces.new(list(reversed(lo)) if axis == 'y' else lo); bm.faces.new(hi if axis == 'y' else list(reversed(hi)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]) if axis == 'y' else (lo[i], hi[i], hi[j], lo[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.normal_update(); L.world_uv(bm, tile)
    ob = mesh_obj(name, bm, mat)
    if bevel:
        mod = ob.modifiers.new('Bevel', 'BEVEL'); mod.width = bevel; mod.segments = 2; mod.limit_method = 'ANGLE'; mod.angle_limit = math.radians(40)
        for p in ob.data.polygons: p.use_smooth = True
        ob.modifiers.new('Weighted', 'WEIGHTED_NORMAL')
    return ob

def wheel(name, x, y, z, r, w, rim_r=None):
    objs = []
    for mat, rad, depth, verts in ((M['tyre'], r, w, 28), (M['rim'], rim_r or r * 0.62, w + 0.02, 20)):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=rad, radius2=rad, depth=depth)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
        bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, z)); L.world_uv(bm, 0.5)
        ob = mesh_obj(name, bm, mat, smooth=True)
        if mat is M['tyre']:
            mod = ob.modifiers.new('Bevel', 'BEVEL'); mod.width = 0.05; mod.segments = 3
        objs.append(ob)
    return objs

def B(name, *a, **k): return L.box(col, name, *a, **k)

def arch_profile(L_, clear, wheels, r, front_pts, top_pts, rear_pts):
    """Side profile: bottom edge from rear to front with wheel arches, then the given front / top / rear outline."""
    pts = [(-L_ / 2 + 0.05, clear)]
    for wx in wheels:
        ar = r + 0.07
        pts.append((wx - ar, clear))
        for k in range(1, 8):
            a = math.pi - math.pi * k / 8
            pts.append((wx + ar * math.cos(a), r + 0.02 + ar * math.sin(a) * 0.95))
        pts.append((wx + ar, clear))
    pts.append((L_ / 2 - 0.05, clear))
    return pts + front_pts + top_pts + rear_pts

# ---------------------------------------------------------------- vehicles (face +X, on the ground at z=0)
def car(module, L_, W, r, wb, clear, lower_front, lower_top, lower_rear, glass, roof):
    o = []; hw = W / 2
    wheels_x = (-wb / 2, wb / 2)
    o.append(extrude('Body', arch_profile(L_, clear, wheels_x, r, lower_front, lower_top, lower_rear), -hw, hw, M['paint'], bevel=0.06))
    o.append(extrude('Glasshouse', glass, -hw + 0.1, hw - 0.1, M['car_glass'], bevel=0.03))
    o.append(extrude('Roof', roof, -hw + 0.12, hw - 0.12, M['paint'], bevel=0.04))
    # pillars between the windows
    gx = sorted(p[0] for p in glass); mid = (gx[0] + gx[-1]) / 2 - 0.1
    zs = [p[1] for p in glass]
    for y in (-hw + 0.08, hw - 0.12):
        o.append(B('B pillar', mid - 0.06, y, min(zs) + 0.02, mid + 0.06, y + 0.04, max(zs) - 0.03, M['trim']))
    for wx in wheels_x:
        for y in (-hw + 0.1, hw - 0.1): o += wheel('Wheel', wx, y, r, r, 0.22)
    fx = max(p[0] for p in lower_front)
    hz = sorted(p[1] for p in lower_front)[len(lower_front) // 2]
    for s in (-1, 1):
        o.append(B('Headlight', fx - 0.12, s * (hw - 0.22) - 0.2, hz - 0.06, fx + 0.01, s * (hw - 0.22) + 0.2, hz + 0.06, M['headlight']))
        o.append(B('Taillight', -L_ / 2 + 0.0, s * (hw - 0.2) - 0.22, lower_rear[0][1] - 0.18, -L_ / 2 + 0.12, s * (hw - 0.2) + 0.22, lower_rear[0][1] - 0.06, M['taillight']))
        o.append(B('Mirror', mid + 0.85, s * (hw + 0.08) - 0.06, zs[0] + 0.02, mid + 1.0, s * (hw + 0.08) + 0.06, zs[0] + 0.14, M['paint']))
    o.append(B('Grille', fx - 0.08, -0.45, clear + 0.12, fx + 0.02, 0.45, clear + 0.3, M['trim']))
    o.append(B('Rear bumper', -L_ / 2 - 0.02, -hw + 0.1, clear, -L_ / 2 + 0.2, hw - 0.1, clear + 0.18, M['trim']))
    o.append(B('Sill', -wb / 2 + r + 0.1, -hw - 0.005, clear, wb / 2 - r - 0.1, hw + 0.005, clear + 0.08, M['trim']))
    return tag(o, module)

car('car_sedan', 4.7, 1.84, 0.33, 2.8, 0.2,
    [(2.38, 0.42), (2.36, 0.62), (2.15, 0.78)], [(1.2, 0.9), (-1.75, 0.96)], [(-2.3, 0.92), (-2.38, 0.6)],
    [(1.0, 0.92), (0.2, 1.38), (-0.95, 1.40), (-1.72, 0.96)], [(0.24, 1.36), (-0.98, 1.38), (-0.98, 1.44), (0.2, 1.42)])
car('car_suv', 4.75, 1.92, 0.38, 2.85, 0.26,
    [(2.4, 0.5), (2.38, 0.82), (2.1, 1.0)], [(1.35, 1.08), (-2.2, 1.12)], [(-2.35, 1.1), (-2.4, 0.7)],
    [(1.3, 1.08), (0.55, 1.68), (-2.05, 1.70), (-2.3, 1.12)], [(0.58, 1.65), (-2.08, 1.67), (-2.08, 1.74), (0.55, 1.72)])
car('car_hatch', 4.05, 1.78, 0.31, 2.55, 0.18,
    [(2.05, 0.4), (2.03, 0.6), (1.85, 0.75)], [(0.95, 0.86), (-1.85, 0.92)], [(-1.98, 0.9), (-2.03, 0.55)],
    [(0.75, 0.88), (0.0, 1.36), (-1.55, 1.38), (-1.9, 0.94)], [(0.04, 1.34), (-1.58, 1.36), (-1.6, 1.42), (0.0, 1.41)])

def truck():
    o = []
    o.append(B('Cab', 4.6, -1.22, 0.55, 6.9, 1.22, 3.1, M['paint'], bevel=0.12))
    o.append(B('Windscreen', 6.86, -1.1, 1.9, 6.95, 1.1, 2.85, M['car_glass']))
    for s in (-1, 1): o.append(B('Cab window', 5.8, s * 1.23 - 0.02, 1.9, 6.7, s * 1.23 + 0.02, 2.8, M['car_glass']))
    o.append(B('Bumper', 6.85, -1.2, 0.45, 7.05, 1.2, 0.85, M['trim']))
    for s in (-1, 1): o.append(B('Headlight', 6.95, s * 0.95 - 0.18, 0.95, 7.0, s * 0.95 + 0.18, 1.15, M['headlight']))
    o.append(B('Trailer', -6.2, -1.25, 0.95, 4.4, 1.25, 4.0, M['trailer'], bevel=0.05))
    o.append(B('Chassis', -6.2, -0.9, 0.55, 6.8, 0.9, 0.95, M['trim']))
    for s in (-1, 1): o.append(B('Taillight', -6.25, s * 1.0 - 0.15, 1.0, -6.18, s * 1.0 + 0.15, 1.2, M['taillight']))
    for x in (-4.6, -3.4, 5.9):
        for y in (-1.0, 1.0): o += wheel('Wheel', x, y, 0.5, 0.5, 0.32)
    return tag(o, 'truck')
truck()

# ---------------------------------------------------------------- people (face -Y; limbs pivot at hip / shoulder)
def skin_part(name, verts, edges, radii, mat, pivot, sub=1):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, edges, []); ob = bpy.data.objects.new(name, me); col.objects.link(ob)
    ob.modifiers.new('Skin', 'SKIN')
    for i, r in enumerate(radii): me.skin_vertices[0].data[i].radius = r
    me.skin_vertices[0].data[0].use_root = True
    s = ob.modifiers.new('Sub', 'SUBSURF'); s.levels = sub; s.render_levels = sub
    ob.data.materials.append(mat)
    L.apply_modifiers([ob])
    for p in ob.data.polygons: p.use_smooth = True
    return at_pivot(ob, pivot)

def at_pivot(ob, pivot):
    ob.data.transform(Matrix.Translation(-Vector(pivot))); ob.location = pivot
    return ob

def sphere(name, c, r, mat, scale=(1, 1, 1), keep=None):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    if keep: bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context='VERTS')
    bmesh.ops.translate(bm, verts=bm.verts, vec=c); return mesh_obj(name, bm, mat, smooth=True)

def person(module, s=1.0, slim=1.0, long_hair=False):
    """A walking figure ~1.75 m × s. Parts: body (torso, head, hair), leg_l/leg_r, arm_l/arm_r."""
    z = lambda v: v * s
    body = [skin_part('Torso', [(0, 0, z(0.9)), (0, 0, z(1.08)), (0, 0, z(1.3)), (0, 0, z(1.44)), (0, 0, z(1.54))], [(0, 1), (1, 2), (2, 3), (3, 4)],
                      [(0.15 * slim, 0.1), (0.13 * slim, 0.095), (0.17 * slim, 0.105), (0.15 * slim, 0.09), (0.05, 0.05)], M['shirt'], (0, 0, 0)),
            sphere('Head', (0, -0.01, z(1.645)), 0.1 * s, M['skin'], (0.92, 1.0, 1.18))]
    if long_hair:
        body.append(sphere('Hair', (0, 0.012, z(1.65)), 0.108 * s, M['hair'], (0.98, 1.05, 1.25), keep=lambda c: c.z > -0.02 or c.y > 0.02))
        body.append(skin_part('Hair long', [(0, 0.05, z(1.62)), (0, 0.07, z(1.42))], [(0, 1)], [(0.085, 0.05), (0.07, 0.03)], M['hair'], (0, 0, 0)))
    else:
        body.append(sphere('Hair', (0, 0.008, z(1.665)), 0.104 * s, M['hair'], (0.96, 1.04, 1.15), keep=lambda c: c.z > 0.02 or (c.y > 0.0 and c.z > -0.06)))
    tag(body, module, 'body')
    for side, part in ((-1, 'leg_l'), (1, 'leg_r')):
        hip = (side * 0.09 * slim, 0, z(0.92))
        leg = skin_part('Leg', [hip, (side * 0.09 * slim, -0.01, z(0.5)), (side * 0.085 * slim, 0.01, z(0.1))], [(0, 1), (1, 2)],
                        [(0.085 * slim, 0.085), (0.058, 0.06), (0.042, 0.045)], M['trousers'], hip)
        shoe = B('Shoe', hip[0] - 0.05, -0.17, 0, hip[0] + 0.05, 0.06, 0.09, M['shoes'], bevel=0.03); L.apply_modifiers([shoe]); at_pivot(shoe, hip)
        tag([leg, shoe], module, part)
    for side, part in ((-1, 'arm_l'), (1, 'arm_r')):
        sh = (side * 0.2 * slim, 0, z(1.41))
        arm = skin_part('Arm', [sh, (side * 0.225 * slim, 0.01, z(1.13)), (side * 0.235 * slim, -0.03, z(0.88))], [(0, 1), (1, 2)],
                        [(0.05, 0.05), (0.04, 0.04), (0.033, 0.033)], M['shirt'], sh)
        hand = sphere('Hand', (side * 0.237 * slim, -0.035, z(0.83)), 0.045, M['skin'], (0.7, 1.0, 1.4)); at_pivot(hand, sh)
        tag([arm, hand], module, part)
person('person_a', 1.0, 1.0, False)
person('person_b', 0.95, 0.86, True)
person('person_c', 1.04, 1.06, False)

# ---------------------------------------------------------------- trees: skin-modifier wood and leaf cards
FRONDS = [((0.16, 0.53), (0.99, 0.97)), ((0.0, 0.30), (0.43, 0.67)), ((0.25, 0.01), (1.0, 0.42))]   # atlas rects (u, v)

def tree(module, seed, height, spread):
    rnd = random.Random(seed)
    verts, edges, radii, tips = [(0, 0, 0)], [], [(0.26, 0.26)], []
    def add(p, r, parent):
        verts.append(tuple(p)); radii.append((r, r)); edges.append((parent, len(verts) - 1)); return len(verts) - 1
    # trunk with a slight lean
    trunk_h = height * 0.38; cur = 0; p = Vector((0, 0, 0)); lean = Vector((rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), 1)).normalized()
    for k in range(1, 4):
        p = p + lean * trunk_h / 3; cur = add(p, 0.24 - 0.03 * k, cur)
    def branch(start, idx, d, length, r, depth):
        n = 3; p = Vector(start); i = idx
        for k in range(n):
            d = (d + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), rnd.uniform(-0.05, 0.2)))).normalized()
            p = p + d * length / n; i = add(p, max(0.025, r * (1 - (k + 1) / (n + 1.5))), i)
            if depth > 0 and k >= 1 and rnd.random() < 0.85:
                for _ in range(2):
                    a = rnd.uniform(0, math.tau)
                    nd = (d + Vector((math.cos(a), math.sin(a), 0)) * 0.8 + Vector((0, 0, 0.35))).normalized()
                    branch(p, i, nd, length * 0.62, r * 0.55, depth - 1)
        tips.append(p.copy())
    for k in range(5):
        a = k * math.tau / 5 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a) * spread, math.sin(a) * spread, 1.0)).normalized()
        branch(p, cur, d, height * 0.38, 0.13, 2)
    wood = skin_part('Wood', verts, edges, radii, M['bark'], (0, 0, 0))
    # keep the wood light: ~2,500 faces per tree (hundreds are drawn; the leaf cards carry the silhouette)
    if len(wood.data.polygons) > 2500:
        dec = wood.modifiers.new('Decimate', 'DECIMATE'); dec.ratio = 2500 / len(wood.data.polygons); L.apply_modifiers([wood])
    bm = bmesh.new(); bm.from_mesh(wood.data); L.world_uv(bm, 1.2); bm.to_mesh(wood.data); bm.free()
    # leaf cards clustered round every branch end, normals bent outward from the crown centre for soft shading
    centre = sum((Vector(v) for v in verts[4:]), Vector()) / max(1, len(verts) - 4)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap'); normals = []
    for t in tips:
        for _ in range(14):
            (u0, v0), (u1, v1) = FRONDS[rnd.randrange(3)]
            w = 1.1 * rnd.uniform(0.8, 1.2); h = w * (v1 - v0) / (u1 - u0)
            c = t + Vector((rnd.uniform(-0.9, 0.9), rnd.uniform(-0.9, 0.9), rnd.uniform(-0.5, 0.7)))
            out = (c - centre); out.z *= 0.6; out = out.normalized() if out.length else Vector((0, 0, 1))
            rot = Vector((0, 0, 1)).rotation_difference(out) @ Matrix.Rotation(rnd.uniform(0, math.tau), 3, 'Z').to_quaternion()
            rot = rot @ Matrix.Rotation(rnd.uniform(-0.6, 0.6), 3, 'X').to_quaternion()
            corners = [Vector((-w / 2, -h / 2, 0)), Vector((w / 2, -h / 2, 0)), Vector((w / 2, h / 2, 0)), Vector((-w / 2, h / 2, 0))]
            vs = [bm.verts.new(c + rot @ q) for q in corners]
            f = bm.faces.new(vs)
            for loop, (uu, vv) in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))): loop[uv].uv = (uu, vv)
            normals += [((c + rot @ q) - centre + Vector((0, 0, 1.5))).normalized() for q in corners]
    leaves = mesh_obj('Leaves', bm, M['leaves'], smooth=True)
    leaves.data.normals_split_custom_set_from_vertices(normals)
    return tag([wood, leaves], module)
tree('tree_a', 3, 8.5, 0.75)
tree('tree_b', 11, 7.0, 0.95)
tree('tree_c', 27, 10.5, 0.6)

# ---------------------------------------------------------------- Poly Haven street furniture, decimated
def poly(module, model, decimate, height=None):
    root, ms = L.import_model(col, model, 0, 0, decimate=decimate)
    bpy.context.view_layer.update()
    for o in ms:
        o.parent = None; o.matrix_world = o.matrix_world.copy()
    bpy.data.objects.remove(root)
    if height:
        top = max((o.matrix_world @ Vector(c)).z for o in ms for c in o.bound_box)
        for o in ms: o.matrix_world = Matrix.Scale(height / top, 4) @ o.matrix_world
    bpy.context.view_layer.update()
    for o in ms:
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    return tag(ms, module)

def lamp():
    """Modern street light: tapered steel pole, outreach arm and a flat LED head (lit face down)."""
    steel = L.material('Lamp steel', (0.32, 0.34, 0.36), 0.4, 0.8); led = L.material('Lamp light', (1, 0.97, 0.9), 0.2, emission=((1, 0.93, 0.78), 2.0))
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.1, radius2=0.055, depth=7.0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 3.5)); L.world_uv(bm, 0.5)
    o = [mesh_obj('Pole', bm, steel, smooth=True), B('Base', -0.16, -0.16, 0, 0.16, 0.16, 0.5, steel, bevel=0.03),
         B('Arm', -0.04, -1.5, 6.86, 0.04, 0.0, 6.96, steel), B('Head', -0.17, -1.95, 6.8, 0.17, -1.15, 6.98, steel, bevel=0.03),
         B('LED', -0.13, -1.9, 6.78, 0.13, -1.2, 6.8, led)]
    return tag(o, 'lamp')
lamp()
L.dedupe_images()

# ---------------------------------------------------------------- houses (AO baked)
def window(x0, y, z0, x1, z1, side, axis='x'):
    """Framed window on a wall face. axis='x': wall along x at y (side ±1 outward); 'y': wall along y at x=y."""
    o = []; t = 0.06
    if axis == 'x':
        o.append(B('Window', x0, y - 0.01 * side, z0, x1, y + 0.02 * side, z1, M['window']) if side > 0 else B('Window', x0, y - 0.02, z0, x1, y + 0.01, z1, M['window']))
        for a, b in ((x0 - t, x0), (x1, x1 + t)): o.append(B('Frame', a, min(y, y + side * 0.07), z0 - t, b, max(y, y + side * 0.07), z1 + t, M['frame']))
        for a, b in ((z0 - t, z0), (z1, z1 + t)): o.append(B('Frame', x0, min(y, y + side * 0.07), a, x1, max(y, y + side * 0.07), b, M['frame']))
        o.append(B('Mullion', (x0 + x1) / 2 - 0.025, min(y, y + side * 0.05), z0, (x0 + x1) / 2 + 0.025, max(y, y + side * 0.05), z1, M['frame']))
    else:
        o.append(B('Window', min(y, y + side * 0.02), x0, z0, max(y, y + side * 0.02), x1, z1, M['window']))
        for a, b in ((x0 - t, x0), (x1, x1 + t)): o.append(B('Frame', min(y, y + side * 0.07), a, z0 - t, max(y, y + side * 0.07), b, z1 + t, M['frame']))
        for a, b in ((z0 - t, z0), (z1, z1 + t)): o.append(B('Frame', min(y, y + side * 0.07), x0, a, max(y, y + side * 0.07), x1, b, M['frame']))
    return o

def gable(w, d, h, rise, overhang, wall_mat):
    """Gable roof with the ridge along x over a w × d box whose walls stop at h."""
    o = []; hd = d / 2 + overhang; th = 0.16
    o.append(extrude('Roof', [(-hd, h - 0.08), (0, h + rise), (hd, h - 0.08), (hd, h - 0.08 + th), (0, h + rise + th * 1.2), (-hd, h - 0.08 + th)],
                     -w / 2 - overhang, w / 2 + overhang, M['roof'], axis='x', tile=2.0))
    o.append(extrude('Gable', [(-d / 2, h), (d / 2, h), (0, h + rise)], -w / 2, w / 2, wall_mat, axis='x', tile=2.5))
    o.append(extrude('Fascia', [(-hd, h - 0.2), (-hd + 0.05, h - 0.2), (-hd + 0.05, h - 0.02), (-hd, h - 0.02)], -w / 2 - overhang, w / 2 + overhang, M['frame'], axis='x'))
    o.append(extrude('Fascia', [(hd - 0.05, h - 0.2), (hd, h - 0.2), (hd, h - 0.02), (hd - 0.05, h - 0.02)], -w / 2 - overhang, w / 2 + overhang, M['frame'], axis='x'))
    return o

def house_a():
    """Two-storey family home: rendered ground floor, timber upper floor, tiled gable roof, garage wing."""
    o = []; w, d = 11.0, 8.5
    o.append(B('Ground floor', -w / 2, -d / 2, 0, w / 2, d / 2, 2.9, M['render'], tile=2.5))
    o.append(B('Upper floor', -w / 2 - 0.05, -d / 2 - 0.05, 2.9, w / 2 + 0.05, d / 2 + 0.05, 5.6, M['cladding'], tile=2.5))
    o += gable(w, d, 5.6, 2.4, 0.5, M['cladding'])
    for x in (-3.6, -0.6): o += window(x - 0.9, -d / 2, 0.9, x + 0.9, 2.3, -1)
    for x in (-3.4, 0.2, 3.4): o += window(x - 0.75, -d / 2 - 0.05, 3.6, x + 0.75, 5.0, -1)
    for x in (-3.0, 2.5): o += window(x - 1.0, d / 2, 0.9, x + 1.0, 2.3, 1)
    o.append(B('Door', 2.0, -d / 2 - 0.04, 0.05, 3.0, -d / 2 + 0.02, 2.3, M['door']))
    o.append(B('Porch', 1.4, -d / 2 - 1.4, 0, 3.6, -d / 2, 0.15, M['concrete']))
    o.append(B('Canopy', 1.3, -d / 2 - 1.3, 2.55, 3.7, -d / 2, 2.68, M['frame']))
    o.append(B('Garage', w / 2, -d / 2, 0, w / 2 + 3.6, d / 2 - 1.5, 2.8, M['render'], tile=2.5))
    o.append(B('Garage roof', w / 2 - 0.1, -d / 2 - 0.35, 2.8, w / 2 + 3.85, d / 2 - 1.3, 2.98, M['metal_roof']))
    o.append(B('Garage door', w / 2 + 0.3, -d / 2 - 0.04, 0.02, w / 2 + 3.3, -d / 2 + 0.02, 2.3, M['garage']))
    o.append(B('Driveway', w / 2 + 0.1, -d / 2 - 7, -0.02, w / 2 + 3.5, -d / 2, 0.04, M['concrete']))
    o.append(B('Chimney', -w / 2 + 1.2, 0.6, 5.6, -w / 2 + 1.9, 1.3, 8.6, M['render']))
    return tag(o, 'house_a')

def house_b():
    """Single-storey bungalow with a deck and a broad tiled roof."""
    o = []; w, d = 14.0, 9.0
    o.append(B('Walls', -w / 2, -d / 2, 0, w / 2, d / 2, 2.8, M['cladding'], tile=2.5))
    o += gable(w, d, 2.8, 2.0, 0.7, M['cladding'])
    for x in (-5.0, -2.2, 3.6): o += window(x - 0.85, -d / 2, 0.85, x + 0.85, 2.25, -1)
    o.append(B('Door', 0.3, -d / 2 - 0.04, 0.05, 1.3, -d / 2 + 0.02, 2.25, M['door']))
    o.append(B('Deck', -w / 2, -d / 2 - 2.6, 0, w / 2 - 4, -d / 2, 0.35, M['deck'], tile=1.5))
    for x in (-w / 2 + 0.2, -1.0, w / 2 - 4.2):
        o.append(B('Post', x, -d / 2 - 2.5, 0.35, x + 0.16, -d / 2 - 2.34, 2.75, M['frame']))
    o.append(B('Veranda roof', -w / 2 - 0.1, -d / 2 - 2.7, 2.75, w / 2 - 3.9, -d / 2 + 0.1, 2.88, M['metal_roof']))
    for y in (-2.0, 2.0): o += window(y - 0.8, w / 2, 0.85, y + 0.8, 2.25, 1, axis='y')
    o.append(B('Path', 0.2, -d / 2 - 8, -0.02, 1.4, -d / 2 - 2.6, 0.04, M['concrete']))
    return tag(o, 'house_b')

def house_c():
    """Modern two-storey box: rendered base, timber-clad cantilevered upper floor, flat roof, big glazing."""
    o = []; w, d = 12.0, 9.0
    o.append(B('Ground floor', -w / 2, -d / 2, 0, w / 2, d / 2, 3.0, M['render'], tile=2.5))
    o.append(B('Upper floor', -w / 2 - 1.2, -d / 2 - 1.0, 3.0, w / 2 - 1.5, d / 2, 6.0, M['cladding'], tile=2.5))
    o.append(B('Roof', -w / 2 - 1.4, -d / 2 - 1.2, 6.0, w / 2 - 1.3, d / 2 + 0.2, 6.25, M['metal_roof']))
    o.append(B('Glazing', -w / 2 + 0.4, -d / 2 - 0.02, 0.1, w / 2 - 3.2, -d / 2 + 0.01, 2.8, M['window']))
    for i in range(6):
        x = -w / 2 + 0.4 + i * (w - 3.6) / 5
        o.append(B('Mullion', x - 0.04, -d / 2 - 0.07, 0.1, x + 0.04, -d / 2, 2.8, M['frame']))
    o.append(B('Upper glazing', -w / 2 - 0.8, -d / 2 - 1.03, 3.7, w / 2 - 2.0, -d / 2 - 0.98, 5.5, M['window']))
    o.append(B('Door', w / 2 - 2.5, -d / 2 - 0.04, 0.05, w / 2 - 1.4, -d / 2 + 0.02, 2.4, M['door']))
    o.append(B('Terrace', -w / 2, -d / 2 - 4, -0.02, w / 2 - 3, -d / 2, 0.12, M['concrete']))
    return tag(o, 'house_c')
def townhouse_a():
    """One terrace unit (6 m frontage): brick-red render ground floor, timber upper floor, front-facing gable."""
    o = []; w, d, h, rise = 6.0, 10.0, 5.8, 2.6
    o.append(B('Ground floor', -w / 2, -d / 2, 0, w / 2, d / 2, 2.9, M['render'], tile=2.5))
    o.append(B('Upper floor', -w / 2, -d / 2 - 0.05, 2.9, w / 2, d / 2 + 0.05, h, M['cladding'], tile=2.5))
    hw = w / 2 + 0.25; th = 0.16
    o.append(extrude('Roof', [(-hw, h - 0.08), (0, h + rise), (hw, h - 0.08), (hw, h - 0.08 + th), (0, h + rise + th * 1.2), (-hw, h - 0.08 + th)], -d / 2 - 0.4, d / 2 + 0.4, M['roof'], axis='y', tile=2.0))
    o.append(extrude('Gable', [(-w / 2, h), (w / 2, h), (0, h + rise)], -d / 2 - 0.05, d / 2 + 0.05, M['cladding'], axis='y', tile=2.5))
    o += window(-2.3, -d / 2, 0.9, -0.2, 2.3, -1)
    o.append(B('Door', 0.6, -d / 2 - 0.04, 0.05, 1.6, -d / 2 + 0.02, 2.3, M['door']))
    o += window(-2.0, -d / 2 - 0.05, 3.5, 2.0, 5.1, -1)
    o += window(-0.6, -d / 2 - 0.05, h + 0.4, 0.6, h + 1.5, -1)
    o += window(-2.0, d / 2, 0.9, 2.0, 2.4, 1)
    o.append(B('Step', 0.3, -d / 2 - 1.0, 0, 1.9, -d / 2, 0.15, M['concrete']))
    o.append(B('Party wall', -w / 2 - 0.12, -d / 2 - 0.3, 0, -w / 2 + 0.02, d / 2 + 0.3, h + 0.2, M['render']))
    return tag(o, 'townhouse_a')

def townhouse_b():
    """One modern three-storey terrace unit: rendered, recessed balcony on the top floor, flat roof."""
    o = []; w, d = 6.0, 11.0
    o.append(B('Walls', -w / 2, -d / 2, 0, w / 2, d / 2, 8.8, M['render'], tile=2.5))
    o.append(B('Cladding panel', -w / 2 + 0.3, -d / 2 - 0.06, 3.0, w / 2 - 0.3, -d / 2 + 0.01, 5.9, M['cladding'], tile=2.5))
    o.append(B('Roof', -w / 2 - 0.1, -d / 2 - 0.1, 8.8, w / 2 + 0.1, d / 2 + 0.1, 9.05, M['metal_roof']))
    o.append(B('Garage door', -2.6, -d / 2 - 0.04, 0.02, 0.2, -d / 2 + 0.02, 2.4, M['garage']))
    o.append(B('Door', 0.8, -d / 2 - 0.04, 0.05, 1.8, -d / 2 + 0.02, 2.4, M['door']))
    o += window(-2.2, -d / 2 - 0.06, 3.5, 2.2, 5.4, -1)
    o.append(B('Top glazing', -2.6, -d / 2 + 1.2, 6.2, 2.6, -d / 2 + 1.23, 8.5, M['window']))
    o.append(B('Balcony recess', -2.8, -d / 2 - 0.01, 6.05, 2.8, -d / 2 + 1.2, 6.1, M['deck']))
    o.append(B('Balcony glass', -2.8, -d / 2 - 0.02, 6.1, 2.8, -d / 2 + 0.02, 7.1, M['window']))
    o += window(-2.0, d / 2, 0.9, 2.0, 2.4, 1); o += window(-2.0, d / 2, 3.6, 2.0, 5.4, 1); o += window(-2.0, d / 2, 6.6, 2.0, 8.2, 1)
    o.append(B('Party wall', -w / 2 - 0.12, -d / 2 - 0.2, 0, -w / 2 + 0.02, d / 2 + 0.2, 9.2, M['frame']))
    return tag(o, 'townhouse_b')
house_a(); house_b(); house_c(); townhouse_a(); townhouse_b()

L.apply_modifiers([o for objs in MODULES.values() for o in objs])

# ---------------------------------------------------------------- previews / bake / export
world = bpy.data.worlds.new('Sky'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.9, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
L.use_gpu(scene)

LAYOUT = {'car_sedan': (0, -6), 'car_suv': (6, -6), 'car_hatch': (12, -6), 'truck': (26, -6),
          'person_a': (0, 0), 'person_b': (1.2, 0), 'person_c': (2.4, 0), 'lamp': (5, 0),
          'tree_a': (0, 12), 'tree_b': (10, 12), 'tree_c': (20, 12), 'house_a': (-30, 30), 'house_b': (-5, 30), 'house_c': (22, 30), 'townhouse_a': (42, 30), 'townhouse_b': (52, 30)}
def arrange(sign):
    for m, objs in MODULES.items():
        dx, dy = LAYOUT[m]
        for o in objs: o.location.x += sign * dx; o.location.y += sign * dy
arrange(+1)
L.box(ctx, 'Ground', -60, -30, -0.2, 70, 60, 0, M['concrete'])

if '--preview' in ARGS:
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); sun.data.energy = 4; scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(45), 0, math.radians(-40))
    L.preview(scene, (8, -22, 6), (8, 3, 2), 40, os.path.join(OUT, 'preview_props.jpg'))
    L.preview(scene, (-5, 5, 14), (-5, 30, 3), 50, os.path.join(OUT, 'preview_houses.jpg'))
    raise SystemExit

houses = [o for m in ('house_a', 'house_b', 'house_c', 'townhouse_a', 'townhouse_b') for o in MODULES[m] if o.type == 'MESH' and o.material_slots[0].material is not M['window']]
L.lightmap_uvs(houses)
L.bake_ao(scene, houses, SIZE, SAMPLES, os.path.join(OUT, 'props_ao.jpg'), distance=2.0)
arrange(-1)
L.export_glb([o for objs in MODULES.values() for o in objs], os.path.join(OUT, 'props.glb'))
