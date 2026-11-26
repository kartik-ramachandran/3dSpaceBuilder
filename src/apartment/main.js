/*
 * Dollhouse apartment: a Blender-built model with lighting baked in Cycles (assets/apartment/), shown in
 * real time. Orbit freely, hover a room for its name and size, click a piece of furniture for details.
 *
 * Lightmapped meshes carry a second UV set (uv1). Cycles' diffuse bake stores light without surface colour,
 * at half intensity in sRGB; three.js multiplies it by albedo / π, so the intensity is 2π.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const $ = (s) => document.querySelector(s);
const BASE = /\/dist\//.test(location.pathname) ? '../' : '';
const LIGHTMAP_INTENSITY = 2 * Math.PI;

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 6; controls.maxDistance = 70; controls.maxPolarAngle = Math.PI * 0.49;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

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
let model;

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
  frameView(true);
  status.textContent = '';
  window.apartment = { rooms: rooms.length, items: new Set(items.values()).size, baked: baked.size };
  window.__scene = scene;   // debugging aid
  window.__setLightmap = (k) => { for (const m of baked) m.lightMapIntensity = LIGHTMAP_INTENSITY * k; };   // tuning aid
}

/* ---------- camera ---------- */
const views = {
  overview: { pos: new THREE.Vector3(-14, 17, 21), target: new THREE.Vector3(0.4, 0, 0.6) },
};
let tween = null;
function frameView(instant) {
  const v = views.overview;
  if (instant) { camera.position.copy(v.pos); controls.target.copy(v.target); controls.update(); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos.clone(), t1: v.target.clone() };
}
$('#reset').addEventListener('click', () => frameView(false));

/* ---------- hover rooms, click furniture ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#7fb6ff', transparent: true, opacity: 0.08, depthWrite: false }));
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#cfe2ff', transparent: true, opacity: 0.8 }));
const itemBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffd166'));
highlight.visible = outline.visible = itemBox.visible = false; highlight.renderOrder = outline.renderOrder = 5;
scene.add(highlight, outline, itemBox);
let hoverRoom = null, selected = null, down = null;

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
  rayFrom(e);
  const r = roomAt(); if (r !== hoverRoom) showRoom(r);
  const tag = $('#roomTag'); tag.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 14}px)`;
  const hit = ray.intersectObjects(pickMeshes, false)[0];
  canvas.style.cursor = hit && items.get(hit.object) ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', () => showRoom(null));
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
  down = null; rayFrom(e);
  const hit = ray.intersectObjects(pickMeshes, false)[0];
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
addEventListener('keydown', (e) => { if (e.key === 'Escape') select(null); });

/* ---------- loop ---------- */
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
renderer.setAnimationLoop(() => {
  if (tween) {
    tween.t = Math.min(1, tween.t + 1 / 60); const k = ease(tween.t);
    camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (tween.t >= 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
});
load().catch((e) => { console.error(e); status.textContent = 'The apartment could not be loaded. Please reload.'; });
