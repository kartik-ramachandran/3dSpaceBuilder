/*
 * The Blender asset library (scripts/bake/build_development.py and build_props.py): building storeys,
 * houses, townhouses, cars, a truck, people, trees and street lamps. Every object in the GLBs is tagged
 * with `module` (and `part` for people's limbs). Each module is merged per material into a few geometries
 * so it can be drawn many times with InstancedMesh.
 *
 * Materials named here are "tintable" (white in Blender): instance colours give every car, person,
 * facade or roof its own colour.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SOURCES = [
  { glb: 'assets/development/buildings.glb', ao: 'assets/development/buildings_ao.jpg' },
  { glb: 'assets/development/props.glb', ao: 'assets/development/props_ao.jpg' },
];
export const TINTABLE = /^(Paint|Shirt|Trousers|Skin|Hair|Render|House render|Timber cladding|Roof tiles|Trailer)$/;
const TRANSPARENT_GLASS = /^(Glazing|Balustrade glass)$/;
const OPAQUE_GLASS = /^(Car glass|House glass)$/;

const cache = new Map();
/** Loads the library once. Resolves to { modules: Map<name, Part[]>, get(name) }. Part: { geometry, material, part, pivot, exterior, glass, tint } */
export async function loadLibrary(scope = 'all') {
  const sources = scope === 'buildings' ? [SOURCES[0]] : SOURCES;
  const libraries = await Promise.all(sources.map(loadSource));
  const modules = new Map(libraries.flatMap(lib => [...lib.modules]));
  return { modules, get: name => modules.get(name) || [], size: name => bounds(modules.get(name) || []) };
}

function loadSource(source) {
  if (cache.has(source.glb)) return cache.get(source.glb);
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/').setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const tl = new THREE.TextureLoader();
  const pending = Promise.all([source].map(async ({ glb, ao }) => {
    const [gltf, aoTex] = await Promise.all([loader.loadAsync(glb), tl.loadAsync(ao)]);
    aoTex.flipY = false; aoTex.channel = 1; aoTex.colorSpace = THREE.SRGBColorSpace;
    return { gltf, aoTex };
  })).then((sources) => {
    const modules = new Map();
    for (const { gltf, aoTex } of sources) {
      gltf.scene.updateMatrixWorld(true);
      const buckets = new Map();                         // module|part|material → { geos, material, … }
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const node = o.userData.module ? o : o.parent?.userData?.module ? o.parent : null;   // multi-material nodes load as a group
        if (!node) return;
        const module = node.userData.module, part = node.userData.part || null;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        let pivot = null;
        if (part) {                                      // limbs: geometry relative to the joint they swing about
          pivot = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
          g.translate(-pivot.x, -pivot.y, -pivot.z);
        }
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(k)) g.deleteAttribute(k);
        const key = `${module}|${part}|${o.material.name}|${g.attributes.uv1 ? 1 : 0}|${g.attributes.uv ? 1 : 0}`;
        if (!buckets.has(key)) buckets.set(key, { module, part, pivot, geos: [], material: o.material, exterior: !!node.userData.exterior });
        buckets.get(key).geos.push(g);
      });
      for (const b of buckets.values()) {
        const anyPlain = b.geos.some((x) => !x.index);
        const geometry = mergeGeometries(b.geos.map((x) => (anyPlain && x.index ? x.toNonIndexed() : x)));
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const name = b.material.name;
        const glass = TRANSPARENT_GLASS.test(name);
        const part = { geometry, material: dress(b.material, aoTex, !!geometry.attributes.uv1), part: b.part, pivot: b.pivot, exterior: b.exterior, glass, tint: TINTABLE.test(name) };
        if (!modules.has(b.module)) modules.set(b.module, []);
        modules.get(b.module).push(part);
      }
    }
    // people: every part of one figure shares the pivot of its object, so look it up per part name
    return { modules, get: (name) => modules.get(name) || [], size: (name) => bounds(modules.get(name) || []) };
  }).catch(error => { cache.delete(source.glb); throw error; }).finally(() => draco.dispose());
  cache.set(source.glb, pending);
  return pending;
}

/**
 * Foliage textures from the atlas (leaflets on black). Thin leaflets alias to specks under an alpha test,
 * so the mask is dilated into fuller fronds and the colour under it is filled with the leaves' own average
 * colour (blurred colour ÷ blurred coverage) so no black shows at the new edges.
 */
function leafTextures(map) {
  const img = map.image, w = img.width, h = img.height;
  const canvas = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };
  const [src, sx] = canvas(); sx.drawImage(img, 0, 0);
  const base = sx.getImageData(0, 0, w, h);
  const cov = new ImageData(w, h);                                   // coverage: 255 where there is a leaf
  for (let i = 0; i < base.data.length; i += 4) { const on = base.data[i] + base.data[i + 1] + base.data[i + 2] > 54 ? 255 : 0; cov.data[i] = cov.data[i + 1] = cov.data[i + 2] = on; cov.data[i + 3] = 255; }
  const blurred = (data, px) => { const [c, x] = canvas(); const [t, tx] = canvas(); tx.putImageData(data, 0, 0); x.filter = `blur(${px}px)`; x.drawImage(t, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const premul = new ImageData(w, h);
  for (let i = 0; i < base.data.length; i += 4) { const k = cov.data[i] / 255; premul.data[i] = base.data[i] * k; premul.data[i + 1] = base.data[i + 1] * k; premul.data[i + 2] = base.data[i + 2] * k; premul.data[i + 3] = 255; }
  const bc = blurred(premul, 7), bm = blurred(cov, 7), dm = blurred(cov, 3);
  const colour = new ImageData(w, h), mask = new ImageData(w, h);
  for (let i = 0; i < base.data.length; i += 4) {
    const leaf = cov.data[i] > 0, m = Math.max(bm[i], 1) / 255;
    for (let c = 0; c < 3; c++) colour.data[i + c] = leaf ? base.data[i + c] : Math.min(255, bc[i + c] / m);
    colour.data[i + 3] = 255;
    const v = dm[i] > 70 ? 255 : 0; mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = v; mask.data[i + 3] = 255;
  }
  const tex = (data, srgb) => { const [c, x] = canvas(); x.putImageData(data, 0, 0); const t = new THREE.CanvasTexture(c); t.flipY = map.flipY; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
  return { colour: tex(colour, true), mask: tex(mask, false) };
}

function bounds(parts) {
  const b = new THREE.Box3();
  for (const p of parts) { const g = p.geometry.boundingBox.clone(); if (p.pivot) g.translate(p.pivot); b.union(g); }
  return b;
}

const materials = new Map();
function dress(m, ao, hasUv1) {
  const key = `${m.name}|${m.uuid}|${hasUv1}`;
  if (materials.has(key)) return materials.get(key);
  let c;
  const name = m.name;
  if (TRANSPARENT_GLASS.test(name)) {
    const balustrade = /balustrade/i.test(name);
    c = new THREE.MeshPhysicalMaterial({ name, color: balustrade ? '#cfe0e4' : '#2c434c', roughness: 0.03, metalness: balustrade ? 0 : 0.35, transparent: true,
      opacity: balustrade ? 0.22 : 0.74, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.8, depthWrite: false });
  } else if (OPAQUE_GLASS.test(name)) {
    c = new THREE.MeshPhysicalMaterial({ name, color: '#1b252b', roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.0 });
  } else {
    c = m.clone();
    if (name === 'Leaves') {
      const leaf = leafTextures(c.map); c.map = leaf.colour; c.alphaMap = leaf.mask; c.alphaTest = 0.4; c.alphaToCoverage = true; c.side = THREE.DoubleSide; c.transparent = false; c.roughness = 0.75;
      c.color = new THREE.Color('#c9d9b0');                                  // a touch of spring green over the atlas
    }
    if (name === 'Paint') { c = new THREE.MeshPhysicalMaterial({ name, color: '#ffffff', roughness: 0.28, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.06 }); }
    if (/Headlight|Taillight|Lamp light/.test(name)) c.emissiveIntensity = /Lamp/.test(name) ? 1.2 : 0.8;
    if (hasUv1) { c.aoMap = ao; c.aoMapIntensity = 1; }
    for (const t of [c.map, c.normalMap, c.roughnessMap]) if (t) t.anisotropy = 8;
  }
  materials.set(key, c);
  return c;
}

/** One InstancedMesh per part of `parts`, at `matrices`. Optional per-instance colours for tinted parts: an array, or (part) → array. */
export function instanceParts(parent, parts, matrices, { name = '', colors = null, castShadow = true } = {}) {
  return parts.map((p) => {
    const mesh = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, matrices.length));
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = matrices.length;
    const cols = typeof colors === 'function' ? colors(p) : colors;          // per-part colours: (part) → [Color]
    if (cols && p.tint) cols.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false;
    mesh.name = `${name} · ${p.material.name}`;
    mesh.castShadow = castShadow && !p.glass; mesh.receiveShadow = !p.glass; mesh.userData.noShadow = p.glass;
    mesh.userData.exterior = p.exterior; mesh.userData.glass = p.glass; mesh.userData.part = p.part;
    parent.add(mesh);
    return mesh;
  });
}

const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** Matrix for a placement on the ground: position, rotation about y, uniform or (sx, sy, sz) scale. */
export function place(x, y, z, rotY = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromAxisAngle(_up, rotY), _s.set(sx, sy, sz));
}
