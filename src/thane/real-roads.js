/*
 * Road surfaces along the real OpenStreetMap road network: textured asphalt (Poly Haven, CC0) in real
 * metres, with lane and edge markings by road class. Shown at close zoom, where the satellite pixels blur.
 */
import * as THREE from 'three';

export const ROAD_WIDTH = { motorway: 15, trunk: 13, primary: 11, secondary: 9, tertiary: 7.5, minor: 5.5, service: 4 };
const ROAD_Y = { motorway: 0.2, trunk: 0.19, primary: 0.17, secondary: 0.15, tertiary: 0.13, minor: 0.11, service: 0.1 };

/** Where the assets folder is relative to this page (dist/ pages sit one level down). */
export const ASSET_BASE = /\/dist\//.test(location.pathname) ? '../assets/' : 'assets/';

function loadAsphalt() {
  const tl = new THREE.TextureLoader(), base = `${ASSET_BASE}tex/asphalt_02/`;
  const tex = (f, srgb) => { const t = tl.load(base + f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return new THREE.MeshStandardMaterial({ map: tex('diff.jpg', true), normalMap: tex('nor.jpg'), roughnessMap: tex('rough.jpg'), roughness: 1, color: '#b9b6ae', normalScale: new THREE.Vector2(0.8, 0.8), polygonOffset: true, polygonOffsetFactor: -1 });
}

/** Splits a polyline into runs that stay outside the development plinth. */
function outsideRuns(pts, keepOut) {
  const runs = []; let cur = [];
  const inside = (p) => Math.abs(p.x) < keepOut.x && Math.abs(p.z) < keepOut.z;
  for (const p of pts) { if (inside(p)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p); }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/** Ribbon between offsets a and b (metres left of the centreline), UVs in metres / tile. */
function ribbon(pts, a, b, y, tile, positions, uvs, index) {
  let along = 0;
  const base = positions.length / 3;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x, tz = next.z - prev.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = tz, nz = -tx;                                 // left of travel in an x-east, z-south frame
    if (i) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    positions.push(p.x + nx * a, y, p.z + nz * a, p.x + nx * b, y, p.z + nz * b);
    uvs.push(along / tile, a / tile, along / tile, b / tile);
    if (i) { const k = base + (i - 1) * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
}
/** Dashed or solid stripe as separate quads along the line. */
function stripe(pts, off, y, width, dash, gap, positions, index) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z); if (!L) continue;
    const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L, nx = tz, nz = -tx;
    for (let s = 0; s < L; ) {
      const phase = d % (dash + gap), on = gap === 0 || phase < dash, step = Math.min(L - s, gap === 0 ? L : on ? dash - phase : dash + gap - phase);
      if (on) {
        const k = positions.length / 3, x0 = a.x + tx * s + nx * off, z0 = a.z + tz * s + nz * off, x1 = x0 + tx * step, z1 = z0 + tz * step;
        positions.push(x0 + nx * width / 2, y, z0 + nz * width / 2, x0 - nx * width / 2, y, z0 - nz * width / 2, x1 + nx * width / 2, y, z1 + nz * width / 2, x1 - nx * width / 2, y, z1 - nz * width / 2);
        index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      s += step; d += step;
    }
  }
}
function mesh(positions, uvs, index, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; m.userData.noShadow = true; return m;
}

export function buildRealRoads(roads, keepOut) {
  const group = new THREE.Group(); group.name = 'Real road surfaces (OpenStreetMap)';
  const asphalt = loadAsphalt();
  const white = new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e2b23a', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 });
  const P = [], U = [], I = [], W = [], WI = [], Y = [], YI = [];
  for (const r of roads) {
    const w = ROAD_WIDTH[r.cls] || 5, y = ROAD_Y[r.cls] || 0.1, h = w / 2;
    for (const run of outsideRuns(r.pts, keepOut)) {
      ribbon(run, h, -h, y, 4, P, U, I);
      const my = y + 0.015;
      if (r.cls === 'minor' || r.cls === 'service') continue;
      if (r.oneway) {                                         // one carriageway of a divided road: lane lines and edges
        const lanes = Math.max(2, Math.round(w / 3.5));
        for (let k = 1; k < lanes; k++) stripe(run, -h + k * w / lanes, my, 0.15, 3, 6, W, WI);
        stripe(run, h - 0.35, my, 0.15, 1, 0, Y, YI);          // median edge
        stripe(run, -h + 0.35, my, 0.15, 1, 0, W, WI);
      } else {
        stripe(run, 0, my, 0.15, 3, 6, W, WI);                 // centre line
        if (w >= 9) { stripe(run, h - 0.35, my, 0.13, 1, 0, W, WI); stripe(run, -h + 0.35, my, 0.13, 1, 0, W, WI); }
      }
    }
  }
  if (I.length) group.add(mesh(P, U, I, asphalt));
  if (WI.length) group.add(mesh(W, null, WI, white));
  if (YI.length) group.add(mesh(Y, null, YI, yellow));
  return { group, dispose() { group.traverse((o) => o.geometry?.dispose()); [asphalt, white, yellow].forEach((m) => { m.map?.dispose(); m.normalMap?.dispose(); m.roughnessMap?.dispose(); m.dispose(); }); } };
}
