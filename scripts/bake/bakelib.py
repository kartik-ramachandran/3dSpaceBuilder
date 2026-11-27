"""
Shared helpers for the Blender bake scripts: materials from Poly Haven textures, boxes with real-metre UVs,
model import, lightmap unwrapping, Cycles baking with denoising, and glTF export.

Lightmaps are Cycles DIFFUSE bakes (direct + indirect, no surface colour), denoised, multiplied by `scale`
and saved as sRGB JPEG. The page sets lightMapIntensity = π / scale and the lightmap UV set is TEXCOORD_1.
"""
import bpy, bmesh, math, os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'source-assets')

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene

def collection(name):
    c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c

# ---------------------------------------------------------------- materials
def _img(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color: img.colorspace_settings.name = 'Non-Color'
    return img

# Smooth mode (default): textured materials become their texture's average colour and models carry no images.
# Set BAKE_SMOOTH=0 for full PBR textures.
SMOOTH = os.environ.get('BAKE_SMOOTH', '1') != '0'
_means = {}
def mean_colour(path):
    """Average colour of an image, in linear RGB (what the shader's base colour expects)."""
    if path not in _means:
        img = bpy.data.images.load(path, check_existing=True); px = img.pixels[:]
        n = len(px) // 4; step = max(1, n // 40000)
        acc = [0.0, 0.0, 0.0]; k = 0
        for i in range(0, n, step): acc[0] += px[i * 4]; acc[1] += px[i * 4 + 1]; acc[2] += px[i * 4 + 2]; k += 1
        lin = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
        srgb = img.colorspace_settings.name.lower().startswith('srgb')
        _means[path] = tuple((lin(a / k) if srgb else a / k) for a in acc)
        bpy.data.images.remove(img)
    return _means[path]

def material(name, color=(0.9, 0.9, 0.9), rough=0.6, metal=0.0, tex=None, tint=None, transmission=0.0, coat=0.0,
             normal_strength=0.6, use_diffuse=True, emission=None, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if transmission: b.inputs['Transmission Weight'].default_value = transmission; b.inputs['IOR'].default_value = 1.45
    if coat: b.inputs['Coat Weight'].default_value = coat
    if emission: b.inputs['Emission Color'].default_value = (*emission[0], 1); b.inputs['Emission Strength'].default_value = emission[1]
    if alpha < 1: b.inputs['Alpha'].default_value = alpha
    if tex and SMOOTH:                        # smooth: the texture's average colour, no image maps (light, fast to load)
        folder = os.path.join(SRC, 'tex', tex)
        diff = next((os.path.join(folder, f) for f in os.listdir(folder) if 'diff' in f), None)
        if diff and use_diffuse:
            c = mean_colour(diff); t = tint or (1, 1, 1)
            b.inputs['Base Color'].default_value = (*(min(1.0, c[i] * t[i]) for i in range(3)), 1)
        return m
    if tex:
        folder = os.path.join(SRC, 'tex', tex)
        find = lambda key: next((os.path.join(folder, f) for f in os.listdir(folder) if key in f), None)
        diff, nor, rgh = find('diff'), find('nor_gl') or find('nor'), find('rough')
        if diff and use_diffuse:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(diff)
            if tint:
                mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
                nt.links.new(t.outputs['Color'], mix.inputs['A']); mix.inputs['B'].default_value = (*tint, 1)
                nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
            else: nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if nor:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(nor, True)
            n = nt.nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value = normal_strength
            nt.links.new(t.outputs['Color'], n.inputs['Color']); nt.links.new(n.outputs['Normal'], b.inputs['Normal'])
        if rgh:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(rgh, True); nt.links.new(t.outputs['Color'], b.inputs['Roughness'])
    return m

# ---------------------------------------------------------------- geometry
def world_uv(bm, tile):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = (co.y / tile, co.z / tile) if ax == 0 else (co.x / tile, co.z / tile) if ax == 1 else (co.x / tile, co.y / tile)

def box(coll, name, x0, y0, z0, x1, y1, z1, mat, bevel=0.0, tile=1.0, parent=None):
    """Axis-aligned box between two corners (world metres), UVs in metres / tile."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), z0 + (v.co.z + 0.5) * (z1 - z0)))
    bm.normal_update(); world_uv(bm, tile); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat); coll.objects.link(ob)
    if bevel > 0:
        mod = ob.modifiers.new('Bevel', 'BEVEL'); mod.width = bevel; mod.segments = 3; mod.limit_method = 'ANGLE'; mod.harden_normals = True
    if parent: ob.parent = parent; ob.matrix_parent_inverse = parent.matrix_basis.inverted()
    return ob

def cylinder(coll, name, x, y, z0, z1, r, mat, verts=24):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=(z1 - z0))
    for v in bm.verts: v.co += Vector((x, y, (z0 + z1) / 2))
    bm.normal_update(); world_uv(bm, 0.5); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat); coll.objects.link(ob)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def import_model(coll, model, x, y, z=0.0, rot=0.0, scale=1.0, decimate=None, name=None):
    """Imports a Poly Haven glTF from source-assets/models and places it; optional decimation ratio (0..1)."""
    path = os.path.join(SRC, 'models', model, f'{model}.gltf')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(name or model, None); coll.objects.link(root)
    root.location = (x, y, z); root.rotation_euler = (0, 0, math.radians(rot)); root.scale = (scale, scale, scale)
    for o in new:
        for c in o.users_collection: c.objects.unlink(o)
        coll.objects.link(o)
        if o.parent is None: o.parent = root
        if decimate and o.type == 'MESH' and len(o.data.polygons) > 2000:
            mod = o.modifiers.new('Decimate', 'DECIMATE'); mod.ratio = decimate
            bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=mod.name)
    return root, [o for o in new if o.type == 'MESH']

def dedupe_images():
    by_path = {}
    for img in list(bpy.data.images):
        key = bpy.path.abspath(img.filepath).lower() if img.filepath else None
        if not key: continue
        if key in by_path: img.user_remap(by_path[key]); bpy.data.images.remove(img)
        else: by_path[key] = img
    return len(by_path)

def apply_modifiers(objects):
    for o in objects:
        if o.type != 'MESH': continue
        for mod in list(o.modifiers):
            bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=mod.name)

# ---------------------------------------------------------------- lightmaps
def lightmap_uvs(objects, drop_hidden_below=None):
    """Adds a 'Lightmap' UV set to each mesh and packs all of them into one shared 0..1 space."""
    meshes = []
    for o in objects:
        if o.type != 'MESH' or o.data in [m.data for m in meshes]: continue
        if drop_hidden_below is not None:          # faces facing down at or below this height are never seen
            bm = bmesh.new(); bm.from_mesh(o.data); mw = o.matrix_world
            hidden = [f for f in bm.faces if (mw.to_3x3() @ f.normal).z < -0.9 and (mw @ f.calc_center_median()).z < drop_hidden_below]
            if hidden and len(hidden) < len(bm.faces): bmesh.ops.delete(bm, geom=hidden, context='FACES'); bm.to_mesh(o.data)
            bm.free()
        if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
        if 'Lightmap' not in o.data.uv_layers: o.data.uv_layers.new(name='Lightmap')
        o.data.uv_layers.active = o.data.uv_layers['Lightmap']
        meshes.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0015, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.002, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    return meshes

def use_gpu(scene):
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for backend in ('HIP', 'CUDA', 'OPTIX', 'ONEAPI'):
            try:
                prefs.compute_device_type = backend; prefs.get_devices()
                if any(d.type == backend for d in prefs.devices):
                    for d in prefs.devices: d.use = True
                    scene.cycles.device = 'GPU'; print('bake device', backend); return backend
            except Exception: pass
    except Exception as ex: print('GPU setup failed, using CPU', ex)
    return 'CPU'

def bake_lightmap(scene, targets, size, samples, out_jpg, scale=0.5):
    """Bakes diffuse lighting for `targets` into one image, denoises it, scales it and writes a JPEG."""
    scene.render.engine = 'CYCLES'; scene.cycles.samples = samples; scene.cycles.use_denoising = False
    img = bpy.data.images.new(os.path.basename(out_jpg), size, size, float_buffer=True)
    mats = {s.material for o in targets for s in o.material_slots if s.material}
    for mat in mats:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage'); node.image = img; node.name = 'LightmapBake'; mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    for o in targets: o.select_set(True); o.data.uv_layers.active = o.data.uv_layers['Lightmap']
    bpy.context.view_layer.objects.active = targets[0]
    scene.render.bake.use_pass_direct = True; scene.render.bake.use_pass_indirect = True; scene.render.bake.use_pass_color = False
    print(f'baking {len(targets)} meshes into {size}x{size} at {samples} samples', flush=True)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True)
    raw = out_jpg.replace('.jpg', '_raw.exr'); img.filepath_raw = raw; img.file_format = 'OPEN_EXR'; img.save()
    for mat in mats:
        if 'LightmapBake' in mat.node_tree.nodes: mat.node_tree.nodes.remove(mat.node_tree.nodes['LightmapBake'])
    # denoise (Open Image Denoise) and scale in the compositor
    dn = bpy.data.scenes.new('Denoise'); dn.use_nodes = True; dn.render.engine = 'BLENDER_WORKBENCH'
    dn.render.resolution_x = dn.render.resolution_y = size; dn.render.resolution_percentage = 100
    nt = dn.node_tree; nt.nodes.clear()
    i = nt.nodes.new('CompositorNodeImage'); i.image = bpy.data.images.load(raw)
    d = nt.nodes.new('CompositorNodeDenoise'); d.use_hdr = True
    mul = nt.nodes.new('CompositorNodeMixRGB'); mul.blend_type = 'MULTIPLY'; mul.inputs[2].default_value = (scale, scale, scale, 1)
    c = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(i.outputs['Image'], d.inputs['Image']); nt.links.new(d.outputs['Image'], mul.inputs[1]); nt.links.new(mul.outputs['Image'], c.inputs['Image'])
    dn.render.image_settings.file_format = 'JPEG'; dn.render.image_settings.quality = 90; dn.view_settings.view_transform = 'Standard'
    dn.render.filepath = out_jpg
    bpy.ops.render.render(write_still=True, scene=dn.name)
    bpy.data.scenes.remove(dn)
    for o in targets: o.data.uv_layers.active = o.data.uv_layers[0]
    print('lightmap written', out_jpg, flush=True)

def bake_ao(scene, targets, size, samples, out_jpg, distance=1.2):
    """Bakes ambient occlusion for `targets` into one shared image (denoised, greyscale JPEG)."""
    scene.render.engine = 'CYCLES'; scene.cycles.samples = samples; scene.cycles.use_denoising = False
    scene.world.light_settings.distance = distance
    img = bpy.data.images.new(os.path.basename(out_jpg), size, size, float_buffer=True)
    mats = {s.material for o in targets for s in o.material_slots if s.material}
    for mat in mats:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage'); node.image = img; node.name = 'LightmapBake'; mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    for o in targets: o.select_set(True); o.data.uv_layers.active = o.data.uv_layers['Lightmap']
    bpy.context.view_layer.objects.active = targets[0]
    print(f'baking AO for {len(targets)} meshes into {size}x{size} at {samples} samples', flush=True)
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    raw = out_jpg.replace('.jpg', '_raw.exr'); img.filepath_raw = raw; img.file_format = 'OPEN_EXR'; img.save()
    for mat in mats:
        if 'LightmapBake' in mat.node_tree.nodes: mat.node_tree.nodes.remove(mat.node_tree.nodes['LightmapBake'])
    dn = bpy.data.scenes.new('Denoise'); dn.use_nodes = True; dn.render.engine = 'BLENDER_WORKBENCH'
    dn.render.resolution_x = dn.render.resolution_y = size; dn.render.resolution_percentage = 100
    nt = dn.node_tree; nt.nodes.clear()
    i = nt.nodes.new('CompositorNodeImage'); i.image = bpy.data.images.load(raw)
    d = nt.nodes.new('CompositorNodeDenoise')
    c = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(i.outputs['Image'], d.inputs['Image']); nt.links.new(d.outputs['Image'], c.inputs['Image'])
    dn.render.image_settings.file_format = 'JPEG'; dn.render.image_settings.quality = 92; dn.view_settings.view_transform = 'Standard'
    dn.render.filepath = out_jpg
    bpy.ops.render.render(write_still=True, scene=dn.name)
    bpy.data.scenes.remove(dn)
    for o in targets: o.data.uv_layers.active = o.data.uv_layers[0]
    print('AO written', out_jpg, flush=True)

def export_glb(objects, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_extras=True, export_apply=True,
                              export_lights=False, export_cameras=False, export_image_format='JPEG', export_image_quality=85,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_texcoords=True, export_normals=True)
    print('exported', path, flush=True)

def preview(scene, cam_at, look_at, fov_deg, out_jpg, samples=48, res=(1280, 720)):
    """Quick denoised Cycles render from a camera matching the web page, to judge lighting before baking."""
    cam_data = bpy.data.cameras.new('Preview'); cam_data.sensor_fit = 'VERTICAL'; cam_data.angle_y = math.radians(fov_deg)
    cam = bpy.data.objects.new('Preview', cam_data); scene.collection.objects.link(cam); cam.location = cam_at
    d = Vector(look_at) - Vector(cam_at); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam; scene.render.engine = 'CYCLES'; scene.cycles.samples = samples; scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res; scene.render.resolution_percentage = 100
    scene.render.film_transparent = True; scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'JPEG'; scene.render.filepath = out_jpg
    bpy.ops.render.render(write_still=True)
    print('preview written', out_jpg, flush=True)
