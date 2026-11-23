/*
 * Office: floor plates split into 8 m bays; each zone takes enough bays for its capacity
 * (desks, glass offices, meeting rooms, lounge, event seating). Timber fins and a glass skin.
 */
import * as THREE from 'three';
import { clamp, sum, lerp } from '../util.js';
import { OFFICE_PER_BAY } from '../spec/schema.js';
import { box, cyl, merge, std, hitMat, instanced, gridTexture, repeatTex, zoneMats } from './helpers.js';
import { buildSurroundings } from './surroundings.js';
import { addFurniture, furniturePalette } from './furniture.js';
import { addArchitecture } from './architecture.js';

export function buildOffice(sp) {
  const group = new THREE.Group();
  const zones = new Map();
  const palette = furniturePalette(sp.design);
  const X = 48, Z = 28, fh = 4.0, BAYS = 6, bw = X / BAYS;
  sp.zones.forEach((z) => { z._bays = clamp(Math.ceil(z.capacity / OFFICE_PER_BAY[z.type]), 1, 14); });
  let totalBays = sum(sp.zones.map((z) => z._bays));
  if (totalBays > 60) { const k = 60 / totalBays; sp.zones.forEach((z) => { z._bays = Math.max(1, Math.round(z._bays * k)); }); totalBays = sum(sp.zones.map((z) => z._bays)); }
  const floors = clamp(Math.max(sp.shell.floors || 0, Math.ceil(totalBays / BAYS)), 1, 10);
  const H = floors * fh;
  const slabY = (f) => 0.4 + f * fh;
  // slabs, roof, fins
  const slabPos = []; for (let f = 0; f < floors; f++) slabPos.push(new THREE.Vector3(0, slabY(f), 0));
  group.add(instanced(box(X + 0.8, 0.35, Z + 0.8), std('#d7d2c8'), slabPos));
  const roofMat = std('#d7d2c8', { transparent: true });
  const roofSlab = new THREE.Mesh(box(X + 0.8, 0.35, Z + 0.8, 0, slabY(floors), 0), roofMat);
  group.add(roofSlab);
  const finPos = [];
  for (let x = -X / 2; x <= X / 2 + 0.01; x += 2.4) { finPos.push(new THREE.Vector3(x, 0, Z / 2 + 0.45)); finPos.push(new THREE.Vector3(x, 0, -Z / 2 - 0.45)); }
  for (let z = -Z / 2 + 2.4; z < Z / 2; z += 2.4) { finPos.push(new THREE.Vector3(X / 2 + 0.45, 0, z)); finPos.push(new THREE.Vector3(-X / 2 - 0.45, 0, z)); }
  const fins = instanced(box(0.22, H + 0.6, 0.5, 0, (H + 0.6) / 2 + 0.4, 0), std('#b98f5e', { roughness: 0.7 }), finPos);
  group.add(fins);
  if (/terrace/.test(sp.shell.amenities.join(' '))) {
    const tp = []; for (let i = 0; i < 8; i++) tp.push(new THREE.Vector3(-X / 2 + 4 + i * 5.7, slabY(floors) + 0.2, Z / 2 - 3));
    group.add(instanced(merge([box(3, 0.8, 1.2, 0, 0.4, 0), new THREE.SphereGeometry(1.1, 8, 6).translate(0, 1.4, 0)]), std('#5d8a52', { flatShading: true }), tp));
    group.add(new THREE.Mesh(box(X - 6, 0.12, 8, 0, slabY(floors) + 0.24, Z / 2 - 5), std('#c9a77a')));
  }
  // glass skin
  const gTex = gridTexture({ cols: 4, rows: 2, frame: '#55626f', lit: '#b9d3e6', dark: '#9fc3dc', litP: 0.5, seed: 4, pad: [4, 6] });
  const front = repeatTex(gTex, X / 9.6, floors / 2), side = repeatTex(gTex, Z / 9.6, floors / 2); gTex.dispose();
  const gm = (t) => std('#ffffff', { map: t, transparent: true, roughness: 0.12, metalness: 0.35 });
  const gSide = gm(side), gFront = gm(front), none = new THREE.MeshBasicMaterial({ visible: false });
  const skin = new THREE.Mesh(new THREE.BoxGeometry(X, H, Z), [gSide, gSide, none, none, gFront, gFront]);
  skin.position.y = 0.4 + H / 2; skin.renderOrder = 2; group.add(skin);

  // bays
  const greyTile = std('#b7b4ad', { roughness: 0.95 });
  let bay = 0;
  const greyTiles = [];
  sp.zones.forEach((z) => {
    const mats = zoneMats(z, sp.design);
    const tiles = [], items = [], glassRooms = [];
    const bayCenters = [];
    for (let b = 0; b < z._bays && bay < floors * BAYS; b++, bay++) {
      const f = Math.floor(bay / BAYS), i = bay % BAYS;
      const bx = -X / 2 + (i + 0.5) * bw, y = slabY(f) + 0.18;
      bayCenters.push({ bx, y, f });
      tiles.push(box(bw - 0.25, 0.05, Z - 0.6, bx, y + 0.025, 0));
      if (z.type === 'desks') { for (let r = 0; r < 8; r++) for (const dx of [-1.6, 1.6]) items.push({ geo: 'desk', p: new THREE.Vector3(bx + dx, y, -Z / 2 + 2.4 + r * 3.2) }); }
      else if (z.type === 'offices' || z.type === 'meeting') {
        const n = z.type === 'offices' ? 4 : 2, rd = (Z - 1) / n;
        for (let r = 0; r < n; r++) {
          const rz = -Z / 2 + 0.5 + (r + 0.5) * rd;
          glassRooms.push(box(bw - 0.6, 2.9, rd - 0.5, bx, y + 1.45, rz));
          if (z.type === 'offices') [[-1.4, -1.2], [1.4, -1.2], [-1.4, 1.2], [1.4, 1.2]].forEach(([dx, dz]) => items.push({ geo: 'desk', p: new THREE.Vector3(bx + dx, y, rz + dz) }));
          else items.push({ geo: 'table', p: new THREE.Vector3(bx, y, rz) });
        }
      } else if (z.type === 'lounge') { for (let r = 0; r < 4; r++) for (const dx of [-1.8, 1.8]) items.push({ geo: 'sofa', p: new THREE.Vector3(bx + dx, y, -Z / 2 + 4 + r * 6.4 + (dx > 0 ? 2 : 0)) }); }
      else if (z.type === 'event') { for (let r = 0; r < 9; r++) for (let c = 0; c < 6; c++) items.push({ geo: 'chair', p: new THREE.Vector3(bx - 2.9 + c * 1.16, y, -Z / 2 + 7 + r * 1.9) }); items.push({ geo: 'stage', p: new THREE.Vector3(bx, y, -Z / 2 + 2.8) }); }
    }
    if (!tiles.length) return;
    group.add(new THREE.Mesh(merge(tiles), mats.floor));
    for (const key of ['desk', 'table', 'sofa', 'chair', 'stage']) {
      addFurniture(group, key, items.filter((it) => it.geo === key).map((it) => it.p), mats.furn, palette);
    }
    if (glassRooms.length) group.add(new THREE.Mesh(merge(glassRooms), std(new THREE.Color('#dff2ff').lerp(new THREE.Color(z.color), 0.25), { transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false })));
    const hits = bayCenters.map(({ bx, y }) => { const h = new THREE.Mesh(box(bw, fh - 0.2, Z + 0.8, bx, y + fh / 2 - 0.1, 0), hitMat); h.userData.zone = z.id; group.add(h); return h; });
    const last = bayCenters[bayCenters.length - 1];
    const first = bayCenters[0];
    const level = last.f + 1;
    const deskNo = String(((bayCenters.length * 7) % 40) + 3).padStart(2, '0');
    const label = z.type === 'desks' ? `Desk ${level}.${deskNo}` : z.type === 'offices' ? `Office ${level}.${String(bayCenters.length).padStart(2, '0')}` : z.type === 'meeting' ? `Meeting room ${level}.${bayCenters.length}` : `${z.name}, level ${level}`;
    const spotX = Math.round((last.bx + (z.type === 'desks' ? 1.6 : 0) + X / 2 - 1.2) / 2.4) * 2.4 - X / 2 + 1.2;
    const spotZ = z.type === 'offices' ? Z / 2 - 5 : z.type === 'meeting' ? Z / 2 - 5 : Z / 2 - 1.6;
    const seats = [{ pos: new THREE.Vector3(spotX, last.y + (z.type === 'event' || z.type === 'lounge' ? 1.6 : 1.25), spotZ), label, note: `level ${level} · ${sp.shell.setting === 'waterfront' ? 'water' : sp.shell.setting}-facing side` }];
    const floorsTxt = first.f === last.f ? `level ${first.f + 1}` : `levels ${first.f + 1}–${last.f + 1}`;
    zones.set(z.id, { z, mats, hits, anchor: new THREE.Vector3(first.bx, first.y + fh * 0.9, Z / 2 + 1), center: new THREE.Vector3(first.bx, first.y, 0), seats, look: new THREE.Vector3(0.05, -0.16, 1).normalize(), floorsLabel: floorsTxt });
  });
  for (; bay < floors * BAYS; bay++) { const f = Math.floor(bay / BAYS), i = bay % BAYS; greyTiles.push(box(bw - 0.25, 0.05, Z - 0.6, -X / 2 + (i + 0.5) * bw, slabY(f) + 0.205, 0)); }
  if (greyTiles.length) group.add(new THREE.Mesh(merge(greyTiles), greyTile));
  addArchitecture(group, { X, Z, floors, fh, base: 0.4, palette });
  const env = buildSurroundings('office', sp.shell.setting, X, Z);
  const root = new THREE.Group(); root.add(env, group);
  return {
    kind: 'office', group: root, zones, glassLabel: 'Glass skin', levels: floors,
    fitBox: new THREE.Box3(new THREE.Vector3(-X / 2 - 4, 0, -Z / 2 - 4), new THREE.Vector3(X / 2 + 4, H + 4, Z / 2 + 4)),
    target: new THREE.Vector3(0, H * 0.45, 0),
    dirs: { wide: new THREE.Vector3(0.75, 0.62, 1), tall: new THREE.Vector3(0.6, 0.75, 1) },
    applyGlass(g) { [gSide, gFront].forEach((m) => { m.opacity = lerp(0.95, 0.08, g); m.depthWrite = g < 0.02; }); roofMat.opacity = lerp(1, 0.28, g); roofMat.depthWrite = g < 0.02; },
    setView(on) { skin.visible = !on; },
    update() {},
  };
}
