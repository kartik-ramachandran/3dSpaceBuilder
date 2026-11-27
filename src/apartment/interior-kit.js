/*
 * Interiors kit for the Design sidebar on apartment.html: everything a house or room is made of.
 *
 *  Structure   walls (length, height, thickness, finish, skirting), rooms (four walls, floor, ceiling,
 *              built-in door and window, each wall on or off so rooms can share walls), glass partitions,
 *              half walls, columns, platforms, stairs and roofs (gable, hip, skillion, flat)
 *  Openings    hinged, double, sliding, cavity and barn doors, front doors, casement, sliding, picture and
 *              awning windows, archways. Drag one near a wall and it snaps into it and cuts its opening.
 *  Furniture   procedural, fully parametric pieces (sofa, bed, kitchen, island, wardrobe, shelving, dining
 *              set, desk, cabinets, TV, fireplace, rugs, art, lights) plus every piece modelled in Blender
 *              for the apartment (bath, shower, vanity, lounge chair, plants…), lifted out of its model.
 *
 * Geometry is built in metres with UVs in metres, so the small canvas-drawn textures (brick, boards, tiles,
 * oak, marble, concrete, carpet, roof tiles, standing seam) tile at their real size. Everything is merged per
 * material. Conventions: an item's front is +z; for walls inside a room, the room side is local −z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const money = (v, cur) => `${cur} ${v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm' : Math.round(v / 1000) + 'k'}`;
/**
 * Figures the user can type over (p.facts = { label: number }). A row's `drive(n)` turns a typed number into
 * a param change, so the model follows (floor area → room size); other rows keep the typed figure. A typed
 * floor area re-prices an "Est." row at the same rate per m², unless that was typed too.
 */
function editableStats(p, ctx, rows, { area, value } = {}) {
  const f = p.facts || {}, unit = (v) => (String(v).match(/ (m²|m)$/) || ['', ''])[1];
  const show = (k, v) => (k.startsWith('Est.') ? money(f[k], ctx.currency) : `${f[k].toLocaleString()}${unit(v) ? ' ' + unit(v) : ''}`);
  const out = rows.map(([k, v, drive]) => [k, f[k] != null ? show(k, v) : v, { drive, edited: f[k] != null }]);
  const est = out.find((r) => r[0].startsWith('Est.'));
  if (est && f[est[0]] == null && f['Floor area'] != null && area && value) { est[1] = money(f['Floor area'] * value / area, ctx.currency); est[2].derived = true; }
  return out;
}
import { rng } from '../util.js';

const clamp = THREE.MathUtils.clamp;
const deg = THREE.MathUtils.degToRad;

/* ---------------------------------------------------------------- textures (drawn once, tiny) */
const TEX = new Map();
function canvasTexture(name, w, h, metresW, metresH, draw) {
  if (TEX.has(name)) return TEX.get(name);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h, rng(name.length * 977 + name.charCodeAt(0)));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(1 / metresW, 1 / metresH);
  TEX.set(name, t); return t;
}
function speckle(g, w, h, r, n, colours, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colours[Math.floor(r() * colours.length)];
    const x = r() * w, y = r() * h, s = size * (0.5 + r());
    for (const dx of [0, -w, w]) for (const dy of [0, -h, h]) g.fillRect(x + dx, y + dy, s, s);
  }
}
const DRAW = {
  brick: () => canvasTexture('brick', 360, 240, 0.45, 0.3, (g, w, h, r) => {
    g.fillStyle = '#bdb5a8'; g.fillRect(0, 0, w, h);
    const reds = ['#9c4a32', '#a8553a', '#8e432e', '#b0603f', '#94503a', '#a24c34', '#87412c'];
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 90 : 0;
      for (let k = 0; k < 2; k++) {
        g.fillStyle = reds[Math.floor(r() * reds.length)];
        for (const wrap of [0, -w]) g.fillRect(k * 180 + off + 4 + wrap, row * 60 + 4, 172, 52);
      }
    }
    speckle(g, w, h, r, 1400, ['rgba(0,0,0,.10)', 'rgba(255,255,255,.07)', 'rgba(60,20,10,.12)'], 2.2);
  }),
  boards: () => canvasTexture('boards', 300, 600, 0.6, 1.2, (g, w, h, r) => {
    for (let b = 0; b < 5; b++) {
      const v = 232 + Math.floor(r() * 18); g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(b * 60, 0, 60, h);
      g.strokeStyle = 'rgba(120,100,80,.16)'; g.lineWidth = 1;
      for (let l = 0; l < 7; l++) { const x0 = b * 60 + 6 + r() * 48; g.beginPath(); g.moveTo(x0, 0); for (let y = 0; y <= h; y += 40) g.lineTo(x0 + Math.sin(y / 70 + l) * 2.5, y); g.stroke(); }
      g.fillStyle = 'rgba(60,50,40,.45)'; g.fillRect(b * 60, 0, 2, h);
    }
  }),
  tiles: () => canvasTexture('tiles', 256, 256, 0.6, 0.6, (g, w, h, r) => {
    g.fillStyle = '#b9b7b1'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const v = 238 + Math.floor(r() * 12); g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(i * 128 + 2, j * 128 + 2, 124, 124); }
  }),
  oak: () => canvasTexture('oak', 256, 768, 0.76, 2.28, (g, w, h, r) => {
    const tones = ['#b98b5c', '#c39665', '#ad7f52', '#c99f70', '#b48657', '#a8794c'];
    for (let p = 0; p < 4; p++) {
      let y = -r() * 300;
      while (y < h) {
        const len = 240 + r() * 300, tone = tones[Math.floor(r() * tones.length)];
        g.fillStyle = tone;
        for (const wrap of [0, h, -h]) g.fillRect(p * 64, y + wrap, 64, len);
        g.strokeStyle = 'rgba(80,50,25,.18)';
        for (let l = 0; l < 6; l++) { const x0 = p * 64 + 4 + r() * 56; g.beginPath(); g.moveTo(x0, y); for (let yy = 0; yy <= len; yy += 30) g.lineTo(x0 + Math.sin((y + yy) / 50 + l) * 2, y + yy); g.stroke(); }
        g.fillStyle = 'rgba(50,30,15,.35)'; for (const wrap of [0, h, -h]) g.fillRect(p * 64, y + wrap, 64, 1.5);
        y += len;
      }
      g.fillStyle = 'rgba(50,30,15,.4)'; g.fillRect(p * 64, 0, 1.5, h);
    }
  }),
  concrete: () => canvasTexture('concrete', 256, 256, 1.6, 1.6, (g, w, h, r) => {
    g.fillStyle = '#a9a8a3'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 260, ['rgba(255,255,255,.05)', 'rgba(0,0,0,.05)'], 26);
    speckle(g, w, h, r, 2200, ['rgba(0,0,0,.10)', 'rgba(255,255,255,.08)'], 1.6);
  }),
  marble: () => canvasTexture('marble', 512, 512, 1.2, 1.2, (g, w, h, r) => {
    g.fillStyle = '#f1efea'; g.fillRect(0, 0, w, h);
    for (let v = 0; v < 9; v++) {
      g.strokeStyle = `rgba(120,118,112,${0.15 + r() * 0.3})`; g.lineWidth = 0.6 + r() * 2.2;
      const y0 = r() * h, a = (r() - 0.5) * 0.9;
      for (const wrap of [0, h, -h]) { g.beginPath(); for (let x = 0; x <= w; x += 8) { const y = y0 + wrap + x * a + Math.sin(x / 40 + v) * 14 + Math.sin(x / 9) * 3; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    }
  }),
  carpet: () => canvasTexture('carpet', 128, 128, 0.25, 0.25, (g, w, h, r) => {
    g.fillStyle = '#e4e0da'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 2500, ['rgba(0,0,0,.07)', 'rgba(255,255,255,.12)', 'rgba(0,0,0,.04)'], 1.4);
  }),
  rooftiles: () => canvasTexture('rooftiles', 256, 256, 0.6, 0.6, (g, w, h, r) => {
    for (let row = 0; row < 4; row++) {
      const grad = g.createLinearGradient(0, row * 64, 0, row * 64 + 64); grad.addColorStop(0, '#d8d8d8'); grad.addColorStop(0.85, '#bdbdbd'); grad.addColorStop(1, '#6e6e6e');
      g.fillStyle = grad; g.fillRect(0, row * 64, w, 64);
      g.fillStyle = 'rgba(40,40,40,.5)'; const off = row % 2 ? 32 : 0; for (let k = 0; k < 5; k++) g.fillRect(k * 64 + off - 1, row * 64, 2, 64);
    }
    speckle(g, w, h, r, 700, ['rgba(0,0,0,.06)', 'rgba(255,255,255,.06)'], 2);
  }),
  seams: () => canvasTexture('seams', 128, 64, 0.5, 0.25, (g, w, h) => {
    g.fillStyle = '#d4d6d8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8c8f92'; g.fillRect(0, 0, 4, h); g.fillStyle = '#f2f3f4'; g.fillRect(4, 0, 2, h);
  }),
};

/** A normal map from a drawn texture's brightness (mortar, grout and board joints read as recessed). */
const RELIEF = { brick: [5, true], boards: [3, false], tiles: [4, false], oak: [2.2, false], concrete: [1.6, false], marble: [0.6, false], carpet: [3, false], rooftiles: [5, false], seams: [4, false] };
function reliefMap(name) {
  const key = `relief:${name}`; if (TEX.has(key)) return TEX.get(key);
  const colourTex = DRAW[name](), src = colourTex.image, w = src.width, h = src.height, [strength, invert] = RELIEF[name] || [2, false];
  const d = src.getContext('2d').getImageData(0, 0, w, h).data, H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const l = (0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255; H[i] = invert ? 1 - l : l; }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), out = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = H[y * w + (x + 1) % w] - H[y * w + (x - 1 + w) % w], dy = H[((y + 1) % h) * w + x] - H[((y - 1 + h) % h) * w + x];
    let nx = -dx * strength, ny = dy * strength, nz = 1; const k = 1 / Math.hypot(nx, ny, nz); nx *= k; ny *= k; nz *= k;
    const o = (y * w + x) * 4; out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.repeat.copy(colourTex.repeat);
  TEX.set(key, t); return t;
}

/* ---------------------------------------------------------------- materials (shared, cached) */
const MATS = new Map();
// a softer sky reflection than the default keeps shadowed sides from washing out under the sun
function M(key, make) { let m = MATS.get(key); if (!m) { m = make(); m.name = key; if (!m.transparent && m.envMapIntensity !== undefined) m.envMapIntensity = 0.7; MATS.set(key, m); } return m; }
// satin surfaces (lacquer, painted timber) get a thin clear coat so they pick up soft reflections
const plain = (c, rough = 0.85, metal = 0) => M(`plain:${c}:${rough}:${metal}`, () => (rough <= 0.6 && !metal
  ? new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35 })
  : new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal })));
const textured = (tex, c = '#ffffff', rough = 0.8, metal = 0, coat = 0) => M(`tex:${tex}:${c}:${rough}:${metal}:${coat}`, () => {
  const o = { map: DRAW[tex](), normalMap: reliefMap(tex), color: c, roughness: rough, metalness: metal };
  return coat ? new THREE.MeshPhysicalMaterial({ ...o, clearcoat: coat, clearcoatRoughness: 0.18 }) : new THREE.MeshStandardMaterial(o);
});
const plaster = (c) => M(`plaster:${c}`, () => { const n = reliefMap('concrete'); return new THREE.MeshStandardMaterial({ color: c, roughness: 0.93, normalMap: n, normalScale: new THREE.Vector2(0.22, 0.22) }); });
const glassMat = () => M('glass', () => new THREE.MeshPhysicalMaterial({ color: '#e6eef2', roughness: 0.02, metalness: 0, ior: 1.5, specularIntensity: 1, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.8, side: THREE.DoubleSide }));
const mirrorMat = () => M('mirror', () => new THREE.MeshStandardMaterial({ color: '#dfe5ea', roughness: 0.02, metalness: 1 }));
const glow = (c, k = 2.2) => M(`glow:${c}:${k}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: c, emissiveIntensity: k, roughness: 0.4 }));
const fabric = (c) => M(`fabric:${c}`, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.96, sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.45), normalMap: reliefMap('carpet'), normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide }));
const blackGlass = () => M('blackglass', () => new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.08, metalness: 0.3 }));
const steel = () => plain('#c3c7cb', 0.3, 0.9);

export const FINISHES = [['plaster', 'Painted plaster'], ['brick', 'Exposed brick'], ['concrete', 'Concrete'], ['timber', 'Timber boards'], ['tile', 'Tiled']];
function finishMat(finish, colour) {
  if (finish === 'brick') return textured('brick', '#ffffff', 0.92);
  if (finish === 'concrete') return textured('concrete', '#ffffff', 0.85);
  if (finish === 'timber') return textured('boards', colour, 0.7);
  if (finish === 'tile') return textured('tiles', colour, 0.25, 0, 0.6);
  return plaster(colour);
}
const COST = { plaster: 165, brick: 310, concrete: 260, timber: 240, tile: 290 };   // per m² of wall, illustrative
export const FLOORS = [['oak', 'Oak boards'], ['walnut', 'Walnut'], ['whitewash', 'Limed oak'], ['tile', 'Porcelain tile'], ['marble', 'Marble'], ['concrete', 'Polished concrete'], ['carpet', 'Carpet']];
function floorMat(f) {
  // floors carry a clear coat: oiled oak has a soft sheen, polished concrete and marble real reflections
  return ({ oak: () => textured('oak', '#ffffff', 0.5, 0, 0.3), walnut: () => textured('oak', '#86644c', 0.45, 0, 0.35), whitewash: () => textured('oak', '#f6efe4', 0.55, 0, 0.25),
    tile: () => textured('tiles', '#f0eee9', 0.25, 0, 0.7), marble: () => textured('marble', '#ffffff', 0.12, 0, 1), concrete: () => textured('concrete', '#e8e6e1', 0.45, 0, 0.5), carpet: () => textured('carpet', '#cfc5b6', 1) }[f] || (() => textured('oak')))();
}

/* ---------------------------------------------------------------- geometry helpers */
/** BoxGeometry with UVs in metres on every face. */
function B(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
  return g;
}
/** Collects geometry per material and merges it into one mesh each. */
class Parts {
  constructor() { this.m = new Map(); }
  add(mat, geo, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0 } = {}) {
    if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz); if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.clearGroups();
    if (!this.m.has(mat)) this.m.set(mat, []);
    this.m.get(mat).push(g); return this;
  }
  box(mat, w, h, d, x, y, z, o = {}) { return this.add(mat, B(w, h, d), { x, y, z, ...o }); }
  rbox(mat, w, h, d, r, x, y, z, o = {}) { return this.add(mat, new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999), { x, y, z, ...o }); }
  cyl(mat, rt, rb, h, x, y, z, o = {}) { return this.add(mat, new THREE.CylinderGeometry(rt, rb, h, o.seg || 20, 1, o.open || false), { x, y, z, ...o }); }
  into(parent = new THREE.Group()) {
    for (const [mat, gs] of this.m) {
      const g = gs.length === 1 ? gs[0] : mergeGeometries(gs); if (gs.length > 1) gs.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, mat); if (mat.transparent) mesh.userData.glass = true;
      parent.add(mesh);
    }
    return parent;
  }
}

/**
 * Wall pieces along the local segment a→b, leaving openings [{ s0, s1, bottom, top }] (metres along the
 * segment): solid runs, plus the wall below a sill and above a head. Returns the net wall area.
 */
function wallPieces(parts, seg, h, t, mat, openings, { skirting = false } = {}) {
  const dx = seg.bx - seg.ax, dz = seg.bz - seg.az, L = Math.hypot(dx, dz); if (L < 0.01) return 0;
  const ux = dx / L, uz = dz / L, ang = Math.atan2(-uz, ux), nx = Math.sin(ang), nz = Math.cos(ang);
  const piece = (u0, u1, y0, y1, m = mat, th = t, off = 0) => {
    if (u1 - u0 < 0.004 || y1 - y0 < 0.004) return;
    const g = B(u1 - u0, y1 - y0, th), c = (u0 + u1) / 2;
    parts.add(m, g, { ry: ang, x: seg.ax + ux * c + nx * off, y: (y0 + y1) / 2, z: seg.az + uz * c + nz * off });
  };
  const ops = openings.map((o) => ({ s0: clamp(o.s0, 0, L), s1: clamp(o.s1, 0, L), bottom: clamp(o.bottom, 0, h), top: clamp(o.top, 0, h) }))
    .filter((o) => o.s1 - o.s0 > 0.02 && o.top > o.bottom).sort((a, b) => a.s0 - b.s0);
  let u = 0, area = L * h; const runs = [];
  for (const o of ops) {
    if (o.s0 > u) { piece(u, o.s0, 0, h); runs.push([u, o.s0]); }
    const s0 = Math.max(u, o.s0);
    if (o.s1 > s0) {
      if (o.bottom > 0) { piece(s0, o.s1, 0, o.bottom); runs.push([s0, o.s1]); }
      if (o.top < h) piece(s0, o.s1, o.top, h);
      area -= (o.s1 - s0) * (o.top - o.bottom);
    }
    u = Math.max(u, o.s1);
  }
  if (u < L) { piece(u, L, 0, h); runs.push([u, L]); }
  if (skirting) { const sk = plain('#f3f1ec', 0.55); for (const [a, b] of runs) for (const side of [-1, 1]) piece(a, b, 0, 0.09, sk, 0.014, side * (t / 2 + 0.007)); }
  return area;
}

/** A curtain panel: a plane with folds. */
function curtainGeo(w, h, folds) {
  const g = new THREE.PlaneGeometry(w, h, Math.max(8, folds * 6), 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w + 0.5) * Math.PI * 2 * folds) * 0.035);
  g.computeVertexNormals(); return g;
}
function labelTexture(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d'); g.textAlign = 'center'; g.fillStyle = 'rgba(40,44,52,.62)';
  g.font = 'italic 64px "Instrument Serif", Georgia, serif'; g.fillText(text, 256, 78);
  g.font = '500 30px "Geist Mono", monospace'; g.fillText(sub, 256, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
/**
 * A lamp's light source, as a marker: the page lights the few lamps nearest the view with a fixed pool of
 * real lights (a changing light count would recompile every material), the rest glow through bloom.
 */
function pointLight(group, colour, intensity, x, y, z, distance = 6) {
  const l = new THREE.Object3D(); l.position.set(x, y, z); l.userData.lamp = { colour, intensity, distance }; group.add(l); return l;
}

/* ---------------------------------------------------------------- params */
const choice = (key, label, options) => ({ key, label, type: 'choice', options });
const range = (key, label, min, max, step = 1, unit = '') => ({ key, label, type: 'range', min, max, step, unit });
const colour = (key, label, palette) => ({ key, label, type: 'colour', palette });
const toggle = (key, label) => ({ key, label, type: 'toggle' });

export const PALETTES = {
  paint: ['#f4f1ea', '#e9e4da', '#d9d3c7', '#c8c2b5', '#a9b4ad', '#8fa3b0', '#d8c3a5', '#2f3a40'],
  lacquer: ['#f3f1ec', '#d9d4cb', '#9aa39c', '#4c5b52', '#2c3440', '#1d1d1f', '#b98c5c', '#7a5a3e'],
  timber: ['#c49a6c', '#a87b4f', '#7a5a3e', '#4f3a2a', '#e3cfb1', '#2a2a2a'],
  fabric: ['#e8e1d4', '#cdbfa8', '#9c8f7c', '#6f7d73', '#4a5a6b', '#2e3138', '#b5734f', '#d9b8a8'],
  frame: ['#1c1c1c', '#f3f3f1', '#6b5d4f', '#8a8f94', '#b8925a'],
  metal: ['#1c1c1c', '#c9ccd0', '#b8925a', '#f3f3f1', '#4a5a4f'],
  roof: ['#3b3f44', '#6e7478', '#a1462f', '#8c6b4f', '#d8d6d0', '#2c3a4a'],
  rug: ['#d8cfc0', '#a99c86', '#6c6457', '#3b4a5a', '#8a4b3a', '#c9b48e', '#2f2f33', '#7b8c7a'],
  stone: ['#f2f0eb', '#2b2b2c', '#d9d4cb', '#b98c5c', '#8d8a84'],
};
const ROOM_NAMES = ['Living', 'Bedroom', 'Kitchen', 'Dining', 'Bathroom', 'Study', 'Laundry', 'Hallway', 'Garage', 'Open plan'].map((n) => [n, n]);
const SIDES = [['none', 'None'], ['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']];
const FITOUT = { Kitchen: 5200, Bathroom: 6400, Laundry: 3600, Garage: 900, Hallway: 1600 };
const m2 = (v) => `${v.toFixed(1)} m²`, m = (v) => `${v.toFixed(2)} m`;

/* ---------------------------------------------------------------- types */
export const TYPES = {
  /* ------------------------------ structure */
  wall: {
    defaults: { length: 4, height: 2.7, thickness: 110, finish: 'plaster', colour: '#f4f1ea', skirting: true },
    params: [range('length', 'Length', 0.3, 20, 0.05, 'm'), range('height', 'Height', 0.6, 4.5, 0.05, 'm'), range('thickness', 'Thickness', 50, 600, 10, 'mm'), choice('finish', 'Finish', FINISHES), colour('colour', 'Paint / stain', 'paint'), toggle('skirting', 'Skirting boards')],
    segments: (p) => [{ ax: -p.length / 2, az: 0, bx: p.length / 2, bz: 0, t: p.thickness / 1000, h: p.height, on: true }],
    build(p, lib, ctx) {
      const parts = new Parts(), t = p.thickness / 1000, ops = ctx.rel?.openings?.[0] || [];
      const area = wallPieces(parts, TYPES.wall.segments(p)[0], p.height, t, finishMat(p.finish, p.colour), ops, { skirting: p.skirting && p.height > 0.5 });
      return { object: parts.into(), footprint: [p.length, Math.max(t, 0.2)], stats: editableStats(p, ctx, [
        ['Length', m(p.length), (v) => ({ length: v })], ['Height', m(p.height), (v) => ({ height: v })], ['Thickness', `${p.thickness} mm`, (v) => ({ thickness: v < 1 ? v * 1000 : v })],
        ['Net area', m2(area)], ['Openings', String(ops.length)], ['Est. cost', money(area * COST[p.finish], ctx.currency)]]) };
    },
  },
  room: {
    defaults: { name: 'Bedroom', width: 3.6, depth: 3.4, height: 2.7, thickness: 110, finish: 'plaster', colour: '#f4f1ea', floor: 'oak', door: 'front', window: 'back', wallFront: true, wallBack: true, wallLeft: true, wallRight: true, ceiling: false, label: true, skirting: true },
    params: [choice('name', 'Room', ROOM_NAMES), range('width', 'Width (inside)', 1, 14, 0.05, 'm'), range('depth', 'Depth (inside)', 1, 14, 0.05, 'm'), range('height', 'Ceiling height', 2.1, 4.5, 0.05, 'm'), range('thickness', 'Wall thickness', 50, 400, 10, 'mm'),
      choice('finish', 'Walls', FINISHES), colour('colour', 'Paint', 'paint'), choice('floor', 'Floor', FLOORS), choice('door', 'Door in', SIDES), choice('window', 'Window in', SIDES),
      toggle('wallFront', 'Front wall'), toggle('wallBack', 'Back wall'), toggle('wallLeft', 'Left wall'), toggle('wallRight', 'Right wall'), toggle('ceiling', 'Ceiling'), toggle('label', 'Name on the floor'), toggle('skirting', 'Skirting boards')],
    segments(p) {
      const W = p.width, D = p.depth, t = p.thickness / 1000, h = p.height;
      const S = { front: [-(W / 2 + t), D / 2 + t / 2, W / 2 + t, D / 2 + t / 2], back: [W / 2 + t, -(D / 2 + t / 2), -(W / 2 + t), -(D / 2 + t / 2)], left: [-(W / 2 + t / 2), -D / 2, -(W / 2 + t / 2), D / 2], right: [W / 2 + t / 2, D / 2, W / 2 + t / 2, -D / 2] };
      return ['front', 'back', 'left', 'right'].map((k) => { const [ax, az, bx, bz] = S[k]; return { ax, az, bx, bz, side: k, t, h, on: p['wall' + k[0].toUpperCase() + k.slice(1)] !== false }; });
    },
    build(p, lib, ctx) {
      const g = new THREE.Group(), parts = new Parts(), W = p.width, D = p.depth, t = p.thickness / 1000, wm = finishMat(p.finish, p.colour);
      let wallArea = 0, nOpen = 0;
      TYPES.room.segments(p).forEach((s, i) => {
        if (!s.on) return;
        const ops = [...(ctx.rel?.openings?.[i] || [])], L = Math.hypot(s.bx - s.ax, s.bz - s.az), ux = (s.bx - s.ax) / L, uz = (s.bz - s.az) / L, ang = Math.atan2(-uz, ux);
        const both = p.door === s.side && p.window === s.side;
        const fit = (kind, params, at) => {
          const def = TYPES[kind], o = def.opening(params);
          const u = clamp(at, t + o.w / 2 + 0.05, L - t - o.w / 2 - 0.05);
          if (L - 2 * t < o.w + 0.1) return;
          ops.push({ s0: u - o.w / 2, s1: u + o.w / 2, bottom: o.bottom, top: o.top });
          const obj = def.build({ ...def.defaults, ...params }, lib, { ...ctx, rel: { t, finish: p.finish, colour: p.colour } }).object;
          obj.position.set(s.ax + ux * u, 0, s.az + uz * u); obj.rotation.y = ang; g.add(obj);
        };
        if (p.door === s.side) fit('door', { width: 0.82, height: 2.04, open: 35, swing: 'in' }, both ? L * 0.27 : L / 2);
        if (p.window === s.side) fit('window', { width: clamp((L - 2 * t) * (both ? 0.36 : 0.5), 0.5, 2.4), height: p.name === 'Bathroom' ? 0.7 : 1.4, sill: p.name === 'Bathroom' ? 1.35 : 0.85, curtains: p.name !== 'Bathroom' && p.name !== 'Kitchen' }, both ? L * 0.68 : L / 2);
        wallArea += wallPieces(parts, s, p.height, t, wm, ops, { skirting: p.skirting });
        nOpen += ops.length;
      });
      const floor = new THREE.Mesh(B(W, 0.012, D).translate(0, 0.006, 0), floorMat(p.floor)); g.add(floor);
      if (p.ceiling) parts.box(plain('#f6f5f2', 0.95), W + 2 * t, 0.08, D + 2 * t, 0, p.height + 0.04, 0);
      parts.into(g);
      if (p.label) {
        const lw = clamp(Math.min(W, D * 3.2) * 0.62, 0.8, 2.8), tex = labelTexture(p.name, `${(W * D).toFixed(1)} m² · ${W.toFixed(1)} × ${D.toFixed(1)} m`);
        const lab = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * 160 / 512).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        lab.position.y = 0.014; lab.renderOrder = 2; lab.userData.glass = true; g.add(lab);
      }
      const area = W * D, value = area * (FITOUT[p.name] || 2600);
      return { object: g, walkable: [floor], footprint: [W + 2 * t, D + 2 * t], stats: editableStats(p, ctx, [
        ['Floor area', m2(area), (v) => { const k = Math.sqrt(v / area); return { width: W * k, depth: D * k }; }], ['Perimeter', `${(2 * (W + D)).toFixed(1)} m`],
        ['Wall area', m2(wallArea)], ['Volume', `${(area * p.height).toFixed(1)} m³`], ['Openings', String(nOpen)], ['Est. fit-out', money(value, ctx.currency)]], { area, value }) };
    },
  },
  partition: {
    defaults: { length: 3, height: 2.7, frame: '#1c1c1c', bays: 3, door: true },
    params: [range('length', 'Length', 0.8, 10, 0.05, 'm'), range('height', 'Height', 1, 4, 0.05, 'm'), range('bays', 'Panels', 1, 10), colour('frame', 'Frame', 'frame'), toggle('door', 'Glass door in the middle')],
    build(p, lib, ctx) {
      const parts = new Parts(), L = p.length, H = p.height, fm = plain(p.frame, 0.45, 0.4), gm = glassMat();
      parts.box(fm, L, 0.04, 0.06, 0, 0.02, 0); parts.box(fm, L, 0.04, 0.06, 0, H - 0.02, 0);
      const n = p.bays, dw = p.door ? Math.min(0.9, L / n) : 0;
      for (let i = 0; i <= n; i++) { const x = -L / 2 + (L * i) / n; parts.box(fm, 0.035, H, 0.05, clamp(x, -L / 2 + 0.0175, L / 2 - 0.0175), H / 2, 0); }
      for (let i = 0; i < n; i++) { const x0 = -L / 2 + (L * i) / n, x1 = x0 + L / n; parts.box(gm, x1 - x0 - 0.035, H - 0.08, 0.01, (x0 + x1) / 2, H / 2, 0); }
      if (dw) { parts.box(fm, 0.02, 0.32, 0.03, dw / 2 - 0.08, 1.05, 0.03); parts.box(fm, 0.02, 0.32, 0.03, dw / 2 - 0.08, 1.05, -0.03); }
      return { object: parts.into(), footprint: [L, 0.2], stats: editableStats(p, ctx, [['Length', m(L), (v) => ({ length: v })], ['Height', m(H), (v) => ({ height: v })], ['Glass', m2(L * H)]]) };
    },
  },
  halfwall: {
    defaults: { length: 2.4, height: 1.05, thickness: 150, finish: 'plaster', colour: '#f4f1ea', cap: 'oak', glass: false },
    params: [range('length', 'Length', 0.4, 10, 0.05, 'm'), range('height', 'Height', 0.4, 1.6, 0.05, 'm'), range('thickness', 'Thickness', 50, 400, 10, 'mm'), choice('finish', 'Finish', FINISHES), colour('colour', 'Paint', 'paint'), choice('cap', 'Capping', [['oak', 'Oak'], ['stone', 'Stone'], ['none', 'None']]), toggle('glass', 'Glass balustrade above')],
    build(p, lib, ctx) {
      const parts = new Parts(), L = p.length, t = p.thickness / 1000, H = p.height;
      parts.box(finishMat(p.finish, p.colour), L, H, t, 0, H / 2, 0);
      if (p.cap !== 'none') parts.box(p.cap === 'oak' ? textured('oak', '#ffffff', 0.5) : textured('marble', '#ffffff', 0.2), L + 0.03, 0.035, t + 0.04, 0, H + 0.0175, 0);
      if (p.glass) { parts.box(glassMat(), L, 0.9, 0.012, 0, H + 0.035 + 0.45, 0); parts.box(steel(), L, 0.03, 0.04, 0, H + 0.95, 0); }
      return { object: parts.into(), footprint: [L, t + 0.1], stats: editableStats(p, ctx, [['Length', m(L), (v) => ({ length: v })], ['Height', m(H), (v) => ({ height: v })], ['Area', m2(L * H)]]) };
    },
  },
  column: {
    defaults: { shape: 'square', size: 350, height: 2.7, finish: 'plaster', colour: '#f4f1ea' },
    params: [choice('shape', 'Shape', [['square', 'Square'], ['round', 'Round']]), range('size', 'Size', 120, 900, 10, 'mm'), range('height', 'Height', 2, 6, 0.05, 'm'), choice('finish', 'Finish', FINISHES), colour('colour', 'Paint', 'paint')],
    build(p, lib, ctx) {
      const parts = new Parts(), s = p.size / 1000, mat = finishMat(p.finish, p.colour);
      if (p.shape === 'round') parts.cyl(mat, s / 2, s / 2, p.height, 0, p.height / 2, 0, { seg: 32 }); else parts.box(mat, s, p.height, s, 0, p.height / 2, 0);
      return { object: parts.into(), footprint: [s + 0.1, s + 0.1], stats: editableStats(p, ctx, [['Size', `${p.size} mm`, (v) => ({ size: v < 2 ? v * 1000 : v })], ['Height', m(p.height), (v) => ({ height: v })]]) };
    },
  },
  platform: {
    defaults: { width: 4, depth: 3, thickness: 0.15, floor: 'oak', nosing: true },
    params: [range('width', 'Width', 0.4, 20, 0.05, 'm'), range('depth', 'Depth', 0.4, 20, 0.05, 'm'), range('thickness', 'Thickness', 0.01, 3, 0.01, 'm'), choice('floor', 'Finish', FLOORS), toggle('nosing', 'Edge nosing')],
    build(p, lib, ctx) {
      const g = new THREE.Group(), parts = new Parts(), T = p.thickness;
      const top = new THREE.Mesh(B(p.width, 0.012, p.depth).translate(0, T - 0.006, 0), floorMat(p.floor)); g.add(top);
      if (T > 0.02) parts.box(plain('#e9e6df', 0.9), p.width, T - 0.012, p.depth, 0, (T - 0.012) / 2, 0);
      if (p.nosing && T > 0.04) parts.box(plain('#1c1c1c', 0.5, 0.4), p.width + 0.004, 0.012, 0.03, 0, T - 0.006, p.depth / 2 - 0.013);
      parts.into(g);
      return { object: g, walkable: [top], footprint: [p.width, p.depth], stats: editableStats(p, ctx, [['Area', m2(p.width * p.depth), (v) => { const k = Math.sqrt(v / (p.width * p.depth)); return { width: p.width * k, depth: p.depth * k }; }], ['Top at', m(T), (v) => ({ thickness: v })]]) };
    },
  },
  stairs: {
    defaults: { width: 1, rise: 2.8, steps: 15, style: 'closed', finish: 'oak', rail: 'glass', stringer: '#f3f3f1' },
    params: [range('width', 'Width', 0.6, 2.4, 0.05, 'm'), range('rise', 'Total rise', 0.4, 4.5, 0.05, 'm'), range('steps', 'Steps', 2, 24), choice('style', 'Style', [['closed', 'Closed'], ['open', 'Open risers'], ['float', 'Floating']]), choice('finish', 'Treads', [['oak', 'Oak'], ['concrete', 'Concrete'], ['white', 'White'], ['marble', 'Marble']]), choice('rail', 'Balustrade', [['glass', 'Glass'], ['steel', 'Steel rail'], ['none', 'None']]), colour('stringer', 'Stringer', 'lacquer')],
    build(p, lib, ctx) {
      const parts = new Parts(), n = p.steps, r = p.rise / n, go = 0.27, run = go * n, W = p.width;
      const tm = { oak: textured('oak', '#ffffff', 0.5), concrete: textured('concrete', '#e3e1dc', 0.7), white: plain('#f4f3ef', 0.6), marble: textured('marble', '#ffffff', 0.2) }[p.finish];
      const sm = plain(p.stringer, 0.6);
      for (let i = 0; i < n; i++) {
        const y = r * (i + 1), z = run / 2 - go * (i + 0.5);
        if (p.style === 'closed') parts.box(sm, W, y - 0.04, go, 0, (y - 0.04) / 2, z);
        parts.box(tm, W, 0.04, go + 0.02, 0, y - 0.02, z);
      }
      const len = Math.hypot(run, p.rise), ang = Math.atan2(p.rise, run);
      if (p.style !== 'closed') for (const sx of p.style === 'float' ? [-W / 2 - 0.02] : [-W / 2 - 0.02, W / 2 + 0.02]) parts.box(sm, 0.04, 0.28, len, sx, p.rise / 2 - 0.1, 0, { rx: ang });
      if (p.rail !== 'none') {
        const side = W / 2 + 0.03;
        if (p.rail === 'glass') parts.box(glassMat(), 0.012, 0.95, len, side, p.rise / 2 + 0.55, 0, { rx: ang });
        else for (let i = 0; i <= n; i += 3) { const y = r * (i + 1), z = run / 2 - go * (i + 0.5); parts.box(steel(), 0.025, 0.95, 0.025, side, y + 0.47, z); }
        parts.box(p.rail === 'glass' ? steel() : plain('#1c1c1c', 0.5, 0.5), 0.045, 0.045, len, side, p.rise / 2 + 1.02, 0, { rx: ang });
      }
      const pitch = THREE.MathUtils.radToDeg(Math.atan(r / go));
      return { object: parts.into(), footprint: [W + 0.1, run], stats: editableStats(p, ctx, [['Steps', String(n), (v) => ({ steps: Math.round(v) })], ['Riser', `${Math.round(r * 1000)} mm`, (v) => ({ steps: Math.round(p.rise / (v > 2 ? v / 1000 : v)) })], ['Going', `${go * 1000} mm`], ['Pitch', `${pitch.toFixed(0)}°`], ['Run', m(run)], ['Rise', m(p.rise), (v) => ({ rise: v })]]) };
    },
  },
  roof: {
    defaults: { style: 'gable', width: 10, depth: 8, pitch: 30, overhang: 0.45, eaves: 2.7, material: 'tiles', colour: '#3b3f44', gables: '#f4f1ea' },
    params: [choice('style', 'Style', [['gable', 'Gable'], ['hip', 'Hip'], ['skillion', 'Skillion'], ['flat', 'Flat']]), range('width', 'Width', 2, 30, 0.1, 'm'), range('depth', 'Depth', 2, 30, 0.1, 'm'), range('pitch', 'Pitch', 3, 60, 1, '°'), range('overhang', 'Overhang', 0, 1.2, 0.05, 'm'), range('eaves', 'Eaves height', 1, 12, 0.05, 'm'),
      choice('material', 'Roofing', [['tiles', 'Tiles'], ['metal', 'Standing seam'], ['membrane', 'Membrane']]), colour('colour', 'Roof colour', 'roof'), colour('gables', 'Gable ends', 'paint')],
    build(p, lib, ctx) {
      const g = new THREE.Group(), parts = new Parts(), W = p.width, D = p.depth, ov = p.overhang, E = p.eaves, th = deg(p.style === 'flat' ? 0 : p.pitch), tan = Math.tan(th);
      const rm = p.material === 'tiles' ? textured('rooftiles', p.colour, 0.8) : p.material === 'metal' ? textured('seams', p.colour, 0.38, 0.6) : plain(p.colour, 0.9);
      const fascia = plain('#f3f3f1', 0.6), wall = plain(p.gables, 0.9);
      let ridge = E, area = 0;
      if (p.style === 'gable' || p.style === 'skillion') {
        const span = p.style === 'gable' ? D / 2 : D, rise = span * tan; ridge = E + rise;
        const L = (span + ov) / Math.cos(th), yMid = E + rise - ((span + ov) / 2) * tan;
        const sides = p.style === 'gable' ? [1, -1] : [1];
        for (const s of sides) {
          parts.box(rm, W + 2 * ov, 0.06, L, 0, yMid + 0.03, p.style === 'gable' ? s * (span + ov) / 2 : ov / 2, { rx: s * th });
          parts.box(fascia, W + 2 * ov, 0.2, 0.03, 0, E - ov * tan - 0.08, s * (p.style === 'gable' ? span + ov : D / 2 + ov));
          area += (W + 2 * ov) * L;
        }
        const tri = new THREE.Shape(); if (p.style === 'gable') { tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, rise); } else { tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(D / 2, rise); }
        for (const sx of [-1, 1]) parts.add(wall, new THREE.ExtrudeGeometry(tri, { depth: 0.12, bevelEnabled: false }), { ry: Math.PI / 2, x: sx * W / 2 - 0.06, y: E });
      } else if (p.style === 'hip') {
        const long = W >= D, A = long ? W : D, C = long ? D : W, rise = (C / 2) * tan; ridge = E + rise;
        const ye = E - ov * tan, a = A / 2 + ov, c = C / 2 + ov, rr = Math.max(0, A / 2 - C / 2), yr = E + rise;
        const V = (x, y, z) => (long ? [x, y, z] : [z, y, x]);
        const quads = [[V(-a, ye, c), V(a, ye, c), V(rr, yr, 0), V(-rr, yr, 0)], [V(a, ye, -c), V(-a, ye, -c), V(-rr, yr, 0), V(rr, yr, 0)], [V(a, ye, c), V(a, ye, -c), V(rr, yr, 0), V(rr, yr, 0)], [V(-a, ye, -c), V(-a, ye, c), V(-rr, yr, 0), V(-rr, yr, 0)]];
        const pos = [], uv = [];
        for (const q of quads) for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) for (const v of [q[i], q[j], q[k]]) { pos.push(...v); uv.push(v[0] + v[2] * 0.0, Math.hypot(v[1] - ye, 0) / Math.sin(th || 0.01)); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
        const hipMat = M(`hip:${rm.name}`, () => { const c2 = rm.clone(); c2.side = THREE.DoubleSide; return c2; });
        parts.add(hipMat, geo);
        for (const s of [1, -1]) { parts.box(fascia, 2 * a, 0.2, 0.03, ...(long ? [0, ye - 0.08, s * c] : [s * c, ye - 0.08, 0]), long ? {} : { ry: Math.PI / 2 }); parts.box(fascia, 2 * c, 0.2, 0.03, ...(long ? [s * a, ye - 0.08, 0] : [0, ye - 0.08, s * a]), long ? { ry: Math.PI / 2 } : {}); }
        area = (2 * a) * (2 * c) / Math.cos(th);
      } else {
        parts.box(plain('#d9d7d1', 0.9), W + 2 * ov, 0.3, D + 2 * ov, 0, E + 0.15, 0);
        parts.box(rm, W + 2 * ov - 0.3, 0.02, D + 2 * ov - 0.3, 0, E + 0.31, 0);
        for (const s of [-1, 1]) { parts.box(wall, W + 2 * ov, 0.45, 0.15, 0, E + 0.22, s * (D / 2 + ov - 0.075)); parts.box(wall, 0.15, 0.45, D + 2 * ov, s * (W / 2 + ov - 0.075), E + 0.22, 0); }
        ridge = E + 0.45; area = (W + 2 * ov) * (D + 2 * ov);
      }
      parts.into(g);
      return { object: g, footprint: [W + 2 * ov, D + 2 * ov], stats: editableStats(p, ctx, [['Roof area', m2(area)], ['Ridge height', m(ridge), (v) => ({ pitch: THREE.MathUtils.radToDeg(Math.atan(Math.max(0.05, v - E) / (p.style === 'skillion' ? D : Math.min(W, D) / 2))) })], ['Pitch', `${p.pitch}°`, (v) => ({ pitch: v })], ['Eaves', m(E), (v) => ({ eaves: v })]]) };
    },
  },

  /* ------------------------------ openings: snap into walls, cut their opening */
  door: {
    defaults: { style: 'hinged', width: 0.82, height: 2.04, leaf: '#f3f1ec', frame: '#f3f3f1', hardware: '#1c1c1c', open: 30, hand: 'left', swing: 'in', glazed: false },
    params: [choice('style', 'Type', [['hinged', 'Hinged'], ['double', 'Double'], ['sliding', 'Sliding'], ['pocket', 'Cavity slider'], ['barn', 'Barn']]), range('width', 'Width', 0.6, 2.4, 0.05, 'm'), range('height', 'Height', 1.9, 2.8, 0.01, 'm'),
      colour('leaf', 'Door', 'lacquer'), colour('frame', 'Frame', 'frame'), choice('hardware', 'Handles', [['#1c1c1c', 'Black'], ['#b8925a', 'Brass'], ['#c9ccd0', 'Chrome']]), range('open', 'Open', 0, 100, 5, '%'),
      choice('hand', 'Hinge / slides to', [['left', 'Left'], ['right', 'Right']]), choice('swing', 'Opens', [['in', 'Into the room'], ['out', 'Outward']]), toggle('glazed', 'Glass panels')],
    opening: (p) => ({ w: p.width + 0.09, bottom: 0, top: p.height + 0.045 }),
    build(p, lib, ctx) {
      const g = new THREE.Group(), parts = new Parts(), W = p.width, H = p.height, F = 0.045, t = ctx.rel?.t || 0.11, dep = t + 0.02;
      const fm = plain(p.frame, 0.55), lm = plain(p.leaf, 0.5), hw = plain(p.hardware, 0.3, 0.85), k = p.open / 100, hand = p.hand === 'right' ? -1 : 1;
      parts.box(fm, F, H + F, dep, -W / 2 - F / 2, (H + F) / 2, 0); parts.box(fm, F, H + F, dep, W / 2 + F / 2, (H + F) / 2, 0); parts.box(fm, W + 2 * F, F, dep, 0, H + F / 2, 0);
      for (const s of [-1, 1]) {                                                        // architraves on both faces
        const z = s * (dep / 2 + 0.006);
        parts.box(fm, 0.07, H + 0.08, 0.012, -W / 2 - F - 0.025, (H + 0.08) / 2, z); parts.box(fm, 0.07, H + 0.08, 0.012, W / 2 + F + 0.025, (H + 0.08) / 2, z); parts.box(fm, W + 2 * F + 0.12, 0.07, 0.012, 0, H + F + 0.035, z);
      }
      const leaf = (w, x0, dir) => {                                                    // a leaf hinged at x0, extending dir (+1/−1)
        const lp = new Parts(), lt = 0.04;
        if (p.glazed) {
          lp.box(lm, 0.11, H - 0.01, lt, dir * 0.055, H / 2, 0); lp.box(lm, 0.11, H - 0.01, lt, dir * (w - 0.055), H / 2, 0);
          lp.box(lm, w - 0.22, 0.11, lt, dir * w / 2, 0.06, 0); lp.box(lm, w - 0.22, 0.11, lt, dir * w / 2, H - 0.065, 0); lp.box(lm, w - 0.22, 0.06, lt, dir * w / 2, H * 0.42, 0);
          lp.box(glassMat(), w - 0.22, H - 0.24, 0.008, dir * w / 2, H / 2, 0);
        } else {
          lp.box(lm, w - 0.006, H - 0.01, lt, dir * w / 2, H / 2, 0);
          for (const s of [-1, 1]) for (const [y0, y1] of [[0.18, H * 0.45], [H * 0.52, H - 0.18]]) lp.box(lm, w - 0.24, y1 - y0, 0.006, dir * w / 2, (y0 + y1) / 2, s * (lt / 2 + 0.003));
        }
        for (const s of [-1, 1]) { lp.cyl(hw, 0.026, 0.026, 0.012, dir * (w - 0.07), 1.0, s * 0.026, { rx: Math.PI / 2 }); lp.box(hw, 0.13, 0.018, 0.018, dir * (w - 0.07 - 0.055), 1.0, s * 0.045); }
        const pivot = lp.into(); pivot.position.x = x0; return pivot;
      };
      const inward = p.swing === 'in' ? 1 : -1;                                          // the room side is local −z
      if (p.style === 'hinged' || p.style === 'double') {
        const leaves = p.style === 'double' ? [[-W / 2, 1, W / 2], [W / 2, -1, W / 2]] : [[-hand * W / 2, hand, W]];
        for (const [x0, dir, w] of leaves) { const l = leaf(w, x0, dir); l.rotation.y = dir * inward * k * Math.PI / 2; g.add(l); }
      } else {
        const over = p.style === 'barn' ? 0.12 : 0.03, w = W + over, z = p.style === 'pocket' ? 0 : -(dep / 2 + 0.03);
        const l = leaf(w, -w / 2, 1); l.position.set(-w / 2 - hand * k * W * 0.92, 0, z); g.add(l);
        if (p.style === 'barn') { parts.box(plain('#1c1c1c', 0.4, 0.8), 2 * W + 0.3, 0.05, 0.02, -hand * W / 2, H + 0.12, z - 0.01); for (const s of [-1, 1]) parts.cyl(plain('#1c1c1c', 0.4, 0.8), 0.04, 0.04, 0.03, -w / 2 - hand * k * W * 0.92 + w / 2 + s * w * 0.35, H + 0.12, z, { rx: Math.PI / 2 }); }
        if (p.style === 'sliding') parts.box(fm, 2 * W + 0.1, 0.06, 0.06, -hand * W / 2, H + 0.08, z);
      }
      parts.box(plain('#8d8a84', 0.5, 0.3), W, 0.012, dep, 0, 0.006, 0);                     // threshold
      parts.into(g);
      return { object: g, footprint: [W + 0.25, Math.max(dep, 0.3)], stats: editableStats(p, ctx, [['Clear width', m(W), (v) => ({ width: v })], ['Height', m(H), (v) => ({ height: v })], ['In a wall', ctx.rel ? 'Yes' : 'No: drag onto a wall']]) };
    },
  },
  window: {
    defaults: { style: 'casement', width: 1.6, height: 1.4, sill: 0.85, panes: 2, frame: '#1c1c1c', open: 0, curtains: true, curtain: '#e8e1d4', ledge: true },
    params: [choice('style', 'Type', [['casement', 'Casement'], ['sliding', 'Sliding'], ['fixed', 'Picture'], ['awning', 'Awning']]), range('width', 'Width', 0.4, 6, 0.05, 'm'), range('height', 'Height', 0.3, 2.8, 0.05, 'm'), range('sill', 'Sill height', 0, 1.8, 0.05, 'm'), range('panes', 'Panes', 1, 8),
      colour('frame', 'Frame', 'frame'), range('open', 'Open', 0, 100, 5, '%'), toggle('curtains', 'Curtains'), colour('curtain', 'Curtain', 'fabric'), toggle('ledge', 'Inside sill')],
    opening: (p) => ({ w: p.width, bottom: p.sill, top: p.sill + p.height }),
    build(p, lib, ctx) {
      const g = new THREE.Group(), parts = new Parts(), W = p.width, H = p.height, y0 = p.sill, F = 0.055, dep = 0.07, t = ctx.rel?.t || 0.11, fm = plain(p.frame, 0.5, 0.2);
      parts.box(fm, W, F, dep, 0, y0 + H - F / 2, 0); parts.box(fm, W, F, dep, 0, y0 + F / 2, 0); parts.box(fm, F, H - 2 * F, dep, -W / 2 + F / 2, y0 + H / 2, 0); parts.box(fm, F, H - 2 * F, dep, W / 2 - F / 2, y0 + H / 2, 0);
      const iw = W - 2 * F, ih = H - 2 * F, n = p.style === 'sliding' ? Math.max(2, p.panes) : p.panes, pw = iw / n, k = p.open / 100;
      for (let i = 0; i < n; i++) {
        const cx = -iw / 2 + pw * (i + 0.5);
        if (i) parts.box(fm, 0.04, ih, dep * 0.9, -iw / 2 + pw * i, y0 + H / 2, 0);
        const sash = new Parts(), sf = p.style === 'fixed' ? 0.0 : 0.035;
        if (sf) { sash.box(fm, pw - 0.01, sf, 0.045, 0, ih / 2 - sf / 2, 0); sash.box(fm, pw - 0.01, sf, 0.045, 0, -ih / 2 + sf / 2, 0); sash.box(fm, sf, ih - 2 * sf, 0.045, -pw / 2 + sf / 2 + 0.005, 0, 0); sash.box(fm, sf, ih - 2 * sf, 0.045, pw / 2 - sf / 2 - 0.005, 0, 0); }
        sash.box(glassMat(), pw - 0.02 - 2 * sf, ih - 0.02 - 2 * sf, 0.008, 0, 0, 0);
        const s = sash.into();
        if (p.style === 'awning' && k) { const piv = new THREE.Group(); piv.position.set(cx, y0 + F + ih, 0.02); s.position.y = -ih / 2; piv.add(s); piv.rotation.x = k * deg(35); g.add(piv); }
        else if (p.style === 'casement' && k && i === n - 1) { const piv = new THREE.Group(); piv.position.set(cx + pw / 2, y0 + H / 2, 0.02); s.position.x = -pw / 2; piv.add(s); piv.rotation.y = -k * deg(75); g.add(piv); }
        else { s.position.set(cx + (p.style === 'sliding' && i % 2 ? -k * pw * 0.9 : 0), y0 + H / 2, p.style === 'sliding' ? (i % 2 ? 0.022 : -0.022) : 0); g.add(s); }
      }
      if (p.ledge) { parts.box(plain('#f3f1ec', 0.5), W + 0.1, 0.025, t / 2 + 0.05, 0, y0 - 0.0125, -(t / 2 + 0.05) / 2); parts.box(plain('#cfcac1', 0.6), W + 0.08, 0.03, t / 2 + 0.07, 0, y0 - 0.04, (t / 2 + 0.07) / 2); }
      if (p.curtains) {
        const fm2 = fabric(p.curtain), top = y0 + H + 0.15, cw = Math.max(0.35, W * 0.3), z = -(t / 2 + 0.13);
        parts.cyl(plain('#1c1c1c', 0.4, 0.7), 0.012, 0.012, W + 0.8, 0, top, z, { rz: Math.PI / 2, seg: 10 });
        for (const s of [-1, 1]) parts.add(fm2, curtainGeo(cw, top - 0.03, 5), { x: s * (W / 2 + 0.4 - cw / 2), y: (top - 0.01) / 2 + 0.01, z: z + 0.01 });
      }
      parts.into(g);
      return { object: g, footprint: [W + (p.curtains ? 0.8 : 0.1), 0.4], stats: editableStats(p, ctx, [['Glazed area', m2(iw * ih)], ['Width', m(W), (v) => ({ width: v })], ['Head height', m(y0 + H), (v) => ({ height: Math.max(0.3, v - y0) })], ['Sill', m(y0), (v) => ({ sill: v })]]) };
    },
  },
  arch: {
    defaults: { width: 1.2, height: 2.3, arched: true },
    params: [range('width', 'Width', 0.6, 5, 0.05, 'm'), range('height', 'Height', 1.9, 3.6, 0.05, 'm'), toggle('arched', 'Round top')],
    opening: (p) => ({ w: p.width, bottom: 0, top: p.height }),
    build(p, lib, ctx) {
      const parts = new Parts(), W = p.width, H = p.height, t = ctx.rel?.t || 0.11;
      if (p.arched) {
        const rise = Math.min(W / 2, H - 1.8), sh = new THREE.Shape();
        sh.moveTo(-W / 2, H); sh.lineTo(-W / 2, H - rise); sh.absellipse(0, H - rise, W / 2, rise, Math.PI, 0, true); sh.lineTo(W / 2, H); sh.lineTo(-W / 2, H);
        parts.add(finishMat(ctx.rel?.finish || 'plaster', ctx.rel?.colour || '#f4f1ea'), new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 24 }), { z: -t / 2 });
      }
      if (!ctx.rel) { parts.box(plain('#f4f1ea', 0.9), 0.1, H, 0.11, -W / 2 - 0.05, H / 2, 0); parts.box(plain('#f4f1ea', 0.9), 0.1, H, 0.11, W / 2 + 0.05, H / 2, 0); }
      return { object: parts.into(), footprint: [W + 0.2, 0.3], stats: editableStats(p, ctx, [['Width', m(W), (v) => ({ width: v })], ['Height', m(H), (v) => ({ height: v })]]) };
    },
  },

  /* ------------------------------ furniture (procedural, parametric) */
  sofa: {
    defaults: { seats: 3, chaise: 'none', colour: '#cdbfa8', legs: '#2a2a2a', depth: 0.95 },
    params: [range('seats', 'Seats', 1, 5), choice('chaise', 'Chaise', [['none', 'None'], ['left', 'Left'], ['right', 'Right']]), range('depth', 'Depth', 0.8, 1.2, 0.05, 'm'), colour('colour', 'Fabric', 'fabric'), colour('legs', 'Legs', 'timber')],
    build(p, lib, ctx) {
      const parts = new Parts(), sw = 0.72, arm = 0.18, W = p.seats * sw + 2 * arm, D = p.depth, fm = fabric(p.colour), lm = plain(p.legs, 0.5, 0.2);
      parts.rbox(fm, W, 0.24, D, 0.05, 0, 0.27, 0);                                        // base
      parts.rbox(fm, W, 0.42, 0.2, 0.08, 0, 0.6, -D / 2 + 0.1);                             // back
      for (const s of [-1, 1]) parts.rbox(fm, arm, 0.34, D, 0.06, s * (W / 2 - arm / 2), 0.5, 0);
      for (let i = 0; i < p.seats; i++) { const x = -W / 2 + arm + sw * (i + 0.5); parts.rbox(fm, sw - 0.02, 0.14, D - 0.24, 0.06, x, 0.45, 0.08); parts.rbox(fm, sw - 0.06, 0.38, 0.16, 0.07, x, 0.68, -D / 2 + 0.27, { rx: -0.18 }); }
      if (p.chaise !== 'none') { const s = p.chaise === 'left' ? -1 : 1, cw = sw + 0.06, x = s * (W / 2 - arm - cw / 2); parts.rbox(fm, cw, 0.38, 0.8, 0.06, x, 0.27, D / 2 + 0.4); parts.rbox(fm, cw - 0.04, 0.12, 0.78, 0.05, x, 0.45, D / 2 + 0.4); }
      for (const [x, z] of [[-W / 2 + 0.08, -D / 2 + 0.08], [W / 2 - 0.08, -D / 2 + 0.08], [-W / 2 + 0.08, D / 2 - 0.08], [W / 2 - 0.08, D / 2 - 0.08]]) parts.cyl(lm, 0.02, 0.015, 0.15, x, 0.075, z);
      return { object: parts.into(), footprint: [W, D + (p.chaise !== 'none' ? 0.8 : 0)], stats: editableStats(p, ctx, [['Width', m(W)], ['Seats', String(p.seats), (v) => ({ seats: Math.round(v) })]]) };
    },
  },
  armchair: {
    defaults: { colour: '#9c8f7c', legs: '#a87b4f' },
    params: [colour('colour', 'Fabric', 'fabric'), colour('legs', 'Legs', 'timber')],
    build(p) { const b = TYPES.sofa.build({ ...TYPES.sofa.defaults, seats: 1, depth: 0.85, colour: p.colour, legs: p.legs }, null, { currency: 'NZD' }); b.stats = []; return b; },
  },
  bed: {
    defaults: { size: 'queen', headboard: 'upholstered', linen: '#f2efe8', throw: '#9c8f7c', frame: '#a87b4f' },
    params: [choice('size', 'Size', [['single', 'Single'], ['double', 'Double'], ['queen', 'Queen'], ['king', 'King'], ['superking', 'Super king']]), choice('headboard', 'Headboard', [['upholstered', 'Upholstered'], ['timber', 'Timber'], ['panel', 'Wall panel'], ['none', 'None']]), colour('linen', 'Linen', 'fabric'), colour('throw', 'Throw', 'fabric'), colour('frame', 'Frame', 'timber')],
    build(p, lib, ctx) {
      const parts = new Parts(), [W, L] = { single: [0.92, 1.88], double: [1.38, 1.88], queen: [1.53, 2.03], king: [1.83, 2.03], superking: [2.03, 2.03] }[p.size];
      const fr = textured('oak', p.frame, 0.6), lin = fabric(p.linen), z0 = -L / 2;
      parts.box(fr, W + 0.08, 0.26, L + 0.06, 0, 0.17, 0.02); parts.rbox(fabric('#f6f4ef'), W, 0.24, L, 0.04, 0, 0.42, 0.02);
      parts.rbox(lin, W + 0.04, 0.08, L * 0.72, 0.035, 0, 0.56, z0 + L * 0.28 + L * 0.36 + 0.02);
      parts.rbox(fabric(p.throw), W + 0.1, 0.03, 0.5, 0.012, 0, 0.6, L / 2 - 0.3);
      const nP = W > 1.2 ? 2 : 1; for (let i = 0; i < nP; i++) { const x = nP === 1 ? 0 : (i ? 1 : -1) * W / 4; parts.rbox(lin, W / nP - 0.1, 0.16, 0.42, 0.07, x, 0.62, z0 + 0.3, { rx: -0.35 }); parts.rbox(fabric(p.throw), W / nP - 0.3, 0.13, 0.3, 0.06, x, 0.62, z0 + 0.52, { rx: -0.25 }); }
      if (p.headboard === 'upholstered') parts.rbox(fabric(p.throw), W + 0.16, 1.05, 0.12, 0.05, 0, 0.6, z0 - 0.04);
      else if (p.headboard === 'timber') parts.box(fr, W + 0.16, 1.0, 0.05, 0, 0.55, z0 - 0.025);
      else if (p.headboard === 'panel') { parts.box(textured('boards', p.frame, 0.6), W + 1.6, 1.25, 0.03, 0, 0.62, z0 - 0.03); }
      return { object: parts.into(), footprint: [W + 0.16, L + 0.12], stats: editableStats(p, ctx, [['Mattress', `${Math.round(W * 100)} × ${Math.round(L * 100)} cm`], ['Sleeps', W > 1.2 ? '2' : '1']]) };
    },
  },
  cabinet: {
    defaults: { width: 0.5, height: 0.55, depth: 0.42, drawers: 2, colour: '#a87b4f', legs: true, lamp: false },
    params: [range('width', 'Width', 0.3, 3, 0.05, 'm'), range('height', 'Height', 0.3, 1.4, 0.05, 'm'), range('depth', 'Depth', 0.3, 0.7, 0.05, 'm'), range('drawers', 'Drawers', 0, 6), colour('colour', 'Finish', 'lacquer'), toggle('legs', 'Legs'), toggle('lamp', 'Table lamp on top')],
    build(p, lib, ctx) {
      const parts = new Parts(), W = p.width, H = p.height, D = p.depth, leg = p.legs ? 0.12 : 0, fm = plain(p.colour, 0.5), y0 = leg;
      parts.box(fm, W, H - leg, D, 0, y0 + (H - leg) / 2, 0);
      const n = Math.max(1, p.drawers), dh = (H - leg - 0.02) / n;
      for (let i = 0; i < n; i++) { parts.box(fm, W - 0.02, dh - 0.008, 0.012, 0, y0 + 0.01 + dh * (i + 0.5), D / 2 + 0.006); parts.box(plain('#b8925a', 0.3, 0.9), Math.min(0.16, W * 0.3), 0.012, 0.02, 0, y0 + 0.01 + dh * (i + 0.5) + dh * 0.2, D / 2 + 0.02); }
      if (leg) for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.cyl(plain('#2a2a2a', 0.5, 0.5), 0.015, 0.012, leg, x * (W / 2 - 0.04), leg / 2, z * (D / 2 - 0.04));
      const g = parts.into();
      if (p.lamp) { const l = new Parts(); l.cyl(plain('#d9d4cb', 0.4), 0.05, 0.07, 0.3, W * 0.25, H + 0.15, 0); l.cyl(fabric('#f3eee4'), 0.11, 0.15, 0.2, W * 0.25, H + 0.38, 0, { open: true, seg: 24 }); l.into(g); pointLight(g, '#ffd9a8', 1.2, W * 0.25, H + 0.36, 0, 3); }
      return { object: g, footprint: [W, D], stats: editableStats(p, ctx, [['Width', m(W), (v) => ({ width: v })], ['Height', m(H), (v) => ({ height: v })], ['Drawers', String(p.drawers), (v) => ({ drawers: Math.round(v) })]]) };
    },
  },
  wardrobe: {
    defaults: { length: 2.4, height: 2.4, depth: 0.6, doors: 'hinged', colour: '#f3f1ec', handles: '#1c1c1c' },
    params: [range('length', 'Length', 0.6, 6, 0.05, 'm'), range('height', 'Height', 1.8, 3, 0.05, 'm'), range('depth', 'Depth', 0.45, 0.75, 0.05, 'm'), choice('doors', 'Doors', [['hinged', 'Hinged'], ['sliding', 'Sliding'], ['mirror', 'Mirrored sliding'], ['open', 'Open (rails)']]), colour('colour', 'Finish', 'lacquer'), choice('handles', 'Handles', [['#1c1c1c', 'Black'], ['#b8925a', 'Brass'], ['none', 'Push to open']])],
    build(p, lib, ctx) {
      const parts = new Parts(), L = p.length, H = p.height, D = p.depth, fm = plain(p.colour, 0.45);
      parts.box(fm, L, H, 0.02, 0, H / 2, -D / 2 + 0.01); parts.box(fm, L, 0.02, D, 0, H - 0.01, 0); parts.box(fm, L, 0.08, D, 0, 0.04, 0);
      for (const s of [-1, 1]) parts.box(fm, 0.02, H, D, s * (L / 2 - 0.01), H / 2, 0);
      const n = Math.max(2, Math.round(L / (p.doors === 'hinged' ? 0.5 : 1.1)));
      if (p.doors === 'open') {
        parts.cyl(steel(), 0.012, 0.012, L - 0.04, 0, H - 0.35, 0, { rz: Math.PI / 2, seg: 10 });
        const r = rng(Math.round(L * 100)); for (let i = 0; i < Math.round(L * 7); i++) parts.box(fabric(PALETTES.fabric[Math.floor(r() * 8)]), 0.04, 0.7 + r() * 0.5, 0.5, -L / 2 + 0.1 + i * (L - 0.2) / (L * 7), H - 0.35 - (0.35 + r() * 0.25), 0);
        parts.box(fm, L - 0.04, 0.02, D - 0.02, 0, H * 0.32, 0);
      } else for (let i = 0; i < n; i++) {
        const w = L / n, x = -L / 2 + w * (i + 0.5), z = D / 2 + (p.doors === 'hinged' ? 0.01 : i % 2 ? 0.035 : 0.01);
        parts.box(p.doors === 'mirror' ? mirrorMat() : fm, w - 0.006, H - 0.1, 0.02, x, H / 2 + 0.04, z);
        if (p.handles !== 'none' && p.doors !== 'mirror') parts.box(plain(p.handles, 0.3, 0.85), 0.015, 0.4, 0.02, x + (p.doors === 'hinged' ? (i % 2 ? -1 : 1) * (w / 2 - 0.05) : 0), 1.05, z + 0.02);
      }
      return { object: parts.into(), footprint: [L, D + 0.05], stats: editableStats(p, ctx, [['Length', m(L), (v) => ({ length: v })], ['Hanging', `${(L * 0.85).toFixed(1)} m of rail`], ['Storage', `${(L * H * D).toFixed(1)} m³`]]) };
    },
  },
  bookshelf: {
    defaults: { length: 1.8, height: 2.1, colour: '#a87b4f', books: true, back: true },
    params: [range('length', 'Length', 0.4, 6, 0.05, 'm'), range('height', 'Height', 0.6, 3, 0.05, 'm'), colour('colour', 'Timber', 'timber'), toggle('books', 'Books and objects'), toggle('back', 'Back panel')],
    build(p, lib, ctx) {
      const parts = new Parts(), L = p.length, H = p.height, D = 0.32, fm = textured('oak', p.colour, 0.6), shelves = Math.max(2, Math.round(H / 0.36)), bays = Math.max(1, Math.round(L / 0.8));
      for (let i = 0; i <= shelves; i++) parts.box(fm, L, 0.025, D, 0, 0.0125 + (H - 0.025) * i / shelves, 0);
      for (let i = 0; i <= bays; i++) parts.box(fm, 0.025, H, D, clamp(-L / 2 + L * i / bays, -L / 2 + 0.0125, L / 2 - 0.0125), H / 2, 0);
      if (p.back) parts.box(plain('#e9e4da', 0.9), L, H, 0.01, 0, H / 2, -D / 2 + 0.005);
      const g = parts.into();
      if (p.books) {
        const r = rng(Math.round(L * 1000 + H * 10)), bookCol = ['#7a3b2e', '#2e4a5f', '#c9b48e', '#3b4a3a', '#d8cfc0', '#1f1f22', '#8a6a52', '#b5734f', '#5a6b7c'], books = new Parts();
        for (let s = 0; s < shelves; s++) {
          const y = 0.025 + (H - 0.025) * s / shelves, sh = (H - 0.025) / shelves - 0.04;
          let x = -L / 2 + 0.03;
          while (x < L / 2 - 0.08) {
            if (r() < 0.12) { x += 0.12 + r() * 0.2; continue; }
            const w = 0.018 + r() * 0.03, h = sh * (0.62 + r() * 0.3);
            books.box(plain(bookCol[Math.floor(r() * bookCol.length)], 0.8), w, h, 0.18 + r() * 0.06, x + w / 2, y + h / 2, 0.01);
            x += w + 0.002;
          }
        }
        books.into(g);
      }
      return { object: g, footprint: [L, D], stats: editableStats(p, ctx, [['Length', m(L), (v) => ({ length: v })], ['Shelves', String(shelves * bays)], ['Shelf run', `${(L * shelves).toFixed(1)} m`]]) };
    },
  },
  kitchen: {
    defaults: { length: 3.6, colour: '#f3f1ec', top: '#f2f0eb', uppers: true, tall: true, appliances: true, handles: 'none' },
    params: [range('length', 'Length', 1.2, 8, 0.05, 'm'), colour('colour', 'Cabinets', 'lacquer'), colour('top', 'Benchtop', 'stone'), toggle('uppers', 'Wall cabinets'), toggle('tall', 'Fridge and oven column'), toggle('appliances', 'Sink, tap and cooktop'), choice('handles', 'Handles', [['none', 'Handle-less'], ['#1c1c1c', 'Black'], ['#b8925a', 'Brass']])],
    build(p, lib, ctx) {
      const parts = new Parts(), L = p.length, D = 0.6, fm = plain(p.colour, 0.4), tm = p.top === '#f2f0eb' ? textured('marble', '#ffffff', 0.2) : plain(p.top, 0.35);
      const tallW = p.tall ? 0.62 : 0, base = L - tallW, bx = -L / 2 + base / 2;
      parts.box(plain('#2a2a2a', 0.8), base, 0.12, D - 0.08, bx, 0.06, -0.04);                    // plinth, recessed
      parts.box(fm, base, 0.72, D - 0.02, bx, 0.48, -0.01);
      parts.box(tm, base + 0.02, 0.04, D + 0.02, bx, 0.86, 0.01);
      const n = Math.max(1, Math.round(base / 0.6)), dw = base / n;
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + dw * (i + 0.5), drawers = i === Math.floor(n / 2);
        if (drawers) for (let k = 0; k < 3; k++) parts.box(fm, dw - 0.006, 0.232, 0.018, x, 0.24 + 0.24 * k, D / 2 + 0.008);
        else parts.box(fm, dw - 0.006, 0.71, 0.018, x, 0.48, D / 2 + 0.008);
        if (p.handles !== 'none') parts.box(plain(p.handles, 0.3, 0.85), Math.min(0.3, dw * 0.5), 0.012, 0.02, x, 0.78, D / 2 + 0.03);
      }
      if (p.appliances) {
        const sx = bx - base * 0.18, hx = bx + base * 0.25;
        parts.box(steel(), 0.72, 0.015, 0.44, sx, 0.875, 0.02); parts.box(plain('#2b2d30', 0.4, 0.6), 0.66, 0.012, 0.38, sx, 0.877, 0.02);
        parts.cyl(steel(), 0.016, 0.02, 0.32, sx, 1.04, -0.24); parts.box(steel(), 0.02, 0.02, 0.2, sx, 1.2, -0.15);
        parts.box(blackGlass(), 0.6, 0.008, 0.52, hx, 0.884, 0.01);
        parts.box(blackGlass(), 0.58, 0.58, 0.012, hx, 0.47, D / 2 + 0.02);
      }
      parts.box(tm, base, p.uppers ? 0.58 : 0.4, 0.015, bx, 0.88 + (p.uppers ? 0.29 : 0.2), -D / 2 + 0.008);
      if (p.uppers) { parts.box(fm, base, 0.72, 0.35, bx, 1.46 + 0.36, -D / 2 + 0.175); for (let i = 0; i < n; i++) parts.box(fm, dw - 0.006, 0.71, 0.018, -L / 2 + dw * (i + 0.5), 1.82, -D / 2 + 0.36); parts.box(glow('#ffe3b8', 1.4), base - 0.04, 0.01, 0.03, bx, 1.455, -D / 2 + 0.32); }
      if (p.tall) { const tx = L / 2 - tallW / 2; parts.box(fm, tallW, 2.3, D, tx, 1.15, 0); parts.box(fm, tallW - 0.006, 1.4, 0.018, tx, 1.55, D / 2 + 0.008); parts.box(blackGlass(), tallW - 0.04, 0.58, 0.014, tx, 0.53, D / 2 + 0.012); parts.box(plain('#2a2a2a', 0.8), tallW, 0.12, D - 0.08, tx, 0.06, -0.04); }
      return { object: parts.into(), footprint: [L, D + 0.05], stats: editableStats(p, ctx, [['Length', m(L), (v) => ({ length: v })], ['Bench run', m(base)], ['Cabinets', String(n + (p.uppers ? n : 0) + (p.tall ? 1 : 0))], ['Est. cost', money(L * 4200, ctx.currency)]]) };
    },
  },
  island: {
    defaults: { length: 2.4, depth: 1, colour: '#4c5b52', top: '#f2f0eb', waterfall: true, stools: 3, stool: '#a87b4f' },
    params: [range('length', 'Length', 1, 5, 0.05, 'm'), range('depth', 'Depth', 0.6, 1.6, 0.05, 'm'), colour('colour', 'Cabinets', 'lacquer'), colour('top', 'Top', 'stone'), toggle('waterfall', 'Waterfall ends'), range('stools', 'Stools', 0, 6), colour('stool', 'Stools', 'timber')],
    build(p, lib, ctx) {
      const parts = new Parts(), L = p.length, D = p.depth, fm = plain(p.colour, 0.45), tm = p.top === '#f2f0eb' ? textured('marble', '#ffffff', 0.2) : plain(p.top, 0.35);
      parts.box(plain('#2a2a2a', 0.8), L - (p.waterfall ? 0.1 : 0), 0.12, D - 0.38, 0, 0.06, -0.12);
      parts.box(fm, L - (p.waterfall ? 0.1 : 0), 0.74, D - 0.3, 0, 0.49, -0.14);
      parts.box(tm, L, 0.05, D, 0, 0.885, 0);
      if (p.waterfall) for (const s of [-1, 1]) parts.box(tm, 0.05, 0.86, D, s * (L / 2 - 0.025), 0.43, 0);
      for (let i = 0; i < p.stools; i++) { const x = -L / 2 + 0.25 + (L - 0.5) * (p.stools === 1 ? 0.5 : i / (p.stools - 1)); stool(parts, p.stool, x, D / 2 + 0.25); }
      return { object: parts.into(), footprint: [L, D + (p.stools ? 0.5 : 0)], stats: editableStats(p, ctx, [['Length', m(L), (v) => ({ length: v })], ['Bench area', m2(L * D)], ['Seats', String(p.stools), (v) => ({ stools: Math.round(v) })]]) };
    },
  },
  dining: {
    defaults: { seats: 6, shape: 'rect', top: '#a87b4f', chair: '#cdbfa8', frame: '#4f3a2a' },
    params: [range('seats', 'Seats', 2, 12), choice('shape', 'Table', [['rect', 'Rectangular'], ['round', 'Round']]), colour('top', 'Table top', 'timber'), colour('chair', 'Seat fabric', 'fabric'), colour('frame', 'Chair frame', 'timber')],
    build(p, lib, ctx) {
      const parts = new Parts(), n = p.seats, tm = textured('oak', p.top, 0.45);
      let W, D;
      if (p.shape === 'round') {
        const R = clamp(n * 0.62 / (2 * Math.PI), 0.45, 1.1); W = D = 2 * R;
        parts.cyl(tm, R, R, 0.04, 0, 0.74, 0, { seg: 48 }); parts.cyl(plain('#2a2a2a', 0.5, 0.4), 0.06, 0.06, 0.7, 0, 0.36, 0); parts.cyl(plain('#2a2a2a', 0.5, 0.4), 0.3, 0.32, 0.03, 0, 0.015, 0, { seg: 32 });
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; chair(parts, p, Math.sin(a) * (R + 0.32), Math.cos(a) * (R + 0.32), a + Math.PI); }
      } else {
        const per = Math.ceil((n - (n > 4 ? 2 : 0)) / 2); W = Math.max(0.9, per * 0.62 + 0.3); D = 0.95;
        parts.box(tm, W, 0.04, D, 0, 0.74, 0);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.box(textured('oak', p.top, 0.5), 0.07, 0.72, 0.07, x * (W / 2 - 0.08), 0.36, z * (D / 2 - 0.08));
        for (let i = 0; i < per; i++) { const x = -W / 2 + 0.15 + 0.62 * (i + 0.5) + (W - 0.3 - per * 0.62) / 2; chair(parts, p, x, D / 2 + 0.3, Math.PI); if (per + i + 1 <= n - (n > 4 ? 2 : 0)) chair(parts, p, x, -D / 2 - 0.3, 0); }
        if (n > 4) { chair(parts, p, -W / 2 - 0.3, 0, Math.PI / 2); chair(parts, p, W / 2 + 0.3, 0, -Math.PI / 2); }
      }
      return { object: parts.into(), footprint: [W + 1.2, D + 1.2], stats: editableStats(p, ctx, [['Seats', String(n), (v) => ({ seats: Math.round(v) })], ['Table', p.shape === 'round' ? `${Math.round(W * 100)} cm across` : `${Math.round(W * 100)} × ${Math.round(D * 100)} cm`]]) };
    },
  },
  chair: {
    defaults: { chair: '#cdbfa8', frame: '#4f3a2a' },
    params: [colour('chair', 'Seat fabric', 'fabric'), colour('frame', 'Frame', 'timber')],
    build(p) { const parts = new Parts(); chair(parts, p, 0, 0, 0); return { object: parts.into(), footprint: [0.5, 0.55], stats: [] }; },
  },
  desk: {
    defaults: { width: 1.4, depth: 0.7, colour: '#a87b4f', legs: '#1c1c1c', chair: true, monitor: true, lamp: true },
    params: [range('width', 'Width', 0.8, 3, 0.05, 'm'), range('depth', 'Depth', 0.5, 0.9, 0.05, 'm'), colour('colour', 'Top', 'timber'), colour('legs', 'Legs', 'metal'), toggle('chair', 'Chair'), toggle('monitor', 'Monitor'), toggle('lamp', 'Desk lamp')],
    build(p, lib, ctx) {
      const parts = new Parts(), W = p.width, D = p.depth, lm = plain(p.legs, 0.4, 0.6);
      parts.box(textured('oak', p.colour, 0.5), W, 0.035, D, 0, 0.735, 0);
      for (const s of [-1, 1]) { parts.box(lm, 0.04, 0.72, 0.04, s * (W / 2 - 0.05), 0.36, -D / 2 + 0.06); parts.box(lm, 0.04, 0.72, 0.04, s * (W / 2 - 0.05), 0.36, D / 2 - 0.06); }
      if (p.monitor) { parts.box(blackGlass(), 0.62, 0.36, 0.02, 0, 1.03, -D / 2 + 0.16); parts.box(lm, 0.04, 0.2, 0.04, 0, 0.84, -D / 2 + 0.13); parts.box(lm, 0.22, 0.012, 0.16, 0, 0.758, -D / 2 + 0.15); parts.box(plain('#d9d9dc', 0.5), 0.42, 0.012, 0.13, 0, 0.758, 0.08); }
      const g = parts.into();
      if (p.lamp) { const l = new Parts(); l.cyl(lm, 0.07, 0.07, 0.015, W / 2 - 0.16, 0.76, -D / 2 + 0.14); l.cyl(lm, 0.008, 0.008, 0.42, W / 2 - 0.16, 0.97, -D / 2 + 0.14); l.cyl(lm, 0.03, 0.07, 0.1, W / 2 - 0.2, 1.18, -D / 2 + 0.2, { rx: 0.5, open: true }); l.into(g); pointLight(g, '#ffdcae', 1, W / 2 - 0.2, 1.12, -D / 2 + 0.25, 2.5); }
      if (p.chair) { const c = new Parts(); chair(c, { chair: '#2e3138', frame: '#1c1c1c' }, 0, D / 2 + 0.25, Math.PI); c.into(g); }
      return { object: g, footprint: [W, D + (p.chair ? 0.6 : 0)], stats: editableStats(p, ctx, [['Width', m(W), (v) => ({ width: v })], ['Depth', m(D), (v) => ({ depth: v })]]) };
    },
  },
  coffee: {
    defaults: { shape: 'round', size: 0.9, top: '#d9d4cb' },
    params: [choice('shape', 'Shape', [['round', 'Round'], ['rect', 'Rectangular']]), range('size', 'Size', 0.5, 1.6, 0.05, 'm'), colour('top', 'Top', 'stone')],
    build(p) {
      const parts = new Parts(), S = p.size, tm = p.top === '#f2f0eb' ? textured('marble', '#ffffff', 0.2) : plain(p.top, 0.45);
      if (p.shape === 'round') { parts.cyl(tm, S / 2, S / 2, 0.05, 0, 0.36, 0, { seg: 48 }); parts.cyl(tm, S * 0.3, S * 0.32, 0.34, 0, 0.17, 0, { seg: 40 }); }
      else { parts.box(tm, S * 1.4, 0.05, S * 0.7, 0, 0.36, 0); for (const s of [-1, 1]) parts.box(tm, 0.06, 0.34, S * 0.7, s * (S * 0.7 - 0.03), 0.17, 0); }
      return { object: parts.into(), footprint: [p.shape === 'round' ? S : S * 1.4, p.shape === 'round' ? S : S * 0.7], stats: [] };
    },
  },
  tv: {
    defaults: { inches: 65, mount: 'wall', height: 1.25, console: true, colour: '#7a5a3e', on: true },
    params: [range('inches', 'Screen', 32, 98, 1, '"'), choice('mount', 'Mount', [['wall', 'On the wall'], ['stand', 'On a stand']]), range('height', 'Centre height', 0.7, 2, 0.05, 'm'), toggle('console', 'Media console'), colour('colour', 'Console', 'lacquer'), toggle('on', 'Screen on')],
    mount: true,
    build(p, lib, ctx) {
      const parts = new Parts(), diag = p.inches * 0.0254, sw = diag * 0.8716, sh = diag * 0.4903, y = p.mount === 'wall' ? p.height : 0.62 + sh / 2, z = p.mount === 'wall' ? 0.03 : 0;
      parts.box(blackGlass(), sw + 0.01, sh + 0.01, 0.03, 0, y, z);
      if (p.on) parts.box(glow('#29415e', 0.9), sw - 0.01, sh - 0.01, 0.002, 0, y, z + 0.016);
      if (p.mount === 'stand') { parts.box(blackGlass(), 0.3, 0.012, 0.2, 0, 0.56, 0); parts.box(blackGlass(), 0.05, 0.08, 0.03, 0, 0.6, 0); }
      if (p.console) { const cw = Math.max(1.6, sw + 0.4); parts.box(plain(p.colour, 0.5), cw, 0.42, 0.42, 0, 0.26, 0.21 + (p.mount === 'wall' ? 0 : -0.21)); parts.box(plain('#2a2a2a', 0.6), cw - 0.1, 0.05, 0.36, 0, 0.025, 0.21 + (p.mount === 'wall' ? 0 : -0.21)); }
      return { object: parts.into(), footprint: [Math.max(sw, 1.6), 0.45], stats: editableStats(p, ctx, [['Screen', `${p.inches}"`, (v) => ({ inches: Math.round(v) })], ['Picture', `${Math.round(sw * 100)} × ${Math.round(sh * 100)} cm`]]) };
    },
  },
  fireplace: {
    defaults: { width: 1.6, style: 'stone', lit: true },
    params: [range('width', 'Width', 0.9, 3.2, 0.05, 'm'), choice('style', 'Surround', [['stone', 'Stone'], ['plaster', 'Plaster'], ['black', 'Black steel']]), toggle('lit', 'Fire lit')],
    mount: true,
    build(p) {
      const g = new THREE.Group(), parts = new Parts(), W = p.width, sm = p.style === 'stone' ? textured('marble', '#e9e4da', 0.4) : p.style === 'black' ? plain('#1c1c1c', 0.5, 0.6) : plain('#f1ede5', 0.9);
      parts.box(sm, W, 1.1, 0.36, 0, 0.55, 0.18); parts.box(plain('#141414', 0.9), W * 0.55, 0.55, 0.3, 0, 0.4, 0.22); parts.box(sm, W + 0.2, 0.06, 0.44, 0, 1.13, 0.2); parts.box(sm, W + 0.4, 0.05, 0.6, 0, 0.025, 0.3);
      if (p.lit) { parts.box(glow('#ff8a2e', 3), W * 0.4, 0.14, 0.12, 0, 0.22, 0.25); pointLight(g, '#ff9040', 2.5, 0, 0.4, 0.6, 4); }
      parts.into(g);
      return { object: g, footprint: [W + 0.4, 0.6], stats: [] };
    },
  },
  rug: {
    defaults: { width: 2.4, depth: 1.7, colour: '#d8cfc0', pattern: 'border', round: false },
    params: [range('width', 'Width', 0.6, 6, 0.05, 'm'), range('depth', 'Depth', 0.6, 5, 0.05, 'm'), colour('colour', 'Colour', 'rug'), choice('pattern', 'Pattern', [['plain', 'Plain'], ['border', 'Border'], ['stripes', 'Stripes'], ['grid', 'Grid']]), toggle('round', 'Round')],
    build(p, lib, ctx) {
      const key = `rug:${p.colour}:${p.pattern}:${p.round}`;
      const mat = M(key, () => {
        const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), base = new THREE.Color(p.colour), dark = base.clone().multiplyScalar(0.72).getStyle(), light = base.clone().lerp(new THREE.Color('#ffffff'), 0.35).getStyle();
        g.fillStyle = base.getStyle(); g.fillRect(0, 0, 256, 256);
        if (p.pattern === 'border') { g.strokeStyle = dark; g.lineWidth = 14; g.strokeRect(18, 18, 220, 220); g.strokeStyle = light; g.lineWidth = 4; g.strokeRect(36, 36, 184, 184); }
        if (p.pattern === 'stripes') for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? dark : light; g.fillRect(0, i * 32 + 10, 256, 8); }
        if (p.pattern === 'grid') { g.strokeStyle = dark; g.lineWidth = 3; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(i * 256 / 6, 0); g.lineTo(i * 256 / 6, 256); g.moveTo(0, i * 256 / 6); g.lineTo(256, i * 256 / 6); g.stroke(); } }
        speckle(g, 256, 256, rng(7), 3000, ['rgba(0,0,0,.06)', 'rgba(255,255,255,.07)'], 1.4);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        return new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
      });
      const geo = p.round ? new THREE.CylinderGeometry(p.width / 2, p.width / 2, 0.012, 64) : new THREE.BoxGeometry(p.width, 0.012, p.depth);
      const mesh = new THREE.Mesh(geo.translate(0, 0.008, 0), mat);
      const g = new THREE.Group(); g.add(mesh);
      const area = p.round ? Math.PI * (p.width / 2) ** 2 : p.width * p.depth;
      return { object: g, footprint: [p.width, p.round ? p.width : p.depth], stats: editableStats(p, ctx, [['Area', m2(area)], ['Size', p.round ? `${Math.round(p.width * 100)} cm across` : `${Math.round(p.width * 100)} × ${Math.round(p.depth * 100)} cm`]]) };
    },
  },
  art: {
    defaults: { width: 1, height: 0.75, centre: 1.5, scheme: 0, frame: '#1c1c1c' },
    params: [range('width', 'Width', 0.2, 3, 0.05, 'm'), range('height', 'Height', 0.2, 2, 0.05, 'm'), range('centre', 'Centre height', 0.6, 2.6, 0.05, 'm'), range('scheme', 'Artwork', 0, 9), colour('frame', 'Frame', 'frame')],
    mount: true,
    build(p) {
      const parts = new Parts(), W = p.width, H = p.height, y = p.centre;
      const mat = M(`art:${p.scheme}`, () => {
        const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'), r = rng(p.scheme * 131 + 17);
        const sets = [['#e9dcc7', '#c2562f', '#2e4a5f', '#d8a64a'], ['#f2efe8', '#1f1f22', '#b5734f', '#9c8f7c'], ['#d7e0dc', '#3b4a3a', '#7b8c7a', '#e8e1d4'], ['#f4e9e1', '#d9b8a8', '#8a4b3a', '#2e3138']];
        const s = sets[p.scheme % sets.length]; g.fillStyle = s[0]; g.fillRect(0, 0, 320, 240);
        for (let i = 0; i < 7; i++) { g.fillStyle = s[1 + Math.floor(r() * 3)]; g.globalAlpha = 0.65 + r() * 0.35; if (r() < 0.5) { g.beginPath(); g.arc(r() * 320, r() * 240, 20 + r() * 80, 0, Math.PI * 2); g.fill(); } else g.fillRect(r() * 300, r() * 220, 30 + r() * 140, 10 + r() * 90); }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
      });
      parts.box(plain(p.frame, 0.5), W, H, 0.035, 0, y, 0.018);
      parts.box(plain('#f6f4ef', 0.9), W - 0.04, H - 0.04, 0.002, 0, y, 0.036);
      const g = parts.into();
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.14, H - 0.14), mat); pic.position.set(0, y, 0.038); g.add(pic);
      return { object: g, footprint: [W, 0.1], stats: [] };
    },
  },
  pendant: {
    defaults: { style: 'dome', colour: '#1c1c1c', ceiling: 2.7, drop: 0.75, on: true, count: 1 },
    params: [choice('style', 'Shade', [['dome', 'Dome'], ['globe', 'Globe'], ['cylinder', 'Cylinder'], ['linear', 'Linear bar']]), colour('colour', 'Colour', 'metal'), range('ceiling', 'Ceiling height', 2.1, 5, 0.05, 'm'), range('drop', 'Drop', 0.2, 2, 0.05, 'm'), range('count', 'Pendants in a row', 1, 5), toggle('on', 'Light on')],
    build(p) {
      const g = new THREE.Group(), parts = new Parts(), mt = plain(p.colour, 0.35, 0.6), y = p.ceiling - p.drop;
      const xs = Array.from({ length: p.count }, (_, i) => (i - (p.count - 1) / 2) * 0.55);
      if (p.style === 'linear') { parts.box(mt, Math.max(0.9, p.count * 0.55), 0.05, 0.07, 0, y, 0); parts.box(p.on ? glow('#fff1d6', 2) : plain('#f3f1ec'), Math.max(0.9, p.count * 0.55) - 0.04, 0.005, 0.05, 0, y - 0.026, 0); for (const s of [-1, 1]) parts.cyl(mt, 0.003, 0.003, p.drop, s * Math.max(0.9, p.count * 0.55) * 0.4, y + p.drop / 2, 0, { seg: 6 }); if (p.on) pointLight(g, '#ffe6c2', 3, 0, y - 0.2, 0, 6); }
      else for (const x of xs) {
        parts.cyl(mt, 0.05, 0.05, 0.02, x, p.ceiling - 0.01, 0); parts.cyl(plain('#1c1c1c', 0.6), 0.003, 0.003, p.drop, x, y + p.drop / 2, 0, { seg: 6 });
        if (p.style === 'dome') parts.add(M(`dome:${p.colour}`, () => { const c = mt.clone(); c.side = THREE.DoubleSide; return c; }), new THREE.SphereGeometry(0.2, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), { x, y: y - 0.2 });
        if (p.style === 'globe') parts.add(p.on ? glow('#fff3dd', 1.4) : plain('#f4f1ea', 0.3), new THREE.SphereGeometry(0.16, 28, 18), { x, y: y - 0.16 });
        if (p.style === 'cylinder') parts.cyl(M(`cyl:${p.colour}`, () => { const c = mt.clone(); c.side = THREE.DoubleSide; return c; }), 0.09, 0.09, 0.28, x, y - 0.14, 0, { open: true, seg: 24 });
        if (p.style !== 'globe') parts.add(p.on ? glow('#fff1d6', 3) : plain('#f3f1ec'), new THREE.SphereGeometry(0.045, 12, 8), { x, y: y - 0.08 });
        if (p.on) pointLight(g, '#ffe2b8', 2.2 / Math.sqrt(p.count), x, y - 0.15, 0, 6);
      }
      parts.into(g);
      return { object: g, footprint: [Math.max(0.5, p.count * 0.55), 0.5], stats: [] };
    },
  },
  floorlamp: {
    defaults: { style: 'arc', colour: '#c9ccd0', shade: '#f3eee4', on: true },
    params: [choice('style', 'Style', [['arc', 'Arc'], ['tripod', 'Tripod'], ['column', 'Column']]), colour('colour', 'Metal', 'metal'), colour('shade', 'Shade', 'fabric'), toggle('on', 'Light on')],
    build(p) {
      const g = new THREE.Group(), parts = new Parts(), mt = plain(p.colour, 0.3, 0.8), sh = fabric(p.shade);
      let lx = 0, ly = 1.5;
      if (p.style === 'arc') { parts.box(textured('marble', '#ffffff', 0.3), 0.3, 0.06, 0.3, 0, 0.03, 0); const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(1.3, 1.85, 0)); parts.add(mt, new THREE.TubeGeometry(curve, 40, 0.012, 8)); lx = 1.3; ly = 1.7; parts.add(M(`arcshade:${p.colour}`, () => { const c = mt.clone(); c.side = THREE.DoubleSide; return c; }), new THREE.SphereGeometry(0.22, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), { x: lx, y: ly - 0.05 }); }
      else if (p.style === 'tripod') { for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; parts.cyl(textured('oak', '#ffffff', 0.5), 0.012, 0.016, 1.45, Math.sin(a) * 0.17, 0.7, Math.cos(a) * 0.17, { rx: Math.cos(a) * 0.12, rz: -Math.sin(a) * 0.12 }); } parts.cyl(sh, 0.2, 0.25, 0.32, 0, 1.55, 0, { open: true, seg: 28 }); }
      else { parts.cyl(mt, 0.14, 0.14, 0.02, 0, 0.01, 0); parts.cyl(mt, 0.012, 0.012, 1.4, 0, 0.7, 0); parts.cyl(sh, 0.18, 0.18, 0.36, 0, 1.55, 0, { open: true, seg: 28 }); }
      if (p.on) { parts.add(glow('#fff1d6', 2.5), new THREE.SphereGeometry(0.04, 12, 8), { x: lx, y: ly - 0.03 }); pointLight(g, '#ffdcae', 1.8, lx, ly - 0.15, 0, 4); }
      parts.into(g);
      return { object: g, footprint: [p.style === 'arc' ? 1.6 : 0.5, 0.5], stats: [] };
    },
  },
  walllight: {
    defaults: { style: 'updown', colour: '#1c1c1c', mount: 1.8, on: true },
    params: [choice('style', 'Style', [['updown', 'Up / down'], ['globe', 'Globe'], ['picture', 'Picture light']]), colour('colour', 'Colour', 'metal'), range('mount', 'Mounting height', 1, 2.6, 0.05, 'm'), toggle('on', 'Light on')],
    mount: true,
    build(p) {
      const g = new THREE.Group(), parts = new Parts(), mt = plain(p.colour, 0.35, 0.7), y = p.mount;
      if (p.style === 'updown') { parts.cyl(mt, 0.045, 0.045, 0.2, 0, y, 0.07); parts.box(mt, 0.05, 0.05, 0.05, 0, y, 0.025); if (p.on) { parts.cyl(glow('#fff1d6', 2.5), 0.04, 0.04, 0.005, 0, y + 0.1, 0.07); parts.cyl(glow('#fff1d6', 2.5), 0.04, 0.04, 0.005, 0, y - 0.1, 0.07); } }
      else if (p.style === 'globe') { parts.box(mt, 0.1, 0.1, 0.02, 0, y, 0.01); parts.cyl(mt, 0.006, 0.006, 0.12, 0, y, 0.07, { rx: Math.PI / 2 }); parts.add(p.on ? glow('#fff3dd', 1.3) : plain('#f4f1ea', 0.3), new THREE.SphereGeometry(0.09, 20, 14), { y, z: 0.17 }); }
      else { parts.box(mt, 0.5, 0.03, 0.03, 0, y, 0.16); parts.cyl(mt, 0.006, 0.006, 0.16, -0.15, y, 0.08, { rx: Math.PI / 2 }); parts.cyl(mt, 0.006, 0.006, 0.16, 0.15, y, 0.08, { rx: Math.PI / 2 }); if (p.on) parts.box(glow('#fff1d6', 2), 0.46, 0.004, 0.02, 0, y - 0.017, 0.16); }
      if (p.on) pointLight(g, '#ffdcae', 1.1, 0, y, 0.3, 3.5);
      parts.into(g);
      return { object: g, footprint: [0.5, 0.3], stats: [] };
    },
  },

  /* ------------------------------ Blender pieces lifted from the apartment model */
  piece: {
    defaults: { model: 'King bed', scale: 100 },
    params: [range('scale', 'Scale', 50, 150, 5, '%')],
    build(p, lib, ctx) {
      const tpl = lib?.pieces?.get(p.model), g = new THREE.Group();
      if (!tpl) { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6).translate(0, 0.3, 0), plain('#c8c2b5'))); return { object: g, footprint: [0.6, 0.6], stats: [['Missing', p.model]] }; }
      const o = tpl.object.clone(true), k = p.scale / 100; o.scale.setScalar(k); o.rotation.y = tpl.yaw || 0; g.add(o);
      const s = tpl.size.clone().multiplyScalar(k);
      return { object: g, footprint: [s.x, s.z], stats: editableStats(p, ctx, [['Width', m(s.x), (v) => ({ scale: (v / tpl.size.x) * 100 })], ['Depth', m(s.z), (v) => ({ scale: (v / tpl.size.z) * 100 })], ['Height', m(s.y), (v) => ({ scale: (v / tpl.size.y) * 100 })]]) };
    },
  },
};
function chair(parts, p, x, z, ry) {
  const fr = textured('oak', p.frame, 0.5), seat = fabric(p.chair), c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const [px, pz] = at(lx, lz); parts.box(fr, 0.035, 0.45, 0.035, px, 0.225, pz, { ry }); }
  { const [px, pz] = at(0, 0); parts.rbox(seat, 0.46, 0.06, 0.46, 0.02, px, 0.47, pz, { ry }); }
  { const [px, pz] = at(0, -0.22); parts.rbox(seat, 0.44, 0.36, 0.05, 0.02, px, 0.72, pz, { ry, rx: 0 }); }
  for (const lx of [-0.2, 0.2]) { const [px, pz] = at(lx, -0.22); parts.box(fr, 0.03, 0.5, 0.03, px, 0.7, pz, { ry }); }
}
function stool(parts, colour, x, z) {
  const fr = textured('oak', colour, 0.5);
  parts.cyl(fr, 0.19, 0.19, 0.04, x, 0.66, z, { seg: 28 });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; parts.cyl(fr, 0.014, 0.016, 0.66, x + Math.sin(a) * 0.13, 0.33, z + Math.cos(a) * 0.13, { rx: Math.cos(a) * 0.1, rz: -Math.sin(a) * 0.1 }); }
  parts.add(plain('#2a2a2a', 0.4, 0.7), new THREE.TorusGeometry(0.15, 0.008, 6, 24).rotateX(Math.PI / 2), { x, y: 0.25, z });
}
// fill in missing defaults so every param has a value
for (const def of Object.values(TYPES)) def.defaults = def.defaults || {};

/* ---------------------------------------------------------------- catalogue */
const PIECES = [
  // [label in the model, tile label, sub, category]
  ['King bed', 'King bed', 'Blender · upholstered', 'bedroom'], ['Nightstand', 'Nightstand', 'Blender · floating oak', 'bedroom'], ['Bed bench', 'Bed bench', 'Blender', 'bedroom'],
  ['Wardrobe system', 'Wardrobe system', 'Blender · open oak', 'bedroom'], ['Dresser island', 'Dresser island', 'Blender · glass top', 'bedroom'],
  ['Curved sofa', 'Curved sofa', 'Blender · boucle', 'living'], ['Lounge chair', 'Lounge chair', 'Blender · leather', 'living'], ['Coffee table', 'Travertine table', 'Blender', 'living'], ['Side table', 'Side table', 'Blender · travertine', 'living'], ['Media wall', 'Media wall', 'Blender · oak slats', 'living'],
  ['Kitchen run', 'Kitchen run', 'Blender · full kitchen', 'kitchen'], ['Island', 'Stone island', 'Blender', 'kitchen'], ['Dining table', 'Oak table', 'Blender · seats six', 'kitchen'], ['Dining chair', 'Dining chair', 'Blender · oak, linen', 'kitchen'], ['Counter stool', 'Counter stool', 'Blender', 'kitchen'],
  ['Desk', 'Oak desk', 'Blender', 'bedroom'], ['Desk chair', 'Desk chair', 'Blender', 'bedroom'],
  ['Freestanding bath', 'Freestanding bath', 'Blender · stone resin', 'bath'], ['Walk-in shower', 'Walk-in shower', 'Blender · frameless', 'bath'], ['WC', 'Wall-hung WC', 'Blender', 'bath'], ['Double vanity', 'Double vanity', 'Blender · two basins', 'bath'], ['Guest WC', 'Powder room set', 'Blender · WC + vanity', 'bath'], ['Washer and dryer', 'Washer and dryer', 'Blender · stacked', 'bath'],
  ['Fiddle-leaf plant', 'Fiddle-leaf fig', 'Blender · plant', 'decor'], ['Calathea', 'Calathea', 'Blender · plant', 'decor'], ['Herb pot', 'Herb pot', 'Blender', 'decor'], ['Vase', 'Ceramic vase', 'Blender', 'decor'], ['Entry bench', 'Entry bench', 'Blender · coat storage', 'decor'],
];
const piece = ([model, label, sub]) => ({ id: `piece-${model.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, type: 'piece', label, sub, params: { model } });
const pieces = (cat) => PIECES.filter((x) => x[3] === cat).map(piece);

export const CATEGORIES = [
  { id: 'structure', label: 'Walls & structure', tiles: [
    { id: 'wall-interior', type: 'wall', label: 'Interior wall', sub: '110 mm · plaster', params: {} },
    { id: 'wall-exterior', type: 'wall', label: 'Exterior wall', sub: '250 mm · brick', params: { thickness: 250, finish: 'brick', height: 2.8 } },
    { id: 'wall-concrete', type: 'wall', label: 'Concrete wall', sub: '200 mm · board-formed', params: { thickness: 200, finish: 'concrete' } },
    { id: 'wall-timber', type: 'wall', label: 'Timber-clad wall', sub: '140 mm · boards', params: { thickness: 140, finish: 'timber', colour: '#d8c3a5' } },
    { id: 'wall-tiled', type: 'wall', label: 'Tiled wall', sub: '120 mm · porcelain', params: { thickness: 120, finish: 'tile', colour: '#f4f1ea' } },
    { id: 'partition', type: 'partition', label: 'Glass partition', sub: 'Steel frame + door', params: {} },
    { id: 'halfwall', type: 'halfwall', label: 'Half wall', sub: 'Oak capping', params: {} },
    { id: 'balustrade', type: 'halfwall', label: 'Glass balustrade', sub: 'Upstand + glass', params: { height: 0.25, glass: true, cap: 'none' } },
    { id: 'column', type: 'column', label: 'Column', sub: '350 mm square', params: {} },
    { id: 'column-round', type: 'column', label: 'Round column', sub: '400 mm concrete', params: { shape: 'round', size: 400, finish: 'concrete' } },
    { id: 'platform', type: 'platform', label: 'Floor / platform', sub: 'Raised, any finish', params: {} },
    { id: 'slab', type: 'platform', label: 'Upper floor slab', sub: 'Build a storey on it', params: { width: 8, depth: 6, thickness: 2.95, floor: 'oak' } },
    { id: 'stairs', type: 'stairs', label: 'Staircase', sub: 'Closed, glass rail', params: {} },
    { id: 'stairs-float', type: 'stairs', label: 'Floating stairs', sub: 'Open, oak treads', params: { style: 'float', rail: 'steel' } },
    { id: 'roof-gable', type: 'roof', label: 'Gable roof', sub: '30° · tiles', params: {} },
    { id: 'roof-hip', type: 'roof', label: 'Hip roof', sub: '25° · tiles', params: { style: 'hip', pitch: 25 } },
    { id: 'roof-skillion', type: 'roof', label: 'Skillion roof', sub: '10° · standing seam', params: { style: 'skillion', pitch: 10, material: 'metal', colour: '#2c3a4a' } },
    { id: 'roof-flat', type: 'roof', label: 'Flat roof', sub: 'Parapet · membrane', params: { style: 'flat', material: 'membrane', colour: '#6e7478', overhang: 0.2 } },
  ] },
  { id: 'rooms', label: 'Rooms', tiles: [
    { id: 'room-bedroom', type: 'room', label: 'Bedroom', sub: '3.6 × 3.4 m', params: {} },
    { id: 'room-living', type: 'room', label: 'Living room', sub: '5.0 × 4.2 m', params: { name: 'Living', width: 5, depth: 4.2, window: 'back', door: 'front' } },
    { id: 'room-kitchen', type: 'room', label: 'Kitchen', sub: '3.6 × 3.0 m · tile', params: { name: 'Kitchen', width: 3.6, depth: 3, floor: 'tile' } },
    { id: 'room-bathroom', type: 'room', label: 'Bathroom', sub: '2.4 × 2.2 m · tiled', params: { name: 'Bathroom', width: 2.4, depth: 2.2, finish: 'tile', floor: 'tile' } },
    { id: 'room-study', type: 'room', label: 'Study', sub: '2.8 × 2.6 m', params: { name: 'Study', width: 2.8, depth: 2.6, colour: '#a9b4ad' } },
    { id: 'room-dining', type: 'room', label: 'Dining room', sub: '4.0 × 3.6 m', params: { name: 'Dining', width: 4, depth: 3.6 } },
    { id: 'room-openplan', type: 'room', label: 'Open plan', sub: '8 × 6 m · concrete', params: { name: 'Open plan', width: 8, depth: 6, floor: 'concrete', window: 'back' } },
    { id: 'room-laundry', type: 'room', label: 'Laundry', sub: '2.0 × 1.8 m', params: { name: 'Laundry', width: 2, depth: 1.8, floor: 'tile', window: 'none' } },
    { id: 'room-hall', type: 'room', label: 'Hallway', sub: '1.2 × 4.5 m', params: { name: 'Hallway', width: 1.2, depth: 4.5, window: 'none', label: false } },
    { id: 'room-garage', type: 'room', label: 'Garage', sub: '6 × 6 m · block', params: { name: 'Garage', width: 6, depth: 6, finish: 'concrete', floor: 'concrete', window: 'none', thickness: 190 } },
  ] },
  { id: 'openings', label: 'Doors & windows', tiles: [
    { id: 'door-hinged', type: 'door', label: 'Hinged door', sub: '820 mm · panelled', params: {} },
    { id: 'door-double', type: 'door', label: 'Double doors', sub: '1.6 m · glazed', params: { style: 'double', width: 1.6, glazed: true, leaf: '#1d1d1f', frame: '#1c1c1c' } },
    { id: 'door-front', type: 'door', label: 'Front door', sub: '1.0 m · oak', params: { width: 1, height: 2.4, leaf: '#7a5a3e', hardware: '#b8925a', frame: '#1c1c1c', swing: 'in' } },
    { id: 'door-sliding', type: 'door', label: 'Sliding door', sub: 'Glass · black frame', params: { style: 'sliding', width: 1.8, height: 2.4, glazed: true, leaf: '#1d1d1f', frame: '#1c1c1c', open: 40 } },
    { id: 'door-pocket', type: 'door', label: 'Cavity slider', sub: 'Slides into the wall', params: { style: 'pocket', width: 0.86, open: 60 } },
    { id: 'door-barn', type: 'door', label: 'Barn door', sub: 'On a black rail', params: { style: 'barn', width: 1, leaf: '#a87b4f', open: 30 } },
    { id: 'window-casement', type: 'window', label: 'Casement window', sub: '1.6 × 1.4 m', params: {} },
    { id: 'window-sliding', type: 'window', label: 'Sliding window', sub: '2.0 × 1.2 m', params: { style: 'sliding', width: 2, height: 1.2, sill: 1, frame: '#f3f3f1' } },
    { id: 'window-picture', type: 'window', label: 'Picture window', sub: 'Floor to ceiling', params: { style: 'fixed', width: 2.8, height: 2.4, sill: 0.05, panes: 3, curtains: true } },
    { id: 'window-awning', type: 'window', label: 'Awning window', sub: 'High · bathroom', params: { style: 'awning', width: 0.9, height: 0.6, sill: 1.5, panes: 1, curtains: false, open: 40 } },
    { id: 'arch', type: 'arch', label: 'Archway', sub: 'Round-topped opening', params: {} },
    { id: 'opening', type: 'arch', label: 'Wall opening', sub: 'Square, any size', params: { arched: false, width: 1.6, height: 2.4 } },
  ] },
  { id: 'living', label: 'Living', tiles: [
    { id: 'sofa', type: 'sofa', label: 'Sofa', sub: '3 seater', params: {} },
    { id: 'sofa-chaise', type: 'sofa', label: 'Chaise sofa', sub: '3 seater + chaise', params: { chaise: 'right', colour: '#6f7d73' } },
    { id: 'armchair', type: 'armchair', label: 'Armchair', sub: 'Upholstered', params: {} },
    { id: 'coffee', type: 'coffee', label: 'Coffee table', sub: 'Round · stone', params: {} },
    { id: 'tv', type: 'tv', label: 'TV + console', sub: '65" · wall-mounted', params: {} },
    { id: 'bookshelf', type: 'bookshelf', label: 'Bookshelf', sub: 'Oak · with books', params: {} },
    { id: 'fireplace', type: 'fireplace', label: 'Fireplace', sub: 'Stone surround', params: {} },
    { id: 'rug', type: 'rug', label: 'Rug', sub: '2.4 × 1.7 m', params: {} },
    { id: 'rug-round', type: 'rug', label: 'Round rug', sub: '2 m', params: { round: true, width: 2, colour: '#a99c86', pattern: 'plain' } },
    { id: 'art', type: 'art', label: 'Artwork', sub: 'Framed print', params: {} },
    ...pieces('living'),
  ] },
  { id: 'bedroom', label: 'Bedroom & study', tiles: [
    { id: 'bed', type: 'bed', label: 'Bed', sub: 'Queen · any size', params: {} },
    { id: 'bed-single', type: 'bed', label: 'Single bed', sub: 'Timber headboard', params: { size: 'single', headboard: 'timber', linen: '#d7e0dc' } },
    { id: 'nightstand', type: 'cabinet', label: 'Bedside table', sub: 'With lamp', params: { lamp: true } },
    { id: 'dresser', type: 'cabinet', label: 'Chest of drawers', sub: '1.2 m · 4 drawers', params: { width: 1.2, height: 0.85, depth: 0.5, drawers: 4 } },
    { id: 'wardrobe', type: 'wardrobe', label: 'Built-in wardrobe', sub: '2.4 m · hinged', params: {} },
    { id: 'wardrobe-mirror', type: 'wardrobe', label: 'Mirrored wardrobe', sub: 'Sliding', params: { doors: 'mirror' } },
    { id: 'desk', type: 'desk', label: 'Desk set', sub: 'Desk, chair, lamp', params: {} },
    ...pieces('bedroom'),
  ] },
  { id: 'kitchen', label: 'Kitchen & dining', tiles: [
    { id: 'kitchen', type: 'kitchen', label: 'Kitchen', sub: '3.6 m · any length', params: {} },
    { id: 'kitchen-dark', type: 'kitchen', label: 'Dark kitchen', sub: 'Black stone · brass', params: { colour: '#2c3440', top: '#2b2b2c', handles: '#b8925a' } },
    { id: 'island', type: 'island', label: 'Island', sub: 'Waterfall · 3 stools', params: {} },
    { id: 'dining', type: 'dining', label: 'Dining set', sub: 'Table + 6 chairs', params: {} },
    { id: 'dining-round', type: 'dining', label: 'Round dining', sub: 'Table + 4 chairs', params: { shape: 'round', seats: 4 } },
    { id: 'chair', type: 'chair', label: 'Chair', sub: 'Oak and linen', params: {} },
    { id: 'sideboard', type: 'cabinet', label: 'Sideboard', sub: '1.8 m', params: { width: 1.8, height: 0.75, depth: 0.45, drawers: 2, colour: '#7a5a3e' } },
    ...pieces('kitchen'),
  ] },
  { id: 'bath', label: 'Bathroom & laundry', tiles: pieces('bath') },
  { id: 'lighting', label: 'Lighting', tiles: [
    { id: 'pendant', type: 'pendant', label: 'Pendant', sub: 'Dome · lit', params: {} },
    { id: 'pendants-island', type: 'pendant', label: 'Island pendants', sub: '3 globes', params: { style: 'globe', count: 3, colour: '#b8925a', drop: 0.9 } },
    { id: 'pendant-linear', type: 'pendant', label: 'Linear pendant', sub: 'Over a table', params: { style: 'linear', count: 3, drop: 1 } },
    { id: 'floorlamp', type: 'floorlamp', label: 'Arc floor lamp', sub: 'Marble base', params: {} },
    { id: 'floorlamp-tripod', type: 'floorlamp', label: 'Tripod lamp', sub: 'Oak legs', params: { style: 'tripod' } },
    { id: 'walllight', type: 'walllight', label: 'Wall light', sub: 'Up / down', params: {} },
    { id: 'walllight-globe', type: 'walllight', label: 'Globe sconce', sub: 'Brass', params: { style: 'globe', colour: '#b8925a' } },
  ] },
  { id: 'decor', label: 'Plants & decor', tiles: pieces('decor') },
];
export const TILES = new Map(CATEGORIES.flatMap((c) => c.tiles.map((t) => [t.id, { ...t, cat: c.id, params: { ...TYPES[t.type].defaults, ...t.params } }])));
for (const c of CATEGORIES) c.tiles = c.tiles.map((t) => TILES.get(t.id));

/* ---------------------------------------------------------------- relations: openings in walls */
const isHost = (it) => !!TYPES[it.type]?.segments;
function worldSegs(it) {
  const c = Math.cos(it.rot), s = Math.sin(it.rot), tf = (x, z) => [it.x + x * c + z * s, it.z - x * s + z * c];
  return TYPES[it.type].segments(it.params).map((g, i) => {
    const [ax, az] = tf(g.ax, g.az), [bx, bz] = tf(g.bx, g.bz), L = Math.hypot(bx - ax, bz - az);
    return { ...g, i, ax, az, bx, bz, L, ux: (bx - ax) / L, uz: (bz - az) / L, rot: Math.atan2(-(bz - az) / L, (bx - ax) / L) };
  });
}
/** The wall segment nearest to (x, z) at the same level, within `reach(seg)` metres. */
function nearestSeg(x, z, y, hosts, reach) {
  let best = null;
  for (const h of hosts) {
    if (!isHost(h) || Math.abs((h.y || 0) - (y || 0)) > 0.6) continue;
    for (const s of worldSegs(h)) {
      if (!s.on || s.L < 0.05) continue;
      const vx = x - s.ax, vz = z - s.az, u = vx * s.ux + vz * s.uz, side = vx * -s.uz + vz * s.ux, d = Math.abs(side);
      if (u < -0.1 || u > s.L + 0.1 || d > reach(s)) continue;
      if (!best || d < best.d) best = { h, s, u, d, side: Math.sign(side) || 1 };
    }
  }
  return best;
}
function hostOf(o, list) {
  const n = nearestSeg(o.x, o.z, o.y, list.filter((h) => h !== o), (s) => s.t / 2 + 0.06);
  if (!n) return null;
  return Math.abs(Math.cos(o.rot) * n.s.ux - Math.sin(o.rot) * n.s.uz) > 0.96 ? n : null;
}
function relate(it, list) {
  const def = TYPES[it.type];
  if (def.segments) {
    const ops = def.segments(it.params).map(() => []);
    for (const o of list) {
      const od = TYPES[o.type]; if (!od?.opening || o === it) continue;
      const h = hostOf(o, list); if (!h || h.h !== it) continue;
      const op = od.opening({ ...od.defaults, ...o.params });
      ops[h.s.i].push({ s0: +(h.u - op.w / 2).toFixed(3), s1: +(h.u + op.w / 2).toFixed(3), bottom: op.bottom, top: op.top });
    }
    return { openings: ops };
  }
  if (def.opening) { const h = hostOf(it, list); return h ? { t: h.s.t, finish: h.h.params.finish, colour: h.h.params.colour } : null; }
  return undefined;
}
/** Openings snap into the nearest wall; wall-mounted things (TV, art, lights) snap flat onto its face. */
function snap(it, others) {
  const def = TYPES[it.type];
  if (def.opening) {
    const n = nearestSeg(it.x, it.z, it.y, others, () => 0.9); if (!n) return false;
    const w = def.opening({ ...def.defaults, ...it.params }).w, u = n.s.L > w ? clamp(n.u, w / 2, n.s.L - w / 2) : n.s.L / 2;
    it.x = n.s.ax + n.s.ux * u; it.z = n.s.az + n.s.uz * u; it.rot = n.s.rot; it.y = n.h.y || 0; return true;
  }
  if (def.mount && !(it.type === 'tv' && it.params.mount === 'stand')) {
    const n = nearestSeg(it.x, it.z, it.y, others, () => 0.7); if (!n) return false;
    const off = n.s.t / 2 + 0.002, nx = -n.s.uz * n.side, nz = n.s.ux * n.side;
    it.x = n.s.ax + n.s.ux * n.u + nx * off; it.z = n.s.az + n.s.uz * n.u + nz * off; it.rot = n.side > 0 ? n.s.rot : n.s.rot + Math.PI; return true;
  }
  return false;
}

/* ---------------------------------------------------------------- prompt → layout */
const WORDS = [
  [/\b(chaise|corner|l[- ]shaped)\s*sofas?\b/, 'sofa-chaise'], [/\b(sofas?|couch(es)?|lounge suites?)\b/, 'sofa'], [/\barm\s?chairs?\b/, 'armchair'],
  [/\b(night\s?stands?|bedside tables?)\b/, 'nightstand'], [/\bcoffee tables?\b/, 'coffee'], [/\b(round )?dining (tables?|sets?)\b/, 'dining'], [/\bsideboards?\b/, 'sideboard'],
  [/\b(king|queen|double|single)?\s*beds?\b/, 'bed'], [/\b(wardrobes?|closets?)\b/, 'wardrobe'], [/\b(chests? of drawers|dressers?)\b/, 'dresser'], [/\b(desks?|work ?stations?)\b/, 'desk'],
  [/\b(book\s?shel(f|ves)|book\s?cases?)\b/, 'bookshelf'], [/\b(tvs?|televisions?)\b/, 'tv'], [/\bfire\s?places?\b/, 'fireplace'], [/\brugs?\b/, 'rug'], [/\b(artworks?|paintings?|prints?|art)\b/, 'art'],
  [/\b(kitchen (runs?|units?|cabinets?)|kitchens?)\b/, 'kitchen'], [/\bislands?\b/, 'island'], [/\btables?\b/, 'dining'], [/\b(stools?|chairs?)\b/, 'chair'],
  [/\b(bath ?tubs?|baths?)\b/, 'piece-freestanding-bath'], [/\bshowers?\b/, 'piece-walk-in-shower'], [/\b(wcs?|toilets?)\b/, 'piece-wc'], [/\bvanit(y|ies)\b/, 'piece-double-vanity'], [/\b(washers?|washing machines?|dryers?)\b/, 'piece-washer-and-dryer'],
  [/\bplants?\b/, 'piece-fiddle-leaf-plant'], [/\bwall lights?\b/, 'walllight'], [/\b(pendants?|ceiling lights?)\b/, 'pendant'], [/\b(floor lamps?|lamps?)\b/, 'floorlamp'],
  [/\bstair(s|case)?\b/, 'stairs'], [/\bcolumns?\b/, 'column'], [/\bglass partitions?\b/, 'partition'], [/\bwalls?\b/, 'wall-interior'], [/\bdoors?\b/, 'door-hinged'], [/\bwindows?\b/, 'window-casement'],
];
const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, couple: 2, pair: 2, few: 3 };
const countBefore = (text, idx) => { const m = text.slice(Math.max(0, idx - 18), idx).match(/(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|couple of|pair of|few)\s*(?:[a-z-]+\s){0,2}$/); if (!m) return 1; const w = m[1].split(' ')[0]; return Number(w) || NUMS[w] || 1; };
const ROOM_KEYS = [[/\b(master )?bedrooms?\b/, 'Bedroom'], [/\b(living|family|lounge) (room|area)\b|\bliving\b/, 'Living'], [/\bkitchen\b(?! (runs?|units?|cabinets?))/, 'Kitchen'], [/\b(bathroom|ensuite|wet room)\b/, 'Bathroom'], [/\b(study|office)\b/, 'Study'], [/\bdining room\b/, 'Dining'], [/\blaundry\b/, 'Laundry'], [/\bgarage\b/, 'Garage'], [/\bopen[- ]plan\b/, 'Open plan']];
const ROOM_TILE = { Bedroom: 'room-bedroom', Living: 'room-living', Kitchen: 'room-kitchen', Bathroom: 'room-bathroom', Study: 'room-study', Dining: 'room-dining', Laundry: 'room-laundry', Garage: 'room-garage', 'Open plan': 'room-openplan', Hallway: 'room-hall' };

/** Furniture for a room of a given kind and inside size, in room-local coordinates (front = +z). */
function furnish(name, W, D) {
  const out = [], put = (tile, x, z, rot = 0, params = {}) => out.push({ tile, x, z, rot, params });
  const back = -D / 2, front = D / 2;
  if (name === 'Bedroom') {
    const big = W >= 3.2, bw = big ? 1.53 : 1.38, bl = 2.03;
    put('bed', 0, back + bl / 2 + 0.1, 0, { size: big ? 'queen' : 'double' });
    for (const s of [-1, 1]) if (bw / 2 + 0.6 < W / 2) put('nightstand', s * (bw / 2 + 0.33), back + 0.25);
    if (D > 3) put('wardrobe', -W / 2 + 0.31, Math.min(front - 1.3, back + bl + 0.6), Math.PI / 2, { length: clamp(D - 1.6, 1.2, 2.8) });
    put('rug', 0, back + bl * 0.75, 0, { width: Math.min(W - 0.6, bw + 1), depth: 1.6 });
    put('pendant', 0, 0, 0, { style: 'globe' });
  } else if (name === 'Living' || name === 'Open plan') {
    const lx = name === 'Open plan' ? W / 2 - Math.min(4.2, W * 0.45) / 2 : 0, lw = name === 'Open plan' ? Math.min(4.2, W * 0.45) : W;
    put('tv', lx, back + 0.002, 0);
    put('sofa', lx, Math.min(front - 0.7, back + 3.4), Math.PI);
    put('coffee', lx, Math.min(front - 0.7, back + 3.4) - 1.15, 0, { size: 0.8 });
    put('rug', lx, Math.min(front - 0.7, back + 3.4) - 1.0, 0, { width: Math.min(lw - 0.4, 2.6), depth: 2 });
    put('floorlamp', lx + Math.min(lw / 2 - 0.4, 1.6), Math.min(front - 0.5, back + 3.6), Math.PI, { style: 'tripod' });
    if (name === 'Open plan') {
      const kw = Math.min(4.2, W * 0.4);
      put('kitchen', -W / 2 + kw / 2 + 0.05, back + 0.31, 0, { length: kw });
      if (D > 4.5) { put('island', -W / 2 + kw / 2 + 0.05, back + 2.0, Math.PI, { length: Math.min(2.4, kw - 0.4), stools: 3 }); put('pendants-island', -W / 2 + kw / 2 + 0.05, back + 2.0, 0); }
      put('dining', -W / 2 + kw / 2 + 0.05, front - 1.3, 0, { seats: 6 });
    } else put('piece-fiddle-leaf-plant', -W / 2 + 0.4, back + 0.4);
  } else if (name === 'Kitchen') {
    put('kitchen', 0, back + 0.31, 0, { length: clamp(W - 0.3, 1.2, 5) });
    if (D > 3.2 && W > 2.6) put('island', 0, back + 1.9, Math.PI, { length: clamp(W - 1.6, 1.2, 2.6), stools: W > 3.4 ? 3 : 2 });
  } else if (name === 'Dining') { put('dining', 0, 0, 0, { seats: W > 3.6 ? 6 : 4 }); put('pendant-linear', 0, 0, 0); put('sideboard', 0, back + 0.23, 0, { width: Math.min(1.8, W - 0.8) }); }
  else if (name === 'Study') { put('desk', 0, back + 0.36, 0); put('bookshelf', -W / 2 + 0.17, 0.2, Math.PI / 2, { length: Math.min(D - 0.8, 1.8) }); }
  else if (name === 'Bathroom') { put('piece-double-vanity', 0, back + 0.3, 0); if (W > 2) put('piece-walk-in-shower', W / 2 - 0.55, front - 0.6, 0); put('piece-wc', -W / 2 + 0.45, front - 0.5, Math.PI / 2); }
  else if (name === 'Laundry') put('piece-washer-and-dryer', 0, back + 0.35, 0);
  return out;
}

function planInterior(text, anchor) {
  const t = ` ${text.toLowerCase()} `, items = [], said = [];
  const add = (tile, x, z, rot = 0, params = {}) => { const T = TILES.get(tile); if (T) items.push({ tile, type: T.type, params: { ...T.params, ...params }, x: +x.toFixed(2), z: +z.toFixed(2), rot }); };
  const empty = /\b(empty|unfurnished|bare)\b/.test(t);
  const plan = t.match(/\b(\d+|one|two|three|four|five)[- ]?(bed(room)?s?|bhk|br)\b.*?\b(house|home|apartment|flat|unit|villa|plan)?/);
  if (plan && /\b(house|home|apartment|flat|unit|villa|plan|layout)\b/.test(t)) {
    const n = clamp(Number(plan[1]) || NUMS[plan[1]] || 2, 1, 5), t110 = 0.11, rowB = [];
    for (let i = 0; i < n; i++) rowB.push({ name: 'Bedroom', W: i === 0 ? 4 : 3.4, D: 3.6 });
    rowB.push({ name: 'Bathroom', W: 2.6, D: 3.6 });
    if (n >= 3) rowB.push({ name: 'Laundry', W: 1.8, D: 3.6 });
    const total = rowB.reduce((s, r) => s + r.W, 0) + (rowB.length - 1) * t110, DA = 6.4, zB = -(DA / 2 + 3.6 / 2 + t110);
    add('room-openplan', anchor.x, anchor.z, 0, { width: +total.toFixed(2), depth: DA, wallBack: false, door: 'front', window: 'front', floor: 'oak' });
    if (!empty) for (const f of furnish('Open plan', total, DA)) add(f.tile, anchor.x + f.x, anchor.z + f.z, f.rot, f.params);
    let x = anchor.x - total / 2;
    rowB.forEach((r, i) => {
      const cx = x + r.W / 2;
      add(ROOM_TILE[r.name], cx, anchor.z + zB, 0, { width: r.W, depth: r.D, wallLeft: i === 0, door: 'front', window: r.name === 'Laundry' ? 'none' : 'back', label: true, name: r.name });
      if (!empty) for (const f of furnish(r.name, r.W, r.D)) add(f.tile, cx + f.x, anchor.z + zB + f.z, f.rot, f.params);
      x += r.W + t110;
    });
    const roof = /\broof\b/.test(t);
    if (roof) add('roof-hip', anchor.x, anchor.z + (DA / 2 + zB - 3.6 / 2) / 2, 0, { width: +(total + 2 * t110).toFixed(2), depth: +(DA + 3.6 + 3 * t110).toFixed(2), pitch: 22 });
    return { items, summary: `Laid out a ${n}-bedroom plan: open-plan living, kitchen and dining, ${n} bedroom${n > 1 ? 's' : ''}, a bathroom${n >= 3 ? ' and a laundry' : ''}, furnished${roof ? ', under a hip roof' : ''}.` };
  }
  // a single room (furnished unless asked not to), plus anything else that was named
  let roomName = null; for (const [re, name] of ROOM_KEYS) if (re.test(t)) { roomName = name; break; }
  const size = t.match(/(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)/);
  let W = 0, D = 0; const defaults = new Set();
  if (roomName) {
    const T = TILES.get(ROOM_TILE[roomName]); W = size ? clamp(+size[1], 1, 14) : T.params.width; D = size ? clamp(+size[2], 1, 14) : T.params.depth;
    add(ROOM_TILE[roomName], anchor.x, anchor.z, 0, { width: W, depth: D, window: /\bno windows?\b/.test(t) ? 'none' : T.params.window, door: /\bno doors?\b/.test(t) ? 'none' : T.params.door });
    said.push(`a ${W} × ${D} m ${roomName.toLowerCase()}`);
    if (!empty) { const f = furnish(roomName, W, D); for (const x of f) { add(x.tile, anchor.x + x.x, anchor.z + x.z, x.rot, x.params); defaults.add(x.tile); } if (f.length) said.push('furnished'); }
  }
  let rest = t; const picks = [];
  for (const [re, tile] of WORDS) {
    const g = new RegExp(re.source, 'g'); let mm, n = 0;
    while ((mm = g.exec(rest))) n += countBefore(rest, mm.index);
    rest = rest.replace(g, ' ');
    if (!n || defaults.has(tile) || (roomName && /^(wall|door|window)/.test(tile)) || (roomName === 'Kitchen' && tile === 'kitchen')) continue;
    picks.push([tile, Math.min(n, 12), tile === 'bed' ? { size: /\bking\b/.test(t) ? 'king' : /\bsingle\b/.test(t) ? 'single' : /\bdouble\b/.test(t) ? 'double' : 'queen' } : {}]);
  }
  if (picks.length) {
    let x = anchor.x - (roomName ? W / 2 - 0.8 : 2), z = anchor.z + (roomName ? D / 2 - 0.9 : 0);
    for (const [tile, n, params] of picks) for (let i = 0; i < n; i++) { add(tile, x, z, 0, params); x += 1.4; if (x > anchor.x + (roomName ? W / 2 - 0.6 : 2.5)) { x = anchor.x - (roomName ? W / 2 - 0.8 : 2); z -= 1.4; } }
    said.push(picks.map(([k, n]) => `${n > 1 ? n + ' × ' : ''}${TILES.get(k).label.toLowerCase()}`).join(', '));
  }
  return { items, summary: items.length ? `Added ${said.filter(Boolean).join(', ')}.` : '' };
}

/* ---------------------------------------------------------------- library: the apartment's own Blender furniture */
/** Lifts every furnished item out of the apartment model as a reusable piece (sharing its geometry). */
function liftPieces(model) {
  const pieces = new Map(), geometries = new Set(), matCopy = new Map();
  model.traverse((o) => { if (o.isMesh) geometries.add(o.geometry); });
  const realtime = (mat) => {
    if (!matCopy.has(mat)) { const c = mat.clone(); c.lightMap = null; if (!c.transparent) c.envMapIntensity = 0.9; c.needsUpdate = true; matCopy.set(mat, c); }
    return matCopy.get(mat);
  };
  model.traverse((o) => {
    if (o.userData.kind !== 'item' || !o.userData.label) return;
    const label = o.userData.label.replace(/\s\d+$/, '');
    if (pieces.has(label)) return;
    const c = o.clone(true); c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1);
    c.traverse((x) => { if (x.isMesh) x.material = Array.isArray(x.material) ? x.material.map(realtime) : realtime(x.material); });
    const holder = new THREE.Group(); holder.add(c); holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder), centre = box.getCenter(new THREE.Vector3());
    c.position.set(-centre.x, -box.min.y, -centre.z);
    pieces.set(label, { object: holder, size: box.getSize(new THREE.Vector3()), yaw: 0 });
  });
  return { pieces, geometries };
}

/* ---------------------------------------------------------------- image → rooms (floor plan or room photo) */
const ROOM_NAME_LIST = Object.keys(ROOM_TILE);
/** Instructions for Claude to read a floor plan or a room photo into rooms and furniture from this catalogue. */
function imagePrompt(text) {
  const tiles = [...TILES.values()].filter((t) => t.type !== 'room').map((t) => `${t.id} (${t.label})`).join(', ');
  return `You are laying out an interior in a 3D design tool from the attached image. It is either a FLOOR PLAN (drawing, sketch or listing plan) or a PHOTO of a room.
Return ONLY JSON: {"kind":"plan"|"room","summary":"one short sentence","rooms":[...],"items":[...]}
Coordinates are metres, origin at the centre of the layout, x to the right, z downwards in the image (towards the viewer for a photo). rot is radians about the vertical axis; 0 means the item's front faces +z.
rooms: [{"name": one of ${JSON.stringify(ROOM_NAME_LIST)}, "x":0, "z":0, "width": inside width (x) in m, "depth": inside depth (z) in m, "height": ceiling height (2.4-3.2),
  "door": "none"|"front"|"back"|"left"|"right" (front = +z side), "window": same choices, "walls": {"front":true,"back":true,"left":true,"right":true} (set false where two rooms share a wall: keep it on one of them only, or where the plan is open),
  "floor": one of ${JSON.stringify(FLOORS.map((f) => f[0]))}, "finish": one of ${JSON.stringify(FINISHES.map((f) => f[0]))}, "colour": wall paint "#rrggbb"}]
items: furniture and fittings, [{"tile": id, "x", "z", "rot", "params": {}}] using only these tile ids: ${tiles}.
Useful params: sofa {seats, colour}, bed {size: single|double|queen|king}, kitchen {length}, island {length, stools}, dining {seats, shape: rect|round}, rug {width, depth, colour}, wardrobe {length}, bookshelf {length}.
For a floor plan: read the dimensions written on it when present (otherwise assume typical sizes: bedrooms about 3.3 x 3.6 m), lay every room out where it is in the plan with rooms touching (leave about 0.11 m between neighbouring rooms for the wall), and furnish each room sensibly against its walls.
For a room photo: one room sized to what is visible (typically 4-6 m), the wall colour and floor that you see, and the furniture you can see, placed roughly where it is.
${text ? `The user adds: "${text}"` : ''}`;
}
const clampNum = (v, a, b, d) => (Number.isFinite(+v) ? clamp(+v, a, b) : d);
/** Turns Claude's (or the offline reader's) JSON into placeable items, checked against the catalogue. */
function sanitizeImage(raw, anchor) {
  const out = [], hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : d);
  for (const r of (raw?.rooms || []).slice(0, 30)) {
    const name = ROOM_NAME_LIST.includes(r.name) ? r.name : 'Living', T = TILES.get(ROOM_TILE[name]);
    const side = (s, d) => (['none', 'front', 'back', 'left', 'right'].includes(s) ? s : d), w = r.walls || {};
    out.push({ tile: T.id, type: 'room', x: anchor.x + clampNum(r.x, -60, 60, 0), z: anchor.z + clampNum(r.z, -60, 60, 0), rot: 0, params: { ...T.params, name,
      width: +clampNum(r.width, 1, 14, T.params.width).toFixed(2), depth: +clampNum(r.depth, 1, 14, T.params.depth).toFixed(2), height: +clampNum(r.height, 2.1, 4.5, 2.7).toFixed(2),
      door: side(r.door, T.params.door), window: side(r.window, T.params.window), floor: FLOORS.some((f) => f[0] === r.floor) ? r.floor : T.params.floor,
      finish: FINISHES.some((f) => f[0] === r.finish) ? r.finish : T.params.finish, colour: hex(r.colour, T.params.colour),
      wallFront: w.front !== false, wallBack: w.back !== false, wallLeft: w.left !== false, wallRight: w.right !== false } });
  }
  for (const it of (raw?.items || []).slice(0, 200)) {
    const T = TILES.get(it.tile); if (!T || T.type === 'room') continue;
    const defs = TYPES[T.type].params, params = { ...T.params };
    for (const [k, v] of Object.entries(it.params || {})) {
      const d = defs.find((x) => x.key === k); if (!d) continue;
      if (d.type === 'range') params[k] = clampNum(v, d.min, d.max, params[k]);
      else if (d.type === 'choice') { if (d.options.some((o) => String(o[0]) === String(v))) params[k] = v; }
      else if (d.type === 'colour') params[k] = hex(v, params[k]);
      else if (d.type === 'toggle') params[k] = !!v;
    }
    out.push({ tile: T.id, type: T.type, params, x: anchor.x + clampNum(it.x, -60, 60, 0), z: anchor.z + clampNum(it.z, -60, 60, 0), rot: clampNum(it.rot, -7, 7, 0) });
  }
  return out;
}

/** Pixels of an image, scaled so its long side is `side` px. */
function pixels(img, side) {
  const k = side / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height), w = Math.max(8, Math.round((img.naturalWidth || img.width) * k)), h = Math.max(8, Math.round((img.naturalHeight || img.height) * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  return { w, h, d: g.getImageData(0, 0, w, h).data };
}
const lumAt = (d, i) => 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
const satAt = (d, i) => { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };

/** Offline reading: a clean floor plan becomes its rooms (walls shared, doors facing the main room); a photo becomes one matching room. */
function planFromImage(img, anchor) {
  const P = pixels(img, 360), n = P.w * P.h;
  let light = 0, dark = 0, colourful = 0;
  for (let i = 0; i < n; i++) { const l = lumAt(P.d, i), s = satAt(P.d, i); if (l > 200 && s < 0.18) light++; if (l < 100) dark++; if (s > 0.35 && l > 40) colourful++; }
  const plan = light / n > 0.5 && dark / n > 0.015 && colourful / n < 0.2;
  const raw = plan ? readPlan(P) : readPhoto(P);
  if (plan && !raw.rooms.length) return { raw: readPhoto(P), kind: 'room', summary: 'I could not find closed rooms in that plan, so I built one room from its colours.' };
  return { raw, kind: plan ? 'plan' : 'room', summary: raw.summary };
}
function readPlan(P) {
  const { w, h, d } = P, n = w * h, wall = new Uint8Array(n);
  for (let i = 0; i < n; i++) wall[i] = lumAt(d, i) < 150 ? 1 : 0;
  // close door gaps so rooms do not leak into each other
  const r = Math.max(3, Math.round(Math.max(w, h) * 0.035)), grown = new Uint8Array(n);   // about half a door width
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!wall[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) grown[yy * w + xx] = 1; } }
  }
  const label = new Int32Array(n).fill(-1), comps = [];
  const fill = (start, id) => {
    const stack = [start]; label[start] = id; let count = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (stack.length) { const i = stack.pop(), x = i % w, y = (i / w) | 0; count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !grown[j] && label[j] < 0) { label[j] = id; stack.push(j); } }
    return { count, x0, y0, x1, y1 };
  };
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (!grown[i] && label[i] < 0) fill(i, 0); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (!grown[i] && label[i] < 0) fill(i, 0); }
  let id = 1;
  for (let i = 0; i < n; i++) if (!grown[i] && label[i] < 0) {
    const c = fill(i, id++); const bw = c.x1 - c.x0 + 1 + 2 * r, bh = c.y1 - c.y0 + 1 + 2 * r;
    if (c.count > n * 0.004 && c.count / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)) > 0.5) comps.push({ cx: (c.x0 + c.x1) / 2, cy: (c.y0 + c.y1) / 2, bw, bh, px: bw * bh });
  }
  if (!comps.length) return { rooms: [], items: [], summary: '' };
  const areas = comps.map((c) => c.px).sort((a, b) => a - b), median = areas[Math.floor(areas.length / 2)];
  let s = Math.sqrt(12 / median);                                                            // metres per pixel: a typical room is ~12 m²
  const span = Math.max(...comps.map((c) => c.cx + c.bw / 2)) - Math.min(...comps.map((c) => c.cx - c.bw / 2));
  s = clamp(s, 6 / span, 30 / span);
  const mx = (Math.min(...comps.map((c) => c.cx - c.bw / 2)) + Math.max(...comps.map((c) => c.cx + c.bw / 2))) / 2;
  const my = (Math.min(...comps.map((c) => c.cy - c.bh / 2)) + Math.max(...comps.map((c) => c.cy + c.bh / 2))) / 2;
  const rooms = comps.map((c) => ({ x: (c.cx - mx) * s, z: (c.cy - my) * s, width: Math.max(1, c.bw * s - 0.11), depth: Math.max(1, c.bh * s - 0.11) }))
    .sort((a, b) => b.width * b.depth - a.width * a.depth);
  // names by size and shape
  let baths = 0, kitchens = 0;
  rooms.forEach((rm, i) => {
    const a = rm.width * rm.depth, aspect = Math.max(rm.width, rm.depth) / Math.min(rm.width, rm.depth);
    rm.name = i === 0 ? (a > 34 ? 'Open plan' : 'Living') : aspect > 2.6 && Math.min(rm.width, rm.depth) < 1.8 ? 'Hallway' : a < 4.8 ? (baths++ ? 'Laundry' : 'Bathroom') : a < 8 ? 'Study' : (rooms.length >= 5 && !kitchens++ && a < 16 ? 'Kitchen' : 'Bedroom');
  });
  const main = rooms[0], ext = { x0: Math.min(...rooms.map((q) => q.x - q.width / 2)), x1: Math.max(...rooms.map((q) => q.x + q.width / 2)), z0: Math.min(...rooms.map((q) => q.z - q.depth / 2)), z1: Math.max(...rooms.map((q) => q.z + q.depth / 2)) };
  const toward = (rm, tx, tz) => { const dx = tx - rm.x, dz = tz - rm.z; return Math.abs(dx) / rm.width > Math.abs(dz) / rm.depth ? (dx > 0 ? 'right' : 'left') : (dz > 0 ? 'front' : 'back'); };
  for (const rm of rooms) {
    rm.door = rm === main ? 'front' : toward(rm, main.x, main.z);
    const edges = { left: rm.x - rm.width / 2 - ext.x0, right: ext.x1 - (rm.x + rm.width / 2), back: rm.z - rm.depth / 2 - ext.z0, front: ext.z1 - (rm.z + rm.depth / 2) };
    const outside = Object.entries(edges).filter(([k]) => k !== rm.door).sort((a, b) => a[1] - b[1])[0];
    rm.window = rm.name === 'Hallway' || rm.name === 'Laundry' || outside[1] > 0.6 ? 'none' : outside[0];
    rm.walls = { front: true, back: true, left: true, right: true };
  }
  // neighbours share one wall: the later room drops its side (never the side its door is in)
  for (let i = 0; i < rooms.length; i++) for (let j = 0; j < i; j++) {
    const a = rooms[i], b = rooms[j], ovX = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2), ovZ = Math.min(a.z + a.depth / 2, b.z + b.depth / 2) - Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
    const near = (p, q) => Math.abs(p - q) < 0.5;
    if (ovZ > 0.5 && near(a.x - a.width / 2, b.x + b.width / 2) && a.door !== 'left') a.walls.left = false;
    if (ovZ > 0.5 && near(a.x + a.width / 2, b.x - b.width / 2) && a.door !== 'right') a.walls.right = false;
    if (ovX > 0.5 && near(a.z - a.depth / 2, b.z + b.depth / 2) && a.door !== 'back') a.walls.back = false;
    if (ovX > 0.5 && near(a.z + a.depth / 2, b.z - b.depth / 2) && a.door !== 'front') a.walls.front = false;
  }
  const items = [];
  for (const rm of rooms) {
    rm.floor = rm.name === 'Bathroom' || rm.name === 'Laundry' ? 'tile' : 'oak';
    if (rm.name === 'Bathroom') rm.finish = 'tile';
    for (const f of furnish(rm.name, rm.width, rm.depth)) items.push({ tile: f.tile, x: rm.x + f.x, z: rm.z + f.z, rot: f.rot, params: f.params });
  }
  const names = rooms.reduce((m, q) => (m[q.name] = (m[q.name] || 0) + 1, m), {});
  return { rooms, items, summary: `Read the plan offline: ${Object.entries(names).map(([k, v]) => `${v > 1 ? v + ' ' : ''}${k.toLowerCase()}${v > 1 ? 's' : ''}`).join(', ')}, about ${Math.round((ext.x1 - ext.x0) * (ext.z1 - ext.z0))} m², furnished. Sizes are estimated; type a figure on any room to correct it.` };
}
function readPhoto(P) {
  const { w, h, d } = P, avg = (x0, y0, x1, y1) => { let r = 0, g = 0, b = 0, k = 0; for (let y = Math.floor(y0 * h); y < y1 * h; y++) for (let x = Math.floor(x0 * w); x < x1 * w; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; } return new THREE.Color().setRGB(r / k / 255, g / k / 255, b / k / 255, THREE.SRGBColorSpace); };
  const wallC = avg(0.2, 0.12, 0.8, 0.42), floorC = avg(0.1, 0.86, 0.9, 1);
  const near = (c, list) => list.reduce((best, hx) => { const q = new THREE.Color(hx), dd = (q.r - c.r) ** 2 + (q.g - c.g) ** 2 + (q.b - c.b) ** 2; return dd < best[1] ? [hx, dd] : best; }, [list[0], Infinity])[0];
  const hsl = floorC.getHSL({}, THREE.SRGBColorSpace), hue = hsl.h * 360;
  const floor = hsl.s > 0.22 && hue > 12 && hue < 50 ? (hsl.l < 0.32 ? 'walnut' : hsl.l > 0.68 ? 'whitewash' : 'oak') : hsl.s < 0.14 ? (hsl.l > 0.72 ? 'tile' : 'concrete') : 'carpet';
  const colour = near(wallC, PALETTES.paint);
  const room = { name: 'Living', x: 0, z: 0, width: 5, depth: 4.2, door: 'front', window: 'back', floor, colour, finish: 'plaster' };
  const items = furnish('Living', 5, 4.2).map((f) => ({ tile: f.tile, x: f.x, z: f.z, rot: f.rot, params: f.params }));
  const floorName = FLOORS.find((f) => f[0] === floor)[1].toLowerCase();
  return { rooms: [room], items, summary: `Read the photo offline: a 5 × 4.2 m room with ${colour} walls and ${floorName} flooring, furnished as a living room. Edit any figure to match.` };
}

/**
 * The kit for createDesignSidebar(). `getModel()` resolves to the loaded apartment scene (its furniture becomes
 * library pieces). Pass it as `kit` with mount: where the Compose button goes.
 */
export function createInteriorKit({ getModel, mount = 'nav' }) {
  return {
    TYPES, CATEGORIES, TILES, PALETTES, mount, image: true, imagePrompt, sanitizeImage, planFromImage, showY: true, snapStep: 0.05, reach: 7, maxGround: 30, focusMin: 3.5,
    text: {
      button: 'Design', title: 'Interiors', aria: 'Design the interior: walls, rooms, doors, windows and furniture',
      buttonTitle: 'Design the interior: drag walls, rooms, doors, windows, furniture and lights into the apartment, or build a house from scratch',
      placeholder: 'Ask to build or change anything…',
      hint: 'Text or a floor plan / room photo → rooms and furniture', snap: 'Snap 5 cm', place: 'the floor',
      keys: 'Drag a tile into the scene, or click a tile then click the floor (Shift keeps placing). Doors and windows snap into walls and cut them; TVs, art and wall lights stick to walls. Drag items to move · R / Shift+R turn · Shift+scroll fine turn · Ctrl+D duplicate · Delete removes · Esc cancels',
      empty: 'Nothing placed yet. Drag a room, wall or piece of furniture into the scene, or describe one above.',
      noPlan: 'I could not find anything to build in that. Try “a 4 x 3.6 bedroom”, “a 3 bedroom house” or “a sofa, a rug and 2 lamps”.',
      note: 'Click any figure to type your own; sizes, steps and seats reshape the model. Costs are illustrative (dummy data).',
    },
    ctx: (seed) => ({ seed, currency: 'NZD', rate: 3200 }),
    surface: (o, b, size) => size.y < 0.35 && size.x * size.z > 1.5 && b.max.y < 0.6,
    async loadLibrary() {
      const model = await getModel();
      const { pieces, geometries } = liftPieces(model);
      return { pieces, modules: new Map([['apartment', [...geometries].map((geometry) => ({ geometry }))]]) };
    },
    relate, snap, planFromPrompt: planInterior,
    totals(list) {
      let rooms = 0, area = 0, walls = 0, doors = 0, windows = 0, furniture = 0;
      for (const it of list) {
        const p = it.params, d = TYPES[it.type];
        if (it.type === 'room') { rooms++; area += p.width * p.depth; doors += p.door !== 'none' ? 1 : 0; windows += p.window !== 'none' ? 1 : 0; }
        if (d.segments) for (const s of d.segments(p)) if (s.on) walls += Math.hypot(s.bx - s.ax, s.bz - s.az);
        if (it.type === 'platform') area += p.width * p.depth;
        if (it.type === 'door' || it.type === 'arch') doors++;
        if (it.type === 'window') windows++;
        if (!d.segments && !d.opening && !['platform', 'stairs', 'roof', 'partition', 'halfwall', 'column'].includes(it.type)) furniture++;
      }
      return [['Rooms', rooms], ['Floor', `${area.toFixed(0)} m²`], ['Walls', `${walls.toFixed(0)} m`], ['Doors', doors], ['Windows', windows], ['Pieces', furniture]];
    },
    summary(it) {
      const p = it.params;
      return ({ wall: () => `${p.length} m · ${p.thickness} mm`, room: () => `${p.name} · ${p.width} × ${p.depth} m`, door: () => `${p.style} · ${p.width} m`, window: () => `${p.width} × ${p.height} m`, stairs: () => `${p.steps} steps`, roof: () => `${p.style} · ${p.pitch}°`,
        sofa: () => `${p.seats} seats`, bed: () => p.size, dining: () => `${p.seats} seats`, kitchen: () => `${p.length} m`, island: () => `${p.length} m`, piece: () => 'Blender model', platform: () => `${p.width} × ${p.depth} m` }[it.type]?.()) || TILES.get(it.tile)?.sub || '';
    },
  };
}
