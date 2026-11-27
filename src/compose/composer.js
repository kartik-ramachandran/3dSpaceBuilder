/*
 * Compose: the surroundings sidebar of app.html (its own copy; apartment.html has the Design sidebar in
 * src/apartment/). Tabs for assets and the scene list at the top, the Blender asset grid by category in the
 * middle, and a chat docked at the bottom: describe what to add ("a street with 6 townhouses and a 40 storey
 * tower"), attach a photo of a street, skyline or city to build it, or edit ("delete all", "remove the
 * cars", "undo"). Placed items glide while dragged, drop in when added, and can be selected, moved, turned,
 * duplicated, edited and removed; the composition is saved per scene, exports / imports as JSON, and has
 * undo / redo.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadLibrary } from '../scene/asset-library.js';
import * as outdoor from './catalog.js';
import { planFromPrompt } from './prompt-plan.js';
import { planFromImage, composePrompt, sanitize } from './image-plan.js';

/** Reads a typed figure: "1,250", "250 m²", "8.6 m"; for money also "1.9m", "850k", "NZD 2.1m". NaN when there is no number. */
function parseFigure(text, isMoney = false) {
  const m = String(text).replace(/,/g, '').match(/(\d*\.?\d+)\s*([km])?(?![²a-z])/i);
  if (!m) return NaN;
  const n = Number(m[1]), suffix = m[2]?.toLowerCase();
  if (!isMoney) return n;
  return n * (suffix === 'k' ? 1e3 : suffix === 'm' || n < 1000 ? 1e6 : 1);
}

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const selMat = new THREE.LineBasicMaterial({ color: '#ffc477', transparent: true, opacity: 0.95, depthTest: false });
const hoverMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthTest: false });

/** The outdoor catalogue: houses, townhouses, apartments, towers, vehicles, people, trees, streets and water. */
export const SURROUNDINGS = {
  TYPES: outdoor.TYPES, CATEGORIES: outdoor.CATEGORIES, TILES: outdoor.TILES, PALETTES: outdoor.PALETTES, tick: outdoor.tickMaterials,
  loadLibrary, planFromPrompt, mount: '.tools', snapStep: 1, reach: 110, maxGround: 3, focusMin: 12,
  imagePrompt: composePrompt,
  planFromImage: (img, anchor) => planFromImage(img, anchor),
  sanitizeImage: (raw, anchor) => sanitize(Array.isArray(raw) ? raw : raw?.items || [], anchor),
  text: {
    button: 'Compose', title: 'Surroundings', aria: 'Compose the surroundings',
    buttonTitle: 'Compose the surroundings: drag houses, townhouses, apartments, towers, cars, people, trees, roads and water into the scene, or describe them',
    placeholder: 'Ask to build or change anything…', snap: 'Snap 1 m', place: 'the ground',
    welcome: 'Hi! Drag anything from above into the scene, or tell me what to build: a street of townhouses, a 60 storey tower, a park, traffic. Attach a photo of a street or skyline and I will build it. I can also remove things (“delete all”, “remove the cars”) and undo.',
    suggestions: ['A street with 6 townhouses', 'A 60 storey tower', '8 cars and 20 people', 'A park with 12 trees', 'Delete all'],
    attachTitle: 'Attach a photo of a street, skyline or city (or an aerial view) and build it. You can also drop or paste an image.',
    attachError: 'Attach an image (JPG, PNG or WebP) of a street, skyline or city.',
    imageEmpty: 'Nothing recognisable to build from that picture. Try a clearer street or skyline photo.',
    attachPlaceholder: 'Optional: anything to change, e.g. “make the towers 60 storeys”',
    empty: 'Nothing placed yet. Drag a tile into the scene, or describe it in the chat.',
    noPlan: 'I could not find anything to place in that. Try “6 townhouses, a road, 10 trees and 4 cars”.',
    note: 'Click any figure to type your own; height and unit counts reshape the model. Values are illustrative (dummy data), not a valuation.',
  },
  ctx: (seed, sp) => ({ seed, currency: sp?.currency || 'NZD', rate: sp?.currency === 'INR' ? 115000 : 7200 }),
  surface: (o, b, size) => size.y < 1.2 && size.x * size.z > 400 && b.max.y < 1.5,
  totals(list) {
    let homes = 0, area = 0, cars = 0, people = 0, trees = 0;
    for (const it of list) {
      const st = Object.fromEntries(it.built.stats || []), num = (k) => Number(String(st[k] || '0').replace(/[^\d.]/g, '')) || 0;
      homes += num('Dwellings') + num('Apartments'); area += it.type !== 'lawn' && it.type !== 'water' && it.type !== 'park' && it.type !== 'carPark' ? num('Floor area') : 0;
      cars += it.type === 'car' || it.type === 'truck' ? 1 : it.type === 'road' ? it.params.traffic : it.type === 'carPark' ? Math.round(it.params.bays * it.params.fill / 100) : it.type === 'house' && it.params.car && it.params.style === 'house_a' ? 1 : 0;
      people += it.type === 'person' ? 1 : it.type === 'crowd' ? it.params.count : it.type === 'park' ? it.params.people : it.type === 'road' && it.params.footpaths ? it.params.walkers : 0;
      trees += it.type === 'tree' ? 1 : it.type === 'treeRow' ? it.params.count : it.type === 'park' ? it.params.trees : 0;
    }
    return [['Homes', homes], ['Floor area', `${Math.round(area).toLocaleString()} m²`], ['Cars', cars], ['People', people], ['Trees', trees]];
  },
  summary(it) {
    const p = it.params;
    return { house: () => ({ house_a: 'Family', house_b: 'Bungalow', house_c: 'Modern' }[p.style]), townhouses: () => `${p.units} homes`, apartment: () => `${p.floors} storeys · ${p.floors * p.units} apts`, tower: () => `${p.storeys} storeys`,
      car: () => (p.drive ? `driving ${p.speed} km/h` : 'parked'), truck: () => (p.drive ? 'driving' : 'parked'), person: () => (p.walk ? 'walking' : 'standing'), crowd: () => `${p.count} people`,
      tree: () => `${p.scale}×`, treeRow: () => `${p.count} trees`, park: () => `${p.radius} m radius`, lamp: () => '', road: () => `${p.length} m · ${p.lanes} lanes`, carPark: () => `${p.bays} bays`, water: () => `${p.length} × ${p.width} m`, lawn: () => `${p.width} × ${p.depth} m` }[it.type]?.() || '';
  },
};

export function createComposer({ scene, camera, canvas, controls, getWorld, getSpec, kit = SURROUNDINGS }) {
  const K = { ...SURROUNDINGS, ...kit, text: { ...SURROUNDINGS.text, ...kit.text } };
  const { TYPES, CATEGORIES, TILES, PALETTES } = K, T = K.text;
  const root = new THREE.Group(); root.name = 'Composed'; scene.add(root);
  const items = new Map();            // id → item
  let lib = null, libPromise = null, libGeometries = new Set();
  let open = false, selected = null, hovered = null, placing = null, ghost = null, drag = null, seq = 1, now = 0;
  let history = [], future = [], storageKey = 'p2s:compose:scene';
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let surfaces = [];
  let camTween = null;

  /* ---------------------------------------------------------------- DOM */
  const btn = document.createElement('button');
  btn.className = 'pill'; btn.id = 'composeBtn'; btn.type = 'button'; btn.title = T.buttonTitle;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></svg><span>${T.button}</span>`;
  btn.setAttribute('aria-pressed', 'false');
  $(K.mount)?.prepend(btn);

  const aside = document.createElement('aside');
  aside.id = 'composer'; aside.hidden = true; aside.setAttribute('aria-label', T.aria);
  // Layout: tabs (assets / scene) at the top, the asset grid filling the middle, the chat docked at the bottom.
  const SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const ICON = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    clip: '<path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/>',
    export: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>', import: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/>', clear: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  const icon = (k) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  aside.innerHTML = `
    <header class="cp-head">
      <div class="cp-title"><span class="cp-eyebrow">${esc(T.button)}</span><h2>${esc(T.title)}</h2></div>
      <div class="cp-tabs" role="tablist">
        <button type="button" role="tab" data-tab="assets" aria-selected="true">Assets</button>
        <button type="button" role="tab" data-tab="scene" aria-selected="false">Scene <span class="cp-count">0</span></button>
      </div>
      <button type="button" class="cp-help" data-act="help" aria-expanded="false" title="Keyboard and mouse">?</button>
      <button type="button" class="x" data-act="close" aria-label="Close the design panel">×</button>
    </header>
    <p class="cp-keys" hidden>${T.keys || `Drag a tile into the scene, or click a tile then click ${esc(T.place)} (Shift keeps placing). Drag items to move · R / Shift+R turn · Shift+scroll fine turn · Ctrl+D duplicate · Delete removes · Esc cancels`}</p>
    <div class="cp-pane" data-pane="assets">
      <div class="cp-tools">
        <input type="search" class="cp-search" placeholder="Search ${CATEGORIES.reduce((n, c) => n + c.tiles.length, 0)} assets" aria-label="Search assets">
        <label class="cp-chk" title="Snap positions"><input type="checkbox" data-opt="snap" checked> ${esc(T.snap)}</label>
        <label class="cp-chk" title="Give each placed piece a random turn"><input type="checkbox" data-opt="turn"> Turn</label>
      </div>
      <div class="cp-chips" role="toolbar" aria-label="Categories">${CATEGORIES.map((c) => `<button type="button" data-chip="${c.id}">${esc(c.label)}</button>`).join('')}</div>
      <div class="cp-scroll"><div class="cp-cats"></div></div>
    </div>
    <div class="cp-pane" data-pane="scene" hidden>
      <div class="cp-scroll">
        <section class="cp-scene">
          <div class="cp-totals"></div>
          <ul class="cp-list"></ul>
        </section>
      </div>
    </div>
    <section class="cp-chat" aria-label="Chat">
      <div class="cp-log" role="log" aria-live="polite"></div>
      <div class="cp-suggest"></div>
      <p class="cp-status" role="status" aria-live="polite"></p>
      <form class="cp-prompt" autocomplete="off">
        <div class="cp-attach" hidden><img alt=""><span class="cp-attach-name"></span><button type="button" class="x" data-act="detach" aria-label="Remove the image">×</button></div>
        <textarea rows="1" placeholder="${esc(T.placeholder)}" aria-label="Describe what to add, or what to change"></textarea>
        <div class="cp-prompt-row">
          <div class="cp-bar">
            <button type="button" data-act="attach" class="cp-clip" title="${esc(T.attachTitle)}" aria-label="Attach an image">${icon('clip')}</button>
            <span class="cp-sep"></span>
            <button type="button" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo')}</button>
            <button type="button" data-act="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${icon('redo')}</button>
            <span class="cp-sep"></span>
            <button type="button" data-act="export" title="Download this design as JSON" aria-label="Export">${icon('export')}</button>
            <button type="button" data-act="import" title="Load a design from JSON" aria-label="Import">${icon('import')}</button>
            <button type="button" data-act="clear" class="cp-danger" title="Remove everything you placed" aria-label="Clear">${icon('clear')}</button>
          </div>
          <button class="primary cp-send" type="submit" aria-label="Send" title="Send (Enter)">${SEND}</button>
        </div>
        <input type="file" accept=".json,application/json" hidden class="cp-file">
        <input type="file" accept="image/*" hidden class="cp-image">
      </form>
    </section>`;
  document.body.appendChild(aside);

  const insp = document.createElement('section');
  insp.id = 'cpInspector'; insp.hidden = true; insp.setAttribute('aria-label', 'Selected item');
  document.body.appendChild(insp);

  const log = [];                                  // the chat: { who: 'you' | 'claude', text }
  let replying = false;                            // the next status message answers what was typed
  function say(who, text, image) {
    if (!text && !image) return;
    log.push({ who, text, image }); if (log.length > 60) log.shift();
    const el = $('.cp-log', aside);
    el.innerHTML = log.map((m) => `<div class="cp-msg ${m.who}"><p>${m.image ? `<img class="cp-msg-img" alt="Attached image" src="${m.image}">` : ''}${m.text ? esc(m.text) : ''}</p></div>`).join('');
    el.scrollTop = el.scrollHeight;
    $('.cp-suggest', aside).hidden = log.some((m) => m.who === 'you');
  }
  const status = (msg) => {
    if (replying && msg) { replying = false; $('.cp-status', aside).textContent = ''; say('claude', msg); return; }
    $('.cp-status', aside).textContent = msg || '';
  };
  const opt = (k) => $(`[data-opt="${k}"]`, aside).checked;

  // category grid
  const cats = $('.cp-cats', aside);
  cats.innerHTML = CATEGORIES.map((c) => `
    <section class="cp-cat" data-cat="${c.id}">
      <h3><button type="button" class="cp-cat-toggle" aria-expanded="true">${esc(c.label)} <span>${c.tiles.length}</span></button></h3>
      <div class="cp-grid">${c.tiles.map((t) => `
        <button type="button" class="cp-tile" draggable="true" data-tile="${t.id}" title="${esc(t.label)} — ${esc(t.sub)}. Drag into the scene, or click then click the ground.">
          <span class="cp-thumb"><img alt="" data-thumb="${t.id}"></span>
          <b>${esc(t.label)}</b><small>${esc(t.sub)}</small>
        </button>`).join('')}</div>
    </section>`).join('');

  /* ---------------------------------------------------------------- library, thumbnails */
  function ensureLibrary() {
    if (!libPromise) {
      status('Loading the Blender asset library…');
      libPromise = K.loadLibrary().then((l) => {
        lib = l; for (const parts of l.modules.values()) parts.forEach((p) => libGeometries.add(p.geometry));
        status(''); renderThumbs(); restore(); return l;
      }).catch((e) => { status('The asset library could not load.'); console.warn(e); throw e; });
    }
    return libPromise;
  }

  async function renderThumbs() {
    const W = 384, H = 264;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const s = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r); s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    s.add(new THREE.HemisphereLight('#ffffff', '#8a8370', 1.2));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.4); sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 4; s.add(sun, sun.target);
    const floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.28 })); floorShadow.receiveShadow = true; s.add(floorShadow);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 5000);
    for (const tile of CATEGORIES.flatMap((c) => c.tiles)) {
      const id = tile.id;
      await new Promise((res) => setTimeout(res, 0));
      const built = build(tile.type, tile.params, 7);
      s.add(built.object); built.update?.(0, 1.3);
      const box = boundsOf(built.object), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      built.object.traverse((o) => { if (o.isMesh && !o.userData.glass) o.castShadow = true; });
      { const span = Math.max(size.x, size.z, size.y) * 1.6 + 1; floorShadow.scale.set(span * 2, 1, span * 2); floorShadow.position.set(c.x, box.min.y + 0.001, c.z);
        sun.target.position.copy(c); sun.position.copy(c).add(new THREE.Vector3(0.45, 1, 0.6).multiplyScalar(span)); Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.01, far: span * 4 }); sun.shadow.camera.updateProjectionMatrix(); }
      const tall = size.y > Math.max(size.x, size.z) * 1.6;
      const dir = new THREE.Vector3(tall ? 1.1 : 1.0, tall ? 0.35 : 0.75, tall ? 1.5 : 1.25).normalize();
      const big = Math.max(size.x, size.y * (tall ? 0.62 : 1), size.z), rad = big * 0.62 + Math.min(0.4, big * 0.15);
      cam.position.copy(c).addScaledVector(dir, rad / Math.tan(THREE.MathUtils.degToRad(15)) * 0.62); cam.lookAt(c); cam.near = rad * 0.05; cam.far = rad * 40; cam.updateProjectionMatrix();
      r.render(s, cam);
      const url = r.domElement.toDataURL('image/png');
      document.querySelectorAll(`img[data-thumb="${id}"]`).forEach((img) => { img.src = url; });
      thumbs.set(id, url);
      s.remove(built.object); disposeBuilt(built.object);
    }
    pm.dispose(); r.dispose();
    renderList();
  }
  const thumbs = new Map();

  /* ---------------------------------------------------------------- build / items */
  function ctx(seed, rel) { return { ...K.ctx(seed, getSpec()), rel }; }
  function build(type, params, seed, rel) { return TYPES[type].build({ ...params }, lib, ctx(seed, rel)); }
  function boundsOf(obj) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3(), b = new THREE.Box3(), m = new THREE.Matrix4();
    obj.traverse((o) => {
      if (!o.isMesh || o.material === hitMat) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); box.union(b.copy(o.geometry.boundingBox).applyMatrix4(m.premultiply(o.matrixWorld))); }
      else box.union(b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    return box;
  }
  function disposeBuilt(obj) { obj.traverse((o) => { if (o.geometry && !libGeometries.has(o.geometry)) o.geometry.dispose(); }); }

  function makeItem(data) {
    const id = data.id || `i${seq++}`;
    const it = { id, tile: data.tile, type: data.type, params: { ...data.params }, x: data.x || 0, z: data.z || 0, y: data.y || 0, rot: data.rot || 0, seed: data.seed ?? Math.floor(Math.random() * 1e6) };
    it.node = new THREE.Group(); it.node.name = `compose:${id}`; it.node.userData.composeId = id; root.add(it.node);
    rebuild(it); items.set(id, it); queueRelate();
    const n = Number(String(id).slice(1)); if (n >= seq) seq = n + 1;
    return it;
  }
  function rebuild(it) {
    const first = !it.built;
    if (it.built) { it.node.remove(it.built.object); disposeBuilt(it.built.object); it.node.remove(it.proxy); it.proxy.geometry.dispose(); it.outline && (it.node.remove(it.outline), it.outline.geometry.dispose()); it.outline = null; }
    it.built = build(it.type, it.params, it.seed, it.rel);
    it.node.add(it.built.object);
    if (first) { it.node.position.set(it.x, it.y, it.z); it.node.rotation.y = it.rot; }
    it.node.updateMatrixWorld(true);
    it.built.update?.(0, now);
    // local bounds for picking and the selection frame
    const inv = new THREE.Matrix4().copy(it.node.matrixWorld).invert();
    const box = boundsOf(it.built.object).applyMatrix4(inv);
    if (it.built.footprint) { const [w, d] = it.built.footprint; box.expandByPoint(new THREE.Vector3(-w / 2, 0, -d / 2)).expandByPoint(new THREE.Vector3(w / 2, 0.5, d / 2)); }
    it.box = box;
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    it.proxy = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 0.8), Math.max(size.y, 1.6), Math.max(size.z, 0.8)).translate(c.x, Math.max(c.y, 0.8), c.z), hitMat);
    it.proxy.userData.composeId = it.id; it.node.add(it.proxy);
    it.built.object.traverse((o) => { if (o.isMesh && !o.userData.glass) { o.castShadow = true; o.receiveShadow = true; } });
    if (selectedIds.has(it.id)) frame(it, true);
  }
  function frame(it, on, mat = selMat) {
    if (it.outline) { it.node.remove(it.outline); it.outline.geometry.dispose(); it.outline = null; }
    if (!on) return;
    const s = it.box.getSize(new THREE.Vector3()), c = it.box.getCenter(new THREE.Vector3());
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x + 0.4, s.y + 0.2, s.z + 0.4).translate(c.x, c.y, c.z));
    it.outline = new THREE.LineSegments(g, mat); it.outline.renderOrder = 10; it.node.add(it.outline);
  }
  let relating = false;
  function relate() {
    relating = false;
    if (!K.relate || !lib) return;
    const list = [...items.values()];
    for (const it of list) {
      const rel = K.relate(it, list); if (rel === undefined) continue;
      const sig = JSON.stringify(rel);
      if (sig !== it.relSig) { it.relSig = sig; it.rel = rel; rebuild(it); }
    }
  }
  const queueRelate = () => { if (K.relate && !relating) { relating = true; queueMicrotask(relate); } };
  function removeItem(id) {
    const it = items.get(id); if (!it) return;
    root.remove(it.node); disposeBuilt(it.node); items.delete(id); queueRelate();
    if (selected === id) select(null);
  }
  const serial = (it) => ({ id: it.id, tile: it.tile, type: it.type, params: it.params, x: +it.x.toFixed(2), z: +it.z.toFixed(2), y: +it.y.toFixed(2), rot: +it.rot.toFixed(4), seed: it.seed });
  const snapshot = () => JSON.stringify([...items.values()].map(serial));
  function load(json) {
    for (const id of [...items.keys()]) removeItem(id);
    for (const d of JSON.parse(json || '[]')) if (TYPES[d.type]) makeItem(d);
    renderList();
  }
  function commit(label) {
    history.push(lastState); if (history.length > 80) history.shift(); future = [];
    lastState = snapshot(); save(); renderList(); if (label) status(label); queueRelate();
  }
  let lastState = '[]';
  function save() { try { localStorage.setItem(storageKey, lastState); } catch (e) { /* storage full or off */ } }
  function restore() {
    if (!lib) return;
    let json = '[]'; try { json = localStorage.getItem(storageKey) || '[]'; } catch (e) { /* off */ }
    history = []; future = []; load(json); lastState = snapshot();
    if (items.size) status(`Restored ${items.size} item${items.size > 1 ? 's' : ''} you placed in this scene.`);
  }
  function undo() { if (!history.length) return; future.push(lastState); lastState = history.pop(); load(lastState); save(); status('Undone.'); }
  function redo() { if (!future.length) return; history.push(lastState); lastState = future.pop(); load(lastState); save(); status('Redone.'); }

  /* ---------------------------------------------------------------- picking */
  function setNdc(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function groundAt(e) {
    setNdc(e);
    const walk = walkable();
    const hit = surfaces.length || walk.length ? ray.intersectObjects(surfaces.concat(walk), false)[0] : null;
    const p = new THREE.Vector3();
    if (hit && hit.point.y < (K.maxGround ?? 3)) return hit.point;
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }
  /** Floors of placed rooms and platforms, so furniture dropped on them sits on them (not the one being moved). */
  function walkable() {
    const moving = drag?.id || ghost?.id, out = [];
    for (const it of items.values()) if (it.id !== moving && it.built.walkable) out.push(...it.built.walkable);
    return out;
  }
  function itemAt(e) {
    setNdc(e);
    root.updateMatrixWorld(true);
    const proxies = [...items.values()].filter((it) => it.node.visible && it !== ghost).map((it) => it.proxy);
    const hits = ray.intersectObjects(proxies, false);
    if (!hits.length) return null;
    const first = items.get(hits[0].object.userData.composeId), outer = first.box.clone().applyMatrix4(first.node.matrixWorld).expandByScalar(0.05);
    let best = first, bestVol = Infinity;
    for (const h of hits.slice(1)) {
      const it = items.get(h.object.userData.composeId); if (!it || it === first) continue;
      const b = it.box.clone().applyMatrix4(it.node.matrixWorld), sz = b.getSize(new THREE.Vector3()), vol = sz.x * sz.y * sz.z;
      if (outer.containsBox(b) && vol < bestVol) { best = it; bestVol = vol; }
    }
    return best;
  }
  function findSurfaces(world) {
    const out = [];
    world?.group.updateMatrixWorld(true);
    world?.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible || o.material?.visible === false) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld), s = b.getSize(new THREE.Vector3());
      if (K.surface(o, b, s)) out.push(o);
    });
    return out;
  }
  const snap = (v) => (opt('snap') ? Math.round(v / K.snapStep) * K.snapStep : v);
  /** Let the kit pull an item into place (a door into the nearest wall); returns true when it did. */
  function snapTo(it) { if (!K.snap) return false; const on = K.snap(it, [...items.values()].filter((o) => o !== it)); return on; }

  /* ---------------------------------------------------------------- placing */
  function startPlacing(tileId) {
    if (!lib) return;
    cancelPlacing();
    placing = tileId;
    aside.querySelectorAll('.cp-tile').forEach((t) => t.classList.toggle('placing', t.dataset.tile === tileId));
    status(`Click ${T.place} to place ${TILES.get(tileId).label.toLowerCase()} · Shift-click to keep placing · Esc to stop`);
    canvas.style.cursor = 'crosshair';
  }
  function cancelPlacing() {
    placing = null; canvas.style.cursor = '';
    aside.querySelectorAll('.cp-tile.placing').forEach((t) => t.classList.remove('placing'));
    if (ghost) { removeItem(ghost.id); ghost = null; }
  }
  function ghostFor(tileId, p) {
    if (!ghost || ghost.tile !== tileId) {
      if (ghost) removeItem(ghost.id);
      const t = TILES.get(tileId);
      ghost = makeItem({ tile: tileId, type: t.type, params: t.params, x: p.x, z: p.z, y: p.y, rot: opt('turn') ? Math.floor(Math.random() * 8) * Math.PI / 4 : 0 });
      ghost.node.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
    }
    ghost.x = snap(p.x); ghost.z = snap(p.z); ghost.y = p.y;
    snapTo(ghost); queueRelate();
  }
  function dropGhost(keep) {
    if (!ghost) return;
    const it = ghost; ghost = null;
    it.node.position.y += 0.45;
    it.node.traverse((o) => { if (o.isMesh) delete o.raycast; });
    select(it.id); commit(`Added ${TILES.get(it.tile).label.toLowerCase()}.`);
    // buildings: put the cursor in their height, so "60" + Enter sets it straight away
    const h = insp.querySelector('input.ci-num[data-param="storeys"], input.ci-num[data-param="floors"]'); if (h && !keep) { h.focus(); h.select(); }
    if (!keep) cancelPlacing();
  }

  /* ---------------------------------------------------------------- selection + inspector */
  const selectedIds = new Set();
  function roomContents(room) {
    if (room.type !== 'room') return [];
    const cos = Math.cos(room.rot), sin = Math.sin(room.rot);
    return [...items.values()].filter(it => {
      if (it === room || it === ghost || it.type === 'room') return false;
      const dx = it.x - room.x, dz = it.z - room.z;
      const x = dx * cos - dz * sin, z = dx * sin + dz * cos;
      return Math.abs(x) <= room.params.width / 2 + 0.05 && Math.abs(z) <= room.params.depth / 2 + 0.05 && it.y >= room.y - 0.1 && it.y < room.y + room.params.height;
    });
  }
  const selection = () => [...selectedIds].map(id => items.get(id)).filter(Boolean);
  const pose = it => ({ x: it.x, y: it.y, z: it.z, rot: it.rot });
  function moveContents(room, before) {
    const angle = room.rot - before.rot, cos = Math.cos(angle), sin = Math.sin(angle);
    for (const it of selection()) {
      if (it === room) continue;
      const dx = it.x - before.x, dz = it.z - before.z;
      it.x = room.x + dx * cos + dz * sin;
      it.z = room.z - dx * sin + dz * cos;
      it.y += room.y - before.y; it.rot += angle;
    }
    queueRelate();
  }
  function rotateSelection(angle) {
    const it = items.get(selected); if (!it) return;
    const before = pose(it); it.rot += angle; moveContents(it, before);
  }
  function select(id) {
    for (const it of selection()) frame(it, false);
    selectedIds.clear();
    selected = id && items.has(id) ? id : null;
    if (selected) {
      const primary = items.get(selected);
      for (const it of [primary, ...roomContents(primary)]) { selectedIds.add(it.id); frame(it, true); }
    }
    renderInspector(); renderList();
  }
  function setHovered(it) {
    if (hovered === it?.id) return;
    const old = hovered && items.get(hovered); if (old && !selectedIds.has(old.id)) frame(old, false);
    hovered = it?.id || null;
    if (it && !selectedIds.has(it.id)) frame(it, true, hoverMat);
  }

  /** Stat cards as inputs: typing over one either drives the model (height → storeys) or keeps your figure. */
  function statsHTML(it) {
    return it.built.stats.map(([k, v, m = {}]) => `<div class="${m.edited ? 'is-edited' : ''}${m.derived ? ' is-derived' : ''}"><dt>${esc(k)}${m.edited ? `<button type="button" class="ci-reset" data-reset="${esc(k)}" title="Back to the calculated figure" aria-label="Reset ${esc(k)}">↺</button>` : ''}</dt><dd><input class="ci-fact" data-fact="${esc(k)}" value="${esc(v)}" aria-label="${esc(k)}" title="${m.drive ? 'Type a figure — the model follows' : 'Type your own figure'}" spellcheck="false" autocomplete="off"></dd></div>`).join('');
  }
  function setFact(it, k, text) {
    const row = it.built.stats.find((r) => r[0] === k); if (!row) return;
    const n = parseFigure(text, k.startsWith('Est.')), facts = { ...(it.params.facts || {}) };
    if (!Number.isFinite(n) || n < 0) { renderInspector(); return; }                 // not a number: put the figure back
    const drive = row[2]?.drive;
    if (drive) {
      // apply through the params so the model changes, clamped to what the type allows
      const patch = drive(n), defs = TYPES[it.type].params;
      for (const [key, val] of Object.entries(patch)) {
        const d = defs.find((x) => x.key === key);
        it.params[key] = d?.type === 'range' ? +Math.min(d.max, Math.max(d.min, Math.round(val / d.step) * d.step)).toFixed(4) : val;
      }
      delete facts[k];
    } else facts[k] = Math.round(n * 100) / 100;
    it.params.facts = facts;
    rebuild(it); renderInspector(); commit();
    insp.querySelector(`input.ci-fact[data-fact="${CSS.escape(k)}"]`)?.focus();
  }

  function renderInspector() {
    const it = selected && items.get(selected);
    insp.hidden = !it || !open;
    if (!it) return;
    const tile = TILES.get(it.tile), def = TYPES[it.type];
    const field = (p) => {
      const v = it.params[p.key];
      if (p.type === 'range') return `<div class="ci-field"><span>${esc(p.label)} <span class="ci-numwrap"><input type="number" class="ci-num" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-param="${p.key}" aria-label="${esc(p.label)}${p.unit ? ' (' + esc(p.unit) + ')' : ''}">${p.unit ? `<i>${esc(p.unit)}</i>` : ''}</span></span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-param="${p.key}" aria-label="${esc(p.label)}"><small class="ci-range">${p.min}–${p.max}${p.unit ? ' ' + esc(p.unit) : ''}</small></div>`;
      if (p.type === 'choice') return `<div class="ci-field"><span>${esc(p.label)}</span><div class="ci-seg">${p.options.map(([val, lab]) => `<button type="button" data-param="${p.key}" data-value="${esc(val)}" aria-pressed="${String(val) === String(v)}">${esc(lab)}</button>`).join('')}</div></div>`;
      if (p.type === 'colour') return `<div class="ci-field"><span>${esc(p.label)}</span><div class="ci-swatches">${PALETTES[p.palette].map((c) => `<button type="button" class="ci-sw" style="--c:${c}" data-param="${p.key}" data-value="${c}" aria-pressed="${c === v}" aria-label="${c}"></button>`).join('')}<label class="ci-sw ci-pick" style="--c:${esc(v)}" title="Any colour"><input type="color" value="${esc(v)}" data-param="${p.key}"></label></div></div>`;
      if (p.type === 'toggle') return `<label class="ci-toggle"><input type="checkbox" data-param="${p.key}" ${v ? 'checked' : ''}><span>${esc(p.label)}</span></label>`;
      return '';
    };
    const deg = Math.round(((THREE.MathUtils.radToDeg(it.rot) % 360) + 360) % 360);
    insp.innerHTML = `
      <header class="ci-head"><img alt="" src="${thumbs.get(TILES.get(it.tile)?.id) || ''}"><div><span class="cp-eyebrow">${esc(CATEGORIES.find((c) => c.id === tile.cat)?.label || '')}</span><h3>${esc(tile.label)}</h3></div><button type="button" class="x" data-act="deselect" aria-label="Deselect">×</button></header>
      ${it.built.stats?.length ? `<dl class="ci-stats">${statsHTML(it)}</dl>` : ''}
      <div class="ci-fields">${def.params.map(field).join('')}
        <label class="ci-field"><span>Turn <output>${deg}°</output></span><input type="range" min="0" max="359" step="1" value="${deg}" data-transform="rot"></label>
        <div class="ci-xyz"><label>X <input type="number" step="${K.snapStep}" value="${it.x.toFixed(2)}" data-transform="x"></label>${K.showY ? `<label>Y <input type="number" step="0.05" value="${it.y.toFixed(2)}" data-transform="y" title="Height above the floor"></label>` : ''}<label>Z <input type="number" step="${K.snapStep}" value="${it.z.toFixed(2)}" data-transform="z"></label></div>
      </div>
      <div class="ci-actions">
        <button type="button" data-act="rotate">Turn 90°</button><button type="button" data-act="duplicate">Duplicate</button><button type="button" data-act="focus">Focus</button><button type="button" data-act="delete" class="cp-danger">Delete</button>
      </div>
      <p class="ci-note">${selectedIds.size > 1 ? `Room + ${selectedIds.size - 1} contained objects selected. Move, turn, duplicate or delete them together. ` : ""}${esc(T.note)}</p>`;
  }
  insp.addEventListener('input', (e) => {
    const it = items.get(selected); if (!it) return;
    const t = e.target;
    if (t.dataset.fact) return;                                                        // applied on change / Enter
    if (t.dataset.transform) {
      const v = Number(t.value), before = pose(it);
      if (t.dataset.transform === 'rot') { it.rot = THREE.MathUtils.degToRad(v); t.previousElementSibling.querySelector('output').textContent = `${v}°`; }
      else it[t.dataset.transform] = v;
      moveContents(it, before);
      it.node.position.set(it.x, it.y, it.z); it.node.rotation.y = it.rot; queueRelate(); return;
    }
    if (t.dataset.param) {
      const p = TYPES[it.type].params.find((x) => x.key === t.dataset.param);
      if (p.type === 'range') {
        const n = Number(t.value);
        if (t.value === '' || Number.isNaN(n) || n < p.min || n > p.max) return;          // still typing, or out of range (clamped on change)
        t.closest('.ci-field').querySelectorAll(`input[data-param="${p.key}"]`).forEach((x) => { if (x !== t) x.value = n; });
      }
      it.params[p.key] = t.type === 'checkbox' ? t.checked : p.type === 'range' ? Number(t.value) : t.value;
      if (p.type !== 'range') { rebuild(it); renderInspector(); commit(); } else scheduleRebuild(it);
    }
  });
  let rebuildTimer = null;
  function scheduleRebuild(it) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { rebuild(it); const stats = insp.querySelector('.ci-stats'); if (stats && it.built.stats && !stats.contains(document.activeElement)) stats.innerHTML = statsHTML(it); }, 60); }
  insp.addEventListener('change', (e) => {
    const t = e.target, it = items.get(selected);
    if (it && t.dataset.fact) { setFact(it, t.dataset.fact, t.value); return; }
    if (it && t.classList.contains('ci-num')) {                                         // typed a number: clamp, apply, commit
      const p = TYPES[it.type].params.find((x) => x.key === t.dataset.param);
      const n = +Math.min(p.max, Math.max(p.min, Math.round((Number(t.value) || p.min) / p.step) * p.step)).toFixed(4);
      t.closest('.ci-field').querySelectorAll(`input[data-param="${p.key}"]`).forEach((x) => { x.value = n; });
      if (it.params[p.key] !== n) { it.params[p.key] = n; rebuild(it); }
      renderInspector(); commit(); insp.querySelector(`input.ci-num[data-param="${p.key}"]`)?.focus(); return;
    }
    if (e.target.type === 'range' || e.target.type === 'number' || e.target.type === 'color') { const it = items.get(selected); if (it && e.target.type === 'color') { rebuild(it); renderInspector(); } commit(); } });
  insp.addEventListener('keydown', (e) => {
    const t = e.target; if (!t.dataset?.fact) return;
    if (e.key === 'Enter') { e.preventDefault(); t.blur(); }                            // blur fires change
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renderInspector(); }
  });
  insp.addEventListener('focusin', (e) => { if (e.target.dataset?.fact) e.target.select(); });
  insp.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const it = items.get(selected); if (!it) return;
    if (b.dataset.reset) { const f = { ...(it.params.facts || {}) }; delete f[b.dataset.reset]; it.params.facts = f; rebuild(it); renderInspector(); commit(); return; }
    if (b.dataset.param) {
      const p = TYPES[it.type].params.find((x) => x.key === b.dataset.param);
      it.params[p.key] = typeof p.options?.[0]?.[0] === 'number' ? Number(b.dataset.value) : b.dataset.value;
      rebuild(it); renderInspector(); commit(); return;
    }
    act(b.dataset.act);
  });

  function act(a) {
    const it = items.get(selected);
    if (a === 'deselect') select(null);
    if (!it) return;
    if (a === 'rotate') { rotateSelection(Math.PI / 2); renderInspector(); commit(); }
    if (a === 'delete') { const group = selection(); for (const member of group) removeItem(member.id); commit(`Removed ${group.length} object${group.length === 1 ? '' : 's'}.`); }
    if (a === 'duplicate') {
      const w = (it.box.max.x - it.box.min.x) + 2, dx = Math.cos(it.rot) * w, dz = -Math.sin(it.rot) * w;
      const copies = selection().map(member => makeItem({ ...serial(member), id: undefined, x: member.x + dx, z: member.z + dz, seed: Math.floor(Math.random() * 1e6) }));
      select(copies[0].id); commit('Duplicated.');
    }
    if (a === 'focus') focusOn(selection());
  }

  function focusOn(list) {
    if (!list.length) return;
    const box = new THREE.Box3(); const at = (it) => new THREE.Matrix4().compose(new THREE.Vector3(it.x, it.y, it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot), new THREE.Vector3(1, 1, 1));
    list.forEach((it) => box.union(it.box.clone().applyMatrix4(at(it))));
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(K.focusMin ?? 12, box.getSize(new THREE.Vector3()).length() * 0.6);
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
    camTween = { t0: performance.now(), d: 900, fromPos: camera.position.clone(), fromTgt: controls.target.clone(), toTgt: c, toPos: c.clone().addScaledVector(dir, r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.7) };
  }

  /* ---------------------------------------------------------------- scene list */
  const live = () => [...items.values()].filter((it) => !ghost || it.id !== ghost.id);
  function summary(it) { return K.summary(it) || ''; }
  function renderList() {
    const list = [...items.values()].filter((it) => !ghost || it.id !== ghost.id);
    $('.cp-count', aside).textContent = list.length;
    $('.cp-totals', aside).innerHTML = list.length ? K.totals(live()).map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('') : `<p class="cp-empty">${esc(T.empty)}</p>`;
    $('.cp-list', aside).innerHTML = list.map((it) => `
      <li data-item="${it.id}" aria-selected="${selectedIds.has(it.id)}">
        <button type="button" class="cp-li" data-pick="${it.id}"><img alt="" src="${thumbs.get(TILES.get(it.tile)?.id) || ''}"><span><b>${esc(TILES.get(it.tile)?.label || it.type)}</b><small>${esc(summary(it))}</small></span></button>
        <button type="button" class="cp-li-x" data-remove="${it.id}" aria-label="Remove">×</button>
      </li>`).join('');
  }

  /* ---------------------------------------------------------------- sidebar events */
  aside.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tile) { ensureLibrary().then(() => (placing === b.dataset.tile ? cancelPlacing() : startPlacing(b.dataset.tile))); return; }
    if (b.dataset.pick) { select(b.dataset.pick); focusOn([items.get(b.dataset.pick)]); return; }
    if (b.dataset.remove) { removeItem(b.dataset.remove); commit('Removed.'); return; }
    if (b.classList.contains('cp-cat-toggle')) { const g = b.closest('.cp-cat'); const on = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(on)); g.classList.toggle('collapsed', !on); return; }
    const a = b.dataset.act;
    if (a === 'close') setOpen(false);
    if (a === 'attach') $('.cp-image', aside).click();
    if (a === 'detach') detach();
    if (a === 'help') { const k = $('.cp-keys', aside); k.hidden = !k.hidden; b.setAttribute('aria-expanded', String(!k.hidden)); }
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'clear') { if (!items.size) return; for (const id of [...items.keys()]) removeItem(id); commit('Cleared. Undo brings it back.'); }
    if (a === 'export') {
      const blob = new Blob([JSON.stringify({ scene: getSpec()?.name || 'scene', items: JSON.parse(snapshot()) }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = Object.assign(document.createElement('a'), { href: url, download: 'composition.json' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (a === 'import') $('.cp-file', aside).click();
  });
  $('.cp-file', aside).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); await ensureLibrary(); load(JSON.stringify(d.items || d)); commit(`Imported ${items.size} items.`); focusOn([...items.values()]); }
    catch (err) { status('That file is not a composition.'); }
    e.target.value = '';
  });
  $('.cp-search', aside).addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    aside.querySelectorAll('.cp-tile').forEach((t) => { const tile = TILES.get(t.dataset.tile); t.hidden = q && !`${tile.label} ${tile.sub} ${tile.type} ${tile.cat}`.toLowerCase().includes(q); });
    aside.querySelectorAll('.cp-cat').forEach((c) => { c.hidden = ![...c.querySelectorAll('.cp-tile')].some((t) => !t.hidden); });
  });
  aside.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.cp-tile'); if (!t) return;
    ensureLibrary();
    e.dataTransfer.setData('text/x-compose', t.dataset.tile); e.dataTransfer.setData('text/plain', t.dataset.tile); e.dataTransfer.effectAllowed = 'copy';
    const img = t.querySelector('img'); if (img?.src) e.dataTransfer.setDragImage(img, 48, 33);
    dragTile = t.dataset.tile;
  });
  aside.addEventListener('dragend', () => { dragTile = null; if (ghost) { removeItem(ghost.id); ghost = null; } });
  let dragTile = null;
  canvas.addEventListener('dragover', (e) => {
    if (!dragTile || !lib) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    const p = groundAt(e); if (p) ghostFor(dragTile, p);
  });
  canvas.addEventListener('dragleave', () => { if (ghost && dragTile) { removeItem(ghost.id); ghost = null; } });
  canvas.addEventListener('drop', (e) => {
    if (!dragTile) return; e.preventDefault();
    const p = groundAt(e); if (p) ghostFor(dragTile, p);
    dropGhost(false); dragTile = null;
  });

  const form = $('.cp-prompt', aside), submitBtn = $('.cp-prompt .primary', aside), textarea = $('.cp-prompt textarea', aside);
  /**
   * Edits typed into the prompt: "delete all", "clear", "remove the sofas", "delete selected", "undo", "redo".
   * Returns true when the text was a command (handled here), false when it describes things to add.
   */
  function command(raw) {
    const t = raw.toLowerCase().replace(/[.!?]+$/, '').trim();
    if (/^(undo|go back)\b/.test(t)) { undo(); return true; }
    if (/^redo\b/.test(t)) { redo(); return true; }
    const verb = /^(please\s+)?(delete|remove|clear|erase|wipe|empty|get rid of|take out|reset|start over|start again)\b\s*(.*)$/.exec(t);
    if (!verb) return false;
    const what = verb[3].replace(/^(all of |all the |all |every |each |the |my |of )+/, '').replace(/\b(from|in|off) (the )?(scene|plot|apartment|room)$/, '').trim();
    const live = [...items.values()].filter((it) => !ghost || it.id !== ghost.id);
    if (!what || /^(all|everything|every ?thing|it all|scene|the scene|plot|items|things|stuff)$/.test(what) || /^(clear|empty|reset|start over|start again)$/.test(verb[2]) && !what) {
      if (!live.length) { status('There is nothing to remove yet.'); return true; }
      for (const it of live) removeItem(it.id);
      commit(`Removed everything (${live.length} item${live.length > 1 ? 's' : ''}). Type “undo” or press Undo to bring it back.`);
      return true;
    }
    if (/^(this|it|that|selected|the selected( one| item)?|selection)$/.test(what)) {
      if (!selected) { status('Select something first, then say “delete this”.'); return true; }
      act('delete'); return true;
    }
    // "the sofas", "2 chairs", "all windows": match on the tile name, type or summary (singular or plural)
    const words = what.replace(/^\d+\s+/, '').split(/\s+/).map((w) => w.replace(/(ies)$/, 'y').replace(/(sh|ch|x|s)es$/, '$1').replace(/s$/, ''));
    const limit = Number(/^(\d+)\s/.exec(what)?.[1]) || Infinity;
    const hit = live.filter((it) => { const tile = TILES.get(it.tile); const hay = `${tile?.label} ${tile?.sub} ${it.type} ${it.params?.name || ''} ${summary(it)}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, limit);
    if (!hit.length) { status(`Nothing matching “${what}” in the scene.`); return true; }
    for (const it of hit) removeItem(it.id);
    commit(`Removed ${hit.length} ${hit.length > 1 ? 'items' : 'item'} (${what}). Type “undo” to bring ${hit.length > 1 ? 'them' : 'it'} back.`);
    return true;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text && !attached) return;
    if (attached) { const pic = attached; say('you', text, pic.url); textarea.value = ''; grow(); detach(); await ensureLibrary(); await buildFromImage(pic, text); return; }
    say('you', text); textarea.value = ''; grow(); replying = true;
    await ensureLibrary();
    if (command(text)) { replying = false; return; }
    const anchor = freeAnchor();
    const plan = K.planFromPrompt(text, anchor);
    if (!plan.items.length) { status(T.noPlan); replying = false; return; }
    const added = plan.items.map((d) => makeItem({ ...d, y: 0 }));
    for (const it of added) { const g = groundAt2(it.x, it.z); it.y = g; it.node.position.y = g; }
    cascade(added);
    commit(plan.summary); replying = false; select(null); focusOn(added);
  });
  /* ---------- image → rooms: a floor plan or a room photo ---------- */
  let attached = null;                                      // { img, url, name, mediaType, data }
  const chip = $('.cp-attach', aside);
  async function attach(file) {
    if (!file || !file.type?.startsWith('image/')) { say('claude', T.attachError); return; }
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
    const small = cv.toDataURL('image/jpeg', 0.88);
    attached = { img, url: small, name: file.name || 'image', mediaType: 'image/jpeg', data: small.split(',')[1] };
    chip.hidden = false; chip.querySelector('img').src = small; chip.querySelector('.cp-attach-name').textContent = attached.name;
    textarea.placeholder = T.attachPlaceholder; textarea.focus();
    status('Image attached. Press send to build it.');
  }
  function detach() { attached = null; chip.hidden = true; textarea.placeholder = T.placeholder; status(''); }
  async function buildFromImage(pic, text) {
    const anchor = freeAnchor(), send = $('.cp-send', aside);
    let raw = null, summary = '', via = 'offline';
    send.disabled = true; aside.classList.add('cp-busy');
    try {
      const health = await fetch('/api/health', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (health?.claude) {
        status('Claude is reading the picture…');
        try {
          const r = await fetch('/api/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instructions: K.imagePrompt(text), image: { name: pic.name, mediaType: pic.mediaType, data: pic.data } }) });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw Object.assign(new Error(body.message || body.error), { code: body.error });
          raw = body; summary = body.summary || 'Built from your picture.'; via = 'claude';
        } catch (err) { status(`Claude could not read it (${err.code || err.message}); reading it offline…`); }
      } else status('Reading the picture…');
      if (!raw) {
        await new Promise((res) => setTimeout(res, 30));
        const plan = K.planFromImage(pic.img, { x: 0, z: 0 });
        raw = plan.raw; summary = plan.summary + (health?.claude ? '' : ' (Read offline: add ANTHROPIC_API_KEY to .env and restart the server for Claude to read pictures properly.)');
      }
      const placed = K.sanitizeImage(raw, anchor);
      if (!placed.length) { status(''); say('claude', T.imageEmpty); return; }
      const added = placed.map((d) => makeItem({ ...d, y: 0 }));
      for (const it of added) { const g = groundAt2(it.x, it.z); it.y = g; it.node.position.y = g; }
      cascade(added);
      status(''); commit(); say('claude', summary); select(null); focusOn(added);
      if (text && via !== 'claude' && !command(text)) {                          // offline: apply the typed extras as a normal prompt
        const extra = K.planFromPrompt(text, freeAnchor());
        if (extra.items.length) { const more = extra.items.map((d) => makeItem({ ...d, y: 0 })); cascade(more); commit(); say('claude', extra.summary); }
      }
    } finally { send.disabled = false; aside.classList.remove('cp-busy'); }
  }
  $('.cp-image', aside).addEventListener('change', (e) => { attach(e.target.files[0]); e.target.value = ''; });
  textarea.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f); } });
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  aside.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); aside.classList.add('cp-dropping'); } });
  aside.addEventListener('dragleave', (e) => { if (!aside.contains(e.relatedTarget)) aside.classList.remove('cp-dropping'); });
  aside.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); aside.classList.remove('cp-dropping'); attach(e.dataTransfer.files[0]); });
  canvas.addEventListener('dragover', (e) => { if (open && hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  canvas.addEventListener('drop', async (e) => { if (!open || !hasFiles(e)) return; e.preventDefault(); await attach(e.dataTransfer.files[0]); });

  const grow = () => { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(140, textarea.scrollHeight)}px`; };
  textarea.addEventListener('input', grow);
  const SUGGEST = T.suggestions || ['A 3 bedroom house', 'A 4 x 3.6 bedroom', 'A kitchen with an island', 'A sofa, a rug and 2 lamps', 'Delete all'];
  $('.cp-suggest', aside).innerHTML = SUGGEST.map((q) => `<button type="button" data-say="${esc(q)}">${esc(q)}</button>`).join('');
  $('.cp-suggest', aside).addEventListener('click', (e) => { const b = e.target.closest('[data-say]'); if (!b) return; textarea.value = b.dataset.say; form.requestSubmit(); });
  say('claude', T.welcome || 'Hi! Drag anything from above into the scene, or tell me what to build: a room, a whole house, or furniture. I can also remove things (“delete all”, “remove the chairs”) and undo.');

  // tabs, category chips (jump + follow the scroll), keyboard help
  aside.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    aside.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    aside.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  const assetScroll = $('[data-pane="assets"] .cp-scroll', aside);
  $('.cp-chips', aside).addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]'); if (!b) return;
    const sec = aside.querySelector(`.cp-cat[data-cat="${b.dataset.chip}"]`); if (!sec) return;
    sec.classList.remove('collapsed'); sec.querySelector('.cp-cat-toggle')?.setAttribute('aria-expanded', 'true');
    assetScroll.scrollTo({ top: sec.offsetTop - assetScroll.offsetTop - 2, behavior: 'smooth' });
  });
  assetScroll.addEventListener('scroll', () => {
    let cur = null; for (const sec of aside.querySelectorAll('.cp-cat:not([hidden])')) if (sec.offsetTop - assetScroll.offsetTop - 8 <= assetScroll.scrollTop) cur = sec.dataset.cat;
    cur ??= aside.querySelector('.cp-cat:not([hidden])')?.dataset.cat;
    aside.querySelectorAll('[data-chip]').forEach((c) => { const on = c.dataset.chip === cur; if (on && c.getAttribute('aria-current') !== 'true') c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); c.setAttribute('aria-current', String(on)); });
  }, { passive: true });
  requestAnimationFrame(() => assetScroll.dispatchEvent(new Event('scroll')));
  $('.cp-prompt textarea', aside).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.cp-prompt', aside).requestSubmit(); } });

  /** An open area beside the existing scene, to the side the camera faces, for prompt layouts. */
  function freeAnchor() {
    const world = getWorld();
    const occupied = world?.fitBox ? world.fitBox.clone() : new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 5, 20));
    for (const it of items.values()) occupied.union(it.box.clone().applyMatrix4(it.node.matrixWorld));
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); right.y = 0; right.normalize();
    const c = occupied.getCenter(new THREE.Vector3()), s = occupied.getSize(new THREE.Vector3());
    const out = Math.abs(right.x) > Math.abs(right.z) ? new THREE.Vector3(Math.sign(right.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(right.z));
    const reach = (out.x ? s.x : s.z) / 2 + K.reach;
    return { x: c.x + out.x * reach, z: c.z + out.z * reach };
  }
  /** New items drop into place one after another, so a generated layout visibly builds itself. */
  function cascade(list) {
    const step = Math.min(0.045, 1.4 / Math.max(1, list.length));
    list.forEach((it, i) => { it.node.position.y += 1.6 + Math.min(4, (it.box.max.y - it.box.min.y) * 0.4); it.delay = i * step; it.node.visible = false; });
  }
  function groundAt2(x, z) {
    if (!surfaces.length) return 0;
    const r = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
    const h = r.intersectObjects(surfaces, false)[0];
    return h && h.point.y < (K.maxGround ?? 3) ? h.point.y : 0;
  }

  /* ---------------------------------------------------------------- canvas interaction (capture phase: runs before orbit and zone picking) */
  // Placed modules remain selectable in the overview. Wait for a click so dragging
  // the scene still orbits; open Design only once an actual item is selected.
  let overviewDown = null;
  canvas.addEventListener('pointerdown', (event) => {
    overviewDown = !open && lib && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
  }, true);
  canvas.addEventListener('pointercancel', () => { overviewDown = null; }, true);
  canvas.addEventListener('pointerup', (event) => {
    const start = overviewDown; overviewDown = null;
    if (!start || open || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const item = itemAt(event);
    if (!item) return;
    canvas.focus({ preventScroll: true });
    setOpen(true); select(item.id);
    event.preventDefault();
  }, true);

  canvas.addEventListener('pointerdown', (e) => {
    if (!open || e.button !== 0 || !lib) return;
    if (placing) {
      const p = groundAt(e); if (!p) return;
      ghostFor(placing, p); dropGhost(e.shiftKey);
      e.stopImmediatePropagation(); e.preventDefault(); return;
    }
    const it = itemAt(e);
    if (it) {
      canvas.focus({ preventScroll: true });
      select(it.id);
      const p = groundAt(e);
      drag = { id: it.id, off: p ? new THREE.Vector3(it.x - p.x, 0, it.z - p.z) : new THREE.Vector3(), lift: p ? it.y - p.y : 0, moved: false, pointer: e.pointerId };
      controls.enabled = false; canvas.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation(); e.preventDefault();
    } else if (selected) { select(null); }
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!open || !lib) return;
    if (drag) {
      const it = items.get(drag.id), p = groundAt(e); if (!it || !p) return;
      const before = pose(it);
      it.x = snap(p.x + drag.off.x); it.z = snap(p.z + drag.off.z); it.y = p.y + drag.lift; drag.moved = true;
      snapTo(it); moveContents(it, before); queueRelate();
      e.stopImmediatePropagation(); return;
    }
    if (placing) { const p = groundAt(e); if (p) ghostFor(placing, p); e.stopImmediatePropagation(); return; }
    if (e.pointerType === 'mouse' && !e.buttons) { const it = itemAt(e); setHovered(it); canvas.style.cursor = it ? 'grab' : ''; }
  }, true);
  const endDrag = (e) => {
    if (!drag) return;
    const moved = drag.moved; drag = null; controls.enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
    if (moved) { commit(); renderInspector(); }
    e.stopImmediatePropagation();
  };
  canvas.addEventListener('pointerup', endDrag, true);
  canvas.addEventListener('pointercancel', endDrag, true);
  canvas.addEventListener('wheel', (e) => {
    if (!open || !selected || !e.shiftKey) return;
    const it = items.get(selected); rotateSelection((e.deltaY > 0 ? 1 : -1) * THREE.MathUtils.degToRad(opt('snap') ? 15 : 5)); it.node.rotation.y = it.rot;
    e.preventDefault(); e.stopImmediatePropagation(); clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { renderInspector(); commit(); }, 250);
  }, { capture: true, passive: false });
  let wheelTimer = null;
  addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'escape') { if (placing) cancelPlacing(); else if (selected) select(null); return; }
    if (!selected) return;
    const it = items.get(selected);
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); act('delete'); }
    else if (k === 'r') { rotateSelection((e.shiftKey ? -1 : 1) * Math.PI / 4); renderInspector(); commit(); }
    else if (mod && k === 'd') { e.preventDefault(); act('duplicate'); }
    else if (k === 'f') act('focus');
  }, true);

  /* ---------------------------------------------------------------- open / close */
  function setOpen(on) {
    open = on; aside.hidden = !on; btn.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('composing', on);
    if (on) ensureLibrary(); else { cancelPlacing(); setHovered(null); }
    renderInspector();
  }
  btn.addEventListener('click', () => setOpen(!open));

  return {
    root,
    /** A new world was built: clear, then restore what was composed for it. */
    attach(world, sp) {
      storageKey = `p2s:compose:${sp?.name || 'scene'}`;
      surfaces = findSurfaces(world);
      cancelPlacing(); select(null);
      for (const id of [...items.keys()]) removeItem(id);
      let saved = false; try { saved = (localStorage.getItem(storageKey) || '[]') !== '[]'; } catch (e) { /* off */ }
      if (saved) ensureLibrary().then(() => restore());
      else { history = []; future = []; lastState = '[]'; renderList(); }
      setTimeout(() => { surfaces = findSurfaces(world); }, 4000);          // after the Blender upgrades swap materials
    },
    update(dt, t) {
      now = t;
      const k = 1 - Math.exp(-dt * 18), kr = 1 - Math.exp(-dt * 16);
      for (const it of items.values()) {
        it.built?.update?.(dt, t);
        if (it.delay > 0) { it.delay -= dt; continue; }
        if (!it.node.visible) it.node.visible = true;
        const n = it.node.position;
        if (Math.abs(n.x - it.x) + Math.abs(n.y - it.y) + Math.abs(n.z - it.z) > 0.0005) n.set(n.x + (it.x - n.x) * k, n.y + (it.y - n.y) * k, n.z + (it.z - n.z) * k);
        else n.set(it.x, it.y, it.z);
        let dr = it.rot - it.node.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        if (Math.abs(dr) > 0.0005) it.node.rotation.y += dr * kr; else it.node.rotation.y = it.rot;
      }
      K.tick?.(dt);
      if (camTween) {
        const k = Math.min(1, (performance.now() - camTween.t0) / camTween.d), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e); controls.target.lerpVectors(camTween.fromTgt, camTween.toTgt, e); controls.update();
        if (k >= 1) camTween = null;
      }
    },
    isOpen: () => open,
  };
}
