/*
 * Dollhouse apartment: a Blender-built model with lighting baked in Cycles (assets/apartment/), shown in
 * real time. Orbit freely, hover a room for its name and size, click a piece of furniture for details.
 * Design opens the interiors sidebar: drag walls, rooms, doors, windows, furniture and lights into the
 * apartment, or switch to an empty plot and build a house from scratch.
 *
 * Lightmapped meshes carry a second UV set (uv1). Cycles' diffuse bake stores light without surface colour,
 * at half intensity in sRGB; three.js multiplies it by albedo / π, so the intensity is 2π.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createMovePad } from '../move-pad.js';
import { createNavigation } from '../scene/navigation.js';
import { createDesignSidebar } from './design-sidebar.js';
import { createInteriorKit } from './interior-kit.js';
import { createStudioRenderer, ignoreDirectLight } from '../scene/studio-render.js';

const $ = (s) => document.querySelector(s);
const BASE = /\/dist\//.test(location.pathname) ? '../' : '';
const LIGHTMAP_INTENSITY = 2 * Math.PI;

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512; const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, '#171d1b'); grad.addColorStop(0.55, '#303a34'); grad.addColorStop(1, '#50584a');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 1.2; controls.maxDistance = 160; controls.maxPolarAngle = Math.PI * 0.49;

function resize() {
  const w = innerWidth, h = innerHeight;
  const previousFit = Math.max(1, 1.3 / camera.aspect);
  const nextFit = Math.max(1, 1.3 / (w / h));
  camera.position.sub(controls.target).multiplyScalar(nextFit / previousFit).add(controls.target);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  studio?.setSize(w, h);
}
let studio = null;
addEventListener('resize', resize); resize();
studio = createStudioRenderer({ renderer, scene, camera, aoStrength: 0.7 });
window.__studio = studio;   // tuning aid
studio.setSize(innerWidth, innerHeight);

/* ---------- sky light for reflections and the real-time props ---------- */
async function environment() {
  try {
    const txt = await (await fetch(`${BASE}assets/hdri/kloofendal_48d_partly_cloudy_puresky.txt`)).text();
    const bin = Uint8Array.from(atob(txt.trim()), (c) => c.charCodeAt(0));
    const r = new RGBELoader().setDataType(THREE.HalfFloatType).parse(bin.buffer);
    const tex = new THREE.DataTexture(r.data, r.width, r.height, THREE.RGBAFormat, THREE.HalfFloatType);
    Object.assign(tex, { mapping: THREE.EquirectangularReflectionMapping, colorSpace: THREE.LinearSRGBColorSpace, flipY: true, needsUpdate: true });
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(tex).texture; pmrem.dispose(); tex.dispose();
  } catch (e) { console.warn('environment', e); scene.add(new THREE.HemisphereLight('#eef3ff', '#a89a86', 1.2)); }
}

/* ---------- load the model and its lightmap ---------- */
const status = $('#status');
const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const rooms = [], items = new Map(), pickMeshes = [];
// three.js strips ':' and spaces from node names, so rooms and furniture are tagged with extras (kind, label);
// older exports fall back to the cleaned-up name, e.g. 'roomWalk-in_wardrobe'.
const kindOf = (o) => o.userData.kind || (o.isMesh && o.userData.area !== undefined && /^room/.test(o.name) ? 'room' : !o.isMesh && o.userData.info && /^item/.test(o.name) ? 'item' : null);
const labelOf = (o) => o.userData.label || o.name.replace(/^(room|item)/, '').replace(/_/g, ' ').replace(/\s\d+$/, '').trim();
let model, modelReady;
const modelLoaded = new Promise((res) => { modelReady = res; });

async function load() {
  status.textContent = 'Loading the apartment…';
  const [gltf, lightmap] = await Promise.all([
    loader.loadAsync(`${BASE}assets/apartment/apartment.glb`, (e) => { if (e.total) status.textContent = `Loading the apartment… ${Math.round(e.loaded / e.total * 100)}%`; }),
    new THREE.TextureLoader().loadAsync(`${BASE}assets/apartment/lightmap.jpg`),
    environment(),
  ]);
  lightmap.flipY = false; lightmap.colorSpace = THREE.SRGBColorSpace; lightmap.channel = 1;
  model = gltf.scene;
  // Blender's export is Y-up already; centre the apartment on the origin
  const bounds = new THREE.Box3().setFromObject(model), centre = bounds.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(centre.x, bounds.min.y, centre.z));
  scene.add(model);

  // A lightmap needs the mesh's second UV set, but materials can be shared between baked and real-time
  // meshes. Baked meshes get their own lightmapped copy of any such material.
  const realtimeMats = new Set();
  model.traverse((o) => { if (o.isMesh && !o.geometry.attributes.uv1) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => realtimeMats.add(m)); });
  const bakedCopy = new Map(), baked = new Set();
  const lightmapped = (m) => {
    if (bakedCopy.has(m)) return bakedCopy.get(m);
    const b = realtimeMats.has(m) ? m.clone() : m;
    // The bake already holds all the diffuse light; sky light here would wash its shadows out. Keep a trace for reflections.
    b.lightMap = lightmap; b.lightMapIntensity = LIGHTMAP_INTENSITY; b.envMapIntensity = 0.02; b.needsUpdate = true;
    ignoreDirectLight(b);   // the bake holds its light; the sun and lamps only light what you add
    bakedCopy.set(m, b); baked.add(b); return b;
  };
  model.traverse((o) => {
    if (kindOf(o) === 'room') { o.visible = false; rooms.push(o); return; }
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (o.geometry.attributes.uv1) {
      o.material = Array.isArray(o.material) ? mats.map(lightmapped) : lightmapped(o.material);
    } else for (const m of mats) { if (m.transmission > 0 || /glass/i.test(m.name)) { m.transparent = true; m.opacity = 0.18; m.depthWrite = false; } else m.envMapIntensity = 0.9; }
    pickMeshes.push(o);
    let p = o; while (p && kindOf(p) !== 'item') p = p.parent;
    if (p) items.set(o, p);
  });
  restoreRemovedFurniture();
  frameView(true);
  status.textContent = '';
  modelReady(model);
  attachComposer();
  window.apartment = { rooms: rooms.length, items: new Set(items.values()).size, baked: baked.size };
  window.__scene = scene;   // debugging aid
  window.__setLightmap = (k) => { for (const m of baked) m.lightMapIntensity = LIGHTMAP_INTENSITY * k; };   // tuning aid
}

/* ---------- camera ---------- */
const views = {
  overview: { pos: new THREE.Vector3(-14, 17, 21), target: new THREE.Vector3(0.4, 0, 0.6) },
};
let tween = null;
const navigation = createNavigation(camera, controls, canvas, () => { tween = null; });
const held = new Set();
const movePad = createMovePad($('#movePad'), (x, y, dt) => navigation.walk(y, x, 0, dt, held.has('shift')));
const typing = (target) => target?.closest?.('input, textarea, select, [contenteditable]');
function stopMovement() { held.clear(); movePad.stop(); }
addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
  const key = event.key.toLowerCase();
  if (!['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(key)) return;
  held.add(key);
  if (key !== 'shift') event.preventDefault();
});
addEventListener('keyup', (event) => held.delete(event.key.toLowerCase()));
addEventListener('blur', stopMovement);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMovement(); });
document.addEventListener('focusin', (event) => { if (typing(event.target)) stopMovement(); });
function keyboardMove(dt) {
  const forward = Number(held.has('w')) - Number(held.has('s'));
  const strafe = Number(held.has('d')) - Number(held.has('a'));
  const rise = Number(held.has('e')) - Number(held.has('q'));
  if (forward || strafe || rise) navigation.walk(forward, strafe, rise, dt, held.has('shift'));
}
function frameView(instant) {
  stopMovement();
  const base = views.overview;
  const v = { target: base.target, pos: base.pos.clone().sub(base.target).multiplyScalar(1.25 * Math.max(1, 1.3 / camera.aspect)).add(base.target) };
  if (instant) { camera.position.copy(v.pos); controls.target.copy(v.target); controls.update(); navigation.reset(); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos.clone(), t1: v.target.clone() };
}
$('#reset').addEventListener('click', () => frameView(false));

/* ---------- design: the interiors sidebar, on the apartment or on an empty plot ---------- */
const plot = new THREE.Group(); plot.name = 'Empty plot'; plot.visible = false; scene.add(plot);
{
  // a studio floor that fades into the backdrop, with a fine metre grid drawn over it
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#dcd8d0', roughness: 0.92 }));
  ground.receiveShadow = true; plot.add(ground);
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW;
      float line(vec2 p, float step) { vec2 q = p / step; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main() {
        float d = length(vW.xz), fade = 1.0 - smoothstep(10.0, 34.0, d);
        float a = max(line(vW.xz, 1.0) * 0.12, line(vW.xz, 5.0) * 0.26) * fade;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.33, 0.33, 0.36), a);
      }`,
  }));
  grid.position.y = 0.003; grid.userData.glass = true; plot.add(grid);
}
// one sun for everything you add, in both modes (the baked apartment ignores it); shadows follow your work
const sun = new THREE.DirectionalLight('#fff1dc', 3.2); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.75, 1.1, -0.5).normalize();   // from behind the default view, so shadows fall towards you
// sky fill for the empty plot (kept in the scene at zero on the apartment: a changing light count recompiles every material)
const sky = new THREE.HemisphereLight('#eef3ff', '#a89a86', 0); scene.add(sky);
window.__light = { sun: () => sun, sky };   // tuning aid
// a fixed pool of real lights, handed to the lamps nearest the view; the rest glow through bloom
const lampPool = Array.from({ length: 4 }, () => { const l = new THREE.PointLight('#ffe2b8', 0, 6, 2); scene.add(l); return l; });
const lampPos = new THREE.Vector3();
function lightLamps() {
  const lamps = [];
  composer.root.traverseVisible((o) => { if (o.userData.lamp) { o.getWorldPosition(lampPos); lamps.push({ o, d: lampPos.distanceToSquared(controls.target), p: lampPos.clone() }); } });
  lamps.sort((a, b) => a.d - b.d);
  lampPool.forEach((l, i) => {
    const lamp = lamps[i];
    if (!lamp) { l.intensity = 0; return; }
    const u = lamp.o.userData.lamp; l.position.copy(lamp.p); l.color.set(u.colour); l.intensity = u.intensity * 1.4; l.distance = u.distance;
  });
}
let shadowKey = '';
function fitSun() {
  const box = new THREE.Box3().setFromObject(composer.root);
  if (box.isEmpty()) box.set(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(6, 3, 6));
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(6, box.getSize(new THREE.Vector3()).length() * 0.6);
  const key = `${c.x.toFixed(0)},${c.z.toFixed(0)},${r.toFixed(0)}`; if (key === shadowKey) return; shadowKey = key;
  sun.target.position.copy(c); sun.position.copy(c).addScaledVector(SUN_DIR, r * 2.5);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: r * 5 }); sun.shadow.camera.updateProjectionMatrix();
}
let emptyPlot = false;
const composer = createDesignSidebar({
  scene, camera, canvas, controls,
  getWorld: () => (emptyPlot ? plotWorld() : model && { group: model, fitBox: new THREE.Box3().setFromObject(model) }),
  getSpec: () => ({ name: emptyPlot ? 'apartment-plot' : 'apartment' }),
  kit: createInteriorKit({ getModel: () => modelLoaded, mount: 'nav' }),
});
function plotWorld() { return { group: plot, fitBox: new THREE.Box3(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(6, 3, 6)) }; }
function attachComposer() {
  stopMovement();
  const world = emptyPlot ? plotWorld() : { group: model, fitBox: new THREE.Box3().setFromObject(model) };
  composer.attach(world, { name: emptyPlot ? 'apartment-plot' : 'apartment' });
  navigation.configure(world, controls.getDistance());
}
const plotBtn = document.createElement('button');
plotBtn.type = 'button'; plotBtn.id = 'plotBtn'; plotBtn.textContent = 'Empty plot'; plotBtn.setAttribute('aria-pressed', 'false');
plotBtn.title = 'Hide the apartment and build a house from scratch on an empty plot (kept separately from what you add to the apartment)';
$('nav').prepend(plotBtn);
plotBtn.addEventListener('click', () => {
  if (!model) return;
  emptyPlot = !emptyPlot;
  plotBtn.setAttribute('aria-pressed', String(emptyPlot)); plotBtn.textContent = emptyPlot ? 'Show the apartment' : 'Empty plot';
  model.visible = !emptyPlot; plot.visible = emptyPlot; select(null); showRoom(null);
  scene.fog = emptyPlot ? new THREE.Fog('#303a34', 38, 95) : null;
  studio.setAOStrength(emptyPlot ? 1 : 0.7); shadowKey = ''; sky.intensity = emptyPlot ? 0.34 : 0; renderer.toneMappingExposure = emptyPlot ? 0.95 : 1.05;
  const title = $('.brand h1'); if (title) title.textContent = emptyPlot ? 'Empty plot' : 'The Residence';
  const blurb = $('.brand p'); if (blurb) blurb.textContent = emptyPlot ? 'Build a house from scratch: rooms, walls, doors, windows, roof and furniture.' : 'A three-bedroom apartment, modelled and lit in Blender (Cycles), explored in real time.';
  attachComposer();
  if (emptyPlot) tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(-11, 13, 16), t1: new THREE.Vector3(0, 0, 0) }; else frameView(false);
});

/* ---------- hover rooms, click furniture ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#7fb6ff', transparent: true, opacity: 0.08, depthWrite: false }));
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#cfe2ff', transparent: true, opacity: 0.8 }));
const itemBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffd166'));
highlight.visible = outline.visible = itemBox.visible = false; highlight.renderOrder = outline.renderOrder = 5;
scene.add(highlight, outline, itemBox);
let hoverRoom = null, selected = null, down = null;
const removalKey = 'apartment:removed-furniture:v1';
const removedFurniture = new Set(), removalHistory = [], removalFuture = [];
function furnitureKey(object) {
  const path = [];
  for (let node = object; node && node !== model; node = node.parent) path.unshift(`${node.name}:${node.parent?.children.indexOf(node)}`);
  return path.join('/');
}
function applyRemovedFurniture() {
  for (const object of new Set(items.values())) object.visible = !removedFurniture.has(furnitureKey(object));
  select(null); showRoom(null); studio.poke();
  try { localStorage.setItem(removalKey, JSON.stringify([...removedFurniture])); } catch { /* Storage may be unavailable. */ }
}
function restoreRemovedFurniture() {
  try {
    const saved = JSON.parse(localStorage.getItem(removalKey) || '[]');
    if (Array.isArray(saved)) for (const key of saved) if (typeof key === 'string') removedFurniture.add(key);
  } catch { /* Ignore invalid saved edits. */ }
  applyRemovedFurniture();
}
function deleteSelectedFurniture() {
  if (!selected || composer.isOpen() || emptyPlot) return;
  removalHistory.push([...removedFurniture]); removalFuture.length = 0;
  removedFurniture.add(furnitureKey(selected)); applyRemovedFurniture();
}
function restoreRemovalSnapshot(from, to) {
  if (!from.length) return;
  to.push([...removedFurniture]); removedFurniture.clear();
  for (const key of from.pop()) removedFurniture.add(key);
  applyRemovedFurniture();
}
function visibleFurnitureHit() {
  return ray.intersectObjects(pickMeshes, false).find(hit => {
    for (let node = hit.object; node; node = node.parent) if (!node.visible) return false;
    return true;
  });
}

function rayFrom(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function roomAt() {
  const hit = ray.intersectObjects(rooms, false)[0];
  return hit ? hit.object : null;
}
function showRoom(r) {
  hoverRoom = r;
  if (!r) { highlight.visible = outline.visible = false; $('#roomTag').hidden = true; return; }
  const b = new THREE.Box3().setFromObject(r), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  for (const o of [highlight, outline]) { o.position.copy(c); o.scale.copy(size); o.visible = true; }
  $('#roomTag b').textContent = labelOf(r);
  $('#roomTag span').textContent = `${r.userData.area ?? (size.x * size.z).toFixed(1)} m² · ${size.x.toFixed(1)} × ${size.z.toFixed(1)} m`;
  $('#roomTag small').textContent = r.userData.info || '';
  $('#roomTag').hidden = false;
}
canvas.addEventListener('pointermove', (e) => {
  if (composer.isOpen() || emptyPlot) { if (hoverRoom) showRoom(null); return; }
  rayFrom(e);
  const r = roomAt(); if (r !== hoverRoom) showRoom(r);
  const tag = $('#roomTag'); tag.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 14}px)`;
  const hit = visibleFurnitureHit();
  canvas.style.cursor = hit && items.get(hit.object) ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', () => showRoom(null));
// dragging or editing keeps contact shadows off until things settle, so it stays smooth
canvas.addEventListener('pointermove', (e) => { if (e.buttons) studio.poke(); }, true);
addEventListener('input', () => studio.poke(), true);
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
  down = null;
  if (composer.isOpen() || emptyPlot) return;
  canvas.focus({ preventScroll: true });
  rayFrom(e);
  const hit = visibleFurnitureHit();
  select(hit ? items.get(hit.object) || null : null);
});
function select(it) {
  selected = it;
  if (!it) { itemBox.visible = false; $('#card').hidden = true; return; }
  itemBox.box.setFromObject(it); itemBox.visible = true;
  const size = itemBox.box.getSize(new THREE.Vector3());
  const r = rooms.find((room) => new THREE.Box3().setFromObject(room).containsPoint(itemBox.box.getCenter(new THREE.Vector3())));
  $('#cardRoom').textContent = r ? labelOf(r) : '';
  $('#cardName').textContent = labelOf(it);
  $('#cardInfo').textContent = it.userData.info || '';
  $('#cardSize').textContent = `${size.x.toFixed(2)} × ${size.z.toFixed(2)} m · ${size.y.toFixed(2)} m high`;
  $('#cardSource').textContent = it.userData.source || 'Modelled for this scene';
  $('#card').hidden = false;
}
$('#cardClose').addEventListener('click', () => select(null));
$('#cardDelete').addEventListener('click', deleteSelectedFurniture);
addEventListener('keydown', (event) => {
  if (composer.isOpen() || emptyPlot || typing(event.target)) return;
  const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
  if (key === 'escape') select(null);
  if ((key === 'delete' || key === 'backspace') && selected && !modifier && !event.altKey) {
    event.preventDefault(); deleteSelectedFurniture();
  }
  if (modifier && (key === 'z' || key === 'y')) {
    event.preventDefault();
    if (key === 'y' || event.shiftKey) restoreRemovalSnapshot(removalFuture, removalHistory);
    else restoreRemovalSnapshot(removalHistory, removalFuture);
  }
});

/* ---------- loop ---------- */
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clock = new THREE.Clock();
let sunTimer = 0;
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta(), dt = Math.min(0.05, raw);
  composer.update(dt, clock.elapsedTime);
  if ((sunTimer -= dt) < 0) { sunTimer = 0.3; fitSun(); lightLamps(); }
  keyboardMove(dt);
  movePad.update(dt);
  const animatingCamera = Boolean(tween);
  if (tween) {
    tween.t = Math.min(1, tween.t + 1 / 60); const k = ease(tween.t);
    camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (tween.t >= 1) tween = null;
  }
  if (animatingCamera) { controls.update(); navigation.reset(); }
  else navigation.update(dt, true);
  studio.render(dt, clock.elapsedTime > 6 && document.visibilityState === 'visible' ? raw * 1000 : 0);
});
load().catch((e) => { console.error(e); status.textContent = 'The apartment could not be loaded. Please reload.'; });
