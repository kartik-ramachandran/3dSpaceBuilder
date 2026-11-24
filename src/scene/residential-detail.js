import * as THREE from 'three';
import { box, cyl, merge, std, surface, instanced, gridTexture } from './helpers.js';
import { DEV } from '../spec/site-layout.js';
import { rng } from '../util.js';

// Batched architectural detail keeps the 100-storey skyline inexpensive to render.
export function buildResidentialLandscape(layout) {
  const group = new THREE.Group(); group.name = 'Residential gardens and central towers';
  const labels = [], stone = [], bronze = [], windows = [], crowns = [];
  const height = DEV.BASE + 100 * DEV.FH;
  const z = layout.towerZ;
  const width = layout.towerWidth, depth = layout.towerDepth;
  for (let c = 0; c < layout.cols; c++) {
    const x = -layout.siteX / 2 + layout.BX / 2 + c * (layout.BX + DEV.GAP_X);
    const tower = new THREE.Group(); tower.name = `Central residence ${c + 1} · 100 storeys`;
    tower.userData.storeys = 100; tower.userData.building = layout.buildings + c + 1;
    tower.position.set(x, 0, z); group.add(tower);
    const tex = gridTexture({ cols: 8, rows: 100, w: 512, h: 4096, frame: '#79766c', lit: '#f7d9a2', dark: '#344650', litP: 0.24, seed: 100 + c, pad: [7, 5] });
    const facade = new THREE.Mesh(new THREE.BoxGeometry(width, 320, depth), new THREE.MeshPhysicalMaterial({ color: '#d9dbd5', map: tex, roughness: 0.24, metalness: 0.24, clearcoat: 0.7, emissive: '#ffce8b', emissiveMap: tex, emissiveIntensity: 0.15 }));
    facade.position.y = DEV.BASE + 160; tower.add(facade);
    for (let f = 0; f <= 100; f++) {
      const y = DEV.BASE + f * DEV.FH;
      stone.push(box(width + 1.2, 0.22, depth + 1.4, x, y, z));
      if (f < 100) for (const side of [-1, 1]) {
        // Recessed balconies: projecting slab, dark railing, glazed infill.
        stone.push(box(width * 0.7, 0.18, 1.3, x, y, z + side * (depth / 2 + 0.75)));
        bronze.push(box(width * 0.7, 0.055, 0.07, x, y + 1.08, z + side * (depth / 2 + 1.35)));
        windows.push(box(width * 0.7, 0.85, 0.045, x, y + 0.56, z + side * (depth / 2 + 1.35)));
      }
    }
    for (const dx of [-width / 2, -width * 0.30, width * 0.30, width / 2]) {
      stone.push(box(0.85, height + 3, depth + 1.1, x + dx, (height + 3) / 2, z));
      crowns.push(box(1.2, 7, 1.2, x + dx, height + 3, z - depth / 2), box(1.2, 7, 1.2, x + dx, height + 3, z + depth / 2));
    }
    crowns.push(box(width + 3, 0.9, depth + 3, x, height + 6, z));
    labels.push({ text: `Building ${String.fromCharCode(65 + layout.buildings + c)} \u00b7 100 storeys`, pos: new THREE.Vector3(x, height + 10, z) });
  }
  group.add(new THREE.Mesh(merge(stone), surface('stone', '#c9baa4')));
  group.add(new THREE.Mesh(merge(crowns), surface('stone', '#e4d5bb')));
  group.add(new THREE.Mesh(merge(bronze), std('#554d40', { metalness: 0.65, roughness: 0.3 })));
  group.add(new THREE.Mesh(merge(windows), new THREE.MeshPhysicalMaterial({ color: '#739295', roughness: 0.18, metalness: 0.25, clearcoat: 1 })));

  const random = rng(901), trunks = [], leaves = [], treePositions = [], paths = [], beds = [];
  for (let row = 0; row < layout.rows; row++) {
    const oz = layout.origin(row * layout.cols + 1).z;
    for (const side of [-1, 1]) {
      const pathZ = oz + side * (DEV.D / 2 + 4);
      paths.push(box(layout.siteX + 8, 0.18, 2.5, 0, 0.49, pathZ));
      beds.push(box(layout.siteX + 8, 0.10, 1.6, 0, 0.46, oz + side * (DEV.D / 2 + 2.1)));
      for (let x = -layout.siteX / 2 - 3; x <= layout.siteX / 2 + 3; x += 8) treePositions.push(new THREE.Vector3(x, 0.5, oz + side * (DEV.D / 2 + 2.1)));
    }
  }
  group.add(new THREE.Mesh(merge(paths), surface('stone', '#b8b3a6')));
  group.add(new THREE.Mesh(merge(beds), surface('stone', '#65734a', { roughness: 1 })));
  for (const p of treePositions) {
    trunks.push(p);
    for (let k = 0; k < 15; k++) {
      const a = k * 2.399, radius = 0.6 + random() * 1.2;
      leaves.push(new THREE.Vector3(p.x + Math.cos(a) * radius, 3.5 + random() * 2.4, p.z + Math.sin(a) * radius));
    }
  }
  group.add(instanced(cyl(0.12, 0.23, 3.7, 0, 1.85, 0, 8), surface('wood', '#66513c'), trunks));
  const foliageMat = std('#426339', { roughness: 0.95 });
  const wind = { value: 0 };
  foliageMat.onBeforeCompile = shader => {
    shader.uniforms.windTime = wind;
    shader.vertexShader = 'uniform float windTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.x += sin(windTime * 1.1 + instanceMatrix[3].x * 0.6 + instanceMatrix[3].z) * 0.07 * (position.y + 1.5);`);
  };
  const canopy = instanced(new THREE.SphereGeometry(1.15, 9, 7).scale(1, 1.15, 1), foliageMat, leaves);
  leaves.forEach((p, i) => canopy.setColorAt(i, new THREE.Color().setHSL(0.25 + random() * 0.06, 0.28 + random() * 0.2, 0.62 + random() * 0.3)));
  group.add(canopy);

  // Walkers stay on the dedicated longitudinal footpaths, turning at their ends.
  const walkers = [], skin = std('#b98c6f'), trousers = std('#303b44'), shoes = std('#242724');
  const headGeo = new THREE.SphereGeometry(0.115, 10, 8), limbGeo = cyl(0.055, 0.045, 0.65, 0, -0.325, 0, 8);
  for (let i = 0; i < 36; i++) {
    const row = i % layout.rows, side = i % 2 ? 1 : -1;
    const pathZ = layout.origin(row * layout.cols + 1).z + side * (DEV.D / 2 + 4);
    const person = new THREE.Group(); person.name = 'Footpath pedestrian';
    const shirt = std(['#b8aa8d', '#466278', '#b56a4c', '#7a8070', '#ded8ca'][i % 5]);
    const torso = new THREE.Mesh(cyl(0.17, 0.13, 0.56, 0, 1.13, 0, 10), shirt); person.add(torso);
    const head = new THREE.Mesh(headGeo, skin); head.position.y = 1.55; person.add(head);
    const limbs = [];
    for (let j = 0; j < 4; j++) {
      const pivot = new THREE.Group(); pivot.position.set(j < 2 ? (j ? 0.095 : -0.095) : (j === 2 ? -0.21 : 0.21), j < 2 ? 0.87 : 1.37, 0);
      pivot.add(new THREE.Mesh(limbGeo, j < 2 ? trousers : shirt));
      if (j < 2) { const shoe = new THREE.Mesh(box(0.12, 0.09, 0.24, 0, -0.68, 0.035), shoes); pivot.add(shoe); }
      person.add(pivot); limbs.push(pivot);
    }
    const span = Math.max(3, layout.siteX / 2 - 2), speed = 0.9 + random() * 0.55;
    walkers.push({ person, limbs, span, speed, offset: random() * span * 4, z: pathZ + (i % 3 - 1) * 0.48 }); group.add(person);
  }
  return { group, labels, height: height + 7, update(dt, t) {
    wind.value = t;
    for (const w of walkers) {
      const phase = (w.offset + t * w.speed) % (4 * w.span), dir = phase < 2 * w.span ? 1 : -1;
      w.person.position.set(phase < 2 * w.span ? -w.span + phase : 3 * w.span - phase, 0.435, w.z);
      w.person.rotation.y = dir * Math.PI / 2;
      w.limbs.forEach((limb, j) => limb.rotation.x = Math.sin(t * w.speed * 5 + w.offset + (j === 0 || j === 3 ? 0 : Math.PI)) * (j < 2 ? 0.42 : 0.3));
    }
  } };
}

// Decorative vehicle components share the exact instance transforms of their body batch.
export function detailTraffic(group, bodies, truck = false) {
  const parts = [], add = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, bodies.count); m.instanceMatrix = bodies.instanceMatrix; m.frustumCulled = false; group.add(m); parts.push(m); };
  const wheels = [], rims = [];
  for (const x of truck ? [-3.5, -2.3, 5.9] : [-1.35, 1.35]) for (const z of [-1, 1]) {
    wheels.push(new THREE.CylinderGeometry(truck ? 0.49 : 0.34, truck ? 0.49 : 0.34, 0.22, 12).rotateX(Math.PI / 2).translate(x, truck ? 0.5 : 0.36, z * (truck ? 1.22 : 0.88)));
    rims.push(new THREE.CylinderGeometry(0.20, 0.20, 0.235, 10).rotateX(Math.PI / 2).translate(x, truck ? 0.5 : 0.36, z * (truck ? 1.22 : 0.88)));
  }
  add(merge(wheels), std('#181b1c', { roughness: 0.95 })); add(merge(rims), std('#b6b9bb', { metalness: 0.85, roughness: 0.24 }));
  add(truck ? box(1.8, 0.9, 2.43, 6.4, 2.3, 0) : merge([box(1.65, 0.49, 1.625, -0.15, 1.5, 0), box(0.05, 0.5, 1.4, 0.92, 1.48, 0), box(0.05, 0.46, 1.4, -1.31, 1.48, 0)]), new THREE.MeshPhysicalMaterial({ color: '#253b48', metalness: 0.25, roughness: 0.13, clearcoat: 1 }));
  for (const front of [true, false]) {
    const x = truck ? (front ? 7.52 : -5.02) : (front ? 2.12 : -2.12);
    add(merge([-0.64, 0.64].map(z => box(0.045, 0.18, 0.38, x, 0.83, z))), std(front ? '#fff0cb' : '#8a1b12', { emissive: front ? '#ffe0a0' : '#ff2918', emissiveIntensity: front ? 0.7 : 0.5 }));
  }
  bodies.frustumCulled = false;
  return parts;
}
