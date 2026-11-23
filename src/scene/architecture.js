import * as THREE from 'three';
import { box, rounded, cyl, merge, std, surface, instanced } from './helpers.js';

export function addArchitecture(group, { X, Z, floors, fh, base, palette, hotel = false }) {
  const H = base + floors * fh;
  const frames = [], reveals = [], columns = [], lights = [];
  const bay = hotel ? 5 : 2.4;
  for (const side of [-1, 1]) {
    for (let x = -X / 2; x <= X / 2 + 0.01; x += bay) frames.push(box(0.07, H - base, 0.12, x, (H + base) / 2, side * (Z / 2 + 0.15)));
    for (let z = -Z / 2; z <= Z / 2 + 0.01; z += 4) frames.push(box(0.12, H - base, 0.07, side * (X / 2 + 0.15), (H + base) / 2, z));
    for (let f = 0; f <= floors; f++) {
      const y = base + f * fh;
      frames.push(box(X, 0.075, 0.12, 0, y + 0.25, side * (Z / 2 + 0.15)));
      reveals.push(box(X + 0.45, 0.065, 0.08, 0, y - 0.12, side * (Z / 2 + 0.29)));
      frames.push(box(0.12, 0.075, Z, side * (X / 2 + 0.15), y + 0.25, 0));
    }
    for (let x = -X / 2 + 1; x < X / 2; x += 8) columns.push(box(0.3, H, 0.3, x, H / 2, side * (Z / 2 - 0.45)));
  }
  group.add(new THREE.Mesh(merge(frames), palette.dark));
  group.add(new THREE.Mesh(merge(reveals), palette.metal));
  group.add(new THREE.Mesh(merge(columns), surface('stone', '#d9d5cd')));
  for (let f = 0; f < floors; f++) for (let x = -X / 2 + 4; x < X / 2; x += 8) {
    lights.push(box(hotel ? 0.6 : 2.4, 0.035, 0.14, x, base + (f + 1) * fh - 0.25, 0));
  }
  group.add(new THREE.Mesh(merge(lights), palette.light));
  // A thin parapet and continuous metal cap give the roof a finished edge.
  const rails = [];
  for (const s of [-1, 1]) {
    rails.push(box(X, 0.07, 0.08, 0, H + 1.25, s * Z / 2), box(0.08, 0.07, Z, s * X / 2, H + 1.25, 0));
    for (let x = -X / 2; x <= X / 2; x += 2.5) rails.push(box(0.035, 0.95, 0.035, x, H + 0.77, s * Z / 2));
  }
  group.add(new THREE.Mesh(merge(rails), palette.metal));
  // Entrance with paired glazed doors and long pull handles.
  const entry = new THREE.Group();
  entry.add(new THREE.Mesh(rounded(5.6, 0.18, 3.5, 0, 3.25, Z / 2 + 1.2), palette.dark));
  const glass = new THREE.MeshPhysicalMaterial({ color: '#b9d7de', transparent: true, opacity: 0.26, roughness: 0.08, metalness: 0.15, clearcoat: 1, depthWrite: false });
  for (const s of [-1, 1]) {
    entry.add(new THREE.Mesh(box(1.25, 2.65, 0.05, s * 0.65, 1.72, Z / 2 + 0.2), glass));
    entry.add(new THREE.Mesh(cyl(0.018, 0.018, 0.65, s * 0.13, 1.6, Z / 2 + 0.29), palette.metal));
  }
  group.add(entry);
  const pots = [-X / 2 + 3, X / 2 - 3].map((x) => new THREE.Vector3(x, 0.4, Z / 2 + 4));
  group.add(instanced(cyl(0.75, 0.6, 0.85, 0, 0.425, 0), surface('stone', '#a49b8c'), pots));
  const leafParts = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.399;
    leafParts.push(new THREE.SphereGeometry(0.38, 12, 8).scale(1, 1.5, 1).translate(Math.cos(a) * 0.36, 1.15 + (i % 3) * 0.27, Math.sin(a) * 0.36));
  }
  group.add(instanced(merge(leafParts), std('#42603b', { roughness: 0.85 }), pots));
}
