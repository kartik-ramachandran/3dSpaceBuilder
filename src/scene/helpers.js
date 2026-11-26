/* Geometry, material and texture helpers shared by the plane, hotel and office builders. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng } from '../util.js';

export const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
export const rounded = (w, h, d, x = 0, y = 0, z = 0, radius = 0.035) => new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) * 0.45)).translate(x, y, z);
export const cyl = (rt, rb, h, x = 0, y = 0, z = 0, seg = 32) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
export const merge = (parts) => {
  const normalized = parts.map((p) => p.index ? p.toNonIndexed() : p);
  const g = mergeGeometries(normalized);
  new Set([...parts, ...normalized]).forEach((p) => p.dispose());
  return g;
};
export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o });
export const hitMat = new THREE.MeshBasicMaterial({ visible: false });
export const m4 = new THREE.Matrix4();
export function instanced(geo, mat, positions, rotY = null) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, positions.length));
  const q = new THREE.Quaternion(); const s = new THREE.Vector3(1, 1, 1); const up = new THREE.Vector3(0, 1, 0);
  positions.forEach((p, i) => { q.setFromAxisAngle(up, rotY ? rotY[i] : 0); m4.compose(p, q, s); mesh.setMatrixAt(i, m4); });
  mesh.count = positions.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const PUFF = puffTexture();
export function gridTexture({ cols = 4, rows = 4, frame = '#0d1422', lit = '#ffcf8a', dark = '#24365a', litP = 0.45, seed = 3, w = 512, h = 512, pad = [6, 10] }) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); const r = rng(seed);
  x.fillStyle = frame; x.fillRect(0, 0, w, h);
  const cw = w / cols, rh = h / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const on = r() < litP;
    x.fillStyle = on ? lit : dark;
    x.globalAlpha = on ? 0.75 + r() * 0.25 : 0.85 + r() * 0.15;
    x.fillRect(i * cw + pad[0], j * rh + pad[1], cw - pad[0] * 2, rh - pad[1] * 2);
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
export const repeatTex = (t, rx, ry) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(rx, ry); return c; };

export function disposeTree(o) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  o.traverse((c) => {
    if (c.geometry) geometries.add(c.geometry);
    const ms = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
    ms.forEach((m) => { if (m === hitMat) return; materials.add(m); for (const v of Object.values(m)) if (v?.isTexture && v !== PUFF) textures.add(v); });
  });
  geometries.forEach((g) => g.dispose());
  textures.forEach((t) => { if (!surfaceTextures.has(t)) t.dispose(); });
  materials.forEach((m) => m.dispose());
}

/* Zone material pair: a glowing floor and a tinted furniture material. */
export function zoneMats(z, design = {}) {
  const c = new THREE.Color(z.color);
  const floor = surface('carpet', design.floorColor || new THREE.Color('#a49d91').lerp(c, 0.10), { emissive: c, emissiveIntensity: 0 });
  const furn = surface('fabric', design.upholsteryColor || new THREE.Color('#8c9293').lerp(c, 0.18), { emissive: c, emissiveIntensity: 0 });
  return { floor, furn };
}

// These deterministic maps are shared across materials and scene rebuilds.
const surfaceMaps = new Map();
const surfaceTextures = new Set();
/* Small, deterministic material maps. Texture detail stays subtle at real-world scale. */
export function surface(kind, color, options = {}) {
  let bump = surfaceMaps.get(kind);
  if (!bump) {
    const size = 256, c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'), data = ctx.createImageData(size, size), random = rng(83);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const n = random() - 0.5;
      let v = 0.5 + n * 0.15;
      if (kind === 'wood') v = 0.55 + 0.12 * Math.sin(x * 0.48 + Math.sin(y * Math.PI / 128) * 2 + Math.sin(x * 0.08) * 3) + n * 0.07;
      if (kind === 'fabric' || kind === 'carpet') v = 0.5 + ((x % 4 < 2) !== (y % 4 < 2) ? 0.11 : -0.11) + n * 0.12;
      if (kind === 'stone') v = 0.55 + n * 0.16 + Math.sin(x * 0.03 + Math.sin(y * 0.02) * 4) * 0.035;
      if (kind === 'water') v = 0.5 + Math.sin(x * Math.PI / 16 + Math.sin(y * Math.PI / 32) * 3) * 0.16 + Math.sin(y * Math.PI / 8) * 0.07;
      const i = (y * size + x) * 4;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = Math.round(v * 255); data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 8;
    bump.repeat.set(kind === 'wood' ? 2 : kind === 'carpet' ? 12 : 3, kind === 'wood' ? 1 : kind === 'carpet' ? 12 : 3);
    surfaceMaps.set(kind, bump); surfaceTextures.add(bump);
  }
  const roughness = { wood: 0.38, fabric: 0.94, carpet: 0.98, stone: 0.7, water: 0.13 }[kind] ?? 0.6;
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0,
    bumpMap: bump, bumpScale: kind === 'water' ? 0.13 : kind === 'wood' ? 0.012 : 0.018,
    ...(kind === 'wood' ? { clearcoat: 0.22, clearcoatRoughness: 0.35 } : {}),
    ...(kind === 'fabric' ? { sheen: 0.45, sheenRoughness: 0.85, sheenColor: new THREE.Color('#d8d5d0') } : {}), ...options });
}

export function prepareShadows(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || obj.material === hitMat || obj.userData.noShadow) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    obj.castShadow = materials.some((m) => m.visible && !m.transparent);
    obj.receiveShadow = true;
  });
}
