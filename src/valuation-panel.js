/*
 * Valuation layer for residential developments (demo data):
 *  - left controls: rendered/wireframe, select unit/floor, context, colour by, legend
 *  - right panel: a rotatable 3D trend chart (rate × quarter × floor with a fitted surface)
 *    and the selected apartment or floor: valuation history, confidence and a floor plan
 *  - building labels projected over the scene
 * main.js calls attach(world, spec) after each build and hover/select/frame as things change.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $ } from './util.js';
import { buildValuations, fitTrend, quarterLabel, QUARTERS } from './spec/valuations.js';
import { LAYER_TYPES, FLOOD_EVENTS, applyLayers, layerSummary } from './spec/site-layers.js';

const LOW = new THREE.Color('#dbe8ff'), HIGH = new THREE.Color('#0b3fa8');
const NONE = new THREE.Color('#3b4252'), HOVER = new THREE.Color('#ffd23f'), PICK = new THREE.Color('#ff5fd2');
const letter = (b) => String.fromCharCode(64 + b);

export function createValuationPanel({ onSelect, onFly, onLayout }) {
  const controls = $('#valControls'), panel = $('#valPanel'), labelsEl = $('#valLabels');
  let world = null, spec = null, data = null, base = null, chart = null;
  // Site layers on the map: id → { on, event? }. A layer missing from here has been removed (it can be added back).
  const layers = { river: { on: true }, roads: { on: true }, motorway: { on: true }, flood: { on: true, event: 100 }, solar: { on: true } };
  const pctText = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(1)}%`;
  let colourBy = 'valuation', pick = 'unit', scope = 'project', hovered = null, selected = null;
  const fmt = (v) => {
    try { return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: spec.currency, currencyDisplay: 'code', maximumFractionDigits: 0 }).format(v).replace(/ /g, ' '); }
    catch (e) { return `${spec.currency} ${Math.round(v).toLocaleString('en-NZ')}`; }
  };
  const zoneOf = (id) => spec?.zones.find((z) => z.id === id) || null;
  const rampColor = (rate) => LOW.clone().lerp(HIGH, data.max > data.min ? (rate - data.min) / (data.max - data.min) : 0.5);

  /* ---------- controls ---------- */
  const setPressed = (sel, attr, value) => controls.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  controls.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !world) return;
    if (b.dataset.render) { setPressed('[data-render]', 'render', b.dataset.render); world.setWireframe(b.dataset.render === 'wire'); }
    if (b.dataset.pick) { pick = b.dataset.pick; setPressed('[data-pick]', 'pick', pick); paint(); renderDetails(); }
    if (b.id === 'valCollapse') {
      const open = controls.classList.toggle('collapsed') === false;
      b.setAttribute('aria-expanded', String(open)); b.textContent = open ? '−' : '+';
      onLayout();
    }
  });
  $('#valContext').addEventListener('change', (e) => world?.setContext(e.target.checked));

  /* ---------- site layers: toggle, remove, add back, flood event ---------- */
  const layerList = $('#valLayerList'), addLayer = $('#valAddLayer');
  layerList.addEventListener('change', (e) => {
    const id = e.target.closest('[data-layer]')?.dataset.layer; if (!id || !layers[id]) return;
    if (e.target.matches('input[type="checkbox"]')) layers[id].on = e.target.checked;
    if (e.target.matches('select')) { layers.flood.event = Number(e.target.value); world?.siteLayers.setFloodEvent(layers.flood.event); }
    recompute();
  });
  layerList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-remove]'); if (!b) return;
    delete layers[b.dataset.remove]; recompute();
  });
  addLayer.addEventListener('change', () => {
    const id = addLayer.value; if (!id) return;
    layers[id] = id === 'flood' ? { on: true, event: 100 } : { on: true };
    if (id === 'flood') world?.siteLayers.setFloodEvent(100);
    recompute();
  });
  function renderLayers() {
    layerList.innerHTML = LAYER_TYPES.filter((t) => layers[t.id]).map((t) => {
      const L = layers[t.id], s = layerSummary(data, t.id);
      const effect = !L.on ? 'Off: no effect on values' : s.count ? `${s.count} apartment${s.count > 1 ? 's' : ''} · ${s.min === s.max ? pctText(s.min) : `${pctText(s.min)} to ${pctText(s.max)}`}` : 'No apartments affected';
      const flood = t.id === 'flood' ? `<select aria-label="Flood event">${Object.entries(FLOOD_EVENTS).map(([k, v]) => `<option value="${k}"${Number(k) === L.event ? ' selected' : ''}>${v.label}</option>`).join('')}</select>` : '';
      return `<li data-layer="${t.id}"><label><input type="checkbox"${L.on ? ' checked' : ''}><i style="background:${t.color}"></i><b>${t.name}</b></label>${flood}
        <button type="button" class="vl-x" data-remove="${t.id}" aria-label="Remove ${t.name} layer" title="Remove layer">×</button>
        <span class="vl-sub">${t.blurb}</span><span class="vl-eff">${effect}</span></li>`;
    }).join('');
    const missing = LAYER_TYPES.filter((t) => !layers[t.id]);
    addLayer.innerHTML = `<option value="">${missing.length ? '+ Add layer' : 'All layers added'}</option>` + missing.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    addLayer.disabled = !missing.length;
    // net movement across the development
    const f = [...data.byZone.values()].map((e) => e.factor - 1);
    $('#valLayerNet').textContent = f.some((x) => Math.abs(x) > 1e-4) ? `Location factors move apartment values by ${pctText(Math.min(...f))} to ${pctText(Math.max(...f))}.` : 'No location factors applied.';
  }
  /** Re-applies the layers to the base valuations and refreshes everything that shows them. */
  function recompute() {
    if (!world) return;
    data = applyLayers(base, spec, world.layout, layers);
    for (const t of LAYER_TYPES) world.siteLayers.setActive(t.id, !!layers[t.id]?.on);
    $('#valMin').textContent = `${fmt(data.min)} · lowest`;
    $('#valMax').textContent = `highest · ${fmt(data.max)}`;
    renderLayers(); paint(); renderDetails(); updateChart();
  }
  $('#valColour').addEventListener('change', (e) => { colourBy = e.target.value; world?.valuationLayer.setVisible(colourBy === 'valuation'); controls.dataset.colour = colourBy; paint(); });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.scope) { scope = b.dataset.scope; panel.querySelectorAll('[data-scope]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.scope === scope))); updateChart(); }
    if (b.id === 'vpExpand') { const wide = document.body.classList.toggle('vp-wide'); b.textContent = wide ? 'Collapse' : 'Expand'; requestAnimationFrame(() => { chart?.resize(); onLayout(); }); }
    if (b.dataset.act === 'floor') { pick = 'floor'; setPressed('[data-pick]', 'pick', pick); paint(); renderDetails(); }
    if (b.dataset.act === 'fly' && selected) onFly(selected);
    if (b.dataset.unit) onSelect(b.dataset.unit);
  });

  /* ---------- colours ---------- */
  function sameFloor(a, b) { return a && b && a.building === b.building && a.floor === b.floor; }
  function paint() {
    if (!world || !data) return;
    const sel = zoneOf(selected), hov = zoneOf(hovered);
    for (const z of spec.zones) {
      const entry = data.byZone.get(z.id);
      let c = entry?.latest ? rampColor(entry.latest.rate) : NONE;
      if (pick === 'floor' ? sameFloor(z, sel) : z.id === selected) c = PICK;
      if (pick === 'floor' ? sameFloor(z, hov) && !sameFloor(z, sel) : z.id === hovered && z.id !== selected) c = HOVER;
      world.valuationLayer.setColor(z.id, c);
    }
  }

  /* ---------- details ---------- */
  function renderDetails() {
    const box = $('#vpUnit');
    const z = zoneOf(selected);
    if (!z) { box.innerHTML = `<p class="vu-empty">Select an apartment to see its valuation history, confidence and floor plan.</p>`; return; }
    if (pick === 'floor') { box.innerHTML = floorHtml(z); return; }
    const e = data.byZone.get(z.id);
    const latest = e.latest;
    box.innerHTML = `
      <div class="vu-head"><h3>${z.name}</h3>
        <p>Building ${letter(z.building)} · Level ${z.floor} · <button class="link" data-act="floor">view floor</button></p></div>
      <div class="vu-badges"><span class="badge conf-${e.confidence}">Placement confidence ${e.confidence}</span><span class="badge">${z.bedrooms} bed · ${z.area} m²</span></div>
      ${latest ? `<div class="vu-figs"><div><b>${fmt(latest.value)}</b><span>dummy valuation · ${latest.quarter}</span></div><div><b>${fmt(latest.rate)}</b><span>per m²</span></div></div>
      <table class="vu-hist"><thead><tr><th>Quarter</th><th>Purpose</th><th>Rate /m²</th><th>Value</th></tr></thead><tbody>
        ${e.valuations.slice().reverse().map((v) => `<tr><td>${v.quarter}</td><td>${v.purpose}</td><td>${fmt(v.rate)}</td><td>${fmt(v.value)}</td></tr>`).join('')}
      </tbody></table>` : `<p class="vu-empty">No market valuation for this apartment yet. Its example value is ${fmt(z.price)} (illustrative).</p>`}
      ${e.effects.length ? `<div class="vu-loc"><h4>Location factors</h4><ul>${e.effects.map((x) => `<li><span>${x.label}</span><b class="${x.pct > 0 ? 'up' : 'down'}">${pctText(x.pct)}</b></li>`).join('')}
        <li class="net"><span>Net${e.baseLatest ? ` · before factors ${fmt(e.baseLatest.value)}` : ''}</span><b class="${e.factor >= 1 ? 'up' : 'down'}">${pctText(e.factor - 1)}</b></li></ul></div>` : ''}
      <canvas class="vu-plan" aria-label="Floor plan of apartment ${z.name}"></canvas>
      <button class="primary" data-act="fly">Stand on the balcony</button>`;
    drawPlan(box.querySelector('.vu-plan'), z);
  }
  function floorHtml(z) {
    const units = spec.zones.filter((u) => sameFloor(u, z));
    const valued = units.map((u) => data.byZone.get(u.id).latest).filter(Boolean);
    const avg = valued.length ? valued.reduce((s, v) => s + v.rate, 0) / valued.length : 0;
    return `
      <div class="vu-head"><h3>Building ${letter(z.building)} · Level ${z.floor}</h3><p>${units.length} apartments · ${valued.length} valued</p></div>
      ${valued.length ? `<div class="vu-figs"><div><b>${fmt(avg)}</b><span>average latest rate per m²</span></div><div><b>${fmt(Math.min(...valued.map((v) => v.rate)))}–${fmt(Math.max(...valued.map((v) => v.rate))).replace(/^[A-Z]{3}\s*/, '')}</b><span>range per m²</span></div></div>` : ''}
      <table class="vu-hist"><thead><tr><th>Apartment</th><th>Size</th><th>Rate /m²</th><th>Latest value</th></tr></thead><tbody>
        ${units.map((u) => { const l = data.byZone.get(u.id).latest; return `<tr><td><button class="link" data-unit="${u.id}">${u.name}</button></td><td>${u.bedrooms} bed · ${u.area} m²</td><td>${l ? fmt(l.rate) : '—'}</td><td>${l ? fmt(l.value) : 'Not valued'}</td></tr>`; }).join('')}
      </tbody></table>`;
  }

  /* ---------- floor plan (procedural line drawing) ---------- */
  function drawPlan(canvas, z) {
    const W = 7.5, Dp = Math.max(7, z.area / W), BAL = 1.6, dpr = Math.min(2, devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 380, s = (cssW - 40) / W, cssH = Math.round((Dp + BAL) * s + 40);
    canvas.width = cssW * dpr; canvas.height = cssH * dpr; canvas.style.height = `${cssH}px`;
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, cssW, cssH);
    const ox = 20, oy = 20, X = (x) => ox + x * s, Y = (y) => oy + y * s;
    const rooms = [];
    const two = z.bedrooms >= 2, backD = Math.min(3.6, Dp * 0.38);
    if (two) {
      rooms.push(['BEDROOM 1', 0, 0, 3.5, backD], ['BEDROOM 2', 3.5, 0, W, backD]);
      rooms.push(['BATH', 0, backD, 2.2, backD + 2.2], ['KITCHEN', 2.2, backD, W, backD + 2.2]);
    } else {
      rooms.push(['BEDROOM', 0, 0, 3.9, backD], ['BATH', 3.9, 0, W, backD * 0.62], ['LDRY', 3.9, backD * 0.62, W, backD]);
      rooms.push(['KITCHEN', 0, backD, W, backD + 2.0]);
    }
    const livY = rooms[rooms.length - 1][4];
    rooms.push(['LIVING / DINING', 0, livY, W, Dp]);
    // furniture hints
    g.strokeStyle = '#c9c3b8'; g.lineWidth = 1;
    const rect = (x0, y0, x1, y1) => g.strokeRect(X(x0), Y(y0), (x1 - x0) * s, (y1 - y0) * s);
    rooms.forEach(([name, x0, y0, x1, y1]) => {
      const cx = (x0 + x1) / 2;
      if (name.startsWith('BEDROOM')) { rect(cx - 0.8, y0 + 0.15, cx + 0.8, y0 + 2.15); rect(cx - 0.7, y0 + 0.25, cx - 0.05, y0 + 0.6); rect(cx + 0.05, y0 + 0.25, cx + 0.7, y0 + 0.6); }
      if (name === 'KITCHEN') { rect(x0 + 0.1, y0 + 0.1, x1 - 0.1, y0 + 0.7); }
      if (name === 'BATH') { rect(x0 + 0.15, y0 + 0.15, x0 + 0.95, y0 + 0.95); g.beginPath(); g.arc(X(x1 - 0.45), Y(y0 + 0.5), 0.22 * s, 0, 7); g.stroke(); }
      if (name.startsWith('LIVING')) { rect(x0 + 0.4, y1 - 1.3, x0 + 2.6, y1 - 0.4); rect(x1 - 2.4, y0 + 0.7, x1 - 0.6, y0 + 1.7); }
    });
    // walls
    g.strokeStyle = '#2d2a26'; g.lineWidth = 1.6;
    rooms.forEach(([, x0, y0, x1, y1]) => rect(x0, y0, x1, y1));
    g.lineWidth = 4; rect(0, 0, W, Dp);
    // balcony
    g.lineWidth = 1.2; g.setLineDash([5, 4]); rect(0.3, Dp, W - 0.3, Dp + BAL); g.setLineDash([]);
    // door openings: a gap with a swing arc on each internal room's lower wall
    g.lineWidth = 1;
    rooms.slice(0, -1).forEach(([, x0, , , y1]) => {
      g.fillStyle = '#fbfaf7'; g.fillRect(X(x0 + 0.35), Y(y1) - 3, 0.8 * s, 6);
      g.strokeStyle = '#8a847a'; g.beginPath(); g.arc(X(x0 + 0.35), Y(y1), 0.8 * s, -Math.PI / 2, 0); g.stroke();
    });
    // labels with sizes
    g.fillStyle = '#3a3631'; g.textAlign = 'center';
    rooms.forEach(([name, x0, y0, x1, y1]) => {
      const cx = X((x0 + x1) / 2), cy = Y((y0 + y1) / 2);
      g.font = `600 ${Math.max(9, Math.min(12, s * 0.27))}px Geist, system-ui, sans-serif`; g.fillText(name, cx, cy);
      g.font = `400 ${Math.max(8.5, Math.min(11, s * 0.24))}px Geist Mono, monospace`; g.fillText(`${(x1 - x0).toFixed(1)} × ${(y1 - y0).toFixed(1)} m`, cx, cy + 14);
    });
    g.font = '600 11px Geist, system-ui, sans-serif'; g.fillText('BALCONY', X(W / 2), Y(Dp + BAL / 2) + 4);
    g.textAlign = 'left'; g.fillStyle = '#8a847a'; g.font = '400 10px Geist, system-ui, sans-serif';
    g.fillText(`Indicative layout · ${z.area} m² · demo`, 20, cssH - 6);
  }

  /* ---------- chart ---------- */
  function updateChart() {
    if (!chart || !data) return;
    const z = zoneOf(selected) || zoneOf(hovered);
    const building = scope === 'building' ? (z?.building || 1) : null;
    const pts = building ? data.all.filter((v) => v.building === building) : data.all;
    const fit = fitTrend(pts);
    const highlight = z ? (data.byZone.get(z.id)?.valuations || []) : [];
    chart.set({ points: pts, fit, highlight, floors: building && building <= spec.shell.buildings ? spec.shell.floors : world.layout.maxFloors, min: Math.min(...data.all.map((v) => v.rate)), max: Math.max(...data.all.map((v) => v.rate)), fmt });
    $('#vpStats').innerHTML = `<i class="dot"></i>${building ? `Building ${letter(building)}` : 'Whole project'}: n = ${pts.length}${fit ? `, R² = ${fit.r2.toFixed(2)}` : ' (too few to fit)'}`;
    const sl = $('#vpSelLegend');
    sl.hidden = !z || !highlight.length; if (z) sl.querySelector('span').textContent = `Selected: ${z.name}`;
  }

  /* ---------- labels ---------- */
  let labelEls = [];
  function buildLabels() {
    labelsEl.textContent = '';
    labelEls = (world?.labels || []).map((l) => {
      const d = document.createElement('div'); d.className = l.layer ? `val-label layer-${l.layer}` : 'val-label'; d.textContent = l.text;
      labelsEl.appendChild(d); return { el: d, src: l };
    });
  }
  const tmp = new THREE.Vector3();

  return {
    attach(w, sp) {
      const on = sp.kind === 'development' && !!w?.valuationLayer;
      world = on ? w : null; spec = on ? sp : null; selected = hovered = null;
      controls.hidden = panel.hidden = !on; labelsEl.hidden = !on;
      document.body.classList.toggle('has-valuations', on);
      if (!on) { labelsEl.textContent = ''; labelEls = []; data = null; return; }
      base = buildValuations(sp);
      data = applyLayers(base, sp, world.layout, layers);
      for (const t of LAYER_TYPES) world.siteLayers.setActive(t.id, !!layers[t.id]?.on);
      if (layers.flood) world.siteLayers.setFloodEvent(layers.flood.event);
      renderLayers();
      $('#valLede').textContent = `${sp.zones.length} apartments across ${w.layout.totalBuildings} building${w.layout.totalBuildings > 1 ? 's' : ''}.`;
      $('#valMin').textContent = `${fmt(data.min)} · lowest`;
      $('#valMax').textContent = `highest · ${fmt(data.max)}`;
      $('#valUnitNote').textContent = `${sp.currency} per m², dummy valuation per apartment`;
      $('#valCount').textContent = `${data.valuedCount} of ${sp.zones.length} apartments valued (${data.all.length} valuations, ${quarterLabel(0)}–${quarterLabel(QUARTERS - 1)}). Hover an apartment for its valuation.`;
      $('#vpSub').textContent = `Dummy data (not a market appraisal): rate per m² by quarter and floor. All ${data.all.length} valuations.`;
      world.valuationLayer.setVisible(colourBy === 'valuation');
      world.setWireframe(controls.querySelector('[data-render="wire"]').getAttribute('aria-pressed') === 'true');
      world.setContext($('#valContext').checked);
      controls.dataset.colour = colourBy;
      chart ??= createTrendChart($('#vpChart'));
      requestAnimationFrame(() => chart.resize());
      paint(); renderDetails(); updateChart(); buildLabels();
    },
    hover(id) { if (!world || id === hovered) return; hovered = id; paint(); if (!selected) updateChart(); },
    select(id) { if (!world || id === selected) return; selected = id; paint(); renderDetails(); updateChart(); },
    clear() { if (world) { selected = null; paint(); renderDetails(); updateChart(); } },
    /** Text for the floating tag over a hovered apartment, or null to keep the default. */
    tag(id) {
      if (!world || colourBy !== 'valuation') return null;
      const l = data.byZone.get(id)?.latest;
      return l ? `${fmt(l.rate)} /m² · ${l.quarter}` : 'No market valuation';
    },
    frame(camera, visible) {
      if (!world) return;
      for (const l of labelEls) {
        if (l.src.layer && l.el.textContent !== l.src.text) l.el.textContent = l.src.text;   // the flood label changes with the event
        tmp.copy(l.src.pos).project(camera);
        const layerOn = !l.src.layer || layers[l.src.layer]?.on;
        const show = visible && layerOn && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
        l.el.style.opacity = show ? 1 : 0;
        if (show) l.el.style.transform = `translate(${(tmp.x + 1) / 2 * innerWidth}px, ${(1 - tmp.y) / 2 * innerHeight}px) translate(-50%, -100%)`;
      }
    },
  };
}

/* ================= 3D trend chart ================= */
function createTrendChart(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  camera.position.set(13.5, 9.5, 15.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2.6, 0); controls.enablePan = false; controls.minDistance = 10; controls.maxDistance = 45; controls.update();
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#2a2f3d', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4); sun.position.set(6, 12, 8); scene.add(sun);
  const BX = 5, BZ = 4, BY = 6;                       // half-width (quarters), half-depth (floors), height (rate)
  const dyn = new THREE.Group(); scene.add(dyn);
  const axes = new THREE.Group(); scene.add(axes);

  // Grid on the floor and the two back walls.
  const gl = [];
  for (let i = 0; i <= 8; i++) {
    const x = -BX + (2 * BX) * i / 8, z = -BZ + (2 * BZ) * i / 8, y = BY * i / 8;
    gl.push(x, 0, -BZ, x, 0, BZ, -BX, 0, z, BX, 0, z);        // floor
    gl.push(x, 0, -BZ, x, BY, -BZ, -BX, y, -BZ, BX, y, -BZ);  // back wall
    gl.push(-BX, 0, z, -BX, BY, z, -BX, y, -BZ, -BX, y, BZ);  // side wall
  }
  const grid = new THREE.BufferGeometry(); grid.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
  axes.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: '#2b3753', transparent: true, opacity: 0.85 })));

  function sprite(text, size = 0.5, color = '#a9b4cc') {
    const c = document.createElement('canvas'), g = c.getContext('2d'), px = 48;
    g.font = `500 ${px}px Geist, system-ui, sans-serif`;
    c.width = Math.ceil(g.measureText(text).width) + 16; c.height = px + 16;
    g.font = `500 ${px}px Geist, system-ui, sans-serif`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 8, c.height / 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
    s.scale.set(size * c.width / c.height, size, 1); return s;
  }
  const qx = (q) => -BX + (2 * BX) * q / (QUARTERS - 1);
  for (const q of [0, 4, 8, 12, 15]) { const s = sprite(quarterLabel(q), 0.62); s.position.set(qx(q), -0.45, BZ + 1.1); axes.add(s); }
  { const s = sprite('Quarter', 0.75, '#d7deec'); s.position.set(0, -1.2, BZ + 2.3); axes.add(s); }

  let pointsMesh = null, hiMesh = null, surface = null, wire = null, dynLabels = [];
  const ptGeo = new THREE.SphereGeometry(0.11, 12, 8), hiGeo = new THREE.SphereGeometry(0.22, 16, 12);
  const ptMat = new THREE.MeshLambertMaterial({ color: '#3d8bff' }), hiMat = new THREE.MeshBasicMaterial({ color: '#ff5fd2' });
  const surfMat = new THREE.MeshLambertMaterial({ color: '#b5583a', transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
  const wireMat = new THREE.LineBasicMaterial({ color: '#e39a76', transparent: true, opacity: 0.35 });
  const m = new THREE.Matrix4();

  function clearDyn() {
    for (const o of [pointsMesh, hiMesh, surface, wire, ...dynLabels]) if (o) { dyn.remove(o); if (o.geometry && o.geometry !== ptGeo && o.geometry !== hiGeo) o.geometry.dispose(); if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); } }
    pointsMesh = hiMesh = surface = wire = null; dynLabels = [];
  }
  function render() { renderer.render(scene, camera); }
  controls.addEventListener('change', render);

  return {
    set({ points, fit, highlight, floors, min, max, fmt }) {
      clearDyn();
      const lo = min - (max - min) * 0.08, hi = max + (max - min) * 0.08;
      const fz = (f) => floors > 1 ? -BZ + (2 * BZ) * (f - 1) / (floors - 1) : 0;
      const ry = (r) => BY * (r - lo) / (hi - lo);
      const jitter = (v, i) => ((v.zone.length * 31 + i * 17) % 7 - 3) * 0.03;
      pointsMesh = new THREE.InstancedMesh(ptGeo, ptMat, Math.max(1, points.length));
      points.forEach((v, i) => pointsMesh.setMatrixAt(i, m.makeTranslation(qx(v.q) + jitter(v, i), ry(v.rate), fz(v.floor) + jitter(v, i + 3))));
      pointsMesh.count = points.length; dyn.add(pointsMesh);
      if (highlight.length) {
        hiMesh = new THREE.InstancedMesh(hiGeo, hiMat, highlight.length);
        highlight.forEach((v, i) => hiMesh.setMatrixAt(i, m.makeTranslation(qx(v.q), ry(v.rate), fz(v.floor))));
        dyn.add(hiMesh);
      }
      if (fit) {
        const qs = points.map((p) => p.q), fs = points.map((p) => p.floor);
        const q0 = Math.min(...qs), q1 = Math.max(...qs), f0 = Math.min(...fs), f1 = Math.max(...fs), N = 22;
        const pos = [], idx = [], wl = [];
        for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
          const q = q0 + (q1 - q0) * i / N, f = f0 + (f1 - f0) * j / N;
          pos.push(qx(q), THREE.MathUtils.clamp(ry(fit.predict(q, f)), 0, BY), fz(f));
        }
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1); }
        for (let j = 0; j <= N; j += 2) for (let i = 0; i < N; i++) { const a = (j * (N + 1) + i) * 3, b = a + 3; wl.push(...pos.slice(a, a + 3), ...pos.slice(b, b + 3)); }
        for (let i = 0; i <= N; i += 2) for (let j = 0; j < N; j++) { const a = (j * (N + 1) + i) * 3, b = ((j + 1) * (N + 1) + i) * 3; wl.push(...pos.slice(a, a + 3), ...pos.slice(b, b + 3)); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
        surface = new THREE.Mesh(geo, surfMat); surface.renderOrder = 2; dyn.add(surface);
        const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wl, 3));
        wire = new THREE.LineSegments(wg, wireMat); wire.renderOrder = 3; dyn.add(wire);
      }
      // rate ticks (back wall) and floor ticks (side)
      for (let i = 0; i <= 4; i++) { const r = lo + (hi - lo) * i / 4; const s = sprite(fmt(r), 0.6); s.position.set(-BX - 2.3, ry(r), -BZ); dynLabels.push(s); dyn.add(s); }
      { const s = sprite('Rate per m²', 0.75, '#d7deec'); s.position.set(-BX - 1.8, BY + 0.9, -BZ); dynLabels.push(s); dyn.add(s); }
      for (const f of (floors <= 10 ? Array.from({ length: floors }, (_, i) => i + 1) : [1, 20, 40, 60, 80, 100])) { const s = sprite(`L${f}`, 0.62); s.position.set(BX + 0.9, -0.25, fz(f)); dynLabels.push(s); dyn.add(s); }
      { const s = sprite('Floor', 0.75, '#d7deec'); s.position.set(BX + 2.2, -0.8, 0); dynLabels.push(s); dyn.add(s); }
      render();
    },
    resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
    },
  };
}
