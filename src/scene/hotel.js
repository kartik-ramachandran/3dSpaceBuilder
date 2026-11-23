/*
 * Hotel: tower with a lobby, one block of floors per zone (rooms, suites, penthouse, amenity),
 * roof amenities and a lit-window facade that fades to glass.
 */
import * as THREE from 'three';
import { sum, lerp } from '../util.js';
import { HOTEL_PER_FLOOR } from '../spec/schema.js';
import { box, cyl, merge, std, surface, hitMat, instanced, gridTexture, repeatTex, zoneMats } from './helpers.js';
import { buildSurroundings } from './surroundings.js';
import { addFurniture, furniturePalette } from './furniture.js';
import { addArchitecture } from './architecture.js';

export function buildHotel(sp) {
  const group = new THREE.Group();
  const zones = new Map();
  const palette = furniturePalette(sp.design);
  const X = 40, Z = 16, lobbyH = 6, fh = 3.4;
  sp.zones.forEach((z) => { z._floors = z.floors || Math.max(1, Math.ceil(z.capacity / HOTEL_PER_FLOOR[z.type])); });
  let total = sum(sp.zones.map((z) => z._floors));
  if (total > 46) { const k = 46 / total; sp.zones.forEach((z) => { z._floors = Math.max(1, Math.round(z._floors * k)); }); total = sum(sp.zones.map((z) => z._floors)); }
  const H = lobbyH + total * fh;
  const yOf = (k) => lobbyH + (k - 1) * fh; // floor k (1-based) slab level

  // lobby, slabs, roof
  group.add(new THREE.Mesh(box(X - 1, 0.35, Z - 1, 0, 0.35, 0), surface('stone', '#d5cfc2')));
  group.add(new THREE.Mesh(box(8, 1.1, 1.2, 0, 1.05, -3), surface('wood', '#8b6346')));
  addFurniture(group, 'sofa', [new THREE.Vector3(-12, 0.53, 0), new THREE.Vector3(12, 0.53, 0)], palette.linen, palette);
  group.add(new THREE.Mesh(box(16, 0.4, 6, 0, lobbyH * 0.68, Z / 2 + 3), std('#2b2a2e')));
  const slabPos = []; for (let k = 0; k <= total; k++) slabPos.push(new THREE.Vector3(0, lobbyH + k * fh, 0));
  group.add(instanced(box(X + 0.6, 0.32, Z + 0.6), std('#cbc5b9'), slabPos));
  group.add(new THREE.Mesh(box(X + 0.6, 1.1, Z + 0.6, 0, H + 0.55, 0), std('#bdb6aa')));
  // amenities on the roof
  const am = sp.shell.amenities.join(' ');
  if (/pool/.test(am)) {
    group.add(new THREE.Mesh(box(15, 0.12, 6.5, -8, H + 1.37, 1.5), surface('water', '#398e9b', { clearcoat: 1, metalness: 0.18 })));
    group.add(new THREE.Mesh(box(22, 0.25, 11, -8, H + 1.15, 1.5), std('#d8cbb3')));
  }
  if (/helipad/.test(am)) {
    group.add(new THREE.Mesh(cyl(6, 6, 0.4, 10, H + 1.3, 0, 32), std('#2d3138')));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.12, 6, 40), std('#ffd27a', { emissive: '#ffd27a', emissiveIntensity: 1.2 }));
    ring.rotation.x = Math.PI / 2; ring.position.set(10, H + 1.55, 0); group.add(ring);
  }
  if (/garden/.test(am)) group.add(new THREE.Mesh(box(10, 0.8, 5, 12, H + 1.5, -3), std('#4d7a46')));
  if (/bar/.test(am)) group.add(new THREE.Mesh(box(10, 3, 7, /helipad/.test(am) ? -8 : 10, H + 2.6, -3.5), std('#ffcf8a', { emissive: '#ffbf70', emissiveIntensity: 0.8, transparent: true, opacity: 0.8 })));

  // facade: lit-window texture, fades to glass
  const winTex = gridTexture({ cols: 4, rows: 4, frame: '#0e1524', lit: '#ffcf8a', dark: '#26385c', litP: 0.42, seed: 9 });
  const front = repeatTex(winTex, X / 10, total / 4), side = repeatTex(winTex, Z / 10, total / 4);
  winTex.dispose();
  const facMat = (t) => new THREE.MeshPhysicalMaterial({ color: '#c4d2d5', map: t, emissive: '#ffe2b9', emissiveMap: t, emissiveIntensity: 0.14, transparent: true, roughness: 0.16, metalness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 });
  const fSide = facMat(side), fFront = facMat(front), none = new THREE.MeshBasicMaterial({ visible: false });
  const facade = new THREE.Mesh(new THREE.BoxGeometry(X + 0.2, total * fh, Z + 0.2), [fSide, fSide, none, none, fFront, fFront]);
  facade.position.y = lobbyH + total * fh / 2; facade.renderOrder = 2;
  group.add(facade);

  // rooms
  const wallMat = std(sp.design?.wallColor || '#d8d3ca', { roughness: 0.8 });
  const walls = [];
  let k = 1;
  sp.zones.forEach((z) => {
    const mats = zoneMats(z, sp.design);
    const tiles = [], beds = [], sofas = [];
    const seats = [];
    const perSide = z.type === 'room' ? 8 : z.type === 'suite' ? 4 : 1;
    const depth = (Z - 2.2) / 2;
    for (let f = 0; f < z._floors; f++) {
      const y = yOf(k + f) + 0.16;
      if (z.type === 'penthouse') {
        const units = Math.min(2, z.capacity);
        for (let u = 0; u < units; u++) {
          const ux = -X / 2 + (u + 0.5) * X / units;
          tiles.push([new THREE.Vector3(ux, y, 0), X / units - 0.3, Z - 0.3]);
          beds.push(new THREE.Vector3(ux - 4, y, -3)); sofas.push(new THREE.Vector3(ux + 4, y, 3)); sofas.push(new THREE.Vector3(ux + 1, y, -4));
          if (u > 0) walls.push([new THREE.Vector3(ux - X / units / 2, y, 0), 0.12, Z - 0.4]);
        }
      } else if (z.type === 'amenity') {
        tiles.push([new THREE.Vector3(0, y, 0), X - 0.3, Z - 0.3]);
        for (let i = 0; i < 10; i++) sofas.push(new THREE.Vector3(-X / 2 + 3 + i * 3.8, y, (i % 2 ? 3 : -3)));
      } else {
        const rw = X / perSide;
        for (const sgn of [-1, 1]) for (let i = 0; i < perSide; i++) {
          const rx = -X / 2 + (i + 0.5) * rw, rz = sgn * (1.1 + depth / 2);
          tiles.push([new THREE.Vector3(rx, y, rz), rw - 0.14, depth - 0.1]);
          beds.push(new THREE.Vector3(rx, y, rz - sgn * 0.6));
          if (z.type === 'suite') sofas.push(new THREE.Vector3(rx + rw * 0.25, y, rz + sgn * 1.6));
          if (i > 0) walls.push([new THREE.Vector3(rx - rw / 2, y, rz), 0.1, depth]);
        }
      }
    }
    // floor tiles: one geometry per zone (sizes vary by type)
    const tileGeo = merge(tiles.map(([p, w, d]) => box(w, 0.06, d, p.x, p.y + 0.03, p.z)));
    group.add(new THREE.Mesh(tileGeo, mats.floor));
    addFurniture(group, 'bed', beds, mats.furn, palette);
    addFurniture(group, 'sofa', sofas, mats.furn, palette);
    // window spot: the middle floor of the zone, harbour-facing (+z) side
    const mf = k + Math.floor(z._floors / 2);
    const idx = Math.floor(perSide / 2);
    const rx = z.type === 'penthouse' ? -X / 4 + 4 : -X / 2 + (idx + 0.5) * (X / perSide);
    const roomNo = z.type === 'penthouse' ? `Penthouse, level ${mf}` : z.type === 'amenity' ? `${z.name}, level ${mf}` : `Room ${mf}${String(idx + 1 + perSide).padStart(2, '0')}`;
    seats.push({ pos: new THREE.Vector3(rx, yOf(mf) + 1.65, Z / 2 - 1.1), label: roomNo, note: `level ${mf} · ${sp.shell.setting === 'city' ? 'city' : sp.shell.setting === 'mountain' ? 'mountain' : sp.shell.setting === 'beach' ? 'sea' : 'harbour'}-facing` });
    const y0 = yOf(k), y1 = yOf(k + z._floors);
    const hit = new THREE.Mesh(box(X + 1.2, y1 - y0, Z + 1.2, 0, (y0 + y1) / 2, 0), hitMat);
    hit.userData.zone = z.id; group.add(hit);
    zones.set(z.id, { z, mats, hits: [hit], anchor: new THREE.Vector3(X / 2 * 0.2, (y0 + y1) / 2, Z / 2 + 1), center: new THREE.Vector3(0, (y0 + y1) / 2, 0), seats, look: new THREE.Vector3(0, -0.2, 1).normalize(), floorsLabel: z._floors > 1 ? `levels ${k}–${k + z._floors - 1}` : `level ${k}` });
    k += z._floors;
  });
  if (walls.length) group.add(new THREE.Mesh(merge(walls.map(([p, w, d]) => box(w, 2.9, d, p.x, p.y + 1.45, p.z))), wallMat));
  addArchitecture(group, { X, Z, floors: total, fh, base: lobbyH, palette, hotel: true });
  const env = buildSurroundings('hotel', sp.shell.setting, X, Z);
  const root = new THREE.Group(); root.add(env, group);
  return {
    kind: 'hotel', group: root, zones, glassLabel: 'Glass facade', levels: total + 1,
    fitBox: new THREE.Box3(new THREE.Vector3(-X / 2 - 6, 0, -Z / 2 - 6), new THREE.Vector3(X / 2 + 6, H + 3, Z / 2 + 8)),
    target: new THREE.Vector3(0, H * 0.48, 0),
    dirs: { wide: new THREE.Vector3(0.62, 0.36, 1), tall: new THREE.Vector3(0.5, 0.3, 1) },
    applyGlass(g) { [fSide, fFront].forEach((m) => { m.opacity = lerp(0.97, 0.07, g); m.emissiveIntensity = lerp(0.14, 0.015, g); m.depthWrite = g < 0.02; }); },
    setView(on) { facade.visible = !on; },
    update() {},
  };
}
