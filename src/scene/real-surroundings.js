/*
 * Swaps the development's simple surroundings for the Blender asset library and real textures:
 * cars, trucks and people from build_props.py, branching trees, modern street lights, a neighbourhood
 * of houses, townhouses and apartment blocks in place of the box skyline, asphalt and paver textures,
 * grass and a river with a moving water normal map. The originals stay in the scene (hidden), so every
 * existing animation and layer toggle keeps driving them; this module copies their motion every frame.
 */
import * as THREE from 'three';
import { instanceParts, place } from './asset-library.js';
import { rng } from '../util.js';

const texCache = new Map();
/** A tiling texture from assets/tex/<name>/<file>.jpg. */
export function tex(name, file = 'diff', { srgb = file === 'diff', repeat = [1, 1] } = {}) {
  const key = `${name}/${file}`;
  if (!texCache.has(key)) {
    const t = new THREE.TextureLoader().load(`assets/tex/${name}/${file}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texCache.set(key, t);
  }
  const t = texCache.get(key).clone(); t.repeat.set(...repeat);
  return t;
}
/** Tiling PBR material in world metres (the mesh needs planar uvs, see planarUV). */
export function pbr(name, { color = '#ffffff', rough = true, normalScale = 1, roughness = 0.9, ...o } = {}) {
  return new THREE.MeshStandardMaterial({ color, map: tex(name), normalMap: tex(name, 'nor'), normalScale: new THREE.Vector2(normalScale, normalScale),
    ...(rough ? { roughnessMap: tex(name, 'rough') } : {}), roughness, metalness: 0, ...o });
}
/** Sets uv = (x, z) / metres per tile from world-space vertex positions (meshes with identity transforms). */
export function planarUV(geometry, metres) {
  const p = geometry.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / metres; uv[i * 2 + 1] = p.getZ(i) / metres; }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

// wind for every tree's leaves (shared library material)
const wind = { value: 0 };
export function addWind(material) {
  if (material.userData.wind) return; material.userData.wind = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind;
    shader.vertexShader = 'uniform float windTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
      #else
        float ph = 0.0;
      #endif
      float sway = max(position.y - 2.0, 0.0) * 0.012;
      transformed.x += sin(windTime * 1.3 + ph + position.z * 0.4) * sway;
      transformed.z += cos(windTime * 1.1 + ph + position.x * 0.4) * sway * 0.6;`);
  };
  material.needsUpdate = true;
}
export function tickWind(t) { wind.value = t; }

export const CAR_COLOURS = ['#f2f2f0', '#c9cbcc', '#8b9093', '#2b2e31', '#121314', '#1f3552', '#7a1a1a', '#5d6b74', '#e8e4da', '#3c4a3a'].map((c) => new THREE.Color(c));
export const SHIRTS = ['#e9e4d8', '#33475b', '#8a3b2c', '#58705a', '#c7b48a', '#2a2a2e', '#7d8fa3', '#b25f43', '#f0f0f0', '#4f3d5e'].map((c) => new THREE.Color(c));
export const TROUSERS = ['#2b3441', '#1d1f22', '#5b5145', '#3c4b5c', '#7b7266', '#22303f'].map((c) => new THREE.Color(c));
export const SKINS = ['#f1c9a5', '#d9a77f', '#b47b56', '#8a5a3c', '#5e3b26', '#e6b892'].map((c) => new THREE.Color(c));
export const HAIRS = ['#1b1714', '#3b2a1e', '#6b4a2e', '#a9844f', '#d7c28f', '#8a8a8a'].map((c) => new THREE.Color(c));
export const FACADES = ['#f3f0ea', '#e7dfd1', '#d6d3cc', '#c9b8a2', '#b77a5f', '#9fa6a8', '#e9e2d6'].map((c) => new THREE.Color(c));
export const ROOFS = ['#ffffff', '#c98a6a', '#6e6e72', '#8f8a84'].map((c) => new THREE.Color(c));

const LIMB = { leg_l: 0, leg_r: 1, arm_l: 2, arm_r: 3 };
const _m = new THREE.Matrix4(), _p = new THREE.Matrix4(), _r = new THREE.Matrix4(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);

/**
 * A crowd of jointed people drawn with InstancedMesh: `people` is [{ variant, colours }], and every frame
 * `pose(i)` returns { pos, rotY, swing: [legL, legR, armL, armR] } for person i.
 */
export function createCrowd(parent, lib, people) {
  const byVariant = new Map();
  people.forEach((p, i) => { if (!byVariant.has(p.variant)) byVariant.set(p.variant, []); byVariant.get(p.variant).push(i); });
  const batches = [];
  for (const [variant, ids] of byVariant) {
    for (const part of lib.get(variant)) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, ids.length);
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `${variant} · ${part.part} · ${part.material.name}`;
      if (part.tint) ids.forEach((id, k) => mesh.setColorAt(k, people[id].colours[part.material.name] || people[id].colours.Shirt));
      parent.add(mesh); batches.push({ mesh, ids, pivot: part.pivot || new THREE.Vector3(), limb: LIMB[part.part] });
    }
  }
  return {
    batches,
    update(pose) {
      const cache = new Map();
      for (const b of batches) {
        b.ids.forEach((id, k) => {
          let p = cache.get(id); if (!p) { p = pose(id); cache.set(id, p); }
          _q.setFromAxisAngle(_up, p.rotY); _m.compose(p.pos, _q, _one);
          _p.makeTranslation(b.pivot.x, b.pivot.y, b.pivot.z); _m.multiply(_p);
          if (b.limb !== undefined) _m.multiply(_r.makeRotationX(p.swing[b.limb]));
          b.mesh.setMatrixAt(k, _m);
        });
        b.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

/** A random set of clothes, skin and hair. */
export function outfit(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  return { Shirt: pick(SHIRTS), Trousers: pick(TROUSERS), Skin: pick(SKINS), Hair: pick(HAIRS) };
}

/**
 * Places a neighbourhood into one footprint (centre x, z; w × d metres; target height h):
 * low footprints become houses and townhouse rows, taller ones apartment blocks built from storey modules.
 * Pushes matrices and colours into `out[module] = { m: [], c: [] }`.
 */
export function neighbourhood(out, r, x, z, w, d, h) {
  const add = (module, matrix, colour) => { (out[module] ||= { m: [], c: [] }).m.push(matrix); out[module].c.push(colour); };
  const pick = (a) => a[Math.floor(r() * a.length)];
  const rot = Math.floor(r() * 4) * Math.PI / 2;
  if (h < 16) {
    if (w >= 20 && r() < 0.45) {                       // a terrace of townhouses
      const n = Math.max(2, Math.floor((w - 2) / 6)), kind = r() < 0.5 ? 'townhouse_a' : 'townhouse_b';
      const c = pick(FACADES), ax = Math.cos(rot), az = -Math.sin(rot);
      for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 6; add(kind, place(x + ax * o, 0.02, z + az * o, rot), i % 2 ? c : pick(FACADES)); }
      return;
    }
    const nx = Math.max(1, Math.round(w / 16)), nz = Math.max(1, Math.round(d / 15));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const hx = x + (i - (nx - 1) / 2) * 16, hz = z + (j - (nz - 1) / 2) * 15, kind = pick(['house_a', 'house_b', 'house_c', 'house_a']);
      add(kind, place(hx, 0.02, hz, Math.floor(r() * 4) * Math.PI / 2), pick(FACADES));
    }
    return;
  }
  const floors = Math.max(3, Math.round((h - 0.6) / 3.2)), c = pick(FACADES);
  if (h > 60) {
    const sx = w / 26, sz = d / 14;
    for (let f = 0; f < floors; f++) add('tower_floor', place(x, 0.6 + f * 3.2, z, rot, sx, 1, sz), c);
    add('tower_crown', place(x, 0.6 + floors * 3.2, z, rot, sx, 1, sz), c);
    return;
  }
  const sx = Math.min(w, 34) / 30, sz = Math.min(d, 16) / 11;
  add('lowrise_base', place(x, 0, z, rot, sx, 1, sz), c);
  for (let f = 0; f < floors; f++) add('lowrise_floor', place(x, 0.6 + f * 3.2 - 0.15, z, rot, sx, 1, sz), c);
  add('lowrise_roof', place(x, 0.6 + floors * 3.2 - 0.15, z, rot, sx, 1, sz), c);
}

/** Draws everything collected by neighbourhood(). */
export function drawNeighbourhood(parent, lib, out) {
  const meshes = [];
  for (const [module, { m, c }] of Object.entries(out)) meshes.push(...instanceParts(parent, lib.get(module), m, { name: module, colors: c }));
  return meshes;
}

export function upgradeSurroundings({ lib, site, landscape, env }) {
  const r = rng(4242), tickers = [];
  const hide = (o) => { if (o) o.visible = false; };
  const P = site.parts, LP = landscape.parts;

  /* ---------- ground, plaza, roads, paths: real textures ---------- */
  const ground = env.userData.ground;
  if (ground) ground.material = new THREE.MeshStandardMaterial({ color: '#eef5d8', map: tex('grass', 'diff', { repeat: [320, 320] }), normalMap: tex('grass', 'nor', { repeat: [320, 320] }), roughness: 1 });
  const plaza = env.userData.plaza;
  if (plaza) { planarUV(plaza.geometry, 3.2); plaza.material = pbr('pavers', { color: '#e4dfd6', normalScale: 0.8 }); hide(env.userData.joints); }
  const asphalt = pbr('asphalt_02', { color: '#a8a8a8', normalScale: 0.7 });
  for (const m of P.roads) { planarUV(m.geometry, 7); m.material = asphalt; }
  const pavers = pbr('pavers', { color: '#d9d4ca', normalScale: 0.8 });
  for (const m of P.paving) { planarUV(m.geometry, 2.4); m.material = pavers; }
  if (LP.paths) { planarUV(LP.paths.geometry, 2.4); LP.paths.material = pavers; }
  if (LP.beds) { planarUV(LP.beds.geometry, 3); LP.beds.material = new THREE.MeshStandardMaterial({ color: '#8f9a76', map: tex('grass'), normalMap: tex('grass', 'nor'), roughness: 1 }); }

  /* ---------- river: moving normal-mapped water, grassy banks ---------- */
  if (P.water) {
    const w = P.water, n1 = tex('water', 'normals', { srgb: false, repeat: [1, 2.2] });
    Object.assign(w, { bumpMap: null, normalMap: n1, normalScale: new THREE.Vector2(0.55, 0.55), color: new THREE.Color('#2f5a66'), roughness: 0.05, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 });
    w.needsUpdate = true;
    if (P.flow) P.flow.material.opacity = 0.07;
    tickers.push((dt) => { n1.offset.x -= dt * 0.035; n1.offset.y += dt * 0.006; });
    const bank = new THREE.MeshStandardMaterial({ color: '#a7ad8a', map: tex('grass'), normalMap: tex('grass', 'nor'), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const b of P.banks) { planarUV(b.geometry, 4); b.material = bank; }
  }

  /* ---------- street lights ---------- */
  if (P.lampSpots.length) {
    P.oldLamps.forEach(hide);
    const layer = P.oldLamps[0].parent;
    instanceParts(layer, lib.get('lamp'), P.lampSpots.map((s) => place(s.x, s.y, s.z, s.side > 0 ? Math.PI : 0)), { name: 'Street light' });
  }

  /* ---------- traffic: real cars and trucks follow the existing movers ---------- */
  for (const t of P.traffic) {
    hide(t.mesh); t.detail.forEach(hide);
    const kinds = t.truck ? ['truck'] : ['car_sedan', 'car_suv', 'car_hatch', 'car_sedan'];
    const variants = kinds.map(() => []);
    for (let i = 0; i < t.mesh.count; i++) variants[i % kinds.length].push(i);
    variants.forEach((ids, v) => {
      if (!ids.length) return;
      const colours = ids.map(() => t.truck ? new THREE.Color().setHSL(r(), 0.5, 0.35) : CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)]);
      const meshes = instanceParts(t.group, lib.get(kinds[v]), ids.map(() => new THREE.Matrix4()), { name: kinds[v], colors: colours });
      const shared = meshes[0].instanceMatrix;
      meshes.forEach((m) => { m.instanceMatrix = shared; });
      tickers.push(() => { ids.forEach((i, k) => { t.mesh.getMatrixAt(i, _m); shared.array.set(_m.elements, k * 16); }); shared.needsUpdate = true; });
    });
  }

  /* ---------- people: garden walkers plus pedestrians on the street footpaths ---------- */
  const people = [], poses = [];
  const VARIANTS = ['person_a', 'person_b', 'person_c'];
  LP.walkers.forEach((w, i) => {
    w.person.visible = false;
    people.push({ variant: VARIANTS[i % 3], colours: outfit(r) });
    poses.push(() => ({ pos: w.person.position, rotY: w.person.rotation.y, swing: w.limbs.map((l) => l.rotation.x) }));
  });
  const footpaths = [...new Set(P.lampSpots.map((s) => (s.z - s.side * 0.75).toFixed(2)))].map(Number);
  const xs = P.lampSpots.map((s) => s.x), span = xs.length ? (Math.max(...xs) - Math.min(...xs)) / 2 + 10 : 0;
  if (span) for (let i = 0; i < 44; i++) {
    const z = footpaths[i % footpaths.length] + (r() - 0.5) * 1.2, speed = 1.1 + r() * 0.5, dir = r() < 0.5 ? 1 : -1, x0 = (r() * 2 - 1) * span, ph = r() * 10;
    people.push({ variant: VARIANTS[i % 3], colours: outfit(r) });
    const pos = new THREE.Vector3(x0, 0.565, z), swing = [0, 0, 0, 0];
    poses.push((t) => {
      let x = x0 + dir * speed * t; x = ((x + span) % (2 * span) + 2 * span) % (2 * span) - span; pos.x = x;
      const s = Math.sin(t * speed * 5 + ph);
      swing[0] = s * 0.42; swing[1] = -s * 0.42; swing[2] = -s * 0.3; swing[3] = s * 0.3;
      return { pos, rotY: dir * Math.PI / 2, swing };
    });
  }
  const crowd = createCrowd(landscape.group, lib, people);
  let now = 0;
  tickers.push(() => crowd.update((i) => poses[i](now)));

  /* ---------- trees ---------- */
  const treeSpots = [...(LP.trees?.positions || []).map((p) => ({ p, s: 0.62 + r() * 0.2 })), ...(env.userData.trees?.positions || []).map((p) => ({ p, s: 0.8 + r() * 0.35 }))];
  (LP.trees?.meshes || []).forEach(hide); (env.userData.trees?.meshes || []).forEach(hide);
  const treeKinds = ['tree_a', 'tree_b', 'tree_c'], perKind = treeKinds.map(() => []);
  treeSpots.forEach(({ p, s }, i) => perKind[(i * 7 + Math.floor(r() * 3)) % 3].push(place(p.x, p.y, p.z, r() * Math.PI * 2, s)));
  treeKinds.forEach((k, i) => { if (perKind[i].length) instanceParts(env, lib.get(k), perKind[i], { name: k }).forEach((m) => { if (m.material.name === 'Leaves') addWind(m.material); }); });

  /* ---------- neighbourhood: houses, townhouses and apartment blocks instead of the box skyline ---------- */
  const sky = env.userData.skyline;
  if (sky) {
    hide(sky.mesh);
    const out = {};
    sky.pos.forEach((p, i) => { const [w, h, d] = sky.scl[i]; neighbourhood(out, r, p.x, p.z, w, d, h); });
    drawNeighbourhood(env, lib, out);
    // a car on most house driveways
    const parked = (out.house_a?.m || []).filter(() => r() < 0.8).map((m) => m.clone().multiply(place(7.3, 0, 7.6, Math.PI / 2)));
    if (parked.length) instanceParts(env, lib.get('car_suv'), parked, { name: 'Parked car', colors: parked.map(() => CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)]) });
  }

  return { update(dt, t) { now = t; tickWind(t); for (const f of tickers) f(dt, t); } };
}
