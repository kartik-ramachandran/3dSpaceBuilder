/*
 * Residential tower exterior with lighting baked in Blender (scripts/bake/build_tower.py).
 * One typical floor is baked once and stacked; the podium, crown and plaza carry their own lightmap.
 * Orbit freely, hover a level or the lobby, click a level to see a typical apartment inside.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { loadLightmap, applyLightmap, loadSky } from '../baked.js';

const $ = (s) => document.querySelector(s);
const BASE = /\/dist\//.test(location.pathname) ? '../' : '';

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.55;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#c9d3d8', 260, 900);
const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 3000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 18; controls.maxDistance = 420; controls.maxPolarAngle = Math.PI * 0.495;
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const status = $('#status');
const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'));
const levels = [];               // { k, group }
let info = { floors: 24, floor_height: 3.2, podium: 7.2, lightmap_scale: 0.18, flats_per_floor: 12 }, lobby = [];

async function load() {
  status.textContent = 'Loading the building…';
  const [floor, site, floorLM, siteLM, sky] = await Promise.all([
    loader.loadAsync(`${BASE}assets/tower/floor.glb`), loader.loadAsync(`${BASE}assets/tower/site.glb`),
    loadLightmap(`${BASE}assets/tower/floor_lightmap.jpg`), loadLightmap(`${BASE}assets/tower/site_lightmap.jpg`),
    loadSky(renderer, `${BASE}assets/hdri/kloofendal_48d_partly_cloudy_puresky.txt`, { background: true }),
  ]);
  scene.environment = sky.env; scene.background = sky.background; scene.backgroundIntensity = 0.75;
  site.scene.traverse((o) => { if (o.userData.kind === 'tower') info = { ...info, ...o.userData }; });
  applyLightmap(site.scene, siteLM, info.lightmap_scale);
  applyLightmap(floor.scene, floorLM, info.lightmap_scale);
  for (const m of [floor.scene, site.scene]) m.traverse((o) => { if (o.isMesh && /glazing|glass/i.test([].concat(o.material)[0].name)) { const g = [].concat(o.material)[0]; g.opacity = 0.32; g.roughness = 0.04; g.metalness = 0.6; g.envMapIntensity = 1.4; } });
  scene.add(site.scene);
  // the typical floor, stacked; copies share geometry, materials and the one lightmap
  for (let k = 0; k < info.floors; k++) {
    const g = k ? floor.scene.clone() : floor.scene;
    g.position.y = info.podium + k * info.floor_height;
    g.userData.level = k + 1; g.traverse((o) => { o.userData.level = k + 1; });
    scene.add(g); levels.push({ k, group: g });
  }
  site.scene.traverse((o) => { if (o.isMesh && /Pier|Lobby|Podium|Canopy/.test(o.name)) lobby.push(o); });
  // ground beyond the plaza
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), new THREE.MeshStandardMaterial({ color: '#7d8a68', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.42; scene.add(ground);
  frame(true);
  status.textContent = '';
  window.building = { floors: levels.length, flats: levels.length * info.flats_per_floor, info };
}

/* ---------- camera ---------- */
const VIEW = { pos: new THREE.Vector3(-105, 52, 150), target: new THREE.Vector3(0, 34, -2) };
let tween = null;
function frame(instant) {
  if (instant) { camera.position.copy(VIEW.pos); controls.target.copy(VIEW.target); controls.update(); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: VIEW.pos.clone(), t1: VIEW.target.clone() };
}
$('#reset').addEventListener('click', () => frame(false));

/* ---------- hover a level, click for the apartment inside ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const band = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.16, depthWrite: false }));
const bandEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffe1a0' }));
band.visible = bandEdge.visible = false; scene.add(band, bandEdge);
let hover = null, down = null;
function hitAt(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const objs = []; for (const l of levels) l.group.traverse((o) => { if (o.isMesh) objs.push(o); });
  const hit = ray.intersectObjects([...objs, ...lobby], false)[0];
  if (!hit) return null;
  return hit.object.userData.level ? { level: hit.object.userData.level } : { lobby: true };
}
function showHover(h) {
  hover = h;
  const tag = $('#tag');
  if (!h) { band.visible = bandEdge.visible = false; tag.hidden = true; return; }
  const [tx, ty] = info.footprint || [36, 20];
  if (h.level) {
    const y = info.podium + (h.level - 1) * info.floor_height;
    for (const o of [band, bandEdge]) { o.position.set(0, y + info.floor_height / 2, 0); o.scale.set(tx + 0.6, info.floor_height, ty + 4.2); o.visible = true; }
    tag.querySelector('b').textContent = `Level ${h.level}`;
    tag.querySelector('span').textContent = `${info.flats_per_floor} apartments · balconies front and back`;
    tag.querySelector('small').textContent = 'Click to see a typical apartment inside';
  } else {
    for (const o of [band, bandEdge]) { o.position.set(0, info.podium / 2, 0); o.scale.set(50.6, info.podium, 32.6); o.visible = true; }
    tag.querySelector('b').textContent = 'Lobby and podium';
    tag.querySelector('span').textContent = 'Double-height lobby · residents’ garden on the podium roof';
    tag.querySelector('small').textContent = '';
  }
  tag.hidden = false;
}
canvas.addEventListener('pointermove', (e) => {
  const h = hitAt(e);
  if (JSON.stringify(h) !== JSON.stringify(hover)) showHover(h);
  $('#tag').style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 14}px)`;
  canvas.style.cursor = h?.level ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', () => showHover(null));
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
  down = null; const h = hitAt(e);
  if (!h?.level) { $('#card').hidden = true; return; }
  $('#cardLevel').textContent = `Level ${h.level}`;
  $('#cardText').textContent = `${info.flats_per_floor} apartments on this level, each with a balcony. Every level shares the typical floor plan.`;
  $('#card').hidden = false;
});
$('#cardClose').addEventListener('click', () => { $('#card').hidden = true; });

/* ---------- loop ---------- */
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
renderer.setAnimationLoop(() => {
  if (tween) { tween.t = Math.min(1, tween.t + 1 / 70); const k = ease(tween.t); camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k); if (tween.t >= 1) tween = null; }
  controls.update(); renderer.render(scene, camera);
});
load().catch((e) => { console.error(e); status.textContent = 'The building could not be loaded. Please reload.'; });
