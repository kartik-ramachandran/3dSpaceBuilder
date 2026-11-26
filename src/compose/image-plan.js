/*
 * Image → composition.
 *
 * With Claude (local server with an API key): the image goes to /api/compose with a description of the
 * catalogue, and Claude answers with items (type, params, position) that sanitize() checks and clamps.
 *
 * Offline (always available): the page reads the picture itself.
 *  - Street / skyline photos: the sky is found from the top of every column down, which gives the skyline
 *    silhouette; it is split into buildings by height jumps, and each becomes a tower, apartment block,
 *    townhouse row or house by its height and width, coloured with its own average facade colour.
 *  - Aerial photos (almost no sky): the picture is read as a plan on a grid; greenery becomes parks and
 *    trees, water becomes water, red/brown roofs become houses, large grey roofs apartment blocks,
 *    flat dark grey strips roads.
 *  Greenery, water and road in the lower part of a street photo add trees, a river and a street with traffic.
 */
import { TYPES, TILES } from './catalog.js';

const SCENE_WIDTH = 260;                    // metres the picture's width becomes

/* ---------------------------------------------------------------- shared: validate any proposed items */
export function sanitize(raw, anchor) {
  const items = [];
  for (const it of Array.isArray(raw) ? raw.slice(0, 160) : []) {
    const def = TYPES[it?.type]; if (!def) continue;
    const tiles = [...new Set(TILES.values())].filter((t) => t.type === it.type);
    const tile = tiles.find((t) => t.params.style && t.params.style === it.params?.style) || tiles[0];
    const params = { ...tile.params };
    for (const p of def.params) {
      const v = it.params?.[p.key];
      if (v === undefined || v === null) continue;
      if (p.type === 'range') { const n = Number(v); if (Number.isFinite(n)) params[p.key] = Math.min(p.max, Math.max(p.min, Math.round(n / p.step) * p.step)); }
      else if (p.type === 'choice') { const o = p.options.find(([val]) => String(val) === String(v)); if (o) params[p.key] = o[0]; }
      else if (p.type === 'colour') { if (/^#[0-9a-f]{6}$/i.test(String(v))) params[p.key] = String(v).toLowerCase(); }
      else if (p.type === 'toggle') params[p.key] = Boolean(v);
    }
    const x = Number(it.x) || 0, z = Number(it.z) || 0, rot = Number(it.rot) || 0;
    items.push({ tile: tile.id, type: it.type, params, x: anchor.x + Math.max(-400, Math.min(400, x)), z: anchor.z + Math.max(-400, Math.min(400, z)), rot });
  }
  return items;
}

/** What Claude is told about the catalogue (built from the live parameter definitions). */
export function composePrompt(text) {
  const describe = ([type, def]) => {
    const ps = def.params.map((p) => p.type === 'range' ? `${p.key}: ${p.min}–${p.max}${p.unit ? ' ' + p.unit : ''}` : p.type === 'choice' ? `${p.key}: ${p.options.map(([v]) => JSON.stringify(v)).join(' | ')}` : p.type === 'colour' ? `${p.key}: "#rrggbb"` : `${p.key}: true | false`);
    return `- ${type} { ${ps.join(', ')} }`;
  };
  return `You turn a picture of a place into a 3D scene made only from this catalogue of assets:
${Object.entries(TYPES).map(describe).join('\n')}

Notes on the assets: house styles are house_a (2-storey family home with a garage, ~15 × 12 m), house_b (bungalow with a deck), house_c (modern flat-roof box). townhouses is one terrace row of "units" homes, each 6 m wide (townhouse_a gabled 2 storeys, townhouse_b modern 3 storeys). apartment is a block of "floors" storeys, "units" × 7.5 m wide, 11 m deep. tower is "storeys" × 3.2 m tall on a width × depth footprint. road runs along its local x axis with footpaths, street lights, street trees, its own driving traffic and walkers. treeRow is a line of trees along x. crowd is a group of people. water is a river or pond (length along x). lawn is a grass, paver or asphalt area. carPark is a parking area.

Look at the picture and reproduce what is in it as faithfully as these assets allow: the number, arrangement and relative heights of the buildings (estimate storeys from the picture), their wall colours (as hex), roads and traffic, greenery, water and people. Lay it out in metres on the ground plane: x to the right across the picture, z towards the viewer (z > 0 is the foreground), origin at the middle of the scene, everything within ±300 m. rot is the turn in radians about the vertical axis; at rot 0 a building's front faces +z (the viewer) and a road runs left–right. Keep buildings from overlapping (leave 4–8 m between them). Use at most 120 items: prefer townhouses rows, treeRow, crowd and a road's own traffic over many single items.
${text ? `\nThe person also says: ${text}\n` : ''}
Reply with JSON only, no prose: {"summary": "one sentence describing what you built", "items": [{"type": "...", "params": {...}, "x": 0, "z": 0, "rot": 0}]}`;
}

/* ---------------------------------------------------------------- offline reading */
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function classify(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510, s = max - min;
  return {
    l, s,
    sky: (b >= r - 4 && b >= g - 12 && l > 0.5 && s < 120) || (l > 0.86 && s < 28),
    veg: g > r + 6 && g >= b - 4 && l < 0.72 && s > 14,
    water: b > r + 14 && b >= g - 6 && l < 0.66 && l > 0.12,
    grey: s < 22 && l > 0.18 && l < 0.62,
    roofRed: r > g + 22 && r > b + 22,
  };
}

/** Reads an image (HTMLImageElement / ImageBitmap) and returns { items, summary } placed around `anchor`. */
export function planFromImage(img, anchor) {
  const W = 220, H = Math.max(40, Math.round(W * (img.naturalHeight || img.height) / (img.naturalWidth || img.width)));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
  const px = x.getImageData(0, 0, W, H).data;
  const at = (cx, cy) => { const i = (cy * W + cx) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const cls = (cx, cy) => classify(...at(cx, cy));

  // sky from the top of each column down: it must look like sky AND change smoothly (sky is a gradient;
  // a roofline is a sharp edge, even on pale glass towers). A stray pixel is tolerated.
  const skyTop = new Array(W).fill(0);
  for (let cx = 0; cx < W; cx++) {
    let y = 0, miss = 0, prev = at(cx, 0);
    while (y < H) {
      const p = at(cx, y), d = Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) + Math.abs(p[2] - prev[2]);
      const k = classify(...p);
      if (k.sky && (d < 34 || (k.l > 0.8 && k.s < 34))) { miss = 0; prev = p; } else if (++miss > 1) break;          // clouds: bright and colourless
      y++;
    }
    skyTop[cx] = Math.max(0, y - miss);
  }
  const skyFrac = skyTop.reduce((a, b) => a + b, 0) / (W * H);
  return skyFrac > 0.07 ? skyline(W, H, skyTop, at, cls, anchor) : aerial(W, H, at, cls, anchor);
}

function skyline(W, H, skyTop, at, cls, anchor) {
  // Heights are read relative to the city's typical roofline (the median sky edge), not the bottom of the
  // frame: in most photos the lower part is foreground, so the buildings' bases are hidden. A building's
  // prominence above that roofline (as a share of the frame) sets its type and storeys.
  // the sky's own colour (top band), to reject 'buildings' that are really clouds
  let sr = 0, sgc = 0, sb = 0, sn = 0;
  for (let cx = 0; cx < W; cx += 2) for (let y = 0; y < Math.min(skyTop[cx], H * 0.15); y += 2) { const [R, G, B] = at(cx, y); sr += R; sgc += G; sb += B; sn++; }
  const skyLike = (r, g, b) => sn > 20 && Math.abs(r - sr / sn) + Math.abs(g - sgc / sn) + Math.abs(b - sb / sn) < 42 && (r + g + b) / 3 > 150;
  const top = skyTop.map((_, i) => { const w = skyTop.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b); return w[w.length >> 1]; });
  const built = top.filter((t) => t < H * 0.92);
  const roofline = built.length ? [...built].sort((a, b) => a - b)[built.length >> 1] : H * 0.6;
  const jump = Math.max(5, H * 0.045);

  // split the silhouette into buildings where the roof height jumps
  const segs = []; let cur = null;
  for (let i = 0; i < W; i++) {
    const t = top[i];
    if (t >= H * 0.92) { if (cur) segs.push(cur); cur = null; continue; }
    if (cur && (Math.abs(t - cur.sum / cur.n) > jump || cur.n > W / 4)) { segs.push(cur); cur = null; }
    if (!cur) cur = { start: i, n: 0, sum: 0, min: H };
    cur.n++; cur.sum += t; cur.min = Math.min(cur.min, t);
  }
  if (cur) segs.push(cur);
  const merged = [];
  for (const sg of segs) {
    const last = merged.at(-1);
    if (last && last.start + last.n === sg.start && (sg.n < 4 || Math.abs(sg.sum / sg.n - last.sum / last.n) < jump * 0.6)) { last.n += sg.n; last.sum += sg.sum; last.min = Math.min(last.min, sg.min); }
    else merged.push(sg);
  }

  const items = [], said = { tower: 0, apartment: 0, townhouses: 0, house: 0 };
  let tallest = 0;
  const m = SCENE_WIDTH / W;
  for (const sg of merged.filter((q) => q.n >= 3)) {
    const avgTop = sg.sum / sg.n, prom = (roofline - avgTop) / H, cx = sg.start + sg.n / 2, widthM = sg.n * m;
    let r = 0, g = 0, b = 0, n = 0;                                   // its own facade colour, just below the roof
    const yEnd = Math.min(H - 1, avgTop + H * 0.2);
    for (let xx = sg.start; xx < sg.start + sg.n; xx += 2) for (let yy = Math.round(skyTop[xx] + 2); yy < yEnd; yy += 2) { const [R, G, B] = at(xx, yy); r += R; g += G; b += B; n++; }
    const facade = n ? hex(r / n * 1.1, g / n * 1.1, b / n * 1.1) : '#e7dfd1';
    if (n && skyLike(r / n, g / n, b / n)) continue;                    // a cloud or patch of sky, not a building
    const X = (cx / W - 0.5) * SCENE_WIDTH;
    if (prom > 0.16) {
      const storeys = Math.max(15, Math.min(100, Math.round(10 + prom * 80)));
      tallest = Math.max(tallest, storeys);
      items.push({ type: 'tower', params: { storeys, width: Math.max(18, Math.min(34, Math.round(widthM * 0.8))), depth: 16, facade, podium: true }, x: X, z: -60, rot: 0 }); said.tower++;
    } else if (prom > 0.035) {
      const floors = Math.max(6, Math.min(30, Math.round(6 + prom * 70)));
      tallest = Math.max(tallest, floors);
      items.push({ type: 'apartment', params: { floors, units: Math.max(2, Math.min(6, Math.round(widthM / 9))), facade }, x: X, z: -28, rot: 0 }); said.apartment++;
    } else if (prom > -0.04) {
      const floors = Math.max(3, Math.round(5 + prom * 40));
      tallest = Math.max(tallest, floors);
      items.push({ type: 'apartment', params: { floors, units: Math.max(2, Math.min(6, Math.round(widthM / 9))), facade }, x: X, z: -6, rot: 0 }); said.apartment++;
    } else if (widthM > 16) {
      items.push({ type: 'townhouses', params: { style: 'townhouse_a', units: Math.max(2, Math.min(12, Math.round(widthM / 7))), facade, mixed: false }, x: X, z: 14, rot: 0 }); said.townhouses++;
    } else {
      items.push({ type: 'house', params: { style: ['house_a', 'house_b', 'house_c'][items.length % 3], facade: '#e7dfd1', roof: '#6e6e72', car: true }, x: X, z: 14, rot: 0 }); said.house++;
    }
  }
  // spread overlapping neighbours apart along x, row by row
  items.sort((a, b) => a.x - b.x);
  for (const z of new Set(items.map((it) => it.z))) {
    const row = items.filter((it) => it.z === z);
    for (let k = 1; k < row.length; k++) { const a = row[k - 1], b = row[k], need = (footprint(a) + footprint(b)) / 2 + 5; if (b.x - a.x < need) b.x = a.x + need; }
  }
  const xs = items.map((it) => it.x), span = items.length ? Math.max(...xs) - Math.min(...xs) : 0, shift = items.length ? -(Math.min(...xs) + span / 2) : 0;
  items.forEach((it) => { it.x += shift; });

  // the foreground: greenery overall; water and road only as real horizontal bands
  let veg = 0, cells = 0, waterRows = 0, roadRows = 0;
  for (let y = Math.floor(H * 0.5); y < H; y++) {
    let w = 0, rd = 0;
    for (let cx = 0; cx < W; cx++) { const k = cls(cx, y); veg += k.veg; w += k.water; rd += k.grey && k.s < 12; cells++; }
    if (w / W > 0.55) waterRows++; if (rd / W > 0.6) roadRows++;
  }
  veg /= cells;
  const water = waterRows / H, road = roadRows / H;
  const L = Math.max(160, Math.ceil((span + 80) / 10) * 10);
  const extra = [];
  { const lanes = road > 0.08 ? 4 : 2; items.push({ type: 'road', params: { length: L, lanes, footpaths: true, lamps: true, trees: veg > 0.08, traffic: lanes === 4 ? 12 : 6, walkers: 14 }, x: 0, z: 30, rot: 0 }); extra.push(`a ${lanes === 4 ? 'four-lane road' : 'street'} with traffic`); }
  if (veg > 0.06) { const n = Math.min(30, Math.round(veg * 90)); items.push({ type: 'treeRow', params: { count: n, spacing: Math.max(6, Math.floor(L / n)), scale: 0.85, mixed: true }, x: 0, z: 44, rot: 0 }); extra.push(`${n} trees`); }
  if (veg > 0.3) { items.push({ type: 'park', params: { radius: 30, trees: 24, people: 10, path: true }, x: L / 2 + 40, z: 30, rot: 0 }); extra.push('a park'); }
  if (water > 0.05) { items.push({ type: 'water', params: { length: L + 120, width: 40, banks: true }, x: 0, z: 84, rot: 0 }); extra.push('a river'); }

  const parts = [];
  if (said.tower) parts.push(`${said.tower} tower${said.tower > 1 ? 's' : ''}`);
  if (said.apartment) parts.push(`${said.apartment} apartment block${said.apartment > 1 ? 's' : ''}`);
  if (said.townhouses) parts.push(`${said.townhouses} townhouse row${said.townhouses > 1 ? 's' : ''}`);
  if (said.house) parts.push(`${said.house} house${said.house > 1 ? 's' : ''}`);
  return {
    mode: 'skyline', raw: items,
    summary: items.some((it) => ['tower', 'apartment', 'townhouses', 'house'].includes(it.type))
      ? `Read the skyline offline: ${parts.join(', ') || 'low buildings'}${tallest ? ` (tallest ≈ ${tallest} storeys)` : ''}${extra.length ? ', plus ' + extra.join(', ') : ''}. Heights are estimates — select any building to adjust.`
      : 'I could not find a skyline in that picture.',
  };
}

function footprint(it) {
  const p = it.params;
  return { tower: () => p.width + 3, apartment: () => p.units * 7.5 + 1, townhouses: () => p.units * 6, house: () => 16 }[it.type]?.() || 10;
}

function aerial(W, H, at, cls, anchor) {
  const G = 10, gx = G, gy = Math.max(4, Math.round(G * H / W)), cw = W / gx, ch = H / gy, cell = 32;
  const items = [], counts = { house: 0, apartment: 0, park: 0, water: 0, road: 0, tree: 0 };
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    let veg = 0, water = 0, grey = 0, red = 0, n = 0, lSum = 0, lSq = 0, r = 0, g = 0, b = 0;
    for (let y = Math.floor(j * ch); y < Math.floor((j + 1) * ch); y++) for (let xx = Math.floor(i * cw); xx < Math.floor((i + 1) * cw); xx++) {
      const [R, G2, B] = at(xx, y), k = classify(R, G2, B);
      veg += k.veg; water += k.water; grey += k.grey; red += k.roofRed; lSum += k.l; lSq += k.l * k.l; r += R; g += G2; b += B; n++;
    }
    veg /= n; water /= n; grey /= n; red /= n;
    const varL = lSq / n - (lSum / n) ** 2;
    const X = (i - (gx - 1) / 2) * cell, Z = (j - (gy - 1) / 2) * cell;
    if (water > 0.45) { items.push({ type: 'water', params: { length: cell, width: cell, banks: false }, x: X, z: Z, rot: 0 }); counts.water++; }
    else if (veg > 0.5) { items.push({ type: 'park', params: { radius: cell / 2 - 1, trees: Math.round(4 + veg * 8), people: 0, path: false }, x: X, z: Z, rot: 0 }); counts.park++; }
    else if (red > 0.18) { items.push({ type: 'house', params: { style: ['house_a', 'house_b', 'house_c'][(i + j) % 3], facade: '#e7dfd1', roof: '#c98a6a', car: true }, x: X, z: Z, rot: ((i + j) % 2) * Math.PI }); counts.house++; }
    else if (grey > 0.55 && varL < 0.006) { items.push({ type: 'lawn', params: { width: cell, depth: cell, surface: 'asphalt' }, x: X, z: Z, rot: 0 }); counts.road++; }
    else if (varL > 0.012) { const floors = Math.max(3, Math.min(20, Math.round(4 + varL * 500))); items.push({ type: 'apartment', params: { floors, units: 3, facade: hex(r / n * 1.1, g / n * 1.1, b / n * 1.1) }, x: X, z: Z, rot: 0 }); counts.apartment++; }
    else if (veg > 0.2) { items.push({ type: 'tree', params: { species: ['tree_a', 'tree_b', 'tree_c'][(i * 7 + j) % 3], scale: 1 }, x: X, z: Z, rot: 0 }); counts.tree++; }
  }
  const parts = Object.entries({ 'apartment blocks': counts.apartment, houses: counts.house, 'park cells': counts.park, 'water cells': counts.water, 'paved cells': counts.road, trees: counts.tree }).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`);
  return { mode: 'aerial', raw: items, summary: `Read it as an aerial view offline, on a ${gx} × ${gy} grid of ${cell} m cells: ${parts.join(', ')}. Select any item to adjust it.` };
}
