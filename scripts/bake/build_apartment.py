"""
Builds a dollhouse apartment in Blender, bakes its lighting with Cycles, and exports it for the web.

    blender -b -P scripts/bake/build_apartment.py -- [--samples 128] [--size 4096] [--quick]

Output (assets/apartment/):
    apartment.glb      geometry, PBR materials, UVs (TEXCOORD_0 textures, TEXCOORD_1 lightmap),
                       room volumes ("room:*") and furniture groups ("item:*") with extras for the page
    lightmap.jpg       baked diffuse lighting (direct + indirect), stored at half intensity in sRGB

Axes: Blender Z up, metres. x along the apartment (0 → 22), y from the open front (0) to the glazed back (9).
Furniture models and textures: Poly Haven (CC0), from source-assets/ (see scripts/assets/dl.ps1).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(ARGS[ARGS.index(name) + 1]) if name in ARGS else default
SAMPLES = arg('--samples', 128)
SIZE = arg('--size', 4096)
QUICK = '--quick' in ARGS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'source-assets')
OUT = os.path.join(ROOT, 'assets', 'apartment')
os.makedirs(OUT, exist_ok=True)

W, D, H = 22.0, 9.0, 2.8          # footprint and wall height
T_EXT, T_INT = 0.24, 0.12         # wall thickness

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
col_static = bpy.data.collections.new('Static'); scene.collection.children.link(col_static)
col_glass = bpy.data.collections.new('Glass'); scene.collection.children.link(col_glass)
col_rooms = bpy.data.collections.new('Rooms'); scene.collection.children.link(col_rooms)

# ---------------------------------------------------------------- materials
_images = {}
def image(path, non_color=False):
    if path not in _images:
        img = bpy.data.images.load(path, check_existing=True)
        if non_color: img.colorspace_settings.name = 'Non-Color'
        _images[path] = img
    return _images[path]

def material(name, color=(0.9, 0.9, 0.9), rough=0.6, metal=0.0, tex=None, tint=None, transmission=0.0, coat=0.0, normal_strength=0.6, use_diffuse=True):
    """Principled material; tex = Poly Haven texture folder name in source-assets/tex (diff/nor_gl/rough)."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
        b.inputs['IOR'].default_value = 1.45
    if coat: b.inputs['Coat Weight'].default_value = coat
    if tex:
        folder = os.path.join(SRC, 'tex', tex)
        def find(key):
            for f in os.listdir(folder):
                if key in f: return os.path.join(folder, f)
        diff, nor, rgh = find('diff'), find('nor_gl'), find('rough')
        if diff and use_diffuse:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(diff)
            if tint:
                mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1.0
                nt.links.new(t.outputs['Color'], mix.inputs['A']); mix.inputs['B'].default_value = (*tint, 1)
                nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
            else:
                nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if nor:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(nor, True)
            n = nt.nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value = normal_strength
            nt.links.new(t.outputs['Color'], n.inputs['Color']); nt.links.new(n.outputs['Normal'], b.inputs['Normal'])
        if rgh:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(rgh, True)
            nt.links.new(t.outputs['Color'], b.inputs['Roughness'])
    return m

M = {
    'wall': material('Plaster wall', (0.92, 0.905, 0.88), 0.9, tex='white_plaster_02', normal_strength=0.25, use_diffuse=False),
    'slab': material('Slab edge', (0.95, 0.94, 0.92), 0.8),
    'oak': material('Oak floor', rough=0.5, tex='oak_wood_planks', tint=(1.22, 1.14, 1.02)),
    'tile': material('Stone tile', rough=0.4, tex='large_grey_tiles', tint=(1.25, 1.22, 1.18)),
    'wall_tile': material('Wall tile', rough=0.25, tex='long_white_tiles'),
    'lacquer': material('White lacquer', (0.90, 0.885, 0.86), 0.38),
    'veneer': material('Oak veneer', rough=0.5, tex='fine_grained_wood', tint=(1.55, 1.36, 1.1)),
    'marble': material('Marble', rough=0.18, tex='marble_01', coat=0.4),
    'linen': material('Linen', (0.93, 0.9, 0.84), 0.95, tex='rough_linen', use_diffuse=False, normal_strength=0.8),
    'linen_dark': material('Linen taupe', (0.56, 0.49, 0.41), 0.95, tex='rough_linen', use_diffuse=False, normal_strength=0.8),
    'velvet': material('Boucle', (0.92, 0.89, 0.83), 1.0, tex='velour_velvet', use_diffuse=False, normal_strength=1.0),
    'rug': material('Wool rug', (0.84, 0.79, 0.7), 1.0, tex='rough_linen', use_diffuse=False, normal_strength=1.2),
    'travertine': material('Travertine', (0.86, 0.8, 0.7), 0.5, tex='marble_01', tint=(1.0, 0.92, 0.8), normal_strength=0.4),
    'oak_solid': material('Solid oak', rough=0.45, tex='fine_grained_wood', tint=(1.15, 1.0, 0.82)),
    'steel': material('Brushed steel', (0.75, 0.75, 0.74), 0.32, 1.0),
    'black_glass': material('Black glass', (0.02, 0.02, 0.022), 0.08, coat=1.0),
    'chrome': material('Chrome', (0.9, 0.9, 0.9), 0.08, 1.0),
    'porcelain': material('Porcelain', (0.95, 0.95, 0.94), 0.12, coat=0.6),
    'frame': material('Window frame', (0.12, 0.12, 0.13), 0.4, 0.6),
    'glass': material('Glass', (0.92, 0.96, 0.98), 0.02, transmission=1.0),
    'brass': material('Brushed brass', (0.78, 0.6, 0.34), 0.3, 1.0),
    'cloth': [material(f'Garment {i}', c, 0.9) for i, c in enumerate([(0.86, 0.84, 0.8), (0.55, 0.6, 0.66), (0.24, 0.26, 0.3), (0.72, 0.62, 0.5), (0.92, 0.92, 0.9), (0.42, 0.36, 0.3)])],
}

# ---------------------------------------------------------------- geometry helpers
def world_uv(bm, tile):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = (co.y / tile, co.z / tile) if ax == 0 else (co.x / tile, co.z / tile) if ax == 1 else (co.x / tile, co.y / tile)

def box(name, x0, y0, z0, x1, y1, z1, mat, bevel=0.0, tile=1.0, coll=None, parent=None):
    """Axis-aligned box between two corners (world metres), UVs in metres / tile."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), z0 + (v.co.z + 0.5) * (z1 - z0)))
    bm.normal_update(); world_uv(bm, tile); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat)
    (coll or col_static).objects.link(ob)
    if bevel > 0:
        mod = ob.modifiers.new('Bevel', 'BEVEL'); mod.width = bevel; mod.segments = 3; mod.limit_method = 'ANGLE'; mod.harden_normals = True
    if parent: ob.parent = parent; ob.matrix_parent_inverse = parent.matrix_basis.inverted()   # geometry is in world metres
    return ob

def cylinder(name, x, y, z0, z1, r, mat, verts=32, parent=None, axis='Z'):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=(z1 - z0))
    for v in bm.verts:
        if axis == 'Y': v.co = Vector((v.co.x, v.co.z, v.co.y))
        if axis == 'X': v.co = Vector((v.co.z, v.co.y, v.co.x))
        v.co += Vector((x, y, (z0 + z1) / 2)) if axis == 'Z' else Vector((x, y, z0))
    bm.normal_update(); world_uv(bm, 0.5); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat); col_static.objects.link(ob)
    for p in ob.data.polygons: p.use_smooth = True
    if parent: ob.parent = parent; ob.matrix_parent_inverse = parent.matrix_basis.inverted()
    return ob

def item(label, info, x=0, y=0, rot=0):
    """An empty that groups one piece of furniture for click info on the page."""
    e = bpy.data.objects.new(f'item:{label}', None); col_static.objects.link(e)
    e.location = (x, y, 0); e.rotation_euler = (0, 0, math.radians(rot)); e['info'] = info
    e['kind'] = 'item'; e['label'] = label   # the page reads these: three.js strips ':' and spaces from names
    return e

def room(label, x0, y0, x1, y1, info):
    r = box(f'room:{label}', x0, y0, 0.0, x1, y1, H, M['slab'], coll=col_rooms)
    r['area'] = round((x1 - x0) * (y1 - y0), 1); r['info'] = info; r['kind'] = 'room'; r['label'] = label; r.display_type = 'WIRE'; r.hide_render = True
    return r

# ---------------------------------------------------------------- shell
box('Slab', -T_EXT, -0.05, -0.35, W + T_EXT, D + T_EXT, -0.025, M['slab'], bevel=0.01)
floors = [  # (x0, y0, x1, y1, material)
    (0, 0, 2.6, 5.0, 'oak'), (0, 5.0, 2.6, D, 'tile'), (2.6, 0, 7.0, D, 'oak'), (7.0, 0, 22, D, 'oak'),
]
for i, (x0, y0, x1, y1, mk) in enumerate(floors):
    box(f'Floor {i}', x0, y0, -0.02, x1, y1, 0.0, M[mk], tile=2.4 if mk == 'oak' else 1.2)
for x0, y0, x1, y1 in [(13.5, 0, 16.5, 2.2), (17.0, 0, 19.5, 3.0)]:     # laundry and powder room tiles
    box('Wet floor', x0, y0, 0.0, x1, y1, 0.004, M['tile'], tile=1.2)

def wall(name, x0, y0, x1, y1, t, gaps=(), mat=None, head=2.15):
    """Wall along x (y0 == y1) or y (x0 == x1), with door gaps [(a, b)] along its length."""
    along_x = abs(y1 - y0) < 1e-6
    a0, a1 = (x0, x1) if along_x else (y0, y1)
    cuts = sorted(gaps); cur = a0; pieces = []
    for a, b in cuts: pieces.append((cur, a, 0.0, H)); pieces.append((a, b, head, H)); cur = b
    pieces.append((cur, a1, 0.0, H))
    for i, (p, q, z0, z1) in enumerate(pieces):
        if q - p < 0.01: continue
        if along_x: box(f'{name} {i}', p, y0 - t / 2, z0, q, y0 + t / 2, z1, mat or M['wall'], tile=2.0)
        else: box(f'{name} {i}', x0 - t / 2, p, z0, x0 + t / 2, q, z1, mat or M['wall'], tile=2.0)

# exterior: back wall with floor-to-ceiling glazing, side walls; the front is open (dollhouse cut)
glazing = [(3.0, 6.6), (7.6, 12.6), (13.4, 16.8), (0.5, 2.0)]
cur = -T_EXT
for i, (a, b) in enumerate(sorted(glazing)):
    box(f'Back wall {i}', cur, D, 0, a, D + T_EXT, H, M['wall'], tile=2.0); cur = b
    sill = 1.1 if a < 2.1 else 0.0
    if sill: box(f'Back sill {i}', a, D, 0, b, D + T_EXT, sill, M['wall'], tile=2.0)
    box(f'Back head {i}', a, D, 2.45, b, D + T_EXT, H, M['wall'], tile=2.0)
    # frames and mullions
    box(f'Frame bottom {i}', a, D + 0.06, sill, b, D + 0.14, sill + 0.05, M['frame'])
    box(f'Frame top {i}', a, D + 0.06, 2.40, b, D + 0.14, 2.45, M['frame'])
    n = max(1, round((b - a) / 1.25))
    for k in range(n + 1):
        x = a + (b - a) * k / n
        box(f'Mullion {i}.{k}', x - 0.025, D + 0.06, sill, x + 0.025, D + 0.14, 2.45, M['frame'])
    box(f'Glass {i}', a, D + 0.095, sill + 0.05, b, D + 0.105, 2.40, M['glass'], coll=col_glass)
box('Back wall end', cur, D, 0, W + T_EXT, D + T_EXT, H, M['wall'], tile=2.0)
wall('Left wall', 0 - T_EXT / 2, 0, 0 - T_EXT / 2, D, T_EXT)
wall('Right wall', W + T_EXT / 2, 0, W + T_EXT / 2, D, T_EXT, gaps=[(0.9, 1.95)])           # entry door

# interior partitions with door openings
wall('Wardrobe / suite', 2.6, 0, 2.6, D, T_INT, gaps=[(1.0, 1.85), (6.0, 6.85)])
wall('Wardrobe / ensuite', 0, 5.0, 2.6, 5.0, T_INT)
wall('Study / bedroom', 2.6, 3.2, 7.0, 3.2, T_INT, gaps=[(4.0, 4.9)])
wall('Bedroom / living', 7.0, 3.2, 7.0, D, T_INT)
wall('Study / living', 7.0, 0, 7.0, 3.2, T_INT, gaps=[(0.9, 1.8)])
wall('Laundry side A', 13.5, 0, 13.5, 2.2, T_INT); wall('Laundry front', 13.5, 2.2, 16.5, 2.2, T_INT, gaps=[(14.3, 15.2)]); wall('Laundry side B', 16.5, 0, 16.5, 2.2, T_INT)
wall('Powder side A', 17.0, 0, 17.0, 3.0, T_INT); wall('Powder front', 17.0, 3.0, 19.5, 3.0, T_INT, gaps=[(17.6, 18.45)]); wall('Powder side B', 19.5, 0, 19.5, 3.0, T_INT)
# skirting along the main rooms
for x0, x1, y in [(2.6, 7.0, D - 0.005), (7.0, 22, D - 0.005)]:
    box('Skirting', x0, y - 0.015, 0, x1, y, 0.08, M['lacquer'])

# ---------------------------------------------------------------- rooms (hover volumes)
room('Walk-in wardrobe', 0, 0, 2.6, 5.0, 'Open shelving and hanging space on three sides, with a central dresser.')
room('Ensuite', 0, 5.0, 2.6, D, 'Double vanity, freestanding bath and a walk-in shower.')
room('Study', 2.6, 0, 7.0, 3.2, 'A quiet desk nook between the wardrobe and the living room.')
room('Master bedroom', 2.6, 3.2, 7.0, D, 'Upholstered king bed facing full-height glazing.')
room('Living', 7.0, 0, 13.5, D, 'Curved sofa, lounge chair and a media wall.')
room('Dining', 13.5, 2.2, 17.0, D, 'Table for six beside the windows.')
room('Kitchen', 17.0, 3.0, W, D, 'Stone island with seating, full-height storage and integrated appliances.')
room('Laundry', 13.5, 0, 16.5, 2.2, 'Stacked washer and dryer with a folding bench.')
room('Powder room', 17.0, 0, 19.5, 3.0, 'Guest WC with a floating vanity.')
room('Entry', 19.5, 0, W, 3.0, 'Front door, coat storage and a bench.')

# ---------------------------------------------------------------- built-in furniture (procedural)
# Walk-in wardrobe: shelving on the left and front walls, rails with garments, a dresser island
e = item('Wardrobe system', 'Open oak shelving with hanging rails and drawers.')
for y0, y1 in [(0.25, 4.8)]:
    box('Wardrobe carcass', 0.02, y0, 0, 0.62, y1, 2.4, M['veneer'], bevel=0.008, parent=e)
    box('Wardrobe back', 0.02, y0, 0, 0.05, y1, 2.4, M['lacquer'], parent=e)
    for z in (0.45, 1.25, 2.05):
        box('Shelf', 0.05, y0, z, 0.6, y1, z + 0.025, M['veneer'], bevel=0.004, parent=e)
    cylinder('Rail', 0.38, (y0 + y1) / 2, 1.85, 1.85, 0.012, M['chrome'], parent=e)
    k = 0
    y = y0 + 0.12
    while y < y1 - 0.12:
        g = M['cloth'][k % len(M['cloth'])]
        box('Garment', 0.18, y, 1.0 + (k % 3) * 0.08, 0.56, y + 0.035, 1.8, g, bevel=0.01, parent=e)
        y += 0.075 + (k % 4) * 0.02; k += 1
e = item('Dresser island', 'Central island with drawers and a glass top for accessories.')
box('Island body', 1.05, 1.6, 0, 2.05, 3.3, 0.9, M['lacquer'], bevel=0.01, parent=e)
box('Island top', 1.02, 1.57, 0.9, 2.08, 3.33, 0.93, M['marble'], bevel=0.005, parent=e)
for z in (0.25, 0.55):
    box('Drawer line', 1.04, 1.62, z, 1.06, 3.28, z + 0.008, M['brass'], parent=e)

# Ensuite: double vanity, freestanding bath, shower with glass, WC
e = item('Double vanity', 'Floating oak vanity with two vessel basins and a full-width mirror.')
box('Vanity', 0.02, 5.6, 0.55, 0.55, 7.6, 0.9, M['veneer'], bevel=0.01, parent=e)
box('Vanity top', 0.02, 5.6, 0.9, 0.58, 7.6, 0.93, M['marble'], bevel=0.004, parent=e)
for y in (6.1, 7.1):
    cylinder('Basin', 0.3, y, 0.93, 1.06, 0.2, M['porcelain'], parent=e)
    cylinder('Tap', 0.06, y, 0.93, 1.18, 0.012, M['chrome'], parent=e)
box('Mirror', 0.02, 5.7, 1.25, 0.04, 7.5, 2.1, M['chrome'], parent=e)
box('Wall tiles', 0.0, 5.06, 0, 0.02, D - 0.02, 2.4, M['wall_tile'], tile=0.6)
e = item('Freestanding bath', 'Stone resin bath under the window.')
box('Bath', 0.6, 8.1, 0, 2.3, 8.85, 0.58, M['porcelain'], bevel=0.12, parent=e)
box('Bath inner', 0.7, 8.18, 0.25, 2.2, 8.77, 0.6, M['porcelain'], bevel=0.1, parent=e)
e = item('Walk-in shower', 'Frameless glass screen and a rainfall head.')
box('Shower tray', 1.4, 5.1, 0, 2.52, 6.2, 0.03, M['tile'], tile=0.6, parent=e)
box('Shower glass', 1.38, 6.2, 0.03, 2.52, 6.22, 2.05, M['glass'], coll=col_glass)
e = item('WC', 'Wall-hung WC with a concealed cistern.')
box('WC', 2.0, 7.45, 0.3, 2.52, 7.85, 0.68, M['porcelain'], bevel=0.12, parent=e)

# Master bedroom: bed with upholstered headboard against the living-room wall, nightstands, bench
e = item('King bed', 'Upholstered king bed with linen bedding.', 5.0, 6.4)
box('Headboard', 6.68, 5.2, 0.0, 6.9, 7.6, 1.25, M['linen_dark'], bevel=0.05, parent=e)
box('Bed base', 4.65, 5.45, 0.08, 6.7, 7.35, 0.42, M['linen_dark'], bevel=0.04, parent=e)
box('Mattress', 4.68, 5.48, 0.42, 6.66, 7.32, 0.62, M['linen'], bevel=0.06, parent=e)
box('Duvet', 4.6, 5.44, 0.55, 6.1, 7.36, 0.68, M['linen'], bevel=0.07, parent=e)
box('Throw', 4.62, 5.42, 0.66, 4.95, 7.38, 0.7, M['linen_dark'], bevel=0.02, parent=e)
for y in (5.9, 6.9):
    box('Pillow', 6.2, y - 0.38, 0.62, 6.6, y + 0.38, 0.82, M['linen'], bevel=0.08, parent=e)
for y in (4.95, 7.85):
    n = item('Nightstand', 'Floating oak nightstand with a brass lamp.')
    box('Nightstand', 6.4, y - 0.25, 0.35, 6.85, y + 0.25, 0.6, M['veneer'], bevel=0.01, parent=n)
    cylinder('Lamp base', 6.6, y, 0.6, 0.62, 0.07, M['brass'], parent=n)
    cylinder('Lamp stem', 6.6, y, 0.62, 0.95, 0.01, M['brass'], parent=n)
    cylinder('Lamp shade', 6.6, y, 0.92, 1.12, 0.13, M['linen'], parent=n)
e = item('Bed bench', 'Upholstered bench at the foot of the bed.')
box('Bench', 4.05, 5.7, 0.0, 4.5, 7.1, 0.45, M['velvet'], bevel=0.05, parent=e)
box('Bedroom rug', 3.4, 4.6, 0.0, 6.4, 8.2, 0.012, M['rug'], tile=1.5)

# Study nook
e = item('Desk', 'Oak desk facing the wall, with a shelf above.')
box('Desk top', 3.2, 0.15, 0.73, 5.4, 0.85, 0.76, M['veneer'], bevel=0.006, parent=e)
for x in (3.25, 5.35):
    box('Desk leg', x - 0.03, 0.2, 0, x + 0.03, 0.8, 0.73, M['frame'], parent=e)
box('Wall shelf', 3.2, 0.1, 1.45, 5.4, 0.35, 1.48, M['veneer'], parent=e)
box('Monitor', 3.95, 0.4, 0.9, 4.65, 0.43, 1.3, M['black_glass'], bevel=0.008, parent=e)

# Living: media wall and TV on the bedroom wall
e = item('Media wall', 'Oak-slat media wall with a 75-inch screen.')
for k in range(46):
    y = 3.6 + k * 0.105
    box('Slat', 7.06, y, 0, 7.1, y + 0.065, H, M['veneer'], parent=e)
box('TV', 7.1, 4.9, 1.05, 7.15, 6.6, 2.0, M['black_glass'], bevel=0.005, parent=e)
box('Living rug', 8.3, 3.7, 0.0, 12.6, 8.3, 0.012, M['rug'], tile=1.5)

# Dining: oak table for six
e = item('Dining table', 'Solid oak table seating six.', 15.25, 6.0)
box('Table top', 14.3, 5.5, 0.72, 16.2, 6.5, 0.76, M['veneer'], bevel=0.01, parent=e)
for x in (14.55, 15.95):
    box('Table leg', x - 0.05, 5.65, 0, x + 0.05, 6.35, 0.72, M['veneer'], bevel=0.01, parent=e)

# Kitchen: tall storage and counter run on the back wall, island with stone top
e = item('Kitchen run', 'Handle-less cabinetry, integrated fridge and ovens, stone splashback.')
box('Tall units', 17.2, D - 0.62, 0, 19.4, D - 0.02, 2.4, M['lacquer'], bevel=0.006, parent=e)
for x in (17.75, 18.3, 18.85):
    box('Tall joint', x - 0.003, D - 0.63, 0.1, x + 0.003, D - 0.62, 2.35, M['frame'], parent=e)
box('Oven', 18.32, D - 0.64, 0.85, 18.82, D - 0.62, 1.35, M['black_glass'], parent=e)
box('Oven 2', 18.32, D - 0.64, 1.42, 18.82, D - 0.62, 1.8, M['black_glass'], parent=e)
box('Base run', 19.4, D - 0.62, 0.1, W - 0.02, D - 0.02, 0.88, M['lacquer'], bevel=0.006, parent=e)
box('Counter', 19.4, D - 0.65, 0.88, W - 0.02, D - 0.02, 0.92, M['marble'], bevel=0.004, parent=e)
box('Splashback', 19.4, D - 0.04, 0.92, W - 0.02, D - 0.02, 1.5, M['marble'], parent=e)
box('Upper units', 19.4, D - 0.37, 1.55, W - 0.02, D - 0.02, 2.35, M['veneer'], bevel=0.006, parent=e)
box('Cooktop', 20.2, D - 0.55, 0.92, 20.9, D - 0.1, 0.927, M['black_glass'], parent=e)
cylinder('Sink tap', 21.3, D - 0.12, 0.92, 1.25, 0.015, M['steel'], parent=e)
box('Sink', 21.0, D - 0.55, 0.89, 21.6, D - 0.15, 0.925, M['steel'], parent=e)
e = item('Island', 'Stone island with a waterfall edge and seating for four.')
box('Island base', 18.0, 5.0, 0.1, 21.2, 6.0, 0.88, M['veneer'], bevel=0.006, parent=e)
box('Island top', 17.95, 4.95, 0.88, 21.25, 6.05, 0.92, M['marble'], bevel=0.004, parent=e)
for x in (17.95, 21.21):
    box('Waterfall', x, 4.95, 0.0, x + 0.04, 6.05, 0.92, M['marble'], parent=e)
cylinder('Fruit bowl', 20.6, 5.5, 0.92, 0.98, 0.16, M['porcelain'], parent=e)

# Laundry and powder room
e = item('Washer and dryer', 'Stacked front-loaders beside a folding bench.')
for z0 in (0.05, 0.92):
    box('Machine', 13.6, 0.1, z0, 14.25, 0.75, z0 + 0.85, M['porcelain'], bevel=0.02, parent=e)
    cylinder('Door', 13.92, 0.08, z0 + 0.25, z0 + 0.25, 0.22, M['black_glass'], axis='Y', parent=e)
box('Folding bench', 14.35, 0.05, 0.85, 16.4, 0.65, 0.89, M['marble'], parent=e)
box('Laundry base', 14.35, 0.05, 0.1, 16.4, 0.65, 0.85, M['lacquer'], bevel=0.006, parent=e)
e = item('Guest WC', 'Wall-hung WC and a floating vanity.')
box('Guest WC', 17.1, 1.2, 0.3, 17.55, 1.6, 0.68, M['porcelain'], bevel=0.12, parent=e)
box('Guest vanity', 18.7, 0.05, 0.6, 19.4, 0.5, 0.85, M['veneer'], bevel=0.008, parent=e)
cylinder('Guest basin', 19.05, 0.27, 0.85, 0.96, 0.16, M['porcelain'], parent=e)
e = item('Entry bench', 'Bench and coat storage by the front door.')
box('Coat cupboard', 19.7, 0.05, 0, 21.0, 0.65, 2.4, M['veneer'], bevel=0.006, parent=e)
box('Bench', 21.3, 2.3, 0, 21.85, 2.85, 0.45, M['veneer'], bevel=0.01, parent=e)

# ---------------------------------------------------------------- modern furniture, modelled
def local_box(name, x0, y0, z0, x1, y1, z1, mat, parent, bevel=0.0):
    """A box in the parent's local frame (the parent is placed and rotated already)."""
    ob = box(name, x0, y0, z0, x1, y1, z1, mat, bevel=bevel); ob.parent = parent; return ob

def ring_sector(name, cx, cy, r0, r1, a0, a1, z0, z1, mat, seg=28, bevel=0.0, parent=None):
    """A curved slab (annulus sector) between radii r0..r1 and angles a0..a1 (degrees)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new(); rings = []
    for i in range(seg + 1):
        a = math.radians(a0 + (a1 - a0) * i / seg)
        rings.append([bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    for i in range(seg):
        for k in range(4):
            bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][(k + 1) % 4], rings[i][(k + 1) % 4]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.normal_update(); world_uv(bm, 0.6); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat); col_static.objects.link(ob)
    if bevel:
        mod = ob.modifiers.new('Bevel', 'BEVEL'); mod.width = bevel; mod.segments = 4; mod.limit_method = 'ANGLE'
    for poly in ob.data.polygons: poly.use_smooth = True
    if parent: ob.parent = parent; ob.matrix_parent_inverse = parent.matrix_basis.inverted()
    return ob

# curved boucle sofa facing the media wall, with a travertine coffee table and side table
e = item('Curved sofa', 'Curved four-seat sofa in cream boucle.')
ring_sector('Sofa seat', 12.9, 6.1, 1.25, 2.15, 140, 220, 0.05, 0.44, M['velvet'], bevel=0.1, parent=e)
ring_sector('Sofa back', 12.9, 6.1, 1.95, 2.3, 136, 224, 0.05, 0.82, M['velvet'], bevel=0.11, parent=e)
for k, a in enumerate((150, 172, 194, 210)):
    r = math.radians(a); cx, cy = 12.9 + 1.9 * math.cos(r), 6.1 + 1.9 * math.sin(r)
    box(f'Cushion {k}', cx - 0.22, cy - 0.22, 0.44, cx + 0.22, cy + 0.22, 0.78, M['linen'], bevel=0.09, parent=e)
e = item('Coffee table', 'Round travertine coffee table.')
cylinder('Coffee table top', 9.95, 6.1, 0.0, 0.36, 0.62, M['travertine'], verts=48, parent=e)
cylinder('Coffee table tray', 9.95, 6.1, 0.36, 0.38, 0.22, M['oak_solid'], verts=32, parent=e)
e = item('Side table', 'Travertine drum side table.')
cylinder('Side table', 11.9, 3.95, 0.0, 0.52, 0.24, M['travertine'], verts=40, parent=e)
cylinder('Side lamp', 11.9, 3.95, 0.52, 0.9, 0.11, M['linen'], verts=24, parent=e)

def dining_chair(label, info, x, y, rot):
    e = item(label, info, x, y, rot)
    for lx in (-0.2, 0.2):
        for ly in (-0.2, 0.2):
            local_box('Leg', lx - 0.022, ly - 0.022, 0, lx + 0.022, ly + 0.022, 0.45, M['oak_solid'], e)
    local_box('Seat', -0.24, -0.24, 0.42, 0.24, 0.24, 0.5, M['linen'], e, bevel=0.03)
    local_box('Back', -0.23, 0.2, 0.5, 0.23, 0.26, 0.86, M['linen'], e, bevel=0.03)
    return e
for i, (x, y, r) in enumerate([(14.75, 5.15, 180), (15.75, 5.15, 180), (14.75, 6.85, 0), (15.75, 6.85, 0), (14.05, 6.0, -90), (16.45, 6.0, 90)]):
    dining_chair(f'Dining chair {i + 1}', 'Oak frame with a linen seat and back.', x, y, r)
for i, x in enumerate((18.6, 19.3, 20.0, 20.7)):
    e = item(f'Counter stool {i + 1}', 'Oak counter stool.', x, 4.55)
    seat = cylinder('Stool seat', 0, 0, 0.62, 0.68, 0.19, M['oak_solid']); seat.parent = e
    for a in range(4):
        r = math.radians(45 + 90 * a); lx, ly = 0.13 * math.cos(r), 0.13 * math.sin(r)
        local_box('Stool leg', lx - 0.018, ly - 0.018, 0, lx + 0.018, ly + 0.018, 0.62, M['oak_solid'], e)
    local_box('Footrest', -0.13, -0.13, 0.25, 0.13, -0.11, 0.27, M['brass'], e)
dining_chair('Desk chair', 'Oak and linen desk chair.', 4.3, 1.3, 180)

# ---------------------------------------------------------------- Poly Haven furniture
def place_model(model, label, info, x, y, rot=0, z=0, scale=1.0, pick=None):
    path = os.path.join(SRC, 'models', model, f'{model}.gltf')
    if not os.path.exists(path):
        print('missing model', model); return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    if pick:
        keep = [o for o in new if any(o.name.startswith(p) for p in pick)]
        for o in new:
            if o not in keep: bpy.data.objects.remove(o)
        new = keep
        for o in new: o.parent = None   # its import parent may have been removed
    e = item(label, info, x, y, rot)
    e.location.z = z; e.scale = (scale, scale, scale)
    for o in new:
        for c in o.users_collection: c.objects.unlink(o)
        col_static.objects.link(o)
        if o.parent is None or o.parent not in new: o.parent = e
    e['source'] = f'Poly Haven · {model} (CC0)'
    return e

place_model('mid_century_lounge_chair', 'Lounge chair', 'Mid-century lounge chair in leather.', 9.1, 4.3, rot=-35)
for (m, x, y, label) in [('potted_plant_02', 12.9, 8.5, 'Fiddle-leaf plant'), ('calathea_orbifolia_01', 7.4, 8.6, 'Calathea'), ('potted_plant_04', 21.4, D - 0.35, 'Herb pot')]:
    place_model(m, label, 'Indoor plant.', x, y, z=0.92 if m == 'potted_plant_04' else 0.0, pick=['calathea_orbifolia_01_b'] if m.startswith('calathea') else None)
place_model('ceramic_vase_02', 'Vase', 'Ceramic vase.', 15.25, 6.0, z=0.76)
place_model('ceramic_vase_04', 'Vase', 'Ceramic vase.', 1.55, 2.4, z=0.93)

# one image datablock per file: repeated imports of the same model would otherwise duplicate its textures
by_path = {}
for img in list(bpy.data.images):
    key = bpy.path.abspath(img.filepath).lower() if img.filepath else None
    if not key: continue
    if key in by_path: img.user_remap(by_path[key]); bpy.data.images.remove(img)
    else: by_path[key] = img
print(f'{len(by_path)} distinct texture files')

# ---------------------------------------------------------------- lighting for the bake
world = bpy.data.worlds.new('Sky'); scene.world = world; world.use_nodes = True
wn = world.node_tree; bg = wn.nodes['Background']
hdr = os.path.join(SRC, 'hdri', 'kloofendal_48d_partly_cloudy_puresky.hdr')
if os.path.exists(hdr):
    env = wn.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(hdr)
    wn.links.new(env.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 0.28
# key: a warm sun for directional shadows; fill: a smaller softbox high above so shadows soften but stay
sun_data = bpy.data.lights.new('Sun', 'SUN'); sun_data.energy = 6.0; sun_data.angle = math.radians(3); sun_data.color = (1.0, 0.9, 0.78)
soft = bpy.data.lights.new('Studio softbox', 'AREA'); soft.shape = 'RECTANGLE'; soft.size = 12; soft.size_y = 7; soft.energy = 1800; soft.color = (1.0, 0.94, 0.86)
soft_ob = bpy.data.objects.new('Studio softbox', soft); scene.collection.objects.link(soft_ob); soft_ob.location = (W / 2 - 2, D / 2 - 3, 18); soft_ob.rotation_euler = (math.radians(12), 0, 0)
sun = bpy.data.objects.new('Sun', sun_data); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(42), math.radians(-18), math.radians(-28))   # high, from the front-left

# ---------------------------------------------------------------- preview (no bake): a quick render from the page's camera
if '--preview' in ARGS:
    sys.path.insert(0, os.path.dirname(__file__)); import bakelib
    for r in col_rooms.objects: r.hide_render = True
    bakelib.use_gpu(scene)
    bakelib.preview(scene, (-3.0, -16.5, 17.0), (11.4, 3.9, 0.0), 30, os.path.join(OUT, 'preview.jpg')); raise SystemExit

# ---------------------------------------------------------------- make every static mesh unique, add lightmap UVs
bpy.ops.object.select_all(action='DESELECT')
# Small, detailed props are lit in real time on the page; they still cast shadows into the bake.
REALTIME = ('Fiddle-leaf plant', 'Calathea', 'Herb pot', 'Vase')
def owner(o):
    while o.parent: o = o.parent
    return o.name
statics = [o for o in col_static.objects if o.type == 'MESH' and not any(owner(o).startswith(f'item:{p}') for p in REALTIME)]
for o in col_static.objects:
    if o.type == 'MESH' and o not in statics:
        for mod in list(o.modifiers):
            bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=mod.name)
for o in statics:
    if o.data.users > 1: o.data = o.data.copy()
    for mod in list(o.modifiers):
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new(); bm.from_mesh(o.data); mw = o.matrix_world
    hidden = [f for f in bm.faces if (mw.to_3x3() @ f.normal).z < -0.9 and (mw @ f.calc_center_median()).z < 0.05 or (o.name == 'Slab' and (mw.to_3x3() @ f.normal).z > 0.9)]
    if hidden and len(hidden) < len(bm.faces): bmesh.ops.delete(bm, geom=hidden, context='FACES'); bm.to_mesh(o.data)
    bm.free()
    if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    lm = o.data.uv_layers.new(name='Lightmap'); o.data.uv_layers.active = lm
    o.select_set(True)
bpy.context.view_layer.objects.active = statics[0]
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0015, scale_to_bounds=False)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()                 # same texel density on every surface, so floors and walls get their share
bpy.ops.uv.pack_islands(rotate=True, margin=0.002, shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')
print(f'lightmap UVs on {len(statics)} meshes')

# ---------------------------------------------------------------- bake
scene.render.engine = 'CYCLES'
cy = scene.cycles; cy.samples = 16 if QUICK else SAMPLES; cy.use_denoising = False
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for backend in ('HIP', 'CUDA', 'OPTIX', 'ONEAPI'):
        try:
            prefs.compute_device_type = backend; prefs.get_devices()
            if any(d.type == backend for d in prefs.devices):
                for d in prefs.devices: d.use = True
                cy.device = 'GPU'; print('bake device', backend); break
        except Exception: pass
except Exception as ex: print('GPU setup failed, using CPU', ex)

size = 1024 if QUICK else SIZE
lm_img = bpy.data.images.new('Lightmap', size, size, float_buffer=True)
for mat in {s.material for o in statics for s in o.material_slots if s.material}:
    nt = mat.node_tree
    node = nt.nodes.new('ShaderNodeTexImage'); node.image = lm_img; node.name = 'LightmapBake'
    nt.nodes.active = node
glass = [o for o in col_glass.objects]
for o in glass: o.hide_render = False
bpy.ops.object.select_all(action='DESELECT')
for o in statics: o.select_set(True)
bpy.context.view_layer.objects.active = statics[0]
scene.render.bake.use_pass_direct = True; scene.render.bake.use_pass_indirect = True; scene.render.bake.use_pass_color = False
scene.render.bake.margin = 6
print(f'baking {size}x{size} at {cy.samples} samples…')
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True)
raw = os.path.join(OUT, 'lightmap_raw.exr')
lm_img.filepath_raw = raw; lm_img.file_format = 'OPEN_EXR'; lm_img.save()
ao_img = bpy.data.images.new('AO', size, size, float_buffer=True)
for mat in {s.material for o in statics for s in o.material_slots if s.material}:
    if 'LightmapBake' in mat.node_tree.nodes: mat.node_tree.nodes['LightmapBake'].image = ao_img
scene.world.light_settings.distance = 1.2
print('baking ambient occlusion…', flush=True)
bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
ao_raw = os.path.join(OUT, 'ao_raw.exr'); ao_img.filepath_raw = ao_raw; ao_img.file_format = 'OPEN_EXR'; ao_img.save()

# denoise with the compositor (Open Image Denoise)
dn = bpy.data.scenes.new('Denoise'); dn.use_nodes = True
dn.render.resolution_x = dn.render.resolution_y = size; dn.render.resolution_percentage = 100
dn.render.engine = 'BLENDER_WORKBENCH'
ntc = dn.node_tree; ntc.nodes.clear()
inode = ntc.nodes.new('CompositorNodeImage'); inode.image = bpy.data.images.load(raw)
den = ntc.nodes.new('CompositorNodeDenoise'); den.use_hdr = True
mul = ntc.nodes.new('CompositorNodeMixRGB'); mul.blend_type = 'MULTIPLY'; mul.inputs[2].default_value = (0.5, 0.5, 0.5, 1)   # store at half intensity
comp = ntc.nodes.new('CompositorNodeComposite')
ao_node = ntc.nodes.new('CompositorNodeImage'); ao_node.image = bpy.data.images.load(ao_raw)
ao_den = ntc.nodes.new('CompositorNodeDenoise')
ao_mix = ntc.nodes.new('CompositorNodeMixRGB'); ao_mix.blend_type = 'MIX'; ao_mix.inputs[0].default_value = 0.6; ao_mix.inputs[1].default_value = (1, 1, 1, 1)   # 60% AO
ao_mul = ntc.nodes.new('CompositorNodeMixRGB'); ao_mul.blend_type = 'MULTIPLY'; ao_mul.inputs[0].default_value = 1.0
ntc.links.new(ao_node.outputs['Image'], ao_den.inputs['Image']); ntc.links.new(ao_den.outputs['Image'], ao_mix.inputs[2])
ntc.links.new(inode.outputs['Image'], den.inputs['Image']); ntc.links.new(den.outputs['Image'], ao_mul.inputs[1]); ntc.links.new(ao_mix.outputs['Image'], ao_mul.inputs[2])
ntc.links.new(ao_mul.outputs['Image'], mul.inputs[1]); ntc.links.new(mul.outputs['Image'], comp.inputs['Image'])
dn.render.image_settings.file_format = 'JPEG'; dn.render.image_settings.quality = 90
dn.view_settings.view_transform = 'Standard'
dn.render.filepath = os.path.join(OUT, 'lightmap.jpg')
bpy.ops.render.render(write_still=True, scene=dn.name)
print('lightmap written')

# ---------------------------------------------------------------- export
for mat in bpy.data.materials:
    if mat.node_tree and 'LightmapBake' in mat.node_tree.nodes: mat.node_tree.nodes.remove(mat.node_tree.nodes['LightmapBake'])
for o in statics: o.data.uv_layers.active = o.data.uv_layers['UVMap'] if 'UVMap' in o.data.uv_layers else o.data.uv_layers[0]
for r in col_rooms.objects: r.hide_render = False
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'apartment.glb'), export_format='GLB', use_selection=False,
                          export_extras=True, export_apply=True, export_lights=False, export_cameras=False,
                          export_image_format='JPEG', export_image_quality=85, export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=6, export_texcoords=True, export_normals=True)
print('exported', os.path.join(OUT, 'apartment.glb'))
