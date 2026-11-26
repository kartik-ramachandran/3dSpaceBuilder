/*
 * App shell: renderer and camera, building a world from a layout spec, the HUD (zones, card,
 * price tag), picking, the fly-in window view, the prompt flow to Claude, and the render loop.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $, reduceMotion, clamp, sum, lerp, easeInOut } from './util.js';
import { TYPE_LABEL, PRESETS, normalize } from './spec/schema.js';
import { offlineSpec } from './spec/offline-parser.js';
import { claudePrompt } from './spec/claude-prompt.js';
import { createAtmosphere } from './scene/atmosphere.js';
import { disposeTree, prepareShadows } from './scene/helpers.js';
import { buildPlane } from './scene/plane.js';
import { buildHotel } from './scene/hotel.js';
import { buildOffice } from './scene/office.js';
import { buildStadium } from './scene/stadium.js';
import { buildDevelopment } from './scene/development.js';
import { createComposer } from './compose/composer.js';
import { createNavigation } from './scene/navigation.js';
import { createReferences } from './references.js';
import { createMovePad } from './move-pad.js';
import { createSeatHighlight } from './scene/seat-highlight.js';
import { createValuationPanel } from './valuation-panel.js';

const canvas = $('#stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('#fallback').hidden = false;
}
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 12000);
const controls = renderer ? new OrbitControls(camera, canvas) : null;
if (controls) {
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.65;
  controls.rotateSpeed = 0.45;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.05;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.keyPanSpeed = 18;
  controls.listenToKeyEvents(canvas);
}

const { sky, setAtmosphere, fitShadows } = createAtmosphere(renderer, scene);

/* ---------- world state ---------- */
let composer = null;  // Compose sidebar (src/compose), created once the renderer exists
let world = null;   // { kind, group, zones: Map, glassTargets, update(dt,t), overviewDir, fitBox, target }
let spec = null;
if (renderer) composer = createComposer({ scene, camera, canvas, controls, renderer, getWorld: () => world, getSpec: () => spec });
let glass = 1, glassTarget = 1;
let hovered = null, selected = null;
let mode = 'overview';  // overview | flying | view
const zoneLevels = new Map();
const seatHighlight = createSeatHighlight(scene);
let hoverSeat = null, canvasPointer = null, hoverDirty = false, seatPickTargets = [];
controls?.addEventListener('change', () => { if (canvasPointer) hoverDirty = true; });
function setHover(id, seat = null) {
  hovered = id; hoverSeat = seat;
  valuation?.hover(id);
  seatHighlight.show(mode === 'overview' ? seat : null);
  canvas.style.cursor = id ? 'pointer' : '';
}

/* ============================================================
   3. SCENE LIFECYCLE, CAMERA, INTERACTION
   ============================================================ */
const occl = { top: 0, bottom: 0, right: 0, left: 0 };
function measureOcclusion() {
  const w = innerWidth, h = innerHeight;
  const phone = w <= 760;
  const tb = $('.titleblock').getBoundingClientRect();
  const dock = $('#dock').getBoundingClientRect();
  document.documentElement.style.setProperty('--dockH', `${h - dock.top + 8}px`);
  const zl = $('#zonesPanel').getBoundingClientRect();
  const rc = $('#rightCol').getBoundingClientRect();
  occl.top = tb.bottom + 6;
  const vc = $('#valControls');
  occl.left = !phone && vc && !vc.hidden ? vc.getBoundingClientRect().right + 10 : 0;
  if (phone) { occl.bottom = h - Math.min(dock.top, zl.top || dock.top) + 6; occl.right = 0; }
  else { occl.bottom = h - dock.top + 10; occl.right = spec?.kind === 'development' && $('#valPanel').hidden ? 0 : w - rc.left + 10; }
}
function applyViewOffset() {
  const w = innerWidth, h = innerHeight;
  if (mode === 'view') { camera.clearViewOffset(); return; }
  const dx = (occl.right - occl.left) / 2, dy = (occl.bottom - occl.top) / 2;
  camera.setViewOffset(w, h, dx, dy, w, h);
}
function resize() {
  if (!renderer) return;
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  measureOcclusion();
  applyViewOffset();
  camera.updateProjectionMatrix();
}
function overviewPose() {
  const w = innerWidth, h = innerHeight;
  const freeW = Math.max(0.35, (w - occl.right - occl.left) / w), freeH = Math.max(0.3, (h - occl.top - occl.bottom) / h);
  const dir = (w / h < 0.9 ? world.dirs.tall : world.dirs.wide).clone().normalize();
  const target = world.target.clone();
  const corners = [];
  const b = world.fitBox;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const cam = camera.clone();
  cam.clearViewOffset(); cam.aspect = w / h; cam.updateProjectionMatrix();
  let lo = 5, hi = 3000;
  for (let i = 0; i < 26; i++) {
    const d = (lo + hi) / 2;
    cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.updateMatrixWorld();
    const ok = corners.every((c) => { const p = c.clone().project(cam); return p.z < 1 && Math.abs(p.x) < 0.94 * freeW && Math.abs(p.y) < 0.92 * freeH; });
    if (ok) hi = d; else lo = d;
  }
  return { pos: target.clone().addScaledVector(dir, hi), target };
}

const tweens = new Set();
function tween(dur, fn, ease = easeInOut, channel = null) {
  return new Promise((res) => tweens.add({ t0: performance.now(), dur: reduceMotion ? 1 : dur, fn, ease, res, channel }));
}
function cancelCameraTween() {
  for (const tw of tweens) if (tw.channel === 'camera') { tweens.delete(tw); tw.res(); }
}
const navigation = controls ? createNavigation(camera, controls, canvas, cancelCameraTween) : null;
const movePad = createMovePad($('#movePad'), (x, y, dt) => {
  if (mode === 'overview') navigation?.move(x, y, dt);
});
function runTweens(now) {
  for (const tw of tweens) {
    const k = clamp((now - tw.t0) / tw.dur, 0, 1);
    tw.fn(tw.ease(k));
    if (k >= 1) { tweens.delete(tw); tw.res(); }
  }
}

let buildToken = 0;
function applySpec(sp, statusMsg, statusKind) {
  spec = sp;
  const token = ++buildToken;
  movePad.stop();
  cancelCameraTween();
  if (mode !== 'overview') exitView(true);
  lastOverview = null;
  selected = null; setHover(null); canvasPointer = null; showCard(null);
  if (world) { world.dispose?.(); scene.remove(world.group); disposeTree(world.group); }
  setAtmosphere(sp.kind);
  world = { plane: buildPlane, hotel: buildHotel, office: buildOffice, stadium: buildStadium, development: buildDevelopment }[sp.kind](sp);
  scene.add(world.group);
  prepareShadows(world.group);
  composer?.attach(world, sp);
  fitShadows(world.fitBox);
  zoneLevels.clear();
  seatPickTargets = [];
  world.zones.forEach((zo, id) => {
    zoneLevels.set(id, { cur: 0, flash: 0, floorColor: zo.mats.floor.color.clone(), furnColor: zo.mats.furn.color.clone(), tint: new THREE.Color(zo.z.color) });
    seatPickTargets.push(...(zo.seatMeshes || []));
  });
  renderHud();
  valuation.attach(world, sp);   // developments get the valuation layer; other kinds hide it
  resize();
  const pose = overviewPose();
  navigation.configure(world, pose.pos.distanceTo(pose.target));
  camera.position.copy(pose.pos); controls.target.copy(pose.target); controls.update();
  navigation.reset();
  controls.autoRotate = false;
  // signature moment: shell turns to glass, then each zone lights in turn
  glass = 0; glassTarget = sp.kind === 'development' ? 0 : 1; world.applyGlass(0);
  $('#glassBtn').setAttribute('aria-pressed', String(glassTarget === 1));
  $('#glassBtn').disabled = world.hasRoof === false;
  const ids = [...world.zones.keys()];
  const flashStep = Math.min(170, 2400 / Math.max(1, ids.length));  // a 96-apartment site still lights up in ~2.4 s
  if (sp.kind !== 'development') setTimeout(() => {
    if (token !== buildToken) return;
    tween(1500, (k) => { glass = sp.kind === 'development' ? 0 : k; world.applyGlass(glass); }).then(() => {
      ids.forEach((id, i) => setTimeout(() => { if (token === buildToken && zoneLevels.get(id)) zoneLevels.get(id).flash = 1; }, reduceMotion ? 0 : i * flashStep));
    });
  }, reduceMotion ? 0 : 700);
  if (statusMsg) setStatus(statusMsg, statusKind);
  try { localStorage.setItem('p2s:last', JSON.stringify(sp)); } catch (e) { /* storage unavailable */ }
}

/* ---------- HUD ---------- */
const fmtMoney = (v, cur) => {
  if (!v) return 'Included';
  try { return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: cur, currencyDisplay: 'code', maximumFractionDigits: 0 }).format(v).replace(/ /g, ' '); }
  catch (e) { return `${cur} ${Math.round(v).toLocaleString('en-NZ')}`; }
};
function capText(zo) {
  const z = zo.z;
  if (spec.kind === 'stadium') return `${z.capacity.toLocaleString('en-NZ')} seats · ${zo.floorsLabel}`;
  if (spec.kind === 'development') return `${z.bedrooms} bed · ${z.area} m² · ${zo.floorsLabel}`;
  if (spec.kind === 'plane') {
    if (z.type === 'residence') return `${z.capacity} apartment${z.capacity > 1 ? 's' : ''} for two`;
    if (z.type === 'bar') return `${z.capacity} guests · shared`;
    return `${z.capacity} seats · ${z.layout.join('-')}`;
  }
  if (spec.kind === 'hotel') {
    const n = z.type === 'amenity' ? `${z.capacity} guests` : `${z.capacity} ${z.type === 'suite' ? 'suites' : z.type === 'penthouse' ? (z.capacity > 1 ? 'penthouses' : 'penthouse') : 'rooms'}`;
    return `${n} · ${zo.floorsLabel}`;
  }
  const unit = { desks: 'desks', offices: 'offices', meeting: 'rooms', lounge: 'seats', event: 'seats' }[z.type];
  return `${z.capacity} ${unit} · ${zo.floorsLabel}`;
}
function renderHud() {
  const kindName = { plane: 'Plane', hotel: 'Hotel', office: 'Office', stadium: 'Stadium', development: 'Development' }[spec.kind];
  $('#kindLabel').textContent = kindName;
  $('#spaceName').textContent = spec.name;
  const zs = spec.zones;
  let meta = spec.subtitle;
  if (!meta) {
    if (spec.kind === 'plane') meta = [spec.shell.route, `${zs.length} cabins`, `${sum(zs.filter((z) => !['bar'].includes(z.type)).map((z) => z.type === 'residence' ? z.capacity * 2 : z.capacity))} seats`].filter(Boolean).join(' · ');
    if (spec.kind === 'hotel') meta = `${sum(zs.filter((z) => z.type !== 'amenity').map((z) => z.capacity))} keys · ${world.levels} floors · ${spec.shell.setting}`;
    if (spec.kind === 'office') meta = `${sum(zs.filter((z) => z.type === 'desks').map((z) => z.capacity))} desks · ${world.levels} levels · ${spec.shell.setting}`;
    if (spec.kind === 'development') meta = `${world.layout.totalBuildings} building${world.layout.totalBuildings > 1 ? 's' : ''} · ${zs.length} apartments · up to ${world.layout.maxFloors} floors`;
    if (spec.kind === 'stadium') meta = `${spec.shell.sport[0].toUpperCase() + spec.shell.sport.slice(1)} · ${sum(zs.map((z) => z.capacity)).toLocaleString('en-NZ')} seats · ${spec.shell.tiers} tiers`;
  }
  $('#spaceMeta').textContent = meta;
  $('#zonesTitle').textContent = { plane: 'Cabins', hotel: 'Rooms by floor', office: 'Spaces', stadium: 'Stands & tickets', development: 'Apartments' }[spec.kind];
  $('#zonesCount').textContent = String(zs.length);
  $('#glassLbl').textContent = world ? world.glassLabel : 'Glass';
  const ul = $('#zoneList'); ul.textContent = ''; ul.scrollLeft = 0; ul.scrollTop = 0;
  const list = ['plane', 'stadium', 'development'].includes(spec.kind) ? zs : zs.slice().reverse();
  let lastBuilding = null;
  list.forEach((z) => {
    const zo = world.zones.get(z.id); if (!zo) return;
    if (spec.kind === 'development' && z.building !== lastBuilding) {  // building headings keep a long apartment list scannable
      lastBuilding = z.building;
      const h = document.createElement('li'); h.className = 'zgroup'; h.textContent = `Building ${String.fromCharCode(64 + z.building)}`; ul.appendChild(h);
    }
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'zbtn'; b.type = 'button'; b.dataset.zone = z.id; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="sw"></span><span class="nm"></span><span class="pr"></span><span class="sub"></span><span class="unit"></span>`;
    b.querySelector('.sw').style.background = z.color;
    b.querySelector('.nm').textContent = z.name;
    b.querySelector('.pr').textContent = fmtMoney(z.price, spec.currency);
    b.querySelector('.sub').textContent = capText(zo);
    b.querySelector('.unit').textContent = z.price ? z.priceUnit : '';
    b.addEventListener('click', () => selectZone(selected === z.id ? null : z.id, true));
    b.addEventListener('mouseenter', () => { canvasPointer = null; setHover(z.id); });
    b.addEventListener('mouseleave', () => { if (hovered === z.id) setHover(null); });
    li.appendChild(b); ul.appendChild(li);
  });
}
const FLY_LABEL = { plane: 'Sit in a window seat', hotel: 'Stand at the window', office: 'Sit by the window', stadium: 'View from this stand', development: 'Stand on the balcony' };
function showCard(id) {
  const card = $('#zoneCard');
  document.querySelectorAll('.zbtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zone === id)));
  if (!id) { card.hidden = true; $('#zonesPanel').style.visibility = ''; requestAnimationFrame(() => { measureOcclusion(); }); return; }
  if (spec.kind === 'development') { card.hidden = true; return; }  // the valuation panel shows the apartment instead
  const zo = world.zones.get(id); const z = zo.z;
  $('#cardKicker .sw').style.background = z.color;
  $('#cardType').textContent = TYPE_LABEL[z.type];
  $('#cardName').textContent = z.name;
  $('#cardPrice').textContent = fmtMoney(z.price, spec.currency);
  $('#cardUnit').textContent = z.price ? z.priceUnit : '';
  $('#cardCap').textContent = capText(zo);
  $('#cardBlurb').textContent = z.blurb; $('#cardBlurb').hidden = !z.blurb;
  const fl = $('#cardFeatures'); fl.textContent = '';
  z.features.forEach((f) => { const li = document.createElement('li'); li.textContent = f; fl.appendChild(li); });
  $('#flyBtn').textContent = z.type === 'residence' ? 'Step inside' : z.type === 'bar' || z.type === 'lounge' || z.type === 'amenity' ? 'Take a look' : FLY_LABEL[spec.kind];
  card.hidden = false;
  if (innerWidth <= 760) $('#zonesPanel').style.visibility = 'hidden';
}
function selectZone(id, focusCam) {
  selected = id;
  valuation?.select(id);
  showCard(id);
  if (id && focusCam && mode === 'overview') {
    controls.autoRotate = false;
    const zo = world.zones.get(id);
    const t0 = controls.target.clone(), t1 = world.kind === 'stadium' ? world.target.clone() : world.kind === 'development' ? zo.center.clone() : world.kind === 'plane' ? new THREE.Vector3(zo.center.x * 0.6, 0, 0) : new THREE.Vector3(0, zo.center.y, 0);
    cancelCameraTween(); navigation.reset();
    // Move the eye along with the pivot so choosing a floor never swings through it.
    const p0 = camera.position.clone(), shift = t1.clone().sub(t0);
    tween(900, (k) => { controls.target.lerpVectors(t0, t1, k); camera.position.copy(p0).addScaledVector(shift, k); }, easeInOut, 'camera');
  }
}

/* ---------- status ---------- */
let statusLocked = false;
function setStatus(msg, kind) {
  statusLocked = true;
  const s = $('#status'); s.className = kind || ''; $('#statusText').textContent = msg;
}

/* ---------- picking ---------- */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickDetail(cx, cy) {
  if (!world) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
  camera.updateMatrixWorld();
  ray.setFromCamera(ndc, camera);
  if (world.kind === 'plane' && glass > 0.5) {
    const seat = ray.intersectObjects(seatPickTargets, false)[0];
    if (seat) return { zone: seat.object.userData.zone, seat };
  }
  const hits = [];
  world.zones.forEach((zo) => zo.hits.forEach((h) => hits.push(h)));
  const r = ray.intersectObjects(hits, false);
  return r.length ? { zone: r[0].object.userData.zone, seat: null } : null;
}
function pick(cx, cy) { return pickDetail(cx, cy)?.zone || null; }
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, button: e.button };
  canvas.focus({ preventScroll: true });
  setHover(null);
  if (controls) controls.autoRotate = false;
  if (mode === 'view') { look.drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch }; canvas.setPointerCapture(e.pointerId); }
});
canvas.addEventListener('pointermove', (e) => {
  if (mode === 'view' && look.drag) {
    look.yaw = clamp(look.drag.yaw - (e.clientX - look.drag.x) * 0.0035, -1.1, 1.1);
    look.pitch = clamp(look.drag.pitch + (e.clientY - look.drag.y) * 0.003, -0.5, 0.45);
    return;
  }
  if (e.pointerType === 'mouse' && mode === 'overview' && !down) { canvasPointer = { x: e.clientX, y: e.clientY }; hoverDirty = true; }
});
canvas.addEventListener('pointerup', (e) => {
  if (mode === 'view') { look.drag = null; down = null; return; }
  if (down && down.button === 0 && !e.shiftKey && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7 && performance.now() - down.t < 450 && mode === 'overview') {
    const id = pick(e.clientX, e.clientY);
    selectZone(id, false);
  }
  down = null;
  if (e.pointerType === 'mouse' && mode === 'overview') { canvasPointer = { x: e.clientX, y: e.clientY }; hoverDirty = true; }
});
canvas.addEventListener('pointerleave', () => { canvasPointer = null; if (mode === 'overview') setHover(null); });
canvas.addEventListener('pointercancel', () => { down = null; look.drag = null; canvasPointer = null; setHover(null); });

/* ---------- window view ---------- */
const look = { yaw: 0, pitch: 0, base: new THREE.Vector3(), eye: new THREE.Vector3(), drag: null };
let lastOverview = null;
function upgradeFrom(z) {
  if (spec.kind === 'development') {  // the same apartment one floor up, not the next-priced unit across the site
    return spec.zones.find((x) => x.building === z.building && x.unit === z.unit && x.floor === z.floor + 1) || null;
  }
  const bookable = spec.zones.filter((x) => x.price > 0 && x.id !== z.id && x.price > z.price && x.priceUnit === z.priceUnit);
  bookable.sort((a, b) => a.price - b.price);
  return bookable[0] || null;
}
async function enterView(id) {
  if (!world || mode === 'flying') return;
  const zo = world.zones.get(id); if (!zo || !zo.seats.length) return;
  const seat = zo.seats[0];
  const wasView = mode === 'view';
  if (!wasView) lastOverview = { pos: camera.position.clone(), target: controls.target.clone() };
  const l0 = wasView ? camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3())) : controls.target.clone();
  mode = 'flying'; controls.enabled = false; controls.autoRotate = false;
  movePad.stop();
  cancelCameraTween(); navigation.reset();
  setHover(null); canvasPointer = null; $('#view').classList.remove('on'); $('#view').setAttribute('aria-hidden', 'true');
  $('#hud').style.visibility = 'hidden'; $('#tag').style.opacity = 0;
  const p0 = camera.position.clone();
  const p1 = seat.pos.clone();
  const l1 = p1.clone().add(zo.look);
  const arc = wasView ? 2.5 : Math.min(40, p0.distanceTo(p1) * 0.15);
  if (wasView) world.setView(false);
  const lookNow = new THREE.Vector3();
  await tween(wasView ? 1500 : 2100, (k) => {
    camera.position.lerpVectors(p0, p1, k); camera.position.y += Math.sin(k * Math.PI) * arc;
    lookNow.lerpVectors(l0, l1, Math.min(1, k * 1.15)); camera.lookAt(lookNow);
    if (k > 0.8) world.setView(true);
  });
  world.setView(true);
  mode = 'view';
  camera.clearViewOffset(); camera.updateProjectionMatrix();
  look.eye.copy(p1); look.base.copy(zo.look); look.yaw = 0; look.pitch = 0;
  const z = zo.z;
  $('#view').dataset.kind = spec.kind;
  $('#viewTitle').textContent = seat.label;
  $('#viewSub').textContent = `${z.name} · ${seat.note} · ${fmtMoney(z.price, spec.currency)}${z.price ? ' ' + z.priceUnit : ''}`;
  const up = upgradeFrom(z);
  const ub = $('#upgradeBtn');
  if (up) { ub.hidden = false; ub.dataset.zone = up.id; ub.textContent = `Upgrade to ${up.name} · +${fmtMoney(up.price - z.price, spec.currency)}`; }
  else ub.hidden = true;
  $('#view').classList.add('on'); $('#view').setAttribute('aria-hidden', 'false');
  $('#backBtn').focus({ preventScroll: true });
}
async function exitView(instant) {
  if (mode !== 'view' && !instant) return;
  $('#view').classList.remove('on'); $('#view').setAttribute('aria-hidden', 'true');
  if (world) world.setView(false);
  if (instant || !world) {
    mode = 'overview'; if (controls) controls.enabled = true; $('#hud').style.visibility = ''; return;
  }
  const back = lastOverview || overviewPose();
  mode = 'flying';
  const p0 = camera.position.clone(), l0 = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()));
  applyViewOffset(); camera.updateProjectionMatrix();
  const lookNow = new THREE.Vector3();
  await tween(1700, (k) => {
    camera.position.lerpVectors(p0, back.pos, k); camera.position.y += Math.sin(k * Math.PI) * 12;
    lookNow.lerpVectors(l0, back.target, k); camera.lookAt(lookNow);
  });
  mode = 'overview'; controls.target.copy(back.target); controls.enabled = true; controls.update();
  navigation.reset();
  $('#hud').style.visibility = '';
}

$('#flyBtn').addEventListener('click', () => selected && enterView(selected));
$('#backBtn').addEventListener('click', () => exitView(false));
$('#upgradeBtn').addEventListener('click', (e) => { const id = e.currentTarget.dataset.zone; if (id) { selected = id; showCard(id); enterView(id); } });
$('#cardClose').addEventListener('click', () => selectZone(null));
const valuation = createValuationPanel({
  onSelect: (id) => selectZone(id, true),
  onFly: (id) => enterView(id),
  onLayout: () => resize(),
});
$('#glassBtn').addEventListener('click', () => {
  if (!world) return;
  glassTarget = glassTarget > 0.5 ? 0 : 1;
  $('#glassBtn').setAttribute('aria-pressed', String(glassTarget === 1));
  const g0 = glass, g1 = glassTarget;
  tween(800, (k) => { glass = lerp(g0, g1, k); world.applyGlass(glass); });
});
$('#levelBtn').addEventListener('click', () => {
  if (!world || mode !== 'overview') return;
  movePad.stop(); cancelCameraTween(); navigation.reset(); controls.autoRotate = false;
  const target = controls.target.clone();
  target.y = Math.max(world.fitBox.min.y + 1, target.y);
  const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
  const startPhi = orbit.phi;
  camera.up.set(0, 1, 0);
  tween(550, (k) => {
    orbit.phi = lerp(startPhi, Math.PI / 2, k);
    controls.target.copy(target);
    camera.position.setFromSpherical(orbit).add(target);
  }, easeInOut, 'camera');
});
$('#resetBtn').addEventListener('click', () => {
  if (!world || mode !== 'overview') return;
  const pose = overviewPose(); const p0 = camera.position.clone(), t0 = controls.target.clone();
  cancelCameraTween(); navigation.reset(); controls.autoRotate = false;
  selectZone(null);
  tween(1000, (k) => { camera.position.lerpVectors(p0, pose.pos, k); controls.target.lerpVectors(t0, pose.target, k); }, easeInOut, 'camera');
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mode === 'view') exitView(false); else if (selected) selectZone(null); } });

/* ---------- prompt + Claude ---------- */
let sampleFn = null, backendFn = null, sampleResolved = false, busyCtl = null;
const references = createReferences(() => requestAnimationFrame(resize));
const promptEl = $('#prompt');
promptEl.addEventListener('input', () => { promptEl.style.height = 'auto'; promptEl.style.height = Math.min(110, promptEl.scrollHeight) + 'px'; });
promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#dock').requestSubmit(); } });
$('#examples').addEventListener('change', (e) => {
  const sel = e.target; if (!sel.value) return;
  if (sel.value === '@home') { sel.selectedIndex = 0; location.href = 'home.html'; return; }  // the furnished walkthrough is its own page
  promptEl.value = sel.value; promptEl.dispatchEvent(new Event('input'));
  sel.selectedIndex = 0;  // back to "Try an example…" so the same example can be picked again
  $('#dock').requestSubmit();
});
$('#dock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#buildBtn');
  if (busyCtl) { busyCtl.abort(); return; }
  if (references.preparing()) { setStatus('Wait for the reference files to finish preparing.', ''); return; }
  const text = promptEl.value.trim();
  const files = references.files();
  if (!text && !files.length) { promptEl.focus(); return; }
  if (files.length && !backendFn?.references) {
    setStatus(sampleResolved ? 'File-based builds need the local Claude connection. Configure it and restart the server; your files are still attached.' : 'Connecting to Claude. Your reference files are ready; try Build in a moment.', 'warn'); return;
  }
  if (!sampleFn) { applySpec(normalize(offlineSpec(text)), sampleResolved ? 'Claude isn’t available in this view, so the offline parser built this. Prices are illustrative.' : 'Built with the offline parser while Claude connects. Prices are illustrative.', ''); return; }
  busyCtl = new AbortController();
  references.lock(true);
  btn.textContent = 'Stop';
  setStatus(files.length ? 'Claude is reading your references and building the layout…' : 'Claude is laying it out…', 'busy');
  try {
    const generator = files.length ? backendFn : sampleFn;
    const raw = await generator.json(claudePrompt(text, files.length), { modelTier: 'quick', signal: busyCtl.signal, prompt: text, references: files });
    if (busyCtl.signal.aborted) throw Object.assign(new Error('Stopped'), { code: 'cancelled' });
    applySpec(normalize(raw), files.length ? 'Built from your references and instructions. Tap a zone to explore.' : 'Layout and prices by Claude. Tap any zone to see it.', 'ai');
  } catch (err) {
    const code = err && err.code;
    if (code === 'cancelled') setStatus('Stopped. The previous layout is still showing.', '');
    else if (files.length) setStatus(code === 'bad_reference' || code === 'bad_request' ? err.message : code === 'rate_limited' ? 'Claude is busy. Your files are still attached; try again shortly.' : code === 'session_expired' || code === 'not_granted' ? 'The Claude connection is unavailable. Reconnect and try again; your references are still attached.' : 'Could not build from these references. Try again or use a smaller document; your current scene is still showing.', 'warn');
    else if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) { sampleFn = null; applySpec(normalize(offlineSpec(text)), 'Claude isn’t allowed in this view, so the offline parser built this. Prices are illustrative.', ''); }
    else if (code === 'rate_limited') setStatus('Claude is busy or your usage limit is reached. Try again in a minute.', 'warn');
    else if (code === 'session_expired') setStatus('Sign in to Claude again, then press Build.', 'warn');
    else if (code === 'refused') setStatus('Claude declined that request. Try describing the space differently.', 'warn');
    else applySpec(normalize(offlineSpec(text)), 'Claude didn’t return a usable layout, so the offline parser built this. Press Build to try Claude again.', 'warn');
  } finally {
    busyCtl = null; btn.textContent = 'Build'; references.lock(false);
  }
});
/* Outside a Claude artifact, use the local backend (scripts/claude-api.mjs) when it has an API key.
   It mimics the artifact `sample` interface: json(prompt) resolves to a spec or throws with err.code. */
async function backendSample() {
  let health;
  try {
    const h = await fetch('/api/health', { cache: 'no-store' });
    if (!h.ok) return null;
    health = await h.json(); if (!health.claude) return null;
  } catch (e) { return null; }
  return {
    references: health.references === true,
    async json(_prompt, { signal, prompt, references = [] } = {}) {
      let r;
      try {
        r = await fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, references }), signal });
      } catch (e) { throw Object.assign(new Error('cancelled'), { code: signal?.aborted ? 'cancelled' : 'network' }); }
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(body.message || body.error), { code: body.error });
      return body;
    },
  };
}
(async () => {
  try { sampleFn = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('sample') : null; } catch (e) { sampleFn = null; }
  backendFn = await backendSample();
  if (!sampleFn) sampleFn = backendFn;
  sampleResolved = true;
  if (!statusLocked) {
    setStatus(sampleFn ? 'Claude is ready. Describe a space and press Build.' : 'Offline parser: Claude isn’t connected in this view.', sampleFn ? 'ai' : '');
  }
})();

/* ---------- render loop ---------- */
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let lastHot = null;
function frame(now) {
  requestAnimationFrame(frame);
  if (!renderer || !world || document.hidden) return;
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  runTweens(now);
  world.update(dt, t, mode);
  composer?.update(dt, t);
  if (mode === 'overview') {
    movePad.update(dt);
    const animatingCamera = [...tweens].some((tw) => tw.channel === 'camera');
    if (animatingCamera) { controls.update(dt); navigation.reset(); }
    else navigation.update(dt, true);
  }
  if (mode === 'view') {
    tmp.copy(look.base).applyAxisAngle(new THREE.Vector3(0, 1, 0), look.yaw);
    tmp.y += look.pitch * -1; // drag down looks down
    camera.position.copy(look.eye);
    camera.lookAt(look.eye.clone().add(tmp));
  }
  sky.position.copy(camera.position);
  valuation.frame(camera, mode === 'overview');
  if (mode === 'overview' && canvasPointer && hoverDirty && !down) {
    hoverDirty = false;
    if (document.elementFromPoint(canvasPointer.x, canvasPointer.y) === canvas) {
      const hit = pickDetail(canvasPointer.x, canvasPointer.y); setHover(hit?.zone || null, hit?.seat || null);
    } else { canvasPointer = null; setHover(null); }
  }
  world.zones.forEach((zo, id) => {
    const L = zoneLevels.get(id); if (!L) return;
    const target = mode !== 'overview' ? 0 : id === hovered ? 1 : id === selected ? 0.6 : 0;
    L.cur = lerp(L.cur, target, 0.24); L.flash *= 0.94;
    const v = Math.min(1, L.cur + L.flash * 0.35);
    zo.mats.floor.color.copy(L.floorColor).lerp(L.tint, v * 0.42);
    zo.mats.furn.color.copy(L.furnColor).lerp(L.tint, v * 0.48);
    zo.mats.floor.emissiveIntensity = v * 0.42;
    zo.mats.furn.emissiveIntensity = v * 0.3;
    if (zo.hoverOutline) zo.hoverOutline.visible = mode === 'overview' && id === hovered;
  });
  if (hovered !== lastHot) { lastHot = hovered; document.querySelectorAll('.zbtn').forEach((b) => b.classList.toggle('hot', b.dataset.zone === hovered)); }
  // floating price tag
  const tagId = mode === 'overview' ? (hovered || selected) : null;
  const tag = $('#tag');
  if (tagId && world.zones.get(tagId)) {
    const zo = world.zones.get(tagId);
    const p = hoverSeat ? hoverSeat.point.clone().add(new THREE.Vector3(0, 0.5, 0)) : zo.anchor.clone();
    p.project(camera);
    if (p.z < 1) {
      tag.style.opacity = 1;
      tag.style.left = `${(p.x + 1) / 2 * innerWidth}px`; tag.style.top = `${(1 - p.y) / 2 * innerHeight - 10}px`;
      const label = hoverSeat?.object.userData.seatLabels?.[hoverSeat.instanceId];
      const valTag = label ? null : valuation.tag(tagId);
      const tagKey = `${tagId}:${label || ''}:${valTag || ''}`;
      if (tag.dataset.zone !== tagKey) { tag.dataset.zone = tagKey; $('#tagName').textContent = label ? `${label} · ${zo.z.name}` : zo.z.name; $('#tagPrice').textContent = valTag || `${fmtMoney(zo.z.price, spec.currency)}${zo.z.price ? ' ' + zo.z.priceUnit : ''}`; }
    } else tag.style.opacity = 0;
  } else tag.style.opacity = 0;
  renderer.render(scene, camera);
}

/* ---------- boot ---------- */
function start(saved) {
  let first = null;
  if (saved && saved.spec) first = saved.spec;
  if (!first) { try { const s = localStorage.getItem('p2s:last'); if (s) first = JSON.parse(s); } catch (e) { /* ignore */ } }
  const sp = normalize(first || PRESETS.plane);
  addEventListener('resize', () => { resize(); });
  if (renderer) applySpec(sp, null);
  else { spec = sp; world = { zones: new Map(sp.zones.map((z) => [z.id, { z, floorsLabel: '' }])), glassLabel: 'Glass' }; renderHud(); }
  requestAnimationFrame(frame);
}
if (window.claude?.hot) window.claude.hot.snapshot?.(() => ({ spec }));
window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
