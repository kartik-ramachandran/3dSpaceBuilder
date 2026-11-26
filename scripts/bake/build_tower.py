"""
Residential tower exterior: a 24-storey tower on a two-storey podium with a double-height lobby, set in a
landscaped plaza. Lighting is baked in Cycles.

    blender -b -P scripts/bake/build_tower.py -- [--samples 96] [--size 2048] [--quick]

To keep the bake affordable, one typical floor is baked once (with real copies of the floors above and
below in place for its shadows) and the page repeats it. The podium, crown and plaza get their own lightmap,
baked with the whole tower present so its shadow falls across the plaza.

Output (assets/tower/):
    floor.glb + floor_lightmap.jpg   one typical floor at z = 0 (the page stacks FLOORS copies)
    site.glb  + site_lightmap.jpg    podium and lobby, roof crown, plaza, landscaping
Axes: Blender Z up, metres; the front (lobby entrance) faces -Y.
"""
import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bakelib as L

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
arg = lambda n, d: type(d)(ARGS[ARGS.index(n) + 1]) if n in ARGS else d
QUICK = '--quick' in ARGS
SAMPLES = 16 if QUICK else arg('--samples', 96)
SIZE = 1024 if QUICK else arg('--size', 2048)
OUT = os.path.join(L.ROOT, 'assets', 'tower'); os.makedirs(OUT, exist_ok=True)

FLOORS, FH, PODIUM = 24, 3.2, 7.2          # residential floors, floor height, podium height
TX, TY = 36.0, 20.0                        # tower footprint
PX, PY = 50.0, 32.0                        # podium footprint
BAL = 1.8                                  # balcony depth
LM_SCALE = 0.18                            # outdoor light is bright: store the bake at 18% (page uses π / 0.18)

scene = L.reset()
col_floor = L.collection('Typical floor'); col_stack = L.collection('Floor copies'); col_site = L.collection('Site'); col_live = L.collection('Real-time')

M = {
    'render': L.material('Render', (0.86, 0.84, 0.80), 0.85, tex='white_plaster_02', normal_strength=0.35, use_diffuse=False),
    'slab': L.material('Slab edge', (0.93, 0.92, 0.9), 0.7),
    'soffit': L.material('Soffit', (0.95, 0.94, 0.92), 0.9),
    'frame': L.material('Bronze frame', (0.16, 0.13, 0.1), 0.38, 0.75),
    'glass': L.material('Glazing', (0.75, 0.82, 0.85), 0.04, transmission=1.0),
    'balustrade': L.material('Balustrade glass', (0.85, 0.92, 0.94), 0.03, transmission=1.0),
    'rail': L.material('Handrail', (0.2, 0.18, 0.16), 0.35, 0.8),
    'fin': L.material('Fin', (0.82, 0.8, 0.76), 0.6),
    'oak': L.material('Interior oak', rough=0.55, tex='oak_wood_planks', tint=(1.1, 1.02, 0.9)),
    'inner': L.material('Interior wall', (0.9, 0.87, 0.82), 0.9),
    'linen': L.material('Curtain', rough=0.95, tex='rough_linen', tint=(0.96, 0.93, 0.87)),
    'sofa': L.material('Sofa', (0.55, 0.5, 0.45), 0.95),
    'stone': L.material('Podium stone', rough=0.75, tex='stacked_stone_wall', tint=(1.08, 1.04, 0.98)),
    'pavers': L.material('Plaza pavers', rough=0.8, tex='concrete_pavers', tint=(1.05, 1.03, 1.0)),
    'grass': L.material('Lawn', (0.24, 0.36, 0.14), 0.95, tex='grass_path_2', use_diffuse=False, normal_strength=1.0),   # that texture is a path: keep only its surface detail
    'concrete': L.material('Concrete', (0.66, 0.65, 0.62), 0.85),
    'water': L.material('Pool water', (0.06, 0.14, 0.16), 0.04, coat=1.0),
    'asphalt': L.material('Street', (0.13, 0.13, 0.14), 0.9),
    'warm': L.material('Lobby light', (1.0, 0.92, 0.78), 0.5, emission=((1.0, 0.86, 0.66), 3.0)),
}

# ---------------------------------------------------------------- one typical floor (z 0 … FH)
def typical_floor(c, z0=0.0):
    hx, hy = TX / 2, TY / 2
    B = lambda n, *a, **k: L.box(c, n, *a, **k)
    B('Slab', -hx, -hy, z0, hx, hy, z0 + 0.3, M['slab'])
    B('Ceiling', -hx + 0.3, -hy + 0.3, z0 + FH - 0.02, hx - 0.3, hy - 0.3, z0 + FH, M['soffit'])
    for side in (-1, 1):                                       # long faces: balconies, glazing, fins
        yo = side * hy
        y_out = yo + side * BAL
        B('Balcony', -hx + 0.6, min(yo, y_out), z0, hx - 0.6, max(yo, y_out), z0 + 0.25, M['slab'])
        y_bal = y_out - side * 0.06
        B('Balustrade', -hx + 0.6, min(y_bal, y_bal + side * 0.02), z0 + 0.25, hx - 0.6, max(y_bal, y_bal + side * 0.02), z0 + 1.3, M['balustrade'])
        B('Handrail', -hx + 0.6, min(y_bal - side * 0.03, y_bal + side * 0.05), z0 + 1.3, hx - 0.6, max(y_bal - side * 0.03, y_bal + side * 0.05), z0 + 1.35, M['rail'])
        # curtain wall, set back from the slab edge
        yg = yo - side * 0.15
        B('Glass', -hx + 0.4, min(yg, yg + side * 0.02), z0 + 0.3, hx - 0.4, max(yg, yg + side * 0.02), z0 + FH - 0.35, M['glass'])
        B('Head band', -hx + 0.4, min(yg - side * 0.05, yg + side * 0.06), z0 + FH - 0.35, hx - 0.4, max(yg - side * 0.05, yg + side * 0.06), z0 + FH, M['frame'])
        n = int(TX / 1.5)
        for k in range(n + 1):
            x = -hx + 0.4 + (TX - 0.8) * k / n
            B('Mullion', x - 0.03, min(yg - side * 0.04, yg + side * 0.06), z0 + 0.3, x + 0.03, max(yg - side * 0.04, yg + side * 0.06), z0 + FH - 0.35, M['frame'])
        # balcony dividers every 6 m mark the apartments; interior bays behind the glass
        for k in range(1, 6):
            x = -hx + k * 6
            B('Divider', x - 0.08, min(yo, y_out), z0 + 0.25, x + 0.08, max(yo, y_out), z0 + FH, M['fin'])
        y_back = yo - side * 4.5
        B('Interior floor', -hx + 0.4, min(yg, y_back), z0 + 0.3, hx - 0.4, max(yg, y_back), z0 + 0.32, M['oak'], tile=2.4)
        B('Interior back wall', -hx + 0.4, min(y_back, y_back - side * 0.1), z0 + 0.3, hx - 0.4, max(y_back, y_back - side * 0.1), z0 + FH, M['inner'])
        for k in range(6):
            x0 = -hx + k * 6
            if k: B('Party wall', x0 - 0.06, min(yg, y_back), z0 + 0.3, x0 + 0.06, max(yg, y_back), z0 + FH, M['inner'])
            # some life behind the glass: a sofa and curtains drawn to different widths
            sx = x0 + 1.2 + (k * 1.7) % 2.6
            B('Sofa', sx, min(yg - side * 2.2, yg - side * 3.1), z0 + 0.32, sx + 2.0, max(yg - side * 2.2, yg - side * 3.1), z0 + 1.1, M['sofa'], bevel=0.06)
            cw = 0.8 + (k * 0.9) % 1.8
            B('Curtain', x0 + 0.3, min(yg - side * 0.25, yg - side * 0.33), z0 + 0.4, x0 + 0.3 + cw, max(yg - side * 0.25, yg - side * 0.33), z0 + FH - 0.4, M['linen'])
    for side in (-1, 1):                                       # short faces: render cladding with tall slot windows
        xo = side * hx
        B('End wall', min(xo, xo - side * 0.3), -hy, z0 + 0.3, max(xo, xo - side * 0.3), hy, z0 + FH, M['render'], tile=3.0)
        for y in (-5.0, 5.0):
            B('Slot glass', min(xo + side * 0.005, xo + side * 0.02), y - 0.6, z0 + 0.6, max(xo + side * 0.005, xo + side * 0.02), y + 0.6, z0 + FH - 0.5, M['glass'])
            B('Slot frame', min(xo, xo + side * 0.06), y - 0.68, z0 + 0.52, max(xo, xo + side * 0.06), y + 0.68, z0 + 0.6, M['frame'])
    return [o for o in c.objects]

floor_objs = typical_floor(col_floor)
L.apply_modifiers(floor_objs)
MID = FLOORS // 2                                             # the floor that gets baked
mid_z = PODIUM + MID * FH
for o in floor_objs: o.location.z += mid_z
# real copies of every other floor, for shadows and occlusion in the bake (shared mesh data)
for k in range(FLOORS):
    if k == MID: continue
    for o in floor_objs:
        d = o.copy(); d.location.z = o.location.z + (k - MID) * FH; col_stack.objects.link(d)

# ---------------------------------------------------------------- podium with a double-height lobby
B = lambda n, *a, **k: L.box(col_site, n, *a, **k)
hx, hy = PX / 2, PY / 2
B('Podium slab', -hx, -hy, -0.3, hx, hy, 0.15, M['concrete'])
B('Podium roof', -hx, -hy, PODIUM - 0.4, hx, hy, PODIUM, M['slab'])
B('Podium roof garden', -hx + 1, -hy + 1, PODIUM, -TX / 2 - 1, hy - 1, PODIUM + 0.45, M['grass'], tile=3)
B('Podium roof garden 2', TX / 2 + 1, -hy + 1, PODIUM, hx - 1, hy - 1, PODIUM + 0.45, M['grass'], tile=3)
for side in (-1, 1):
    B('Podium end', min(side * hx, side * (hx - 0.4)), -hy, 0.15, max(side * hx, side * (hx - 0.4)), hy, PODIUM - 0.4, M['stone'], tile=2.0)
B('Podium back', -hx, hy - 0.4, 0.15, hx, hy, PODIUM - 0.4, M['stone'], tile=2.0)
# front: stone piers with lobby glazing between, a canopy over the entrance
piers = [-hx, -15, -5, 5, 15, hx - 1.2]
for i, x in enumerate(piers):
    B(f'Pier {i}', x, -hy, 0.15, x + 1.2, -hy + 0.6, PODIUM - 0.4, M['stone'], tile=2.0)
for a, b in zip(piers[:-1], piers[1:]):
    B('Lobby glass', a + 1.2, -hy + 0.25, 0.15, b, -hy + 0.28, PODIUM - 0.6, M['glass'])
    B('Lobby transom', a + 1.2, -hy + 0.2, 3.4, b, -hy + 0.32, 3.5, M['frame'])
B('Lobby floor', -hx + 0.6, -hy + 0.3, 0.15, hx - 0.6, hy - 0.6, 0.17, M['stone'], tile=1.5)
B('Lobby desk', -3, -hy + 5, 0.17, 3, -hy + 6, 1.1, M['oak'], bevel=0.02)
B('Lobby feature wall', -8, -hy + 9, 0.17, 8, -hy + 9.4, PODIUM - 0.6, M['oak'])
B('Lobby ceiling glow', -12, -hy + 1.5, PODIUM - 0.62, 12, -hy + 8, PODIUM - 0.6, M['warm'])
B('Canopy', -6, -hy - 4.5, 4.2, 6, -hy, 4.45, M['frame'])
for x in (-5.6, 5.6): L.cylinder(col_site, 'Canopy column', x, -hy - 4.1, 0.15, 4.2, 0.12, M['frame'])

# ---------------------------------------------------------------- roof crown
top = PODIUM + FLOORS * FH
B('Roof slab', -TX / 2, -TY / 2, top, TX / 2, TY / 2, top + 0.4, M['slab'])
B('Crown', -TX / 2 + 4, -TY / 2 + 3, top + 0.4, TX / 2 - 4, TY / 2 - 3, top + 4.5, M['render'], tile=3)
B('Crown band', -TX / 2 + 3.8, -TY / 2 + 2.8, top + 4.5, TX / 2 - 3.8, TY / 2 - 2.8, top + 4.9, M['frame'])
for side in (-1, 1):
    B('Parapet glass', -TX / 2, min(side * TY / 2, side * (TY / 2 - 0.03)), top + 0.4, TX / 2, max(side * TY / 2, side * (TY / 2 - 0.03)), top + 1.5, M['balustrade'])

# ---------------------------------------------------------------- plaza and landscaping
B('Plaza', -45, -45, -0.35, 45, 35, -0.05, M['pavers'], tile=2.0)
B('Street', -80, -60, -0.4, 80, -45, -0.3, M['asphalt'])
B('Footpath', -80, -45, -0.35, 80, -42, -0.1, M['concrete'])
for x0, x1 in ((-42, -12), (12, 42)):
    B('Lawn', x0, -40, -0.05, x1, -26, 0.08, M['grass'], tile=3.0)
    B('Lawn kerb', x0 - 0.3, -40.3, -0.05, x1 + 0.3, -26 + 0.3, 0.02, M['concrete'])
B('Reflecting pool rim', -9, -40, -0.05, 9, -30, 0.35, M['stone'], tile=1.5)
B('Reflecting pool', -8.6, -39.6, 0.0, 8.6, -30.4, 0.32, M['water'])
site_objs = [o for o in col_site.objects if o.type == 'MESH']
L.apply_modifiers(site_objs)

# real-time props (cast shadows into the bake, lit live on the page)
for i, (x, y, r, s) in enumerate([(-34, -33, 20, 0.9), (32, -34, 140, 1.0), (-24, -36, 260, 0.85), (25, -30, 75, 0.8)]):
    if not QUICK or i == 0: L.import_model(col_live, 'jacaranda_tree', x, y, z=0.08, rot=r, scale=s, decimate=0.12, name=f'Jacaranda {i + 1}')
for i, x in enumerate(range(-40, 41, 8)):
    if abs(x) > 10: L.import_model(col_live, 'shrub_03', x, -26.8, z=0.08, rot=i * 47, name=f'Shrub {i + 1}')
for i, x in enumerate((-30, -18, 18, 30)):
    L.import_model(col_live, 'street_lamp_02', x, -43.5, z=-0.1, rot=90, name=f'Street lamp {i + 1}')
for i, x in enumerate((-16, 16)):
    L.import_model(col_live, 'modular_street_seating', x, -33, rot=0, name=f'Bench {i + 1}')
print(f'{L.dedupe_images()} distinct texture files')

# ---------------------------------------------------------------- daylight: sky plus a warm sun from the front-left
world = bpy.data.worlds.new('Sky'); scene.world = world; world.use_nodes = True
wn = world.node_tree; bg = wn.nodes['Background']
env = wn.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(os.path.join(L.SRC, 'hdri', 'kloofendal_48d_partly_cloudy_puresky.hdr'))
wn.links.new(env.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.9
sun_data = bpy.data.lights.new('Sun', 'SUN'); sun_data.energy = 4.2; sun_data.angle = math.radians(1.2); sun_data.color = (1.0, 0.93, 0.83)
sun = bpy.data.objects.new('Sun', sun_data); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))

# ---------------------------------------------------------------- preview (no bake): a quick render from the page's camera
L.use_gpu(scene)
if '--preview' in ARGS:
    L.preview(scene, (-105, -150, 52), (0, 2, 34), 34, os.path.join(OUT, 'preview.jpg')); raise SystemExit

# ---------------------------------------------------------------- bake: the typical floor, then the site
glass_mats = {M['glass'], M['balustrade'], M['warm']}
bake_floor = [o for o in floor_objs if o.material_slots[0].material not in glass_mats]
bake_site = [o for o in site_objs if o.material_slots[0].material not in glass_mats]
L.lightmap_uvs(bake_floor); L.lightmap_uvs(bake_site, drop_hidden_below=0.0)
L.bake_lightmap(scene, bake_floor, SIZE, SAMPLES, os.path.join(OUT, 'floor_lightmap.jpg'), LM_SCALE)
L.bake_lightmap(scene, bake_site, SIZE, SAMPLES, os.path.join(OUT, 'site_lightmap.jpg'), LM_SCALE)

# ---------------------------------------------------------------- export: the typical floor at z = 0, and the site
for o in floor_objs: o.location.z -= mid_z
for o in floor_objs: o['kind'] = 'floor'
col_floor['floors'] = FLOORS
L.export_glb(floor_objs, os.path.join(OUT, 'floor.glb'))
for o in site_objs: o['kind'] = 'site'
info = bpy.data.objects.new('tower:info', None); col_site.objects.link(info)
info['kind'] = 'tower'; info['floors'] = FLOORS; info['floor_height'] = FH; info['podium'] = PODIUM; info['lightmap_scale'] = LM_SCALE
info['footprint'] = [TX, TY]; info['flats_per_floor'] = 12
live = [o for o in col_live.objects]
L.export_glb(site_objs + live + [info], os.path.join(OUT, 'site.glb'))
