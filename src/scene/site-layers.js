/*
 * 3D site layers around a residential development: a flowing river, local roads with traffic, a motorway
 * with moving cars, a flood area at flood level, and solar (winter sun path and rooftop panels).
 * Positions come from spec/site-layers.js so the picture matches the valuation effects.
 */
import * as THREE from 'three';
import { box, merge, std, m4 } from './helpers.js';
import { DEV } from '../spec/site-layout.js';
import { siteFeatures, FLOOD_EVENTS, WINTER_SUN_DEG } from '../spec/site-layers.js';
import { rng } from '../util.js';

const LEN = 700;                         // half-length of the river and motorway along x

/** A flat strip between two z(x) edges, at height y, with u running along x and v across. */
function ribbon(zA, zB, y, x0, x1, step = 4, uPerMetre = 1 / 20) {
  const pos = [], uv = [], idx = [];
  const n = Math.ceil((x1 - x0) / step);
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n;
    pos.push(x, y, zA(x), x, y, zB(x)); uv.push(x * uPerMetre, 0, x * uPerMetre, 1);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const flat = (mesh) => { mesh.userData.noShadow = true; mesh.receiveShadow = true; return mesh; };
const overlay = (m, k = -2) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: k, polygonOffsetUnits: k });

export function buildSiteLayers(layout) {
  const F = siteFeatures(layout);
  const { siteX, siteZ, H } = layout;
  const root = new THREE.Group();
  const groups = {}, tickers = [], labels = [];
  const layer = (id) => { const g = new THREE.Group(); g.name = `layer:${id}`; root.add(g); groups[id] = g; return g; };

  /* ---------- river ---------- */
  {
    const g = layer('river'), w = F.river.width, zc = F.river.zAt;
    const ripple = canvasTex(256, 256, (x, W, Hh) => {
      const r = rng(7); x.fillStyle = '#808080'; x.fillRect(0, 0, W, Hh);
      for (let i = 0; i < 900; i++) { x.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.08 + r() * 0.12})`; x.lineWidth = 1 + r() * 2; const px = r() * W, py = r() * Hh; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + 10, py - 3 + r() * 6, px + 22 + r() * 20, py); x.stroke(); }
    }, [1, 1]);
    ripple.colorSpace = THREE.NoColorSpace;
    const water = new THREE.MeshPhysicalMaterial(overlay({ color: '#3d6f80', roughness: 0.14, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, bumpMap: ripple, bumpScale: 0.35 }, -3));
    g.add(flat(new THREE.Mesh(ribbon((x) => zc(x) - w / 2, (x) => zc(x) + w / 2, 0.05, -LEN, LEN, 4, 1 / 14), water)));
    const streaks = canvasTex(512, 128, (x, W, Hh) => {
      const r = rng(11); x.clearRect(0, 0, W, Hh);
      for (let i = 0; i < 46; i++) { const px = r() * W, py = 8 + r() * (Hh - 16), len = 30 + r() * 90; const gr = x.createLinearGradient(px, 0, px + len, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.35 + r() * 0.4})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.strokeStyle = gr; x.lineWidth = 1.5 + r() * 1.5; x.beginPath(); x.moveTo(px, py); x.lineTo(px + len, py + (r() - 0.5) * 3); x.stroke(); }
    });
    const flow = new THREE.MeshBasicMaterial(overlay({ map: streaks, transparent: true, opacity: 0.55, depthWrite: false }, -4));
    g.add(flat(new THREE.Mesh(ribbon((x) => zc(x) - w / 2 + 1.5, (x) => zc(x) + w / 2 - 1.5, 0.07, -LEN, LEN, 4, 1 / 40), flow)));
    const bankMat = new THREE.MeshStandardMaterial(overlay({ color: '#b9ad8f', roughness: 0.95 }, -2));
    for (const s of [-1, 1]) g.add(flat(new THREE.Mesh(ribbon((x) => zc(x) + s * w / 2, (x) => zc(x) + s * (w / 2 + 3.5), 0.04, -LEN, LEN), bankMat)));
    tickers.push((dt) => { ripple.offset.x -= dt * 0.05; streaks.offset.x -= dt * 0.16; });   // flows east (+x)
    labels.push({ layer: 'river', text: 'River', pos: new THREE.Vector3(siteX / 2 + 40, 3, zc(siteX / 2 + 40)) });
  }

  /* ---------- local roads ---------- */
  const asphalt = std('#383b40', { roughness: 0.92 }), paint = std('#f2efe6', { roughness: 0.6 });
  {
    const g = layer('roads'), R = F.roads, rw = R.width, ext = 40;
    const segs = [
      [-R.side - ext, R.side + ext, R.front, 'x'], [-R.side - ext, R.side + ext, R.back, 'x'],
      [R.back, R.front, -R.side, 'z'], [R.back, R.front, R.side, 'z'],
      [F.motorway.z + F.motorway.width / 2, R.back, -R.side, 'z'], [F.motorway.z + F.motorway.width / 2, R.back, R.side, 'z'],
    ];
    const slabs = [], dashes = [];
    for (const [a, b, c, axis] of segs) {
      const L = b - a, mid = (a + b) / 2;
      slabs.push(axis === 'x' ? box(L, 0.47, rw, mid, 0.235, c) : box(rw, 0.47, L, c, 0.235, mid));
      for (let s = a + 2; s < b - 2; s += 7) dashes.push(axis === 'x' ? box(3, 0.02, 0.18, s, 0.48, c) : box(0.18, 0.02, 3, c, 0.48, s));
    }
    g.add(new THREE.Mesh(merge(slabs), asphalt));
    g.add(flat(new THREE.Mesh(merge(dashes), paint)));
    // a few cars on the front and back roads
    const carGeo = merge([box(4.2, 0.9, 1.8, 0, 0.75, 0), box(2.2, 0.7, 1.6, -0.2, 1.5, 0)]);
    const cars = new THREE.InstancedMesh(carGeo, std('#ffffff', { roughness: 0.35, metalness: 0.4 }), 8);
    const r = rng(23), local = [];
    for (let i = 0; i < 8; i++) {
      const lane = i % 2 ? 1 : -1, onFront = i < 4;
      local.push({ x: -R.side - ext + r() * (2 * R.side + 2 * ext), z: (onFront ? R.front : R.back) + lane * 1.8, dir: lane, speed: 8 + r() * 4, span: R.side + ext });
      cars.setColorAt(i, new THREE.Color().setHSL(r(), 0.35, 0.35 + r() * 0.3));
    }
    g.add(cars);
    const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    tickers.push((dt) => {
      local.forEach((c, i) => { c.x += c.dir * c.speed * dt; if (c.x > c.span) c.x = -c.span; if (c.x < -c.span) c.x = c.span; cars.setMatrixAt(i, m4.compose(p.set(c.x, 0.47, c.z), c.dir > 0 ? q0 : q1, one)); });
      cars.instanceMatrix.needsUpdate = true;
    });
    labels.push({ layer: 'roads', text: 'Local road', pos: new THREE.Vector3(-R.side - 20, 2.5, R.front) });
  }

  /* ---------- motorway ---------- */
  {
    const g = layer('motorway'), mz = F.motorway.z, mw = F.motorway.width, half = mw / 2;
    g.add(new THREE.Mesh(box(2 * LEN, 0.5, mw, 0, 0.25, mz), asphalt));
    const concrete = std('#b9b5ab', { roughness: 0.9 });
    g.add(new THREE.Mesh(merge([box(2 * LEN, 0.9, 0.6, 0, 0.95, mz), box(2 * LEN, 1.1, 0.4, 0, 1.05, mz - half + 0.2), box(2 * LEN, 1.1, 0.4, 0, 1.05, mz + half - 0.2)]), concrete));
    const lane = (half - 1.2) / 3, dashes = [];
    for (const s of [-1, 1]) for (const k of [1, 2]) { const z = mz + s * (0.6 + k * lane); for (let x = -LEN; x < LEN; x += 12) dashes.push(box(4, 0.02, 0.2, x, 0.51, z)); }
    for (const s of [-1, 1]) dashes.push(box(2 * LEN, 0.02, 0.2, 0, 0.51, mz + s * (half - 0.9)));
    g.add(flat(new THREE.Mesh(merge(dashes), paint)));
    // sign gantry
    const sign = canvasTex(512, 128, (x, W, Hh) => { x.fillStyle = '#0f6b3a'; x.fillRect(0, 0, W, Hh); x.strokeStyle = '#fff'; x.lineWidth = 6; x.strokeRect(6, 6, W - 12, Hh - 12); x.fillStyle = '#fff'; x.font = 'bold 56px system-ui, sans-serif'; x.fillText('MOTORWAY  ·  CITY ⟶', 28, 86); });
    const steel = std('#8d939a', { metalness: 0.6, roughness: 0.4 });
    g.add(new THREE.Mesh(merge([box(0.5, 8, 0.5, -6, 4, mz - half - 0.5), box(0.5, 8, 0.5, -6, 4, mz + half + 0.5), box(0.5, 0.6, mw + 1.5, -6, 7.8, mz)]), steel));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: sign, side: THREE.DoubleSide }));
    panel.position.set(-6.3, 6.4, mz + half / 2); panel.rotation.y = -Math.PI / 2; g.add(panel);
    // traffic: three lanes each way
    const carGeo = merge([box(4.4, 1.0, 1.9, 0, 0.8, 0), box(2.3, 0.75, 1.7, -0.2, 1.65, 0)]);
    const truckGeo = merge([box(10, 3.2, 2.5, 0, 2.1, 0), box(2.4, 2.4, 2.4, 6.3, 1.7, 0)]);
    const r = rng(31), traffic = [], N = 66;
    const cars = new THREE.InstancedMesh(carGeo, std('#ffffff', { roughness: 0.3, metalness: 0.5 }), N);
    const trucks = new THREE.InstancedMesh(truckGeo, std('#e8e4dc', { roughness: 0.6 }), 12);
    for (let i = 0; i < N + 12; i++) {
      const dir = i % 2 ? 1 : -1, ln = Math.floor(r() * 3), truck = i >= N;
      const z = mz + (dir > 0 ? 1 : -1) * (0.6 + (ln + 0.5) * lane);        // eastbound on the north carriageway
      traffic.push({ x: -LEN + r() * 2 * LEN, z, dir, speed: truck ? 20 + r() * 3 : 24 + ln * 3 + r() * 4, truck, i: truck ? i - N : i });
      if (!truck) cars.setColorAt(i, new THREE.Color().setHSL(r(), 0.4, 0.3 + r() * 0.4));
    }
    g.add(cars, trucks);
    const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    tickers.push((dt) => {
      for (const c of traffic) {
        c.x += c.dir * c.speed * dt; if (c.x > LEN) c.x = -LEN; if (c.x < -LEN) c.x = LEN;
        (c.truck ? trucks : cars).setMatrixAt(c.i, m4.compose(p.set(c.x, 0.5, c.z), c.dir > 0 ? q0 : q1, one));
      }
      cars.instanceMatrix.needsUpdate = trucks.instanceMatrix.needsUpdate = true;
    });
    labels.push({ layer: 'motorway', text: 'Motorway', pos: new THREE.Vector3(-siteX / 2 - 60, 9, mz) });
  }

  /* ---------- flood area (rebuilt when the flood event changes) ---------- */
  const floodGroup = layer('flood');
  const floodLabel = { layer: 'flood', text: '', pos: new THREE.Vector3() };
  labels.push(floodLabel);
  let floodMat = null;
  function buildFlood(event) {
    floodGroup.children.slice().forEach((c) => { floodGroup.remove(c); c.geometry?.dispose(); c.material?.map?.dispose(); c.material?.dispose(); });
    const ev = FLOOD_EVENTS[event], X1 = siteX / 2 + 110, edge = (x) => F.flood.edgeAt(x, event);
    const hatch = canvasTex(64, 64, (x, W) => { x.fillStyle = 'rgba(61,139,255,.55)'; x.fillRect(0, 0, W, W); x.strokeStyle = 'rgba(190,220,255,.95)'; x.lineWidth = 3; for (let k = -W; k < W * 2; k += 16) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + W, W); x.stroke(); } });
    floodMat = new THREE.MeshBasicMaterial({ color: '#ffffff', map: hatch, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const sheet = flat(new THREE.Mesh(ribbon(edge, F.river.zAt, ev.level, -X1, X1, 3, 1 / 6), floodMat));
    sheet.renderOrder = 3; floodGroup.add(sheet);
    const pts = []; for (let x = -X1; x <= X1; x += 3) pts.push(new THREE.Vector3(x, ev.level + 0.05, edge(x)));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#9cc8ff', dashSize: 2.5, gapSize: 1.5 }));
    line.computeLineDistances(); floodGroup.add(line);
    floodLabel.text = `Flood area · ${ev.label} · ${ev.level.toFixed(1)} m`;
    { const lx = -siteX / 2 - 75; floodLabel.pos.set(lx, ev.level + 3, (edge(lx) + F.river.zAt(lx)) / 2); }   // over the flood band, west of the site
  }
  buildFlood(100);
  tickers.push((dt, t) => { if (floodMat) floodMat.opacity = 0.62 + 0.1 * Math.sin(t * 1.6); });

  /* ---------- solar: rooftop panels and the winter sun path ---------- */
  {
    const g = layer('solar');
    const panelGeo = new THREE.BoxGeometry(1.7, 0.05, 1.05);
    const cellTex = canvasTex(64, 40, (x, W, Hh) => { x.fillStyle = '#16264a'; x.fillRect(0, 0, W, Hh); x.strokeStyle = '#6f8fc9'; x.lineWidth = 1; for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(i * W / 6, 0); x.lineTo(i * W / 6, Hh); x.stroke(); } for (let j = 1; j < 4; j++) { x.beginPath(); x.moveTo(0, j * Hh / 4); x.lineTo(W, j * Hh / 4); x.stroke(); } });
    const panelMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: cellTex, roughness: 0.2, metalness: 0.3, clearcoat: 1 });
    const spots = [];
    for (let b = 1; b <= layout.buildings; b++) {
      const o = layout.origin(b);
      for (let x = -layout.BX / 2 + 1.6; x <= layout.BX / 2 - 1.6; x += 2.1) for (let z = -DEV.D / 2 + 1.6; z <= DEV.D / 2 - 1.6; z += 1.8) spots.push(new THREE.Vector3(o.x + x, H + 1.05, o.z + z));
    }
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, spots.length);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(20));   // tilted to face north (+z)
    spots.forEach((p, i) => panels.setMatrixAt(i, m4.compose(p, tilt, new THREE.Vector3(1, 1, 1))));
    g.add(panels);
    // winter sun path: rises north-east, peaks due north at ~30°, sets north-west (southern hemisphere)
    const R = 520, pts = [];   // far out, so the path reads as sky (look north, over the river, to see it)
    WINTER_SUN_DEG.forEach((deg, i) => {
      const az = THREE.MathUtils.degToRad(62 - 124 * i / (WINTER_SUN_DEG.length - 1)), el = THREE.MathUtils.degToRad(deg);
      pts.push(new THREE.Vector3(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R));
    });
    const curve = new THREE.CatmullRomCurve3(pts);
    const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)), new THREE.LineDashedMaterial({ color: '#ffd23f', dashSize: 16, gapSize: 10 }));
    arc.computeLineDistances(); g.add(arc);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffd96a' }));
    sun.userData.noShadow = true; g.add(sun);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(24, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.25, depthWrite: false }));
    g.add(halo);
    tickers.push((dt, t) => { const k = (Math.sin(t * 0.18) + 1) / 2; curve.getPoint(0.1 + k * 0.8, sun.position); halo.position.copy(sun.position); });
    labels.push({ layer: 'solar', text: 'Winter sun path · midday 30°', pos: pts[Math.floor(pts.length / 2)].clone().add(new THREE.Vector3(0, 40, 0)) });
  }

  const riverZ = [F.river.zAt(0) - 30, F.river.zAt(0) + 30], motorZ = [F.motorway.z - F.motorway.width, F.motorway.z + F.motorway.width];
  return {
    group: root, labels,
    /** z bands to keep free of the generated skyline and trees */
    clearBands: [riverZ, motorZ],
    /** how far the layers reach, for camera framing */
    extent: { zMin: F.motorway.z - F.motorway.width / 2 - 4, zMax: F.river.zAt(0) + F.river.width },
    setActive(id, on) { if (groups[id]) groups[id].visible = on; },
    setFloodEvent(event) { buildFlood(event); },
    update(dt, t) { for (const f of tickers) f(dt, t); },
  };
}
