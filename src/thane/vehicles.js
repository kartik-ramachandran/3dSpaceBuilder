/*
 * Traffic on the real road network: cars, auto-rickshaws and buses that drive on the left (India),
 * at speeds set by road class. Each vehicle type is a handful of instanced meshes sharing one set of
 * instance matrices, so 150 vehicles cost a few draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng } from '../util.js';
import { ROAD_WIDTH } from './real-roads.js';

const merge = (gs) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)));
const rbox = (w, h, d, x, y, z, r = 0.08) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.99).translate(x, y, z);
const extrudeSide = (pts, width, bevel = 0.06) => {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 });
  return g.translate(0, 0, -width / 2);
};
const wheel = (r, w, x, y, z) => new THREE.CylinderGeometry(r, r, w, 20).rotateX(Math.PI / 2).translate(x, y, z);

/** Vehicle parts in model space: forward is +x, ground is y = 0. */
function carParts() {
  const body = extrudeSide([[-2.12, 0.34], [2.12, 0.34], [2.18, 0.62], [2.05, 0.84], [0.95, 0.96], [0.2, 1.38], [-1.0, 1.4], [-1.86, 0.98], [-2.16, 0.9]], 1.6);
  const glass = extrudeSide([[0.88, 0.97], [0.23, 1.33], [-0.98, 1.35], [-1.76, 0.99]], 1.66, 0.03);
  const tyres = merge([-1.35, 1.38].flatMap((x) => [-0.78, 0.78].map((z) => wheel(0.33, 0.23, x, 0.33, z))));
  const rims = merge([-1.35, 1.38].flatMap((x) => [-0.79, 0.79].map((z) => wheel(0.19, 0.245, x, 0.33, z))));
  const head = merge([-0.6, 0.6].map((z) => rbox(0.08, 0.13, 0.36, 2.15, 0.72, z, 0.03)));
  const tail = merge([-0.62, 0.62].map((z) => rbox(0.08, 0.14, 0.3, -2.17, 0.8, z, 0.03)));
  return { body, glass, tyres, rims, head, tail };
}
function autoParts() {
  const body = merge([rbox(2.0, 0.55, 1.28, -0.25, 0.62, 0, 0.12), rbox(0.7, 0.8, 0.9, 0.98, 0.78, 0, 0.18)]);
  const canopy = merge([rbox(1.95, 0.08, 1.36, -0.28, 1.78, 0, 0.04), rbox(1.6, 0.9, 0.05, -0.35, 1.33, 0.66, 0.03), rbox(1.6, 0.9, 0.05, -0.35, 1.33, -0.66, 0.03), rbox(0.06, 0.95, 1.3, -1.22, 1.3, 0, 0.03)]);
  const glass = rbox(0.06, 0.55, 1.0, 0.72, 1.33, 0, 0.03);
  const tyres = merge([wheel(0.24, 0.16, 1.2, 0.24, 0), wheel(0.25, 0.17, -0.9, 0.25, 0.56), wheel(0.25, 0.17, -0.9, 0.25, -0.56)]);
  const rims = merge([wheel(0.12, 0.18, 1.2, 0.24, 0), wheel(0.13, 0.19, -0.9, 0.25, 0.56), wheel(0.13, 0.19, -0.9, 0.25, -0.56)]);
  const head = rbox(0.06, 0.14, 0.2, 1.34, 0.95, 0, 0.03);
  const tail = merge([-0.5, 0.5].map((z) => rbox(0.05, 0.1, 0.16, -1.26, 0.7, z, 0.02)));
  return { body, canopy, glass, tyres, rims, head, tail };
}
function busParts() {
  const body = rbox(11, 2.6, 2.5, 0, 1.75, 0, 0.18);
  const glass = merge([rbox(10.4, 0.95, 2.53, -0.1, 2.32, 0, 0.06), rbox(0.06, 1.3, 2.2, 5.49, 2.2, 0, 0.04)]);
  const stripe = rbox(11.02, 0.25, 2.52, 0, 1.35, 0, 0.04);
  const tyres = merge([-3.6, 3.4].flatMap((x) => [-1.1, 1.1].map((z) => wheel(0.5, 0.3, x, 0.5, z))));
  const rims = merge([-3.6, 3.4].flatMap((x) => [-1.12, 1.12].map((z) => wheel(0.26, 0.3, x, 0.5, z))));
  const head = merge([-0.85, 0.85].map((z) => rbox(0.06, 0.2, 0.4, 5.5, 0.85, z, 0.03)));
  const tail = merge([-0.95, 0.95].map((z) => rbox(0.06, 0.3, 0.3, -5.5, 0.95, z, 0.03)));
  return { body, glass, stripe, tyres, rims, head, tail };
}

const MATS = {
  paint: () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: '#0f1a20', metalness: 0.1, roughness: 0.05, clearcoat: 1, reflectivity: 0.9 }),
  tyres: () => new THREE.MeshStandardMaterial({ color: '#141617', roughness: 0.92 }),
  rims: () => new THREE.MeshStandardMaterial({ color: '#b9bec2', metalness: 0.9, roughness: 0.25 }),
  head: () => new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffe9b8', emissiveIntensity: 0.9 }),
  tail: () => new THREE.MeshStandardMaterial({ color: '#7a1410', emissive: '#ff2414', emissiveIntensity: 0.55 }),
  canopy: () => new THREE.MeshPhysicalMaterial({ color: '#f1c232', roughness: 0.55, clearcoat: 0.3 }),
  stripe: () => new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.5 }),
};
const CAR_PAINT = ['#f4f4f2', '#f4f4f2', '#f4f4f2', '#c6c9cc', '#c6c9cc', '#7d8288', '#17191b', '#a5161a', '#1d3f7a', '#5a6b4c', '#8c5a2b'];

function batch(parts, count, colourOf) {
  const group = new THREE.Group(), meshes = [];
  let shared = null;
  for (const [name, geo] of Object.entries(parts)) {
    const mat = name === 'body' ? MATS.paint() : (MATS[name] || MATS.paint)();
    const m = new THREE.InstancedMesh(geo, mat, count); m.frustumCulled = false; m.castShadow = name === 'body';
    if (shared) m.instanceMatrix = shared; else shared = m.instanceMatrix;
    if (name === 'body') for (let i = 0; i < count; i++) m.setColorAt(i, new THREE.Color(colourOf(i)));
    group.add(m); meshes.push(m);
  }
  return { group, meshes, set(i, matrix) { meshes[0].setMatrixAt(i, matrix); }, commit() { meshes[0].instanceMatrix.needsUpdate = true; } };
}

const SPEED = { motorway: 19, trunk: 15, primary: 12, secondary: 10, tertiary: 8.5, minor: 6, service: 4 };
const WEIGHT = { motorway: 3, trunk: 3, primary: 2.2, secondary: 1.6, tertiary: 1.2, minor: 0.45, service: 0.15 };
const ROAD_Y = { motorway: 0.2, trunk: 0.19, primary: 0.17, secondary: 0.15, tertiary: 0.13, minor: 0.11, service: 0.1 };

export function createTraffic(roads, { cars = 110, autos = 40, buses = 10, seed = 77 } = {}) {
  const group = new THREE.Group(); group.name = 'Traffic on real roads (simulated)';
  const r = rng(seed);
  // drivable polylines with cumulative lengths
  const lanes = roads.filter((x) => SPEED[x.cls]).map((x) => {
    const cum = [0]; for (let i = 1; i < x.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(x.pts[i].x - x.pts[i - 1].x, x.pts[i].z - x.pts[i - 1].z));
    return { ...x, cum, length: cum[cum.length - 1] };
  }).filter((x) => x.length > 25);
  const pool = (allowMinor) => { const list = lanes.filter((l) => allowMinor || !['minor', 'service'].includes(l.cls)); const total = list.reduce((s, l) => s + l.length * WEIGHT[l.cls], 0); return { list, total }; };
  const pools = { any: pool(true), main: pool(false) };
  const pick = (p) => { let t = r() * p.total; for (const l of p.list) { t -= l.length * WEIGHT[l.cls]; if (t <= 0) return l; } return p.list[p.list.length - 1]; };

  const kinds = [
    { batch: batch(carParts(), cars, () => CAR_PAINT[Math.floor(r() * CAR_PAINT.length)]), n: cars, pool: pools.any, len: 4.3 },
    { batch: batch(autoParts(), autos, () => (r() < 0.75 ? '#18201a' : '#2f6b3a')), n: autos, pool: pools.any, len: 2.6, slow: 0.75 },
    { batch: batch(busParts(), buses, () => (r() < 0.5 ? '#b8322a' : '#2b6f8f')), n: buses, pool: pools.main.list.length ? pools.main : pools.any, len: 11 },
  ];
  const vehicles = [];
  function place(v, start) {
    const lane = pick(v.kind.pool);
    v.lane = lane; v.dir = lane.oneway ? 1 : r() < 0.5 ? 1 : -1;
    v.s = start ? r() * lane.length : v.dir > 0 ? 0 : lane.length;
    v.speed = SPEED[lane.cls] * (0.8 + r() * 0.35) * (v.kind.slow || 1);
    const w = ROAD_WIDTH[lane.cls] || 5;
    v.offset = lane.oneway ? (r() < 0.5 ? -w / 4 : w / 4) : w / 4;   // keep left; one-way roads use either lane
  }
  for (const kind of kinds) for (let i = 0; i < kind.n; i++) { const v = { kind, i }; if (lanes.length) place(v, true); vehicles.push(v); }
  for (const k of kinds) group.add(k.batch.group);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  function update(dt) {
    for (const v of vehicles) {
      if (!v.lane) { v.kind.batch.set(v.i, hidden); continue; }
      v.s += v.speed * dt * v.dir;
      if (v.s < 0 || v.s > v.lane.length) place(v, false);
      const L = v.lane, s = Math.max(0, Math.min(L.length, v.s));
      let k = 1; while (k < L.cum.length - 1 && L.cum[k] < s) k++;
      const a = L.pts[k - 1], b = L.pts[k], seg = (L.cum[k] - L.cum[k - 1]) || 1, t = (s - L.cum[k - 1]) / seg;
      let hx = (b.x - a.x) / seg * v.dir, hz = (b.z - a.z) / seg * v.dir;
      const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      // left of travel in an x-east, z-south frame
      pos.set(a.x + (b.x - a.x) * t + hz * v.offset, ROAD_Y[L.cls] || 0.1, a.z + (b.z - a.z) * t - hx * v.offset);
      q.setFromAxisAngle(up, Math.atan2(-hz, hx));
      v.kind.batch.set(v.i, m.compose(pos, q, one));
    }
    for (const k of kinds) k.batch.commit();
  }
  update(0);
  return {
    group, count: vehicles.length, update,
    dispose() { group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); },
  };
}
