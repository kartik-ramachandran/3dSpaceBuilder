/*
 * Everything the composer can place: property (houses, townhouses, apartment blocks, towers), vehicles,
 * people, nature, streets and water, built from the Blender asset library (src/scene/asset-library.js).
 *
 * A tile is one entry in the sidebar (a type plus starting parameters). A type knows its parameters
 * (for the inspector) and builds a THREE.Object3D at the origin, facing +Z, standing on y = 0.
 * build() returns { object, update?(dt, t), stats: [[label, value]], footprint: [w, d] }.
 */
import * as THREE from 'three';
import { instanceParts, place } from '../scene/asset-library.js';
import { tex, pbr, planarUV, addWind, createCrowd, outfit, CAR_COLOURS, FACADES, ROOFS } from '../scene/real-surroundings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../util.js';

const hex = (c) => `#${c.getHexString()}`;
export const PALETTES = {
  facade: FACADES.map(hex),
  roof: ['#ffffff', '#c98a6a', '#6e6e72', '#8f8a84', '#4b5560'],
  car: CAR_COLOURS.map(hex),
};
const FT = 3.2, BASE = 0.6;

/* ---------------------------------------------------------------- helpers */
function mod(group, lib, module, matrices, tint = {}) {
  // tint: { [material name]: Color | Color[] } for tintable parts (others keep their own colour)
  return instanceParts(group, lib.get(module), matrices, {
    name: module,
    colors: (p) => {
      const c = tint[p.material.name] ?? tint['*']; if (!c) return null;
      return Array.isArray(c) ? c : matrices.map(() => c);
    },
  });
}
const col = (h) => new THREE.Color(h);
const money = (v, cur) => `${cur} ${v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm' : Math.round(v / 1000) + 'k'}`;
let leavesWindy = false;
function windy(lib) {
  if (leavesWindy) return; leavesWindy = true;
  for (const n of ['tree_a', 'tree_b', 'tree_c']) lib.get(n).forEach((p) => { if (p.material.name === 'Leaves') addWind(p.material); });
}
const slab = (w, d, h, material, metres) => { const g = planarUV(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), metres); const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m; };
let mats = null;
function materials() {
  if (mats) return mats;
  mats = {
    asphalt: pbr('asphalt_02', { color: '#a8a8a8', normalScale: 0.7 }),
    pavers: pbr('pavers', { color: '#ddd8ce', normalScale: 0.8 }),
    grass: new THREE.MeshStandardMaterial({ color: '#eef5d8', map: tex('grass'), normalMap: tex('grass', 'nor'), roughness: 1 }),
    line: new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.6 }),
    kerb: new THREE.MeshStandardMaterial({ color: '#c9c5bb', roughness: 0.85 }),
  };
  const n = tex('water', 'normals', { srgb: false, repeat: [1, 1] });
  mats.water = new THREE.MeshPhysicalMaterial({ color: '#2f5a66', normalMap: n, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.05, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 });
  mats.waterNormal = n;
  return mats;
}
export function tickMaterials(dt) { if (mats) { mats.waterNormal.offset.x -= dt * 0.035; mats.waterNormal.offset.y += dt * 0.006; } }

/** A car or truck that parks, or drives back and forth along its own axis over `route` metres. */
function vehicle(lib, module, colour, { drive = false, speed = 30, route = 120, seed = 1 } = {}) {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  mod(body, lib, module, [new THREE.Matrix4()], { Paint: col(colour), Trailer: col('#e9e6df') });
  const v = speed / 3.6, x0 = (seed * 37.3) % route;
  return { group, update: drive ? (dt, t) => { body.position.x = ((x0 + v * t) % route) - route / 2; } : null };
}

/** One person as nested pivots (so arms and legs swing), walking along z over `route` metres if asked. */
function figure(lib, variant, clothes, { walk = false, route = 20, speed = 1.3, phase = 0 } = {}) {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const limbs = {};
  for (const p of lib.get(variant)) {
    let holder = body;
    if (p.part !== 'body') {
      if (!limbs[p.part]) { const pivot = new THREE.Group(); pivot.position.copy(p.pivot); body.add(pivot); limbs[p.part] = pivot; }
      holder = limbs[p.part];
    } else if (p.pivot) { /* body parts sit at the origin */ }
    instanceParts(holder, [p], [new THREE.Matrix4()], { colors: [clothes[p.material.name] || clothes.Shirt] });
  }
  const update = (dt, t) => {
    const s = Math.sin(t * speed * 5 + phase), sw = walk ? 1 : 0.08;
    if (limbs.leg_l) { limbs.leg_l.rotation.x = s * 0.42 * sw; limbs.leg_r.rotation.x = -s * 0.42 * sw; limbs.arm_l.rotation.x = -s * 0.3 * sw; limbs.arm_r.rotation.x = s * 0.3 * sw; }
    if (walk) {
      const L = route, d = ((t * speed + phase) % (2 * L)), fwd = d < L;
      body.position.z = fwd ? d - L / 2 : L / 2 - (d - L);
      body.rotation.y = fwd ? 0 : Math.PI;
    }
  };
  return { group, update };
}

/* ---------------------------------------------------------------- types */
const choice = (key, label, options) => ({ key, label, type: 'choice', options });
const range = (key, label, min, max, step = 1, unit = '') => ({ key, label, type: 'range', min, max, step, unit });
const colour = (key, label, palette) => ({ key, label, type: 'colour', palette });
const toggle = (key, label) => ({ key, label, type: 'toggle' });

export const TYPES = {
  house: {
    params: [choice('style', 'Style', [['house_a', 'Family · 2 storey'], ['house_b', 'Bungalow'], ['house_c', 'Modern box']]), colour('facade', 'Walls', 'facade'), colour('roof', 'Roof', 'roof'), toggle('car', 'Car on the driveway')],
    build(p, lib, ctx) {
      const g = new THREE.Group();
      mod(g, lib, p.style, [new THREE.Matrix4()], { 'House render': col(p.facade), 'Roof tiles': col(p.roof) });
      if (p.car && p.style === 'house_a') { const car = vehicle(lib, 'car_suv', PALETTES.car[(ctx.seed * 3) % PALETTES.car.length]).group; car.position.set(7.3, 0, 7.6); car.rotation.y = Math.PI / 2; g.add(car); }
      const area = { house_a: 190, house_b: 126, house_c: 205 }[p.style], beds = { house_a: 4, house_b: 3, house_c: 4 }[p.style];
      return { object: g, footprint: [p.style === 'house_b' ? 15 : 15, 12], stats: [['Dwellings', '1'], ['Bedrooms', String(beds)], ['Floor area', `${area} m²`], ['Height', p.style === 'house_b' ? '4.8 m' : p.style === 'house_c' ? '6.3 m' : '8.6 m'], ['Est. value', money(area * ctx.rate * 1.15, ctx.currency)]] };
    },
  },
  townhouses: {
    params: [choice('style', 'Style', [['townhouse_a', 'Gabled · 2 storey'], ['townhouse_b', 'Modern · 3 storey']]), range('units', 'Homes in the row', 2, 12), colour('facade', 'Walls', 'facade'), toggle('mixed', 'Mix the colours')],
    build(p, lib, ctx) {
      const g = new THREE.Group(), n = p.units, r = rng(ctx.seed + 5);
      const m = [], cs = [];
      for (let i = 0; i < n; i++) { m.push(place((i - (n - 1) / 2) * 6, 0, 0)); cs.push(p.mixed ? col(PALETTES.facade[Math.floor(r() * PALETTES.facade.length)]) : col(p.facade)); }
      mod(g, lib, p.style, m, { 'House render': cs, 'Roof tiles': m.map(() => col('#ffffff')) });
      const area = p.style === 'townhouse_a' ? 112 : 158;
      return { object: g, footprint: [n * 6, 11], stats: [['Dwellings', String(n)], ['Storeys', p.style === 'townhouse_a' ? '2' : '3'], ['Floor area', `${n * area} m²`], ['Frontage', `${n * 6} m`], ['Est. value', money(n * area * ctx.rate, ctx.currency)]] };
    },
  },
  apartment: {
    params: [range('floors', 'Storeys', 1, 30), range('units', 'Apartments per floor', 2, 6), colour('facade', 'Walls', 'facade')],
    build(p, lib, ctx) {
      const g = new THREE.Group(), sx = p.units * 7.5 / 30, c = col(p.facade), tint = { Render: c };
      mod(g, lib, 'lowrise_base', [place(0, 0, 0, 0, sx, 1, 1)], tint);
      mod(g, lib, 'lowrise_floor', Array.from({ length: p.floors }, (_, f) => place(0, BASE + f * FT - 0.15, 0, 0, sx, 1, 1)), tint);
      mod(g, lib, 'lowrise_roof', [place(0, BASE + p.floors * FT - 0.15, 0, 0, sx, 1, 1)], tint);
      const n = p.floors * p.units;
      return { object: g, footprint: [p.units * 7.5 + 1, 13], stats: [['Apartments', String(n)], ['Height', `${(BASE + p.floors * FT + 0.8).toFixed(1)} m`], ['Floor area', `${Math.round(n * 7.5 * 11)} m²`], ['Est. value', money(n * 78 * ctx.rate, ctx.currency)]] };
    },
  },
  tower: {
    params: [range('storeys', 'Storeys', 10, 100), range('width', 'Width', 18, 34, 1, 'm'), range('depth', 'Depth', 12, 20, 1, 'm'), colour('facade', 'Stone tint', 'facade'), toggle('podium', 'Stone podium')],
    build(p, lib, ctx) {
      const g = new THREE.Group(), sx = p.width / 26, sz = p.depth / 14, c = col(p.facade), tint = { Render: c, Limestone: c };
      if (p.podium) mod(g, lib, 'lowrise_base', [place(0, 0, 0, 0, p.width / 30 * 1.04, 1, (p.depth + 2.6) / 11)]);
      mod(g, lib, 'tower_floor', Array.from({ length: p.storeys }, (_, f) => place(0, BASE + f * FT, 0, 0, sx, 1, sz)), tint);
      mod(g, lib, 'tower_crown', [place(0, BASE + p.storeys * FT, 0, 0, sx, 1, sz)], tint);
      const per = Math.max(2, Math.round(p.width * p.depth / 95)), n = p.storeys * per;
      return { object: g, footprint: [p.width + 3, p.depth + 3], stats: [['Apartments', String(n)], ['Height', `${(BASE + p.storeys * FT + 7.8).toFixed(0)} m`], ['Floor area', `${Math.round(p.storeys * p.width * p.depth * 0.82).toLocaleString()} m²`], ['Est. value', money(n * 85 * ctx.rate * 1.25, ctx.currency)]] };
    },
  },
  car: {
    params: [choice('model', 'Model', [['car_sedan', 'Sedan'], ['car_suv', 'SUV'], ['car_hatch', 'Hatchback']]), colour('paint', 'Paint', 'car'), toggle('drive', 'Driving'), range('speed', 'Speed', 10, 100, 5, 'km/h'), range('route', 'Route length', 20, 400, 10, 'm')],
    build(p, lib, ctx) { const v = vehicle(lib, p.model, p.paint, { ...p, seed: ctx.seed }); return { object: v.group, update: v.update, footprint: [5, 2.2], stats: [['Length', p.model === 'car_hatch' ? '4.1 m' : '4.7 m']] }; },
  },
  truck: {
    params: [colour('paint', 'Cab', 'car'), toggle('drive', 'Driving'), range('speed', 'Speed', 10, 90, 5, 'km/h'), range('route', 'Route length', 30, 400, 10, 'm')],
    build(p, lib, ctx) { const v = vehicle(lib, 'truck', p.paint, { ...p, seed: ctx.seed }); return { object: v.group, update: v.update, footprint: [13.5, 2.6], stats: [['Length', '13.3 m']] }; },
  },
  person: {
    params: [choice('variant', 'Figure', [['person_a', 'Figure A'], ['person_b', 'Figure B'], ['person_c', 'Figure C']]), range('outfit', 'Outfit', 1, 40), toggle('walk', 'Walking'), range('route', 'Walk length', 4, 80, 2, 'm')],
    build(p, lib, ctx) { const f = figure(lib, p.variant, outfit(rng(p.outfit * 101)), { walk: p.walk, route: p.route, phase: ctx.seed }); return { object: f.group, update: f.update, footprint: [0.8, 0.8], stats: [] }; },
  },
  crowd: {
    params: [range('count', 'People', 3, 60), range('radius', 'Spread', 4, 40, 1, 'm'), toggle('walk', 'Walking')],
    build(p, lib, ctx) {
      const g = new THREE.Group(), r = rng(ctx.seed + 9), people = [], poses = [];
      for (let i = 0; i < p.count; i++) {
        people.push({ variant: ['person_a', 'person_b', 'person_c'][i % 3], colours: outfit(r) });
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * p.radius, cx = Math.cos(a) * d, cz = Math.sin(a) * d, head = r() * Math.PI * 2, L = 4 + r() * p.radius, ph = r() * 20, sp = 1.0 + r() * 0.5;
        const pos = new THREE.Vector3(cx, 0, cz), swing = [0, 0, 0, 0];
        poses.push((t) => {
          let rot = head;
          if (p.walk) { const k = (t * sp + ph) % (2 * L), fwd = k < L, s = (fwd ? k : 2 * L - k) - L / 2; pos.set(cx + Math.sin(head) * s, 0, cz + Math.cos(head) * s); rot = fwd ? head : head + Math.PI; }
          const w = Math.sin(t * sp * 5 + ph) * (p.walk ? 1 : 0.06); swing[0] = w * 0.42; swing[1] = -w * 0.42; swing[2] = -w * 0.3; swing[3] = w * 0.3;
          return { pos, rotY: rot, swing };
        });
      }
      const crowd = createCrowd(g, lib, people);
      crowd.update((i) => poses[i](0));
      return { object: g, update: (dt, t) => crowd.update((i) => poses[i](t)), footprint: [p.radius * 2, p.radius * 2], stats: [['People', String(p.count)]] };
    },
  },
  tree: {
    params: [choice('species', 'Tree', [['tree_a', 'Spreading'], ['tree_b', 'Rounded'], ['tree_c', 'Tall']]), range('scale', 'Size', 0.5, 1.6, 0.05, '×')],
    build(p, lib, ctx) { windy(lib); const g = new THREE.Group(); mod(g, lib, p.species, [place(0, 0, 0, (ctx.seed % 6.28), p.scale)]); return { object: g, footprint: [6 * p.scale, 6 * p.scale], stats: [['Height', `${({ tree_a: 9.3, tree_b: 7.6, tree_c: 11.4 }[p.species] * p.scale).toFixed(1)} m`]] }; },
  },
  treeRow: {
    params: [range('count', 'Trees', 2, 30), range('spacing', 'Spacing', 5, 16, 1, 'm'), range('scale', 'Size', 0.5, 1.4, 0.05, '×'), toggle('mixed', 'Mixed species')],
    build(p, lib, ctx) {
      windy(lib); const g = new THREE.Group(), r = rng(ctx.seed + 3), by = { tree_a: [], tree_b: [], tree_c: [] };
      for (let i = 0; i < p.count; i++) by[p.mixed ? ['tree_a', 'tree_b', 'tree_c'][Math.floor(r() * 3)] : 'tree_b'].push(place((i - (p.count - 1) / 2) * p.spacing, 0, 0, r() * 6.28, p.scale * (0.9 + r() * 0.2)));
      for (const [k, m] of Object.entries(by)) if (m.length) mod(g, lib, k, m);
      return { object: g, footprint: [p.count * p.spacing, 6], stats: [['Trees', String(p.count)], ['Length', `${(p.count - 1) * p.spacing} m`]] };
    },
  },
  park: {
    params: [range('radius', 'Radius', 8, 60, 1, 'm'), range('trees', 'Trees', 0, 60), range('people', 'People strolling', 0, 40), toggle('path', 'Paved path')],
    build(p, lib, ctx) {
      windy(lib); const M = materials(), g = new THREE.Group(), r = rng(ctx.seed + 17);
      const lawn = new THREE.Mesh(planarUV(new THREE.CylinderGeometry(p.radius, p.radius, 0.08, 64).translate(0, 0.04, 0), 4), M.grass); lawn.receiveShadow = true; g.add(lawn);
      if (p.path) { const ring = new THREE.Mesh(planarUV(new THREE.RingGeometry(p.radius * 0.55, p.radius * 0.55 + 2.4, 64).rotateX(-Math.PI / 2).translate(0, 0.1, 0), 2.4), M.pavers); ring.receiveShadow = true; g.add(ring); }
      const by = { tree_a: [], tree_b: [], tree_c: [] };
      for (let i = 0; i < p.trees; i++) { const a = r() * 6.28, d = p.radius * (0.15 + 0.8 * Math.sqrt(r())); if (p.path && Math.abs(d - p.radius * 0.55 - 1.2) < 2.5) continue; by[['tree_a', 'tree_b', 'tree_c'][i % 3]].push(place(Math.cos(a) * d, 0.08, Math.sin(a) * d, r() * 6.28, 0.7 + r() * 0.45)); }
      for (const [k, m] of Object.entries(by)) if (m.length) mod(g, lib, k, m);
      let update = null;
      if (p.people) {
        const people = [], poses = [], R = p.radius * 0.55 + 1.2;
        for (let i = 0; i < p.people; i++) {
          people.push({ variant: ['person_a', 'person_b', 'person_c'][i % 3], colours: outfit(r) });
          const a0 = r() * 6.28, dir = r() < 0.5 ? 1 : -1, sp = (1.1 + r() * 0.4) / R, ph = r() * 9, pos = new THREE.Vector3(), swing = [0, 0, 0, 0];
          poses.push((t) => { const a = a0 + dir * sp * t; pos.set(Math.cos(a) * R, 0.1, Math.sin(a) * R); const w = Math.sin(t * 6 + ph); swing[0] = w * 0.42; swing[1] = -w * 0.42; swing[2] = -w * 0.3; swing[3] = w * 0.3; return { pos, rotY: -a + (dir > 0 ? Math.PI : 0), swing }; });
        }
        const crowd = createCrowd(g, lib, people); crowd.update((i) => poses[i](0)); update = (dt, t) => crowd.update((i) => poses[i](t));
      }
      return { object: g, update, footprint: [p.radius * 2, p.radius * 2], stats: [['Area', `${Math.round(Math.PI * p.radius * p.radius).toLocaleString()} m²`], ['Trees', String(p.trees)]] };
    },
  },
  lamp: {
    params: [],
    build(p, lib) { const g = new THREE.Group(); mod(g, lib, 'lamp', [new THREE.Matrix4()]); return { object: g, footprint: [0.6, 2.2], stats: [['Height', '7 m']] }; },
  },
  road: {
    params: [range('length', 'Length', 20, 600, 10, 'm'), choice('lanes', 'Lanes', [[2, 'Two lanes'], [4, 'Four lanes']]), toggle('footpaths', 'Footpaths'), toggle('lamps', 'Street lights'), toggle('trees', 'Street trees'), range('traffic', 'Cars driving', 0, 24), range('walkers', 'People walking', 0, 40)],
    build(p, lib, ctx) {
      const M = materials(), g = new THREE.Group(), L = p.length, lanes = Number(p.lanes), W = lanes * 3.4 + 1, r = rng(ctx.seed + 1);
      g.add(slab(L, W, 0.1, M.asphalt, 7));
      const lines = [];
      const dash = (z) => { for (let x = -L / 2 + 2; x < L / 2 - 3; x += 9) lines.push(new THREE.BoxGeometry(3, 0.02, 0.15).translate(x + 1.5, 0.11, z)); };
      if (lanes === 2) dash(0); else { lines.push(new THREE.BoxGeometry(L - 2, 0.02, 0.12).translate(0, 0.11, -0.12), new THREE.BoxGeometry(L - 2, 0.02, 0.12).translate(0, 0.11, 0.12)); dash(-3.4); dash(3.4); }
      for (const s of [-1, 1]) lines.push(new THREE.BoxGeometry(L - 2, 0.02, 0.15).translate(0, 0.11, s * (W / 2 - 0.45)));
      g.add(new THREE.Mesh(mergeGeometries(lines), M.line));
      const side = W / 2;
      if (p.footpaths) for (const s of [-1, 1]) {
        const k = new THREE.Mesh(new THREE.BoxGeometry(L, 0.2, 0.3).translate(0, 0.1, s * (side + 0.15)), M.kerb); k.castShadow = k.receiveShadow = true; g.add(k);
        const f = slab(L, 2.8, 0.18, M.pavers, 2.4); f.position.z = s * (side + 1.7); g.add(f);
      }
      const edge = side + (p.footpaths ? 3.3 : 1);
      if (p.lamps) { const m = []; for (let x = -L / 2 + 10, i = 0; x < L / 2; x += 28, i++) { const s = i % 2 ? 1 : -1; m.push(place(x, p.footpaths ? 0.18 : 0, s * (edge - 0.5), s > 0 ? Math.PI : 0)); } mod(g, lib, 'lamp', m); }
      if (p.trees) { windy(lib); const by = { tree_a: [], tree_b: [] }; for (let x = -L / 2 + 6, i = 0; x < L / 2; x += 11, i++) for (const s of [-1, 1]) by[i % 2 ? 'tree_a' : 'tree_b'].push(place(x + (s > 0 ? 5 : 0), 0, s * (edge + 1.4), r() * 6.28, 0.6 + r() * 0.2)); for (const [k, m] of Object.entries(by)) if (m.length) mod(g, lib, k, m); }
      const movers = [];
      for (let i = 0; i < p.traffic; i++) {
        const dir = i % 2 ? 1 : -1, lane = lanes === 2 ? dir * 1.7 : dir * (i % 4 < 2 ? 1.7 : 5.1);
        const v = vehicle(lib, ['car_sedan', 'car_suv', 'car_hatch'][i % 3], p.carColour || PALETTES.car[Math.floor(r() * PALETTES.car.length)]);
        v.group.position.set(0, 0.1, lane); v.group.rotation.y = dir > 0 ? 0 : Math.PI; g.add(v.group);
        movers.push({ obj: v.group, dir, x0: r() * L, v: (30 + r() * 25) / 3.6 });
      }
      let crowd = null; const poses = [];
      if (p.walkers && p.footpaths) {
        const people = [];
        for (let i = 0; i < p.walkers; i++) {
          people.push({ variant: ['person_a', 'person_b', 'person_c'][i % 3], colours: outfit(r) });
          const s = i % 2 ? 1 : -1, z = s * (side + 1.7) + (r() - 0.5) * 1.2, dir = r() < 0.5 ? 1 : -1, sp = 1.1 + r() * 0.5, x0 = r() * L, ph = r() * 9, pos = new THREE.Vector3(0, 0.18, z), swing = [0, 0, 0, 0];
          poses.push((t) => { pos.x = ((x0 + dir * sp * t) % L + L) % L - L / 2; const w = Math.sin(t * sp * 5 + ph); swing[0] = w * 0.42; swing[1] = -w * 0.42; swing[2] = -w * 0.3; swing[3] = w * 0.3; return { pos, rotY: dir * Math.PI / 2, swing }; });
        }
        crowd = createCrowd(g, lib, people); crowd.update((i) => poses[i](0));
      }
      const update = (dt, t) => {
        for (const m of movers) m.obj.position.x = ((m.x0 + m.dir * m.v * t) % L + L) % L - L / 2;
        crowd?.update((i) => poses[i](t));
      };
      return { object: g, update, footprint: [L, edge * 2], stats: [['Length', `${L} m`], ['Width', `${(edge * 2).toFixed(1)} m`], ['Cars', String(p.traffic)]] };
    },
  },
  carPark: {
    params: [range('bays', 'Parking bays', 4, 60, 2), range('fill', 'Occupied', 0, 100, 5, '%')],
    build(p, lib, ctx) {
      const M = materials(), g = new THREE.Group(), r = rng(ctx.seed + 7), per = Math.ceil(p.bays / 2), L = per * 2.6 + 2, D = 17;
      g.add(slab(L, D, 0.08, M.asphalt, 7));
      const lines = [];
      for (const s of [-1, 1]) for (let i = 0; i <= per; i++) lines.push(new THREE.BoxGeometry(0.12, 0.02, 5).translate(-L / 2 + 1 + i * 2.6, 0.09, s * 5.5));
      g.add(new THREE.Mesh(mergeGeometries(lines), M.line));
      const by = {};
      for (const s of [-1, 1]) for (let i = 0; i < per; i++) {
        if (r() * 100 >= p.fill) continue;
        const m = ['car_sedan', 'car_suv', 'car_hatch'][Math.floor(r() * 3)];
        (by[m] ||= { m: [], c: [] }).m.push(place(-L / 2 + 2.3 + i * 2.6, 0.08, s * 5.6, s > 0 ? -Math.PI / 2 : Math.PI / 2)); by[m].c.push(col(PALETTES.car[Math.floor(r() * PALETTES.car.length)]));
      }
      for (const [k, { m, c }] of Object.entries(by)) mod(g, lib, k, m, { Paint: c });
      return { object: g, footprint: [L, D], stats: [['Bays', String(per * 2)], ['Area', `${Math.round(L * D)} m²`]] };
    },
  },
  water: {
    params: [range('length', 'Length', 20, 600, 10, 'm'), range('width', 'Width', 6, 80, 1, 'm'), toggle('banks', 'Grassy banks')],
    build(p, lib, ctx) {
      const M = materials(), g = new THREE.Group();
      const w = new THREE.Mesh(planarUV(new THREE.PlaneGeometry(p.length, p.width).rotateX(-Math.PI / 2).translate(0, 0.06, 0), 18), M.water); w.receiveShadow = true; g.add(w);
      if (p.banks) for (const s of [-1, 1]) { const b = slab(p.length, 4, 0.05, M.grass, 4); b.position.z = s * (p.width / 2 + 2); g.add(b); }
      return { object: g, footprint: [p.length, p.width + (p.banks ? 8 : 0)], stats: [['Area', `${Math.round(p.length * p.width).toLocaleString()} m²`]] };
    },
  },
  lawn: {
    params: [range('width', 'Width', 4, 200, 1, 'm'), range('depth', 'Depth', 4, 200, 1, 'm'), choice('surface', 'Surface', [['grass', 'Grass'], ['pavers', 'Pavers'], ['asphalt', 'Asphalt']])],
    build(p) { const M = materials(); const s = slab(p.width, p.depth, 0.05, M[p.surface], p.surface === 'pavers' ? 2.4 : 5); return { object: s, footprint: [p.width, p.depth], stats: [['Area', `${Math.round(p.width * p.depth).toLocaleString()} m²`]] }; },
  },
};

/* ---------------------------------------------------------------- sidebar tiles */
export const CATEGORIES = [
  { id: 'property', label: 'Property', tiles: [
    { id: 'house-family', type: 'house', label: 'Family house', sub: '2 storey · 4 bed', params: { style: 'house_a', facade: '#f3f0ea', roof: '#ffffff', car: true } },
    { id: 'house-bungalow', type: 'house', label: 'Bungalow', sub: '1 storey · deck', params: { style: 'house_b', facade: '#e7dfd1', roof: '#c98a6a', car: false } },
    { id: 'house-modern', type: 'house', label: 'Modern house', sub: 'Flat roof · glazing', params: { style: 'house_c', facade: '#f3f0ea', roof: '#ffffff', car: false } },
    { id: 'townhouses-gabled', type: 'townhouses', label: 'Townhouses', sub: 'Gabled terrace', params: { style: 'townhouse_a', units: 5, facade: '#c9b8a2', mixed: true } },
    { id: 'townhouses-modern', type: 'townhouses', label: 'Modern terrace', sub: '3 storey row', params: { style: 'townhouse_b', units: 4, facade: '#f3f0ea', mixed: false } },
    { id: 'apartment', type: 'apartment', label: 'Apartments', sub: '1–30 storeys', params: { floors: 6, units: 4, facade: '#f3f0ea' } },
    { id: 'tower', type: 'tower', label: 'Tower', sub: '10–100 storeys', params: { storeys: 40, width: 26, depth: 14, facade: '#e7dfd1', podium: true } },
  ] },
  { id: 'vehicles', label: 'Vehicles', tiles: [
    { id: 'car-sedan', type: 'car', label: 'Sedan', sub: 'Parked', params: { model: 'car_sedan', paint: '#1f3552', drive: false, speed: 40, route: 120 } },
    { id: 'car-suv', type: 'car', label: 'SUV', sub: 'Parked', params: { model: 'car_suv', paint: '#f2f2f0', drive: false, speed: 40, route: 120 } },
    { id: 'car-hatch', type: 'car', label: 'Hatchback', sub: 'Driving', params: { model: 'car_hatch', paint: '#7a1a1a', drive: true, speed: 35, route: 120 } },
    { id: 'truck', type: 'truck', label: 'Truck', sub: 'Driving', params: { paint: '#33475b', drive: true, speed: 50, route: 200 } },
    { id: 'car-park', type: 'carPark', label: 'Car park', sub: '20 bays', params: { bays: 20, fill: 70 } },
  ] },
  { id: 'people', label: 'People', tiles: [
    { id: 'person-a', type: 'person', label: 'Walker', sub: 'Walking', params: { variant: 'person_a', outfit: 3, walk: true, route: 24 } },
    { id: 'person-b', type: 'person', label: 'Walker', sub: 'Walking', params: { variant: 'person_b', outfit: 8, walk: true, route: 24 } },
    { id: 'person-c', type: 'person', label: 'Standing', sub: 'Waiting', params: { variant: 'person_c', outfit: 15, walk: false, route: 10 } },
    { id: 'crowd', type: 'crowd', label: 'Crowd', sub: '20 people', params: { count: 20, radius: 14, walk: true } },
  ] },
  { id: 'nature', label: 'Nature', tiles: [
    { id: 'tree-a', type: 'tree', label: 'Spreading tree', sub: '9 m', params: { species: 'tree_a', scale: 1 } },
    { id: 'tree-b', type: 'tree', label: 'Rounded tree', sub: '7.5 m', params: { species: 'tree_b', scale: 1 } },
    { id: 'tree-c', type: 'tree', label: 'Tall tree', sub: '11 m', params: { species: 'tree_c', scale: 1 } },
    { id: 'tree-row', type: 'treeRow', label: 'Avenue', sub: '8 trees', params: { count: 8, spacing: 9, scale: 0.85, mixed: true } },
    { id: 'park', type: 'park', label: 'Park', sub: 'Lawn, trees, path', params: { radius: 26, trees: 18, people: 10, path: true } },
    { id: 'lawn', type: 'lawn', label: 'Lawn', sub: 'Grass area', params: { width: 30, depth: 20, surface: 'grass' } },
    { id: 'pond', type: 'water', label: 'Pond', sub: 'Still water', params: { length: 40, width: 22, banks: true } },
  ] },
  { id: 'street', label: 'Streets & water', tiles: [
    { id: 'road-2', type: 'road', label: 'Street', sub: '2 lanes · footpaths', params: { length: 160, lanes: 2, footpaths: true, lamps: true, trees: true, traffic: 4, walkers: 10 } },
    { id: 'road-4', type: 'road', label: 'Avenue road', sub: '4 lanes · busy', params: { length: 300, lanes: 4, footpaths: true, lamps: true, trees: false, traffic: 14, walkers: 16 } },
    { id: 'lamp', type: 'lamp', label: 'Street light', sub: '7 m LED', params: {} },
    { id: 'plaza', type: 'lawn', label: 'Plaza', sub: 'Paved square', params: { width: 30, depth: 30, surface: 'pavers' } },
    { id: 'river', type: 'water', label: 'River', sub: 'Flowing', params: { length: 300, width: 34, banks: true } },
  ] },
];
export const TILES = new Map(CATEGORIES.flatMap((c) => c.tiles.map((t) => [t.id, { ...t, cat: c.id }])));
// older saved compositions used one tile per preset size
for (const [old, now] of [['apartment-walkup', 'apartment'], ['apartment-midrise', 'apartment'], ['tower-40', 'tower'], ['tower-100', 'tower']]) TILES.set(old, TILES.get(now));
