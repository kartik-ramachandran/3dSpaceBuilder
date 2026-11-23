/* Material-separated, instanced furniture. Dimensions are in metres. */
import * as THREE from 'three';
import { box, rounded as pad, cyl, merge, std, surface, instanced } from './helpers.js';

export function furniturePalette(design = {}) {
  return {
    wood: surface('wood', design.woodColor || '#9e724a'),
    metal: std('#adb4b8', { metalness: 0.92, roughness: 0.26 }),
    dark: std('#282c30', { metalness: 0.3, roughness: 0.4 }),
    shell: new THREE.MeshPhysicalMaterial({ color: design.wallColor || '#e6e2d9', roughness: 0.34, clearcoat: 0.3 }),
    linen: surface('fabric', '#eee9df'),
    screen: std('#172b3b', { roughness: 0.18, metalness: 0.15, emissive: '#52798e', emissiveIntensity: 0.16 }),
    light: std('#fff1d6', { emissive: '#ffe0b1', emissiveIntensity: 0.8, roughness: 0.7 }),
  };
}

function model() {
  const parts = {};
  return { parts, add: (material, ...geometries) => (parts[material] ??= []).push(...geometries) };
}
function leg(x, z, h = 0.7) { return cyl(0.024, 0.032, h, x, h / 2, z); }
function chairParts(m, ox = 0, oz = 0, rotation = 0, office = true) {
  const local = model();
  local.add('fabric', pad(0.49, 0.105, 0.49, 0, 0.48, 0, 0.05), pad(0.47, 0.5, 0.085, 0, 0.79, -0.23, 0.04));
  local.add('dark', pad(0.49, 0.46, 0.045, 0, 0.78, -0.285), box(0.055, 0.3, 0.06, 0, 0.56, -0.24));
  if (office) {
    local.add('metal', cyl(0.035, 0.04, 0.32, 0, 0.26, 0));
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      local.add('metal', pad(0.035, 0.035, 0.29, 0, 0.1, 0.13, 0.014).rotateY(a));
      local.add('dark', cyl(0.042, 0.042, 0.055).rotateZ(Math.PI / 2).translate(Math.sin(a) * 0.27, 0.065, Math.cos(a) * 0.27));
    }
    for (const s of [-1, 1]) {
      local.add('metal', box(0.025, 0.18, 0.025, s * 0.28, 0.59, -0.02));
      local.add('dark', pad(0.065, 0.035, 0.28, s * 0.28, 0.69, 0.01, 0.015));
    }
  } else {
    for (const x of [-0.2, 0.2]) for (const z of [-0.18, 0.18]) local.add('metal', leg(x, z, 0.43));
  }
  for (const [key, geometries] of Object.entries(local.parts)) m.add(key, ...geometries.map((g) => g.rotateY(rotation).translate(ox, 0, oz)));
}

function desk() {
  const m = model();
  m.add('wood', pad(1.5, 0.045, 0.75, 0, 0.75, 0, 0.016));
  for (const x of [-0.65, 0.65]) {
    m.add('metal', box(0.045, 0.69, 0.045, x, 0.365, 0), pad(0.07, 0.035, 0.64, x, 0.035, 0));
  }
  m.add('dark', box(1.3, 0.06, 0.04, 0, 0.66, -0.15), pad(0.61, 0.36, 0.035, 0, 1.075, -0.23, 0.012), box(0.045, 0.15, 0.04, 0, 0.85, -0.23), pad(0.23, 0.015, 0.16, 0, 0.786, -0.22));
  m.add('screen', box(0.575, 0.316, 0.006, 0, 1.08, -0.208));
  m.add('dark', pad(0.4, 0.014, 0.14, -0.03, 0.783, 0.13, 0.006), pad(0.055, 0.025, 0.085, 0.31, 0.79, 0.14, 0.012));
  m.add('linen', pad(0.16, 0.018, 0.22, -0.56, 0.786, 0.05, 0.008));
  m.add('shell', cyl(0.035, 0.03, 0.09, 0.57, 0.82, -0.13));
  chairParts(m, 0, 0.8, Math.PI);
  return m;
}
function table() {
  const m = model();
  m.add('wood', pad(1.6, 0.065, 7.5, 0, 0.76, 0, 0.03));
  for (const z of [-2.6, 0, 2.6]) {
    m.add('dark', box(0.1, 0.68, 0.5, 0, 0.37, z), pad(1.1, 0.04, 0.6, 0, 0.04, z));
    m.add('metal', pad(0.18, 0.008, 0.3, 0, 0.798, z));
  }
  for (const z of [-3, -1.5, 0, 1.5, 3]) for (const s of [-1, 1]) chairParts(m, s * 1.2, z, -s * Math.PI / 2);
  return m;
}
function sofa() {
  const m = model();
  m.add('fabric', pad(2.3, 0.24, 0.9, 0, 0.29, 0, 0.09), pad(2.28, 0.65, 0.2, 0, 0.61, -0.39, 0.065));
  for (const x of [-1.06, 1.06]) m.add('fabric', pad(0.19, 0.44, 0.9, x, 0.48, 0, 0.07));
  for (const x of [-0.64, 0, 0.64]) {
    m.add('fabric', pad(0.62, 0.16, 0.67, x, 0.46, 0.065, 0.065), pad(0.61, 0.4, 0.14, x, 0.7, -0.24, 0.06));
  }
  for (const x of [-0.92, 0.92]) for (const z of [-0.31, 0.31]) m.add('wood', leg(x, z, 0.17));
  m.add('linen', pad(0.33, 0.33, 0.13, -0.77, 0.67, -0.08, 0.06).rotateZ(0.09));
  m.add('wood', cyl(0.48, 0.48, 0.045, 0, 0.44, 1.18, 48));
  for (let i = 0; i < 3; i++) m.add('dark', leg(Math.cos(i * 2.094) * 0.3, 1.18 + Math.sin(i * 2.094) * 0.3, 0.42));
  m.add('linen', pad(0.22, 0.025, 0.29, 0.05, 0.476, 1.18));
  return m;
}
function bed() {
  const m = model();
  m.add('wood', pad(1.94, 0.24, 2.14, 0, 0.25, 0, 0.04), pad(2.06, 1.16, 0.12, 0, 0.65, -1.08));
  m.add('fabric', pad(1.88, 0.75, 0.09, 0, 0.79, -0.998, 0.04), pad(1.92, 0.045, 0.63, 0, 0.65, 0.68, 0.018));
  m.add('linen', pad(1.88, 0.22, 2.03, 0, 0.48, 0, 0.08), pad(1.92, 0.08, 1.5, 0, 0.615, 0.24, 0.035));
  for (const x of [-0.46, 0.46]) m.add('linen', pad(0.74, 0.14, 0.43, x, 0.65, -0.72, 0.065));
  for (const x of [-0.82, 0.82]) for (const z of [-0.92, 0.92]) m.add('dark', leg(x, z, 0.16));
  for (const s of [-1, 1]) {
    m.add('wood', pad(0.44, 0.42, 0.46, s * 1.27, 0.3, -0.81));
    m.add('metal', box(0.14, 0.012, 0.018, s * 1.27, 0.38, -0.57), cyl(0.09, 0.09, 0.018, s * 1.27, 0.52, -0.81), cyl(0.013, 0.013, 0.29, s * 1.27, 0.67, -0.81));
    m.add('light', cyl(0.11, 0.16, 0.2, s * 1.27, 0.87, -0.81));
  }
  return m;
}
function aircraftSeat({ type, width, pitch }) {
  const m = model(), premium = ['first', 'business'].includes(type);
  const w = width * (premium ? 0.60 : 0.86), depth = Math.min(pitch * 0.48, 0.62);
  m.add('fabric', pad(depth, 0.14, w, 0.02, 0.47, 0, 0.05), pad(0.13, 0.7, w, -depth * 0.48, 0.82, 0, 0.055), pad(0.15, 0.22, w * 0.82, -depth * 0.45, 1.16, 0, 0.055));
  m.add('shell', pad(0.06, 0.63, w * 1.03, -depth * 0.65, 0.81, 0, 0.022));
  m.add('dark', box(depth * 0.72, 0.045, w * 0.8, 0, 0.35, 0));
  for (const s of [-1, 1]) {
    m.add('metal', box(0.035, 0.3, 0.035, -0.1, 0.2, s * w * 0.35), box(0.04, 0.22, 0.025, -0.03, 0.57, s * (w / 2 + 0.01)));
    m.add('dark', pad(depth * 0.9, 0.045, 0.055, 0.035, 0.69, s * (w / 2 + 0.01), 0.017));
    m.add('dark', box(0.04, 0.012, w * 0.44, 0.08, 0.55, s * w * 0.25));
  }
  m.add('metal', box(0.065, 0.019, 0.048, 0.08, 0.56, 0));
  m.add('screen', box(0.008, 0.18, w * 0.64, -depth * 0.686, 0.92, 0));
  m.add('shell', pad(0.018, 0.21, w * 0.74, -depth * 0.69, 0.66, 0, 0.007));
  if (premium) {
    m.add('shell', pad(pitch * 0.87, 1.04, 0.07, 0, 0.57, width * 0.46));
    m.add('wood', pad(pitch * 0.44, 0.045, width * 0.22, pitch * 0.12, 0.66, width * 0.32));
    m.add('fabric', pad(Math.min(0.4, pitch * 0.2), 0.22, w, pitch * 0.37, 0.33, 0));
    if (type === 'first') m.add('shell', pad(pitch * 0.87, 1.15, 0.07, 0, 0.62, -width * 0.46));
  }
  return m;
}

export function addFurniture(group, type, positions, fabric, palette, options = {}, rotations = null) {
  if (!positions.length) return [];
  const meshes = [];
  const m = type === 'desk' ? desk() : type === 'table' ? table() : type === 'sofa' ? sofa() : type === 'bed' ? bed() : type === 'aircraft' ? aircraftSeat(options) : model();
  if (type === 'chair') chairParts(m, 0, 0, 0, false);
  if (type === 'stage') { m.add('wood', pad(6, 0.45, 3.2, 0, 0.25, 0)); m.add('dark', box(6, 0.05, 3.2, 0, 0.5, 0)); }
  for (const [key, parts] of Object.entries(m.parts)) {
    const mesh = instanced(merge(parts), key === 'fabric' ? fabric : palette[key], positions, rotations);
    mesh.name = `${type} / ${key}`;
    if (options.zone) {
      mesh.userData.zone = options.zone;
      mesh.userData.seatParts = meshes;
      mesh.userData.seatLabels = options.seatLabels;
    }
    meshes.push(mesh);
    group.add(mesh);
  }
  return meshes;
}
