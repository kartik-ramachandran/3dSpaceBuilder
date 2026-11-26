/*
 * Realistic building shells for the residential development (scripts/bake/build_development.py), drawn
 * from the shared asset library: each storey module is instanced at every storey of every building.
 */
import * as THREE from 'three';
import { loadLibrary } from './asset-library.js';

/** Footprint each module was modelled at (metres); placements scale x / z to the layout's real size. */
export const MODULE_SIZE = { lowrise: { w: 30, d: 11 }, tower: { w: 26, d: 14 } };
const NAMES = ['lowrise_base', 'lowrise_floor', 'lowrise_roof', 'tower_floor', 'tower_crown'];

/** { [module]: parts } with materials of their own, so the development can fade its glass without touching other users. */
export async function loadBuildingModules() {
  const lib = await loadLibrary('buildings');
  const own = new Map();
  const mine = (m) => { if (!own.has(m)) own.set(m, m.clone()); return own.get(m); };
  return Object.fromEntries(NAMES.map((n) => [n, lib.get(n).map((p) => ({ ...p, material: mine(p.material) }))]));
}

/** Instances `parts` (one module) at `matrices`. Returns the instanced meshes, already added to `parent`. */
export function instanceModule(parent, parts, matrices, name) {
  return parts.map(({ geometry, material, exterior, glass }) => {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    mesh.name = `${name} · ${material.name}`;
    mesh.castShadow = !glass; mesh.receiveShadow = !glass; mesh.userData.noShadow = glass;
    mesh.userData.exterior = exterior; mesh.userData.glass = glass;
    parent.add(mesh); return mesh;
  });
}

/** A module placed at (x, y, z), scaled to the real footprint (the glTF export already turned Blender's Z-up into Y-up). */
export function placement(x, y, z, sx = 1, sz = 1) {
  return new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(sx, 1, sz));
}
