/*
 * Plane: lathe fuselage with a roof half that turns to glass, swept wings, engines, tail,
 * cabins laid out nose to tail from each zone's seat layout and pitch, and a drifting cloud sea.
 */
import * as THREE from 'three';
import { sum, lerp, rng } from '../util.js';
import { PLANE_PITCH } from '../spec/schema.js';
import { box, rounded, cyl, merge, std, hitMat, instanced, PUFF, zoneMats } from './helpers.js';
import { addFurniture, furniturePalette } from './furniture.js';

export function buildPlane(sp) {
  const group = new THREE.Group();
  const zones = new Map();
  const palette = furniturePalette(sp.design);
  const across = Math.max(...sp.zones.map((z) => sum(z.layout)));
  const R = across <= 6 ? 2.15 : 3.0;
  const W = R * 1.76;
  const floorY = -0.32 * R;
  const items = sp.zones.map((z) => {
    const n = sum(z.layout);
    const rows = z.type === 'residence' ? z.capacity : z.type === 'bar' ? 1 : Math.ceil(z.capacity / n);
    return { z, n, rows, pitch: PLANE_PITCH[z.type] };
  });
  const gap = 0.6;
  let cabin = sum(items.map((i) => i.rows * i.pitch)) + gap * items.length;
  const maxCabin = across <= 6 ? 42 : 64;
  if (cabin > maxCabin) {
    const k = Math.max(0.5, (maxCabin - gap * items.length) / (cabin - gap * items.length));
    items.forEach((i) => { i.pitch *= k; });
    cabin = sum(items.map((i) => i.rows * i.pitch)) + gap * items.length;
  }
  const Ln = R * 2.3, Lt = R * 3.4;
  const L = cabin + Ln + Lt + 1.6;

  // fuselage: lathe profile from tail (y=0) to nose (y=L), rotated so its axis runs along x
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(R * (0.2 + 0.8 * (1 - Math.pow(1 - t, 2.2))), t * Lt)); }
  pts.push(new THREE.Vector2(R, L - Ln));
  for (let i = 1; i <= 18; i++) { const t = i / 18; pts.push(new THREE.Vector2(Math.max(0.001, R * Math.pow(1 - Math.pow(t, 2.1), 0.55)), L - Ln + t * Ln)); }
  const hullMat = new THREE.MeshPhysicalMaterial({ color: '#f4f3ef', roughness: 0.26, metalness: 0.08, clearcoat: 0.65, clearcoatRoughness: 0.2, side: THREE.DoubleSide });
  const roofMat = hullMat.clone(); roofMat.transparent = true;
  const lower = new THREE.Mesh(new THREE.LatheGeometry(pts, 96, 0, Math.PI), hullMat);
  const roof = new THREE.Mesh(new THREE.LatheGeometry(pts, 96, Math.PI, Math.PI), roofMat);
  [lower, roof].forEach((m) => { m.rotation.z = -Math.PI / 2; });
  group.add(lower, roof);

  // passenger windows + cockpit
  const winPos = [];
  for (let x = Lt + 0.8; x < L - Ln - 0.4; x += 0.95) for (const sgn of [-1, 1]) {
    const y = 0.16 * R; winPos.push(new THREE.Vector3(x, y, sgn * Math.sqrt(R * R - y * y) * 1.004));
  }
  const winMat = std('#1a2232', { roughness: 0.2, metalness: 0.4, transparent: true });
  const wins = instanced(rounded(0.26, 0.38, 0.065, 0, 0, 0, 0.10), winMat, winPos);
  const windowRims = instanced(rounded(0.31, 0.43, 0.048, 0, 0, 0, 0.11), palette.metal, winPos);
  group.add(wins, windowRims);
  const cockMat = std('#141a26', { roughness: 0.15, metalness: 0.5, transparent: true });
  const ck = [];
  [0.5, 0.62, 0.74].forEach((f) => { const x = L - Ln * (1 - f); const t = f; const r = R * Math.pow(1 - Math.pow(t, 2.1), 0.55); [-1, 1].forEach((s) => ck.push(new THREE.Vector3(x, 0.42 * r + 0.1, s * r * 0.82))); });
  const cock = instanced(box(0.5, 0.32, 0.05), cockMat, ck);
  group.add(cock);
  const hullDetails = new THREE.Group();
  const panelLines = [], doorLines = [];
  const onHull = (x, y, side) => new THREE.Vector3(x, y, side * Math.sqrt(R * R - y * y) * 1.006);
  for (let x = Lt + 1; x < L - Ln; x += 4.8) {
    for (let i = 0; i < 96; i++) {
      const a = i * Math.PI * 2 / 96, b = (i + 1) * Math.PI * 2 / 96;
      panelLines.push(new THREE.Vector3(x, Math.cos(a) * R * 1.003, Math.sin(a) * R * 1.003), new THREE.Vector3(x, Math.cos(b) * R * 1.003, Math.sin(b) * R * 1.003));
    }
  }
  for (const side of [-1, 1]) for (const x of [Lt + 1.2, Lt + cabin * 0.45, L - Ln - 0.7]) {
    const corners = [[-0.43, -0.8], [0.43, -0.8], [0.43, 1.15], [-0.43, 1.15]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      for (let j = 0; j < 16; j++) doorLines.push(onHull(x + lerp(a[0], b[0], j / 16), lerp(a[1], b[1], j / 16), side), onHull(x + lerp(a[0], b[0], (j + 1) / 16), lerp(a[1], b[1], (j + 1) / 16), side));
    }
  }
  const seamMat = new THREE.LineBasicMaterial({ color: '#71808a', transparent: true, opacity: 0.16 });
  const doorMat = new THREE.LineBasicMaterial({ color: '#50616c', transparent: true, opacity: 0.6 });
  hullDetails.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(panelLines), seamMat), new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(doorLines), doorMat));
  group.add(hullDetails);

  // wings, engines, tail
  const livery = new THREE.Color(sp.shell.livery);
  const wingMat = std('#e9e8e5', { roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
  const liveryMat = std(livery, { roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
  const span = L * 0.46, root = L * 0.19, tip = root * 0.28, sweep = span * 0.6;
  const wingShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-sweep, span), new THREE.Vector2(-sweep - tip, span), new THREE.Vector2(-root, 0)]);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.065, bevelSize: 0.07, bevelSegments: 3, steps: 1 }).translate(0, 0, -0.08);
  const xLE = L * 0.6, wingY = -0.55 * R;
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(xLE, wingY, 0);
    pivot.rotation.x = side < 0 ? 0.07 : -0.07;
    const m = new THREE.Mesh(wingGeo, wingMat);
    m.rotation.x = -Math.PI / 2;
    if (side > 0) m.scale.y = -1;
    pivot.add(m);
    const tipM = new THREE.Mesh(box(tip * 0.9, 1.6, 0.18, -sweep - tip * 0.45, 0.8, side * span), liveryMat);
    pivot.add(tipM);
    const wingLines = [];
    for (const chord of [0.28, 0.72, 0.9]) {
      wingLines.push(new THREE.Vector3(-root * chord, 0.18, side * R), new THREE.Vector3(-sweep - tip * chord, 0.18, side * span));
    }
    for (const fraction of [0.28, 0.52, 0.72]) {
      const lead = -sweep * fraction, width = lerp(root, tip, fraction);
      wingLines.push(new THREE.Vector3(lead - width * 0.72, 0.18, side * span * fraction), new THREE.Vector3(lead - width, 0.18, side * span * fraction));
    }
    pivot.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wingLines), new THREE.LineBasicMaterial({ color: '#7c858c', transparent: true, opacity: 0.45 })));
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), std(side < 0 ? '#d83835' : '#3aa582', { emissive: side < 0 ? '#f53828' : '#39c78d', emissiveIntensity: 1.4 }));
    nav.position.set(-sweep, 0.25, side * span); pivot.add(nav);
    const fr = sp.shell.engines === 4 ? [0.3, 0.58] : [0.34];
    fr.forEach((f) => {
      const e = R * 0.34;
      const profile = [[0.68, -2.1], [0.82, -1.7], [0.98, -0.6], [1, 1.4], [0.92, 2.0], [0.8, 2.1], [0.74, 1.88], [0.73, 1.1]].map(([r, y]) => new THREE.Vector2(r * e, y * e));
      const nac = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), hullMat);
      nac.rotation.z = -Math.PI / 2;
      nac.position.set(-sweep * f + e * 1.4, -e * 1.25, side * span * f);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(e * 0.84, e * 0.065, 12, 64), palette.metal);
      ring.rotation.y = Math.PI / 2; ring.position.copy(nac.position); ring.position.x += e * 2.02;
      const intake = new THREE.Mesh(new THREE.CircleGeometry(e * 0.74, 48), std('#10151b'));
      intake.rotation.y = Math.PI / 2; intake.position.copy(nac.position); intake.position.x += e * 1.35;
      const fan = new THREE.Group(); fan.position.copy(nac.position); fan.position.x += e * 1.5;
      const blades = [];
      for (let b = 0; b < 24; b++) {
        const a = b * Math.PI / 12;
        blades.push(box(0.045 * e, 0.49 * e, 0.075 * e, 0, 0.45 * e, 0).rotateX(a));
      }
      fan.add(new THREE.Mesh(merge(blades), palette.metal));
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(e * 0.19, e * 0.45, 32), palette.dark);
      spinner.rotation.z = -Math.PI / 2; spinner.position.x = e * 0.1; fan.add(spinner);
      const pylon = new THREE.Mesh(box(e * 2.2, e * 0.9, 0.2, -sweep * f + e * 0.6, -e * 0.45, side * span * f), wingMat);
      pivot.add(nac, ring, intake, pylon, fan);
    });
    group.add(pivot);
  }
  const finH = R * 2.7, finRoot = Lt * 0.9, finSweep = finH * 0.85, finTip = finRoot * 0.38;
  const finGeo = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-finSweep, finH), new THREE.Vector2(-finSweep - finTip, finH), new THREE.Vector2(-finRoot, 0)]), { depth: 0.3, bevelEnabled: false }).translate(0, 0, -0.15);
  const fin = new THREE.Mesh(finGeo, liveryMat); fin.position.set(Lt * 0.98, R * 0.55, 0); group.add(fin);
  const stabSpan = R * 2.6, stabRoot = Lt * 0.5;
  const stabGeo = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-stabSpan * 0.7, stabSpan), new THREE.Vector2(-stabSpan * 0.7 - stabRoot * 0.4, stabSpan), new THREE.Vector2(-stabRoot, 0)]), { depth: 0.22, bevelEnabled: false }).translate(0, 0, -0.11);
  for (const side of [-1, 1]) { const m = new THREE.Mesh(stabGeo, wingMat); m.rotation.x = -Math.PI / 2; if (side > 0) m.scale.y = -1; m.position.set(Lt * 0.72, R * 0.1, 0); group.add(m); }

  // cabin floor
  const cabinFront = L - Ln - 0.6;
  const base = new THREE.Mesh(box(cabin + 0.4, 0.12, W * 1.02, cabinFront - cabin / 2, floorY - 0.06, 0), std('#2a2f3c', { roughness: 0.95 }));
  group.add(base);
  const bulkPos = [];
  let x = cabinFront, rowNo = 1;
  const wingMid = xLE - root / 2;
  items.forEach((it) => {
    const { z } = it;
    const len = it.rows * it.pitch;
    const mats = zoneMats(z, sp.design);
    const cx = x - len / 2;
    const tile = new THREE.Mesh(box(len - 0.1, 0.04, W * 0.99, cx, floorY + 0.02, 0), mats.floor);
    group.add(tile);
    const seats = [], seatMeshes = [];
    const aisle = z.type === 'business' || z.type === 'first' ? 0.62 : 0.5;
    if (z.type === 'residence') {
      const wR = W * 0.64, P = it.pitch;
      for (let r = 0; r < it.rows; r++) {
        const rx = x - (r + 0.5) * P, rz = -W / 2 + wR / 2 + 0.08;
        const g = merge([
          box(0.08, 1.95, wR, P / 2 - 0.05, 0.975, 0), box(0.08, 1.95, wR, -P / 2 + 0.05, 0.975, 0),
          box(P * 0.62, 1.95, 0.08, -P * 0.19, 0.975, wR / 2), box(P * 0.16, 1.95, 0.08, P * 0.42, 0.975, wR / 2),
          box(0.06, 1.95, wR * 0.62, P * 0.06, 0.975, -wR * 0.19),
        ]);
        const m = new THREE.Mesh(g, palette.shell); m.position.set(rx, floorY, rz); group.add(m);
        addFurniture(group, 'bed', [new THREE.Vector3(rx - P * 0.22, floorY, rz - wR * 0.12)], mats.furn, palette, {}, [Math.PI / 2]);
        seatMeshes.push(...addFurniture(group, 'aircraft', [new THREE.Vector3(rx + P * 0.3, floorY, rz - wR / 2 + 0.6)], mats.furn, palette, { type: 'business', width: 1, pitch: 1.5, zone: z.id, seatLabels: [z.name] }));
        const shower = new THREE.Mesh(box(1.0, 1.95, 1.0), std('#bfe6ff', { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 }));
        shower.position.set(rx - P / 2 + 0.65, floorY + 0.975, rz + wR / 2 - 0.62); group.add(shower);
        seats.push({ pos: new THREE.Vector3(rx + P * 0.3 + 0.15, floorY + 1.12, rz - wR / 2 + 0.6), label: it.rows > 1 ? `Residence ${r + 1}` : 'The Residence', note: 'sofa by the window' });
      }
    } else if (z.type === 'bar') {
      const P = len;
      const g = merge([
        rounded(0.7, 1.05, W * 0.34, 0, 0.525, W * 0.12),
      ]);
      const m = new THREE.Mesh(g, palette.wood); m.position.set(cx, floorY, 0); group.add(m);
      group.add(new THREE.Mesh(rounded(0.9, 0.06, W * 0.38, cx, floorY + 1.08, W * 0.12), palette.shell));
      for (const f of [-0.12, 0.04, 0.2]) {
        group.add(new THREE.Mesh(cyl(0.035, 0.035, 0.68, cx - 0.8, floorY + 0.34, W * f), palette.metal));
        group.add(new THREE.Mesh(cyl(0.22, 0.22, 0.035, cx - 0.8, floorY + 0.02, W * f), palette.metal));
        group.add(new THREE.Mesh(cyl(0.22, 0.22, 0.09, cx - 0.8, floorY + 0.72, W * f), mats.furn));
      }
      addFurniture(group, 'sofa', [new THREE.Vector3(cx, floorY, -W / 2 + 0.55)], mats.furn, palette);
      seats.push({ pos: new THREE.Vector3(cx + 0.4, floorY + 1.1, -W / 2 + 0.55), label: z.name, note: 'window bench' });
    } else {
      const { zs, sw } = seatZs(z.layout, W, aisle);
      const pos = [], seatLabels = [];
      for (let r = 0; r < it.rows; r++) {
        const rx = x - (r + 0.5) * it.pitch;
        const inRow = Math.min(it.n, z.capacity - r * it.n);
        for (let s = 0; s < it.n; s++) if (s < inRow || r < it.rows - 1) {
          pos.push(new THREE.Vector3(rx, floorY, zs[s])); seatLabels.push(`Seat ${rowNo + r}${'ABCDEFGHJK'[s]}`);
        }
      }
      seatMeshes.push(...addFurniture(group, 'aircraft', pos, mats.furn, palette, { type: z.type, width: sw, pitch: it.pitch, zone: z.id, seatLabels }));
      const mid = Math.floor(it.rows / 2);
      // pick the window seat whose row sits closest to the wing if the zone overlaps it, otherwise the middle row
      let best = mid, bestD = Infinity;
      for (let r = 0; r < it.rows; r++) { const rx = x - (r + 0.5) * it.pitch; const d = Math.abs(rx - wingMid); if (d < bestD) { bestD = d; best = r; } }
      const pickRow = bestD < root * 0.6 ? best : mid;
      const prx = x - (pickRow + 0.5) * it.pitch;
      const overWing = Math.abs(prx - wingMid) < root * 0.55;
      seats.push({ pos: new THREE.Vector3(prx + 0.05, floorY + (z.type === 'first' ? 1.05 : 1.12), -W / 2 + 0.12), label: `Seat ${rowNo + pickRow}A`, note: overWing ? 'window seat over the wing' : `window seat, row ${rowNo + pickRow}` });
      rowNo += it.rows;
    }
    const hit = new THREE.Mesh(box(len, 2.3, W, cx, floorY + 1.15, 0), hitMat);
    hit.userData.zone = z.id;
    group.add(hit);
    zones.set(z.id, { z, mats, hits: [hit], seatMeshes, anchor: new THREE.Vector3(cx, R * 1.05, 0), center: new THREE.Vector3(cx, floorY, 0), seats, look: new THREE.Vector3(0.32, -0.2, -1).normalize() });
    x -= len;
    bulkPos.push(new THREE.Vector3(x - gap / 2, floorY, 0));
    x -= gap;
  });
  group.add(instanced(box(0.08, 1.9, W * 0.96, 0, 0.95, 0), std('#d9d6cf'), bulkPos.slice(0, -1)));
  group.position.x = -L / 2;
  group.updateMatrixWorld(true);
  zones.forEach((zo) => { zo.anchor.applyMatrix4(group.matrixWorld); zo.center.applyMatrix4(group.matrixWorld); zo.seats.forEach((s) => s.pos.applyMatrix4(group.matrixWorld)); });

  // cloud sea below and wisps around
  const clouds = new THREE.Group();
  const r = rng(11);
  const cMats = ['#ffffff', '#e8edf1', '#ccd6e1'].map((c) => new THREE.SpriteMaterial({ map: PUFF, color: c, transparent: true, depthWrite: false, opacity: 0.9, fog: true }));
  for (let i = 0; i < 340; i++) {
    const rr = r();
    const s = new THREE.Sprite(cMats[rr < 0.3 ? 0 : rr < 0.7 ? 1 : 2]);
    const sc = 40 + r() * 70;
    s.scale.set(sc * 1.6, sc, 1);
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 560;
    s.position.set(Math.cos(a) * d, -26 - r() * 14, Math.sin(a) * d);
    clouds.add(s);
  }
  const wMat = new THREE.SpriteMaterial({ map: PUFF, color: '#edf1f5', transparent: true, depthWrite: false, opacity: 0.5, fog: true });
  for (let i = 0; i < 40; i++) {
    const s = new THREE.Sprite(wMat);
    const sc = 18 + r() * 30;
    s.scale.set(sc * 2.2, sc * 0.7, 1);
    const side = r() < 0.5 ? -1 : 1;
    s.position.set(-500 + r() * 1000, -12 + r() * 22, side * (70 + r() * 380));
    clouds.add(s);
  }
  const root3 = new THREE.Group();
  root3.add(group, clouds);
  const hullParts = [lower, roof, wins, windowRims, cock, hullDetails];
  return {
    kind: 'plane', group: root3, zones, glassLabel: 'Glass roof',
    fitBox: new THREE.Box3(new THREE.Vector3(-L / 2, -R * 1.6, -span), new THREE.Vector3(L / 2, R * 3.4, span)),
    target: new THREE.Vector3(0, 0, 0),
    dirs: { wide: new THREE.Vector3(0.55, 0.78, 0.62), tall: new THREE.Vector3(0.78, 1.15, 0.22) },
    applyGlass(g) {
      roofMat.opacity = 1 - 0.9 * g; roofMat.depthWrite = g < 0.02;
      winMat.opacity = cockMat.opacity = 1 - 0.85 * g;
      seamMat.opacity = 0.16 * (1 - g); doorMat.opacity = 0.6 * (1 - g);
      windowRims.visible = g < 0.5;
    },
    setView(on) { hullParts.forEach((p) => { p.visible = !on; }); },
    update() {},
  };
}
function seatZs(groups, W, aisle) {
  const n = sum(groups), aisles = groups.length - 1;
  const sw = (W - 0.3 - aisles * aisle) / n;
  let z = -W / 2 + 0.15; const zs = [];
  groups.forEach((g, gi) => { for (let s = 0; s < g; s++) { zs.push(z + sw / 2); z += sw; } if (gi < groups.length - 1) z += aisle; });
  return { zs, sw };
}
