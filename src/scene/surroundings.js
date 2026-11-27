/* Ground, plaza, water, skyline, hills and trees around the hotel and office buildings. */
import * as THREE from 'three';
import { surroundingsOn } from './focus.js';
import { rng } from '../util.js';
import { box, cyl, merge, std, surface, m4, instanced, gridTexture } from './helpers.js';

/** clear: optional [[zMin, zMax], …] bands kept free of skyline and trees (for example a river or motorway). */
export function buildSurroundings(kind, setting, X, Z, clear = []) {
  const g = new THREE.Group();
  const blocked = (z, pad = 0) => clear.some(([a, b]) => z > a - pad && z < b + pad);
  const night = false;
  const water = ['harbour', 'beach', 'waterfront'].includes(setting);
  const shoreZ = Z / 2 + 34;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), std(night ? '#1b1f2a' : setting === 'park' ? '#86a06c' : '#a3a596', { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; g.add(ground);
  g.userData.ground = ground;
  const plaza = new THREE.Mesh(box(X + 40, 0.4, Z + 44, 0, 0.2, 4), surface('stone', '#c4beb2'));
  g.add(plaza); g.userData.plaza = plaza;
  const joints = [];
  for (let x = -(X + 40) / 2; x <= (X + 40) / 2; x += 3) joints.push(box(0.022, 0.005, Z + 44, x, 0.403, 4));
  for (let z = -(Z + 44) / 2 + 4; z <= (Z + 44) / 2 + 4; z += 3) joints.push(box(X + 40, 0.005, 0.022, 0, 0.403, z));
  const paving = new THREE.Mesh(merge(joints), std('#8d8980')); paving.userData.noShadow = true; g.add(paving); g.userData.joints = paving;
  if (water) {
    const waterMat = surface('water', '#557c88', { metalness: 0.24, clearcoat: 0.75 });
    waterMat.bumpMap = waterMat.bumpMap.clone();
    waterMat.bumpMap.repeat.set(1200, 600);
    const w = new THREE.Mesh(new THREE.PlaneGeometry(6000, 3000), waterMat);
    w.rotation.x = -Math.PI / 2; w.position.set(0, 0.08, shoreZ + 1500); g.add(w);
    if (setting === 'beach') { const sand = new THREE.Mesh(box(6000, 0.3, 26, 0, 0.12, shoreZ - 6), std(night ? '#6f6556' : '#e6d6b4', { roughness: 1 })); g.add(sand); }
    else { const edge = new THREE.Mesh(box(6000, 0.9, 3, 0, 0.45, shoreZ), std(night ? '#4a4a50' : '#bdb8ad')); g.add(edge); }
  }
  // skyline
  const r = rng(kind === 'hotel' ? 21 : 37);
  const pos = [], scl = [];
  const hMax = setting === 'city' ? 120 : setting === 'harbour' || setting === 'waterfront' ? 70 : setting === 'beach' ? 45 : setting === 'park' ? 28 : 20;
  for (let i = 0; i < 170; i++) {
    const a = r() * Math.PI * 2, d = 170 + Math.pow(r(), 0.7) * 750;
    const px = Math.cos(a) * d, pz = Math.sin(a) * d;
    if (water && pz > shoreZ - 30) continue;
    if (Math.abs(px) < X / 2 + 40 && Math.abs(pz) < Z / 2 + 40) continue;
    if (blocked(pz, 18)) continue;
    const h = 8 + Math.pow(r(), 1.6) * hMax;
    pos.push(new THREE.Vector3(px, h / 2, pz)); scl.push([12 + r() * 18, h, 12 + r() * 18]);
  }
  const skyTex = night ? gridTexture({ cols: 6, rows: 10, frame: '#121826', lit: '#ffd59a', dark: '#1b2436', litP: 0.32, seed: 5 }) : gridTexture({ cols: 6, rows: 10, frame: '#d9d4c9', lit: '#a9bccc', dark: '#8fa3b5', litP: 0.5, seed: 5, pad: [8, 12] });
  const skyMat = std(night ? '#9aa0b8' : '#f2eee6', { map: skyTex, ...(night ? { emissive: '#ffffff', emissiveMap: skyTex, emissiveIntensity: 0.32 } : {}), roughness: 0.8 });
  const sk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), skyMat, pos.length);
  const q = new THREE.Quaternion();
  pos.forEach((p, i) => { m4.compose(p, q, new THREE.Vector3(...scl[i])); sk.setMatrixAt(i, m4); });
  sk.userData.surround = true; sk.visible = surroundingsOn();   // the neighbourhood: hidden unless Surroundings is on (focus.js)
  g.add(sk); g.userData.skyline = { mesh: sk, pos, scl };
  // far shore hills across the water / mountains
  if (water || setting === 'mountain') {
    const hillMat = std(night ? '#1d2438' : '#6f8a8f', { roughness: 1, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const h = setting === 'mountain' ? 160 + r() * 200 : 40 + r() * 70;
      const rad = setting === 'mountain' ? 220 + r() * 180 : 160 + r() * 140;
      const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 7), hillMat);
      m.position.set(-900 + i * 230 + r() * 80, h / 2 - 2, setting === 'mountain' ? 700 + r() * 300 : 1100 + r() * 250);
      g.add(m);
    }
  }
  if (setting === 'park' || setting === 'beach' || setting === 'mountain') {
    const tp = [];
    for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2, d = X / 2 + 14 + r() * 70; const p = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d * 0.8); if (water && p.z > shoreZ - 8) continue; if (blocked(p.z, 4)) continue; tp.push(p); }
    const trunks = instanced(cyl(0.16, 0.27, 3.5, 0, 1.75, 0), surface('wood', '#64513f'), tp); g.add(trunks);
    const foliage = [];
    for (let i = 0; i < 12; i++) { const a = i * 2.399; foliage.push(new THREE.SphereGeometry(1.0, 12, 8).scale(1, 1.35, 1).translate(Math.cos(a) * (i % 3) * 0.5, 3.6 + (i % 4) * 0.45, Math.sin(a) * (i % 3) * 0.5)); }
    const crowns = instanced(merge(foliage), std('#49683d', { roughness: 0.95 }), tp); g.add(crowns);
    g.userData.trees = { positions: tp, meshes: [trunks, crowns] };
  }
  return g;
}
