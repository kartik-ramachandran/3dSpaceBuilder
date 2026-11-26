/*
 * Residential development: rows of low-rise apartment blocks on a landscaped site. Every apartment
 * is its own zone (own value, own hit box, own floor tile and furniture) so it can be tapped,
 * priced and flown into. Facades fade to glass like the hotel tower.
 */
import * as THREE from 'three';
import { lerp } from '../util.js';
import { box, merge, std, surface, hitMat, instanced, gridTexture, repeatTex, zoneMats, m4 } from './helpers.js';
import { buildSurroundings } from './surroundings.js';
import { addFurniture, furniturePalette } from './furniture.js';
import { DEV, developmentLayout } from '../spec/site-layout.js';
import { buildResidentialLandscape } from './residential-detail.js';
import { buildSiteLayers } from './site-layers.js';
import { loadBuildingModules, instanceModule, placement, MODULE_SIZE } from './baked-buildings.js';
import { loadLibrary } from './asset-library.js';
import { upgradeSurroundings } from './real-surroundings.js';

const { UW, D, FH, BASE, GAP_Z, BALCONY } = DEV;

// Yield until the procedural scene has painted before loading detailed assets.
const afterPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

export function buildDevelopment(sp) {
  let disposed = false;
  const group = new THREE.Group();
  const zones = new Map();
  const palette = furniturePalette(sp.design);
  const { buildings, rows, floors, unitsPerFloor } = sp.shell;
  const layout = developmentLayout(sp.shell);         // shared with the valuation model's location effects
  const { BX, siteX, siteZ, H } = layout;              // BX: building width along x
  const origin = (b) => layout.origin(b);              // { x, z, row, col }; row 0 at the front (+z)

  // shared shell pieces
  const slabMat = std('#d4cec3'), roofMat = std('#b9b2a6'), wallMat = std(sp.design?.wallColor || '#e2ddd4', { roughness: 0.85 });
  const railMat = std('#3a3f47', { metalness: 0.4, roughness: 0.4 });
  const balustradeMat = new THREE.MeshPhysicalMaterial({ color: '#cfe0e4', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false });
  const winTex = gridTexture({ cols: 2, rows: 1, frame: '#1b2433', lit: '#ffd59a', dark: '#2d4262', litP: 0.38, seed: 21 });
  const front = repeatTex(winTex, unitsPerFloor, floors), side = repeatTex(winTex, D / UW, floors);
  winTex.dispose();
  const facMat = (t) => new THREE.MeshPhysicalMaterial({ color: '#d0dad8', map: t, emissive: '#ffe2b9', emissiveMap: t, emissiveIntensity: 0.12, transparent: true, roughness: 0.18, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15 });
  const fSide = facMat(side), fFront = facMat(front), none = new THREE.MeshBasicMaterial({ visible: false });
  const facades = [];
  const slabs = [], roofs = [], walls = [], balconies = [], rails = [], panes = [], paths = [];

  for (let b = 1; b <= buildings; b++) {
    const o = origin(b);
    for (let f = 0; f <= floors; f++) slabs.push(new THREE.Vector3(o.x, BASE + f * FH, o.z));
    roofs.push(box(BX + 0.8, 0.7, D + 0.8, o.x, H + 0.35, o.z));
    roofs.push(box(BX + 1.2, BASE, D + 1.2, o.x, BASE / 2, o.z));                       // plinth
    const facade = new THREE.Mesh(new THREE.BoxGeometry(BX + 0.2, floors * FH, D + 0.2), [fSide, fSide, none, none, fFront, fFront]);
    facade.position.set(o.x, BASE + floors * FH / 2, o.z); facade.renderOrder = 2;
    group.add(facade); facades.push(facade);
    paths.push(box(3, 0.08, GAP_Z * 0.6, o.x, 0.45, o.z + D / 2 + GAP_Z * 0.3));      // front path to the street
  }
  const simpleShell = [...facades];                   // replaced by the Blender-modelled buildings once they load
  simpleShell.push(group.add(instanced(box(BX + 0.6, 0.3, D + 0.6), slabMat, slabs)).children.at(-1));
  simpleShell.push(group.add(new THREE.Mesh(merge(roofs), roofMat)).children.at(-1));
  group.add(new THREE.Mesh(merge(paths), surface('stone', '#cfc8ba')));

  // apartments
  const blockAt = [];                                  // per-apartment volume centres for the valuation colour layer
  const towerMats = { floor: std('#d4cec3'), furn: std('#8c9293') };
  const materialOwner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [towerMats.floor, towerMats.furn]);
  materialOwner.visible = false; group.add(materialOwner);
  const towerHitGeo = new THREE.BoxGeometry(layout.towerWidth / unitsPerFloor, FH, layout.towerDepth + 2.8);
  sp.zones.forEach((z) => {
    if (z.tower) {
      const o = origin(z.building), uw = layout.towerWidth / unitsPerFloor;
      const ux = o.x - layout.towerWidth / 2 + (z.unit - 0.5) * uw;
      const y = BASE + (z.floor - 1) * FH;
      const frontZ = o.z + layout.towerDepth / 2 + 1.4;
      const hit = new THREE.Mesh(towerHitGeo, hitMat);
      hit.position.set(ux, y + FH / 2, o.z); hit.userData.zone = z.id; group.add(hit);
      blockAt.push({ id: z.id, pos: new THREE.Vector3(ux, y + FH / 2, o.z), scale: new THREE.Vector3((uw - 0.15) / (UW - 0.45), 1, (layout.towerDepth + 2.9) / (D - 0.5)) });
      zones.set(z.id, { z, mats: towerMats, hits: [hit], anchor: new THREE.Vector3(ux, y + 2, frontZ + 0.4),
        center: new THREE.Vector3(o.x, y + FH / 2, o.z),
        seats: [{ pos: new THREE.Vector3(ux, y + 1.55, frontZ - 0.4), label: `Apartment ${z.name}`, note: `Level ${z.floor} · ${z.bedrooms} bed · ${z.area} m² · dummy value` }],
        look: new THREE.Vector3(0, -0.12, 1).normalize(), floorsLabel: `building ${String.fromCharCode(64 + z.building)} · level ${z.floor}`, furniture: [] });
      return;
    }
    const o = origin(z.building);
    const mats = zoneMats(z, sp.design);
    const y = BASE + (z.floor - 1) * FH + 0.16;
    const ux = o.x - BX / 2 + (z.unit - 0.5) * UW;
    const fz = o.z + D / 2;                                // front (balcony) face
    group.add(new THREE.Mesh(box(UW - 0.16, 0.06, D - 0.2, ux, y + 0.03, o.z), mats.floor));
    const furn = [];
    furn.push(...addFurniture(group, 'bed', [new THREE.Vector3(ux - UW * 0.18, y, o.z - D * 0.22)], mats.furn, palette));
    furn.push(...addFurniture(group, 'sofa', [new THREE.Vector3(ux + UW * 0.12, y, o.z + D * 0.18)], mats.furn, palette));
    if (z.unit > 1) walls.push(box(0.12, FH - 0.35, D - 0.4, ux - UW / 2, y + (FH - 0.35) / 2, o.z));
    walls.push(box(UW - 0.3, FH - 0.35, 0.1, ux, y + (FH - 0.35) / 2, o.z - D * 0.02));  // bedroom / living split
    balconies.push(box(UW - 0.6, 0.18, BALCONY, ux, y - 0.07, fz + BALCONY / 2));
    panes.push(box(UW - 0.6, 0.95, 0.04, ux, y + 0.48, fz + BALCONY - 0.03));          // glass balustrade
    rails.push(box(UW - 0.6, 0.06, 0.08, ux, y + 1.0, fz + BALCONY - 0.03));          // handrail
    blockAt.push({ id: z.id, pos: new THREE.Vector3(ux, y + (FH - 0.55) / 2 + 0.02, o.z) });
    const hit = new THREE.Mesh(box(UW, FH, D + BALCONY, ux, y - 0.16 + FH / 2, o.z + BALCONY / 2), hitMat);
    hit.userData.zone = z.id; group.add(hit);
    const letter = String.fromCharCode(64 + z.building);
    zones.set(z.id, {
      z, mats, hits: [hit],
      anchor: new THREE.Vector3(ux, y + FH * 0.7, fz + BALCONY + 0.4),
      center: new THREE.Vector3(o.x, y + FH / 2, o.z),
      seats: [{ pos: new THREE.Vector3(ux, y + 1.55, fz - 1.2),  // just inside the glass, so the balcony and rail frame the view
         label: `Apartment ${z.name}`, note: `building ${letter} Â· level ${z.floor} Â· ${z.bedrooms} bed Â· ${z.area} mÂ²` }],
      look: new THREE.Vector3(0, -0.12, 1).normalize(),
      floorsLabel: `building ${letter} Â· level ${z.floor}`,
      furniture: furn,
    });
  });
  group.add(new THREE.Mesh(merge(walls), wallMat));
  simpleShell.push(group.add(new THREE.Mesh(merge(balconies), slabMat)).children.at(-1));
  simpleShell.push(group.add(new THREE.Mesh(merge(rails), railMat)).children.at(-1));
  const glassRail = new THREE.Mesh(merge(panes), balustradeMat); glassRail.userData.noShadow = true; group.add(glassRail); simpleShell.push(glassRail);

  const landscape = buildResidentialLandscape(layout);
  group.add(landscape.group);

  // Realistic shells modelled in Blender (scripts/bake/build_development.py): instanced per storey, AO baked.
  const real = new THREE.Group(); real.name = 'Blender-modelled buildings';
  const fading = [];                                   // [material, opacity when solid]
  let glassNow = 0, viewNow = false;
  const LR = MODULE_SIZE.lowrise, TWR = MODULE_SIZE.tower;
  const buildingsReady = afterPaint().then(() => disposed ? null : loadBuildingModules()).then((m) => {
    if (!m) return;
    if (disposed) {
      new Set(Object.values(m).flat().map(p => p.material)).forEach(mat => mat.dispose());
      return;
    }
    const lowSx = BX / LR.w, towSx = layout.towerWidth / TWR.w, towSz = layout.towerDepth / TWR.d;
    const lr = { base: [], floor: [], roof: [] }, tw = { base: [], floor: [], crown: [] };
    for (let b = 1; b <= buildings; b++) {
      const o = origin(b);
      lr.base.push(placement(o.x, 0, o.z, lowSx));
      for (let f = 0; f < floors; f++) lr.floor.push(placement(o.x, BASE + f * FH - 0.15, o.z, lowSx));   // slab centred on the storey line
      lr.roof.push(placement(o.x, BASE + floors * FH - 0.15, o.z, lowSx));
    }
    for (let b = buildings + 1; b <= layout.totalBuildings; b++) {
      const o = origin(b);
      tw.base.push(placement(o.x, 0, o.z, layout.towerWidth / LR.w * 1.04, (layout.towerDepth + 2.6) / LR.d));
      for (let f = 0; f < layout.maxFloors; f++) tw.floor.push(placement(o.x, BASE + f * FH, o.z, towSx, towSz));
      tw.crown.push(placement(o.x, BASE + layout.maxFloors * FH, o.z, towSx, towSz));
    }
    const meshes = [
      ...instanceModule(real, m.lowrise_base, lr.base, 'Low-rise plinth'), ...instanceModule(real, m.lowrise_floor, lr.floor, 'Low-rise floor'),
      ...instanceModule(real, m.lowrise_roof, lr.roof, 'Low-rise roof'), ...instanceModule(real, m.lowrise_base, tw.base, 'Tower plinth'),
      ...instanceModule(real, m.tower_floor, tw.floor, 'Tower floor'), ...instanceModule(real, m.tower_crown, tw.crown, 'Tower crown'),
    ];
    const seen = new Set();
    for (const mesh of meshes) {
      if (!(mesh.userData.exterior || /curtain|interior wall/i.test(mesh.material.name)) || seen.has(mesh.material)) continue;
      seen.add(mesh.material); fading.push([mesh.material, mesh.material.opacity]); mesh.userData.fades = true;
    }
    simpleShell.forEach((o) => { o.visible = false; }); landscape.shell.forEach((o) => { o.visible = false; });
    group.add(real); applyRealGlass(glassNow); setRealView(viewNow);
    // tower apartments' colour blocks sit inside the glazing (the simple tower had balconies out to the block edge)
    blockAt.forEach(({ pos, scale }, i) => { if (scale) blocks.setMatrixAt(i, m4.compose(pos, q, new THREE.Vector3(scale.x, 1, (layout.towerDepth - 0.9) / (D - 0.5)))); });
    blocks.instanceMatrix.needsUpdate = true; showBlocks();
  }).catch((e) => console.warn('Blender buildings unavailable, keeping the simple shells', e));
  const applyRealGlass = (g) => {
    for (const [mat, solid] of fading) {
      mat.opacity = lerp(solid, Math.min(solid, 0.07), g);
      const t = mat.userData.glassTransparent ?? mat.transparent;   // glazing is always transparent
      mat.userData.glassTransparent = t;
      const want = t || g > 0.01;
      if (mat.transparent !== want) { mat.transparent = want; mat.needsUpdate = true; }
      mat.depthWrite = !want || (!t && g < 0.02);
    }
  };
  const setRealView = (on) => real.children.forEach((o) => { if (o.userData.exterior) o.visible = !on; });

  // Valuation colour layer: one solid block per apartment, coloured per instance, hidden until switched on.
  const blockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.02 });
  const blocks = new THREE.InstancedMesh(box(UW - 0.45, FH - 0.55, D - 0.5), blockMat, Math.max(1, blockAt.length));
  const unitIndex = new Map(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), white = new THREE.Color('#ffffff');
  blockAt.forEach(({ id, pos, scale }, i) => { unitIndex.set(id, i); blocks.setMatrixAt(i, m4.compose(pos, q, scale || one)); blocks.setColorAt(i, white); });
  blocks.count = blockAt.length; blocks.visible = false; blocks.userData.noShadow = true;
  group.add(blocks);
  // behind the real glazing the colour blocks show only as the facades turn to glass (the simple facades were opaque)
  let layerOn = false;
  const showBlocks = () => { blocks.visible = layerOn && (!real.parent || glassNow > 0.02); };
  const labels = [...landscape.labels];
  for (let b = 1; b <= buildings; b++) { const o = origin(b); labels.push({ text: `Building ${String.fromCharCode(64 + b)}`, pos: new THREE.Vector3(o.x, H + 2.4, o.z) }); }

  // Site layers (river, roads, motorway, flood, solar): toggled from the valuation panel
  const site = buildSiteLayers(layout);
  labels.push(...site.labels);
  const env = buildSurroundings('office', 'park', siteX, siteZ, site.clearBands);
  const root = new THREE.Group(); root.add(env, group, site.group);
  // Blender cars, people, trees, street lights, neighbourhood and real textures (real-surroundings.js)
  let realEnv = null;
  buildingsReady.then(afterPaint).then(() => disposed ? null : loadLibrary()).then((lib) => {
    if (!disposed && lib) realEnv = upgradeSurroundings({ lib, site, landscape, env });
  })
    .catch((e) => console.warn('Blender surroundings unavailable, keeping the simple ones', e));
  return {
    dispose() { disposed = true; },
    labels, layout, siteLayers: site,
    valuationLayer: {
      setVisible(on) { layerOn = on; showBlocks(); },
      setColor(id, color) { const i = unitIndex.get(id); if (i === undefined) return; blocks.setColorAt(i, color); blocks.instanceColor.needsUpdate = true; },
    },
    setWireframe(on) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m !== hitMat && 'wireframe' in m) m.wireframe = on; });
      });
    },
    setContext(on) { env.visible = on; },
    kind: 'development', group: root, zones, glassLabel: 'Glass facades', levels: layout.maxFloors,
    // frame the site plus the river in front and the motorway behind
    fitBox: new THREE.Box3(new THREE.Vector3(-siteX / 2 - 6, 0, site.extent.zMin), new THREE.Vector3(siteX / 2 + 6, landscape.height + 4, site.extent.zMax)),
    target: new THREE.Vector3(0, landscape.height * 0.34, 0),
    dirs: { wide: new THREE.Vector3(0.55, 0.62, 1), tall: new THREE.Vector3(0.45, 0.7, 1) },
    applyGlass(g) { glassNow = g; applyRealGlass(g); showBlocks(); [fSide, fFront].forEach((m) => { m.opacity = lerp(0.97, 0.06, g); m.emissiveIntensity = lerp(0.12, 0.01, g); m.depthWrite = g < 0.02; }); },
    setView(on) { viewNow = on; setRealView(on); facades.forEach((f) => { f.visible = !on && !real.parent; }); },
    update(dt, t) { site.update(dt, t); landscape.update(dt, t); realEnv?.update(dt, t); },
  };
}
