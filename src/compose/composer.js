/*
 * Compose: a left sidebar of Blender assets (property, vehicles, people, nature, streets and water) that
 * you drag into the 3D scene or place from a prompt ("a street with 6 townhouses, trees and 4 cars").
 * Placed items can be selected, moved, turned, duplicated, edited (storeys, units, colours, traffic…) and
 * removed; the composition is saved per scene, can be exported / imported as JSON, and has undo / redo.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadLibrary } from '../scene/asset-library.js';
import { TYPES, CATEGORIES, TILES, PALETTES, tickMaterials } from './catalog.js';
import { planFromPrompt } from './prompt-plan.js';
import { planFromImage, composePrompt, sanitize } from './image-plan.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const selMat = new THREE.LineBasicMaterial({ color: '#ffc477', transparent: true, opacity: 0.95, depthTest: false });
const hoverMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthTest: false });

export function createComposer({ scene, camera, canvas, controls, renderer, getWorld, getSpec }) {
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
  btn.className = 'pill'; btn.id = 'composeBtn'; btn.type = 'button'; btn.title = 'Compose the surroundings: drag houses, townhouses, apartments, towers, cars, people, trees, roads and water into the scene';
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></svg><span>Compose</span>';
  btn.setAttribute('aria-pressed', 'false');
  $('.tools')?.prepend(btn);

  const aside = document.createElement('aside');
  aside.id = 'composer'; aside.hidden = true; aside.setAttribute('aria-label', 'Compose the surroundings');
  aside.innerHTML = `
    <header class="cp-head">
      <div><span class="cp-eyebrow">Compose</span><h2>Surroundings</h2></div>
      <button type="button" class="x" data-act="close" aria-label="Close compose">×</button>
    </header>
    <form class="cp-prompt" autocomplete="off">
      <textarea rows="2" placeholder="Describe what to add — e.g. a street with 6 townhouses, 2 family houses, a 40 storey tower, trees and 4 cars"></textarea>
      <div class="cp-attach" hidden><img alt=""><span class="cp-attach-name"></span><button type="button" class="x" data-act="detach" aria-label="Remove the image">×</button></div>
      <div class="cp-prompt-row">
        <button type="button" class="cp-clip" data-act="attach" title="Attach a photo of a street, skyline or city (or an aerial view) and build the scene from it. You can also drop or paste an image." aria-label="Attach an image"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg></button>
        <span class="cp-hint">Text or a city photo → scene</span><button class="primary" type="submit">Add to scene</button>
      </div>
      <input type="file" accept="image/*" hidden class="cp-image">
      <p class="cp-status" role="status" aria-live="polite"></p>
    </form>
    <div class="cp-tools">
      <input type="search" class="cp-search" placeholder="Search assets" aria-label="Search assets">
      <label class="cp-chk"><input type="checkbox" data-opt="snap" checked> Snap 1 m</label>
      <label class="cp-chk"><input type="checkbox" data-opt="turn"> Random turn</label>
    </div>
    <div class="cp-scroll">
      <div class="cp-cats"></div>
      <section class="cp-scene">
        <h3>In this scene <span class="cp-count">0</span></h3>
        <div class="cp-totals"></div>
        <ul class="cp-list"></ul>
      </section>
    </div>
    <footer class="cp-foot">
      <button type="button" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
      <button type="button" data-act="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
      <span class="cp-sep"></span>
      <button type="button" data-act="export" title="Download this composition as JSON">Export</button>
      <button type="button" data-act="import" title="Load a composition from JSON">Import</button>
      <button type="button" data-act="clear" class="cp-danger" title="Remove everything you placed">Clear</button>
      <input type="file" accept=".json,application/json" hidden class="cp-file">
    </footer>
    <p class="cp-keys">Drag a tile into the scene, or click a tile then click the ground (Shift keeps placing). Drag items to move · R / Shift+R turn · Shift+scroll fine turn · Ctrl+D duplicate · Delete removes · Esc cancels</p>`;
  document.body.appendChild(aside);

  const insp = document.createElement('section');
  insp.id = 'cpInspector'; insp.hidden = true; insp.setAttribute('aria-label', 'Selected item');
  document.body.appendChild(insp);

  const status = (msg) => { $('.cp-status', aside).textContent = msg || ''; };
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
      libPromise = loadLibrary().then((l) => {
        lib = l; for (const parts of l.modules.values()) parts.forEach((p) => libGeometries.add(p.geometry));
        status(''); renderThumbs(); restore(); return l;
      }).catch((e) => { status('The asset library could not load.'); console.warn(e); throw e; });
    }
    return libPromise;
  }

  async function renderThumbs() {
    const W = 192, H = 132;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const s = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r); s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    s.add(new THREE.HemisphereLight('#ffffff', '#8a8370', 1.2));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(4, 8, 6); s.add(sun);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 5000);
    for (const tile of CATEGORIES.flatMap((c) => c.tiles)) {
      const id = tile.id;
      await new Promise((res) => setTimeout(res, 0));
      const built = build(tile.type, tile.params, 7);
      s.add(built.object); built.update?.(0, 1.3);
      const box = boundsOf(built.object), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const tall = size.y > Math.max(size.x, size.z) * 1.6;
      const dir = new THREE.Vector3(tall ? 1.1 : 1.0, tall ? 0.35 : 0.75, tall ? 1.5 : 1.25).normalize();
      const rad = Math.max(size.x, size.y * (tall ? 0.62 : 1), size.z) * 0.62 + 0.4;
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
  function ctx(seed) { const sp = getSpec(); return { seed, currency: sp?.currency || 'NZD', rate: sp?.currency === 'INR' ? 115000 : 7200 }; }
  function build(type, params, seed) { return TYPES[type].build({ ...params }, lib, ctx(seed)); }
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
    rebuild(it); items.set(id, it);
    const n = Number(String(id).slice(1)); if (n >= seq) seq = n + 1;
    return it;
  }
  function rebuild(it) {
    if (it.built) { it.node.remove(it.built.object); disposeBuilt(it.built.object); it.node.remove(it.proxy); it.proxy.geometry.dispose(); it.outline && (it.node.remove(it.outline), it.outline.geometry.dispose()); it.outline = null; }
    it.built = build(it.type, it.params, it.seed);
    it.node.add(it.built.object);
    it.node.position.set(it.x, it.y, it.z); it.node.rotation.y = it.rot; it.node.updateMatrixWorld(true);
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
    if (selected === it.id) frame(it, true);
  }
  function frame(it, on, mat = selMat) {
    if (it.outline) { it.node.remove(it.outline); it.outline.geometry.dispose(); it.outline = null; }
    if (!on) return;
    const s = it.box.getSize(new THREE.Vector3()), c = it.box.getCenter(new THREE.Vector3());
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x + 0.4, s.y + 0.2, s.z + 0.4).translate(c.x, c.y, c.z));
    it.outline = new THREE.LineSegments(g, mat); it.outline.renderOrder = 10; it.node.add(it.outline);
  }
  function removeItem(id) {
    const it = items.get(id); if (!it) return;
    root.remove(it.node); disposeBuilt(it.node); items.delete(id);
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
    lastState = snapshot(); save(); renderList(); if (label) status(label);
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
    const hit = surfaces.length ? ray.intersectObjects(surfaces, false)[0] : null;
    const p = new THREE.Vector3();
    if (hit && hit.point.y < 3) return hit.point;
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }
  function itemAt(e) {
    setNdc(e);
    const proxies = [...items.values()].map((it) => it.proxy);
    const hit = ray.intersectObjects(proxies, false)[0];
    return hit ? items.get(hit.object.userData.composeId) : null;
  }
  function findSurfaces(world) {
    const out = [];
    world?.group.updateMatrixWorld(true);
    world?.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible || o.material?.visible === false) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld), s = b.getSize(new THREE.Vector3());
      if (s.y < 1.2 && s.x * s.z > 400 && b.max.y < 1.5) out.push(o);
    });
    return out;
  }
  const snap = (v) => (opt('snap') ? Math.round(v) : v);

  /* ---------------------------------------------------------------- placing */
  function startPlacing(tileId) {
    if (!lib) return;
    cancelPlacing();
    placing = tileId;
    aside.querySelectorAll('.cp-tile').forEach((t) => t.classList.toggle('placing', t.dataset.tile === tileId));
    status(`Click the ground to place ${TILES.get(tileId).label.toLowerCase()} · Shift-click to keep placing · Esc to stop`);
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
    ghost.x = snap(p.x); ghost.z = snap(p.z); ghost.y = p.y; ghost.node.position.set(ghost.x, ghost.y, ghost.z);
  }
  function dropGhost(keep) {
    if (!ghost) return;
    const it = ghost; ghost = null;
    it.node.traverse((o) => { if (o.isMesh) delete o.raycast; });
    select(it.id); commit(`Added ${TILES.get(it.tile).label.toLowerCase()}.`);
    // buildings: put the cursor in their height, so "60" + Enter sets it straight away
    const h = insp.querySelector('input.ci-num[data-param="storeys"], input.ci-num[data-param="floors"]'); if (h && !keep) { h.focus(); h.select(); }
    if (!keep) cancelPlacing();
  }

  /* ---------------------------------------------------------------- selection + inspector */
  function select(id) {
    if (selected && items.get(selected)) frame(items.get(selected), false);
    selected = id && items.has(id) ? id : null;
    if (selected) frame(items.get(selected), true);
    renderInspector(); renderList();
  }
  function setHovered(it) {
    if (hovered === it?.id) return;
    const old = hovered && items.get(hovered); if (old && old.id !== selected) frame(old, false);
    hovered = it?.id || null;
    if (it && it.id !== selected) frame(it, true, hoverMat);
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
      ${it.built.stats?.length ? `<dl class="ci-stats">${it.built.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      <div class="ci-fields">${def.params.map(field).join('')}
        <label class="ci-field"><span>Turn <output>${deg}°</output></span><input type="range" min="0" max="359" step="1" value="${deg}" data-transform="rot"></label>
        <div class="ci-xyz"><label>X <input type="number" step="1" value="${it.x.toFixed(1)}" data-transform="x"></label><label>Z <input type="number" step="1" value="${it.z.toFixed(1)}" data-transform="z"></label></div>
      </div>
      <div class="ci-actions">
        <button type="button" data-act="rotate">Turn 90°</button><button type="button" data-act="duplicate">Duplicate</button><button type="button" data-act="focus">Focus</button><button type="button" data-act="delete" class="cp-danger">Delete</button>
      </div>
      <p class="ci-note">Values are illustrative (dummy data), not a valuation.</p>`;
  }
  insp.addEventListener('input', (e) => {
    const it = items.get(selected); if (!it) return;
    const t = e.target;
    if (t.dataset.transform) {
      const v = Number(t.value);
      if (t.dataset.transform === 'rot') { it.rot = THREE.MathUtils.degToRad(v); t.previousElementSibling.querySelector('output').textContent = `${v}°`; }
      else it[t.dataset.transform] = v;
      it.node.position.set(it.x, it.y, it.z); it.node.rotation.y = it.rot; return;
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
  function scheduleRebuild(it) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { rebuild(it); const stats = insp.querySelector('.ci-stats'); if (stats && it.built.stats) stats.innerHTML = it.built.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(''); }, 60); }
  insp.addEventListener('change', (e) => {
    const t = e.target, it = items.get(selected);
    if (it && t.classList.contains('ci-num')) {                                         // typed a number: clamp, apply, commit
      const p = TYPES[it.type].params.find((x) => x.key === t.dataset.param);
      const n = Math.min(p.max, Math.max(p.min, Math.round((Number(t.value) || p.min) / p.step) * p.step));
      t.closest('.ci-field').querySelectorAll(`input[data-param="${p.key}"]`).forEach((x) => { x.value = n; });
      if (it.params[p.key] !== n) { it.params[p.key] = n; rebuild(it); }
      renderInspector(); commit(); insp.querySelector(`input.ci-num[data-param="${p.key}"]`)?.focus(); return;
    }
    if (e.target.type === 'range' || e.target.type === 'number' || e.target.type === 'color') { const it = items.get(selected); if (it && e.target.type === 'color') { rebuild(it); renderInspector(); } commit(); } });
  insp.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const it = items.get(selected); if (!it) return;
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
    if (a === 'rotate') { it.rot += Math.PI / 2; it.node.rotation.y = it.rot; renderInspector(); commit(); }
    if (a === 'delete') { removeItem(it.id); commit('Removed.'); }
    if (a === 'duplicate') {
      const w = (it.box.max.x - it.box.min.x) + 2, dx = Math.cos(it.rot) * w, dz = -Math.sin(it.rot) * w;
      const copy = makeItem({ ...serial(it), id: undefined, x: it.x + dx, z: it.z + dz, seed: Math.floor(Math.random() * 1e6) });
      select(copy.id); commit('Duplicated.');
    }
    if (a === 'focus') focusOn([it]);
  }

  function focusOn(list) {
    if (!list.length) return;
    const box = new THREE.Box3(); list.forEach((it) => box.union(it.box.clone().applyMatrix4(it.node.matrixWorld)));
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(12, box.getSize(new THREE.Vector3()).length() * 0.6);
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
    camTween = { t0: performance.now(), d: 900, fromPos: camera.position.clone(), fromTgt: controls.target.clone(), toTgt: c, toPos: c.clone().addScaledVector(dir, r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.7) };
  }

  /* ---------------------------------------------------------------- scene list */
  function totals() {
    let homes = 0, area = 0, cars = 0, people = 0, trees = 0;
    for (const it of items.values()) {
      if (ghost && it.id === ghost.id) continue;
      const st = Object.fromEntries(it.built.stats || []), num = (k) => Number(String(st[k] || '0').replace(/[^\d.]/g, '')) || 0;
      homes += num('Dwellings') + num('Apartments'); area += it.type !== 'lawn' && it.type !== 'water' && it.type !== 'park' && it.type !== 'carPark' ? num('Floor area') : 0;
      cars += it.type === 'car' || it.type === 'truck' ? 1 : it.type === 'road' ? it.params.traffic : it.type === 'carPark' ? Math.round(it.params.bays * it.params.fill / 100) : it.type === 'house' && it.params.car && it.params.style === 'house_a' ? 1 : 0;
      people += it.type === 'person' ? 1 : it.type === 'crowd' ? it.params.count : it.type === 'park' ? it.params.people : it.type === 'road' && it.params.footpaths ? it.params.walkers : 0;
      trees += it.type === 'tree' ? 1 : it.type === 'treeRow' ? it.params.count : it.type === 'park' ? it.params.trees : 0;
    }
    return { homes, area, cars, people, trees };
  }
  function summary(it) {
    const p = it.params;
    return { house: () => ({ house_a: 'Family', house_b: 'Bungalow', house_c: 'Modern' }[p.style]), townhouses: () => `${p.units} homes`, apartment: () => `${p.floors} storeys · ${p.floors * p.units} apts`, tower: () => `${p.storeys} storeys`,
      car: () => (p.drive ? `driving ${p.speed} km/h` : 'parked'), truck: () => (p.drive ? 'driving' : 'parked'), person: () => (p.walk ? 'walking' : 'standing'), crowd: () => `${p.count} people`,
      tree: () => `${p.scale}×`, treeRow: () => `${p.count} trees`, park: () => `${p.radius} m radius`, lamp: () => '', road: () => `${p.length} m · ${p.lanes} lanes`, carPark: () => `${p.bays} bays`, water: () => `${p.length} × ${p.width} m`, lawn: () => `${p.width} × ${p.depth} m` }[it.type]?.() || '';
  }
  function renderList() {
    const list = [...items.values()].filter((it) => !ghost || it.id !== ghost.id);
    $('.cp-count', aside).textContent = list.length;
    const t = totals();
    $('.cp-totals', aside).innerHTML = list.length ? [['Homes', t.homes], ['Floor area', `${Math.round(t.area).toLocaleString()} m²`], ['Cars', t.cars], ['People', t.people], ['Trees', t.trees]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('') : '<p class="cp-empty">Nothing placed yet. Drag a tile into the scene, or describe it above.</p>';
    $('.cp-list', aside).innerHTML = list.map((it) => `
      <li data-item="${it.id}" aria-selected="${it.id === selected}">
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
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'clear') { if (!items.size) return; for (const id of [...items.keys()]) removeItem(id); commit('Cleared. Undo brings it back.'); }
    if (a === 'export') {
      const blob = new Blob([JSON.stringify({ scene: getSpec()?.name || 'scene', items: JSON.parse(snapshot()) }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = Object.assign(document.createElement('a'), { href: url, download: 'composition.json' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (a === 'import') $('.cp-file', aside).click();
    if (a === 'attach') $('.cp-image', aside).click();
    if (a === 'detach') { detach(); status(''); }
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

  /* ---------- image → scene ---------- */
  let attached = null;                       // { img, url, name, mediaType, data }
  const form = $('.cp-prompt', aside), chip = $('.cp-attach', aside), submitBtn = $('.cp-prompt .primary', aside), textarea = $('.cp-prompt textarea', aside);
  const defaultPlaceholder = textarea.placeholder;
  async function attach(file) {
    if (!file || !file.type.startsWith('image/')) { status('Attach an image (JPG, PNG or WebP) of a street, skyline or city.'); return; }
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
    const small = cv.toDataURL('image/jpeg', 0.86);
    attached = { img, url: small, name: file.name || 'image', mediaType: 'image/jpeg', data: small.split(',')[1] };
    chip.hidden = false; chip.querySelector('img').src = small; chip.querySelector('.cp-attach-name').textContent = attached.name;
    textarea.placeholder = 'Optional: anything to change, e.g. “make the towers 60 storeys” or “add a river”';
    submitBtn.textContent = 'Build from image'; status('Image attached. Press Build from image.');
  }
  function detach() { attached = null; chip.hidden = true; textarea.placeholder = defaultPlaceholder; submitBtn.textContent = 'Add to scene'; }
  $('.cp-image', aside).addEventListener('change', (e) => { attach(e.target.files[0]); e.target.value = ''; });
  textarea.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f); } });
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  aside.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); aside.classList.add('cp-dropping'); } });
  aside.addEventListener('dragleave', (e) => { if (!aside.contains(e.relatedTarget)) aside.classList.remove('cp-dropping'); });
  aside.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); aside.classList.remove('cp-dropping'); attach(e.dataTransfer.files[0]); });
  canvas.addEventListener('dragover', (e) => { if (open && hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  canvas.addEventListener('drop', async (e) => { if (!open || !hasFiles(e)) return; e.preventDefault(); await attach(e.dataTransfer.files[0]); if (attached) form.requestSubmit(); });

  async function buildFromImage(text) {
    const anchor = freeAnchor();
    let raw = null, summary = '', via = 'offline';
    submitBtn.disabled = true; submitBtn.textContent = 'Reading…';
    try {
      const health = await fetch('/api/health', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (health?.claude) {
        status('Claude is reading the picture and laying out the scene…');
        try {
          const r = await fetch('/api/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instructions: composePrompt(text), image: { name: attached.name, mediaType: attached.mediaType, data: attached.data } }) });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw Object.assign(new Error(body.message || body.error), { code: body.error });
          raw = body.items; summary = body.summary || 'Built from your picture.'; via = 'claude';
        } catch (err) { status(`Claude could not read it (${err.code || err.message}); reading it offline instead…`); }
      }
      if (!raw) {
        const plan = planFromImage(attached.img, anchor);
        raw = plan.raw;
        summary = plan.summary + (health?.claude ? '' : ' Read offline: add ANTHROPIC_API_KEY to .env and restart the server for Claude to read pictures properly.');
        if (text) { const extra = planFromPrompt(text, { x: 0, z: 0 }); raw = raw.concat(extra.items.filter((i) => i.type !== 'road' || !raw.some((r) => r.type === 'road')).map((i) => ({ ...i, z: i.z + 130 }))); }
      }
      const placed = sanitize(raw, anchor);
      if (!placed.length) { status('Nothing recognisable to build from that picture. Try a clearer street or skyline photo.'); return; }
      const added = placed.map((d) => makeItem({ ...d, y: 0 }));
      for (const it of added) { const g = groundAt2(it.x, it.z); it.y = g; it.node.position.y = g; }
      commit(`${via === 'claude' ? 'Claude: ' : ''}${summary}`); select(null); focusOn(added); detach();
    } finally { submitBtn.disabled = false; submitBtn.textContent = attached ? 'Build from image' : 'Add to scene'; }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (attached) { await ensureLibrary(); await buildFromImage(text); return; }
    if (!text) return;
    await ensureLibrary();
    const anchor = freeAnchor();
    const plan = planFromPrompt(text, anchor);
    if (!plan.items.length) { status('I could not find anything to place in that. Try “6 townhouses, a road, 10 trees and 4 cars”.'); return; }
    const added = plan.items.map((d) => makeItem({ ...d, y: 0 }));
    for (const it of added) { const g = groundAt2(it.x, it.z); it.y = g; it.node.position.y = g; }
    commit(plan.summary); select(null); focusOn(added);
  });
  $('.cp-prompt textarea', aside).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.cp-prompt', aside).requestSubmit(); } });

  /** An open area beside the existing scene, to the side the camera faces, for prompt layouts. */
  function freeAnchor() {
    const world = getWorld();
    const occupied = world?.fitBox ? world.fitBox.clone() : new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 5, 20));
    for (const it of items.values()) occupied.union(it.box.clone().applyMatrix4(it.node.matrixWorld));
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); right.y = 0; right.normalize();
    const c = occupied.getCenter(new THREE.Vector3()), s = occupied.getSize(new THREE.Vector3());
    const out = Math.abs(right.x) > Math.abs(right.z) ? new THREE.Vector3(Math.sign(right.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(right.z));
    const reach = (out.x ? s.x : s.z) / 2 + 110;
    return { x: c.x + out.x * reach, z: c.z + out.z * reach };
  }
  function groundAt2(x, z) {
    if (!surfaces.length) return 0;
    const r = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
    const h = r.intersectObjects(surfaces, false)[0];
    return h && h.point.y < 3 ? h.point.y : 0;
  }

  /* ---------------------------------------------------------------- canvas interaction (capture phase: runs before orbit and zone picking) */
  canvas.addEventListener('pointerdown', (e) => {
    if (!open || e.button !== 0 || !lib) return;
    if (placing) {
      const p = groundAt(e); if (!p) return;
      ghostFor(placing, p); dropGhost(e.shiftKey);
      e.stopImmediatePropagation(); e.preventDefault(); return;
    }
    const it = itemAt(e);
    if (it) {
      select(it.id);
      const p = groundAt(e);
      drag = { id: it.id, off: p ? new THREE.Vector3(it.x - p.x, 0, it.z - p.z) : new THREE.Vector3(), moved: false, pointer: e.pointerId };
      controls.enabled = false; canvas.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation(); e.preventDefault();
    } else if (selected) { select(null); }
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!open || !lib) return;
    if (drag) {
      const it = items.get(drag.id), p = groundAt(e); if (!it || !p) return;
      it.x = snap(p.x + drag.off.x); it.z = snap(p.z + drag.off.z); it.y = p.y; it.node.position.set(it.x, it.y, it.z); drag.moved = true;
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
    const it = items.get(selected); it.rot += (e.deltaY > 0 ? 1 : -1) * THREE.MathUtils.degToRad(opt('snap') ? 15 : 5); it.node.rotation.y = it.rot;
    e.preventDefault(); e.stopImmediatePropagation(); clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { renderInspector(); commit(); }, 250);
  }, { capture: true, passive: false });
  let wheelTimer = null;
  addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'escape') { if (placing) cancelPlacing(); else if (selected) select(null); return; }
    if (!selected) return;
    const it = items.get(selected);
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); act('delete'); }
    else if (k === 'r') { it.rot += (e.shiftKey ? -1 : 1) * Math.PI / 4; it.node.rotation.y = it.rot; renderInspector(); commit(); }
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
      for (const it of items.values()) it.built?.update?.(dt, t);
      tickMaterials(dt);
      if (camTween) {
        const k = Math.min(1, (performance.now() - camTween.t0) / camTween.d), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e); controls.target.lerpVectors(camTween.fromTgt, camTween.toTgt, e); controls.update();
        if (k >= 1) camTween = null;
      }
    },
    isOpen: () => open,
  };
}
