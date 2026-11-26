/*
 * Prompt → composition, offline: reads quantities and things from a sentence ("a busy street with
 * 6 townhouses, 2 bungalows, a 40 storey tower, 12 trees and 5 red cars") and lays them out as a street
 * scene around `anchor`: buildings face the road from both sides, trees line it, cars drive on it,
 * people walk the footpaths, and parks, water and car parks sit at the ends or behind.
 */
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, dozen: 12, couple: 2, few: 3, several: 4, some: 4, many: 8, lots: 10 };
const NOUNS = [
  ['carPark', /\b(car ?parks?|parking(?: lots?)?)\b/],
  ['townhouses', /\b(town ?houses?|terraces?|terraced houses?|row ?houses?)\b/],
  ['tower', /\b(towers?|skyscrapers?|high[- ]?rises?|supertalls?)\b/],
  ['apartment', /\b(apartments?(?: blocks?| buildings?)?|flats|mid[- ]?rises?|condos?)\b/],
  ['house', /\b(houses?|homes?|bungalows?|villas?)\b/],
  ['truck', /\b(trucks?|lorr(?:y|ies))\b/],
  ['car', /\b(cars?|sedans?|suvs?|hatchbacks?|vehicles?|traffic)\b/],
  ['people', /\b(people|persons?|pedestrians?|walkers?|crowds?|famil(?:y|ies)|kids|shoppers)\b/],
  ['road', /\b(roads?|streets?|avenues?|boulevards?|highways?)\b/],
  ['lamp', /\b(street ?lights?|lamps?|lamp ?posts?)\b/],
  ['tree', /\b(trees?)\b/],
  ['park', /\b(parks?|gardens?|green spaces?|playgrounds?)\b/],
  ['water', /\b(rivers?|ponds?|lakes?|canals?|streams?)\b/],
  ['lawn', /\b(lawns?|plazas?|squares?)\b/],
];
const COLOURS = { red: '#7a1a1a', blue: '#1f3552', white: '#f2f2f0', black: '#121314', grey: '#8b9093', gray: '#8b9093', silver: '#c9cbcc', green: '#3c4a3a' };
const FACADE = { brick: '#b77a5f', white: '#f3f0ea', cream: '#e7dfd1', grey: '#9fa6a8', gray: '#9fa6a8', sand: '#c9b8a2', stone: '#e7dfd1' };
const DEFAULT_COUNT = { tree: 8, people: 10, car: 4, lamp: 6, townhouses: 5, house: 3, apartment: 2, tower: 1, truck: 1, road: 1, park: 1, water: 1, lawn: 1, carPark: 1 };

function parse(text) {
  const t = text.toLowerCase().replace(/[’']/g, '');
  const phrases = t.split(/,|;|\.|\band\b|\bwith\b|\bplus\b|\balong\b|\bnext to\b|\bbeside\b|\bnear\b|\bby\b/).map((s) => s.trim()).filter(Boolean);
  const out = [], global = { busy: /\b(busy|four[- ]lane|4[- ]lane|dual|avenue|boulevard)\b/.test(t), parked: /\bparked\b/.test(t) };
  for (const ph of phrases) {
    for (const [kind, re] of NOUNS) {
      const m = ph.match(re); if (!m) continue;
      const before = ph.slice(0, m.index).trim().split(/\s+/).slice(-4);
      let count = null;
      for (const w of before.reverse()) { if (/^\d+$/.test(w)) { count = Number(w); break; } if (WORDS[w] !== undefined) { count = WORDS[w]; break; } }
      const plural = /s\b|people|flats|traffic|famil/.test(m[1]) && !/ss\b/.test(m[1]);
      if (count === null) count = plural ? DEFAULT_COUNT[kind] : 1;
      const storeys = ph.match(/(\d+)[- ]?(?:storey|story|stories|storeys|floor|level)s?/);
      const units = ph.match(/(\d+)[- ]?(?:units?|homes?|apartments?) (?:per|a|each) floor/);
      if (storeys && Number(storeys[1]) === count && !/\d+\s+\d+/.test(ph)) count = 1;      // "a 40 storey tower"
      const colour = Object.keys(COLOURS).find((c) => new RegExp(`\\b${c}\\b`).test(ph));
      const facade = Object.keys(FACADE).find((c) => new RegExp(`\\b${c}\\b`).test(ph));
      out.push({ kind, count, word: m[1], storeys: storeys ? Number(storeys[1]) : null, units: units ? Number(units[1]) : null, colour, facade, phrase: ph,
        modern: /\bmodern|contemporary\b/.test(ph), bungalow: /\bbungalows?\b/.test(m[1]) || /\bsingle[- ]storey\b/.test(ph), walking: /\bwalk/.test(ph), standing: /\bstand|wait/.test(ph), parked: /\bparked\b/.test(ph) });
      break;
    }
  }
  return { asks: out, global };
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Returns { items: [{ tile, type, params, x, z, rot }], summary }. */
export function planFromPrompt(text, anchor) {
  const { asks, global } = parse(text);
  const items = [], said = [];
  const has = (k) => asks.find((a) => a.kind === k);
  const road = has('road') || (asks.length > 1 && (has('car') || has('people')) ? { kind: 'road', count: 1, auto: true } : null);
  const lanes = global.busy ? 4 : 2, roadW = lanes * 3.4 + 1, edge = roadW / 2 + (road ? 3.3 : 6);

  // buildings, two frontages facing each other
  const buildings = [];
  for (const a of asks) {
    if (a.kind === 'house') for (let i = 0; i < a.count; i++) {
      const style = a.bungalow ? 'house_b' : a.modern ? 'house_c' : /\bfamily\b/.test(a.phrase) ? 'house_a' : ['house_a', 'house_b', 'house_c', 'house_a'][i % 4];
      buildings.push({ tile: { house_a: 'house-family', house_b: 'house-bungalow', house_c: 'house-modern' }[style], type: 'house', w: 15, d: 12, params: { style, facade: FACADE[a.facade] || ['#f3f0ea', '#e7dfd1', '#c9b8a2', '#d6d3cc'][i % 4], roof: ['#ffffff', '#c98a6a', '#6e6e72'][i % 3], car: style === 'house_a' } });
    }
    if (a.kind === 'townhouses') {
      const rows = /\brows?\b/.test(a.phrase) && a.count <= 6 ? a.count : Math.max(1, Math.ceil(a.count / 8));
      const per = /\brows?\b/.test(a.phrase) && a.count <= 6 ? 5 : Math.ceil(a.count / rows);
      for (let r = 0; r < rows; r++) {
        const style = a.modern || (a.storeys || 0) >= 3 ? 'townhouse_b' : 'townhouse_a';
        buildings.push({ tile: style === 'townhouse_a' ? 'townhouses-gabled' : 'townhouses-modern', type: 'townhouses', w: per * 6, d: 11, params: { style, units: per, facade: FACADE[a.facade] || '#c9b8a2', mixed: !a.facade } });
      }
    }
    if (a.kind === 'apartment') for (let i = 0; i < a.count; i++) {
      const floors = Math.min(30, a.storeys || 6), units = Math.min(6, a.units || 4);
      buildings.push({ tile: 'apartment', type: 'apartment', w: units * 7.5 + 1, d: 13, back: true, params: { floors, units, facade: FACADE[a.facade] || ['#f3f0ea', '#c9b8a2', '#d6d3cc'][i % 3] } });
    }
    if (a.kind === 'tower') for (let i = 0; i < a.count; i++) {
      const storeys = Math.max(10, Math.min(100, a.storeys || 40));
      buildings.push({ tile: 'tower', type: 'tower', w: 32, d: 22, back: true, params: { storeys, width: storeys > 60 ? 30 : 26, depth: storeys > 60 ? 18 : 14, facade: FACADE[a.facade] || '#e7dfd1', podium: true } });
    }
  }
  const sides = [{ s: 1, cursor: 0, list: [] }, { s: -1, cursor: 0, list: [] }];
  for (const b of buildings) { const side = sides[0].cursor <= sides[1].cursor ? sides[0] : sides[1]; b.x = side.cursor + b.w / 2; side.cursor += b.w + 6; side.list.push(b); }
  const span = Math.max(60, ...sides.map((s) => s.cursor - 6));
  const L = Math.min(600, Math.max(120, Math.ceil((span + 50) / 10) * 10));
  for (const side of sides) {
    const shift = -(side.cursor - 6) / 2;
    for (const b of side.list) {
      const setback = edge + 4 + b.d / 2 + (b.back ? 6 : 0);
      items.push({ tile: b.tile, type: b.type, params: b.params, x: anchor.x + b.x + shift, z: anchor.z + side.s * setback, rot: side.s > 0 ? Math.PI : 0 });
    }
  }
  const depthOf = (side) => Math.max(0, ...side.list.map((b) => b.d + (b.back ? 6 : 0)));
  for (const a of asks) {
    if (a.kind === 'house') said.push(a.bungalow ? plural(a.count, 'bungalow') : a.modern ? plural(a.count, 'modern house', 'modern houses') : /\bfamily\b/.test(a.phrase) ? plural(a.count, 'family house', 'family houses') : plural(a.count, 'house', 'houses'));
    if (a.kind === 'townhouses') said.push(plural(a.count, 'townhouse'));
    if (a.kind === 'apartment') said.push(plural(a.count, `${Math.min(30, a.storeys || 6)}-storey apartment block`));
    if (a.kind === 'tower') said.push(plural(a.count, `${Math.max(10, Math.min(100, a.storeys || 40))}-storey tower`));
  }

  // the street
  const carAsk = has('car'), peopleAsk = has('people'), treeAsk = has('tree'), lampAsk = has('lamp');
  if (road) {
    const traffic = carAsk && !carAsk.parked && !global.parked ? Math.min(24, carAsk.count) : 0;
    items.push({ tile: lanes === 4 ? 'road-4' : 'road-2', type: 'road', x: anchor.x, z: anchor.z, rot: 0,
      params: { length: L, lanes, footpaths: true, lamps: !!lampAsk || !road.auto, trees: false, traffic, walkers: peopleAsk && !peopleAsk.standing ? Math.min(40, peopleAsk.count) : 0 } });
    said.push(`a ${L} m ${lanes === 4 ? 'four-lane road' : 'street'}${traffic ? ` with ${plural(traffic, 'car')} driving` : ''}`);
  }
  if (carAsk && (!road || carAsk.parked || global.parked)) {
    for (let i = 0; i < carAsk.count; i++) {
      const s = i % 2 ? 1 : -1, x = anchor.x - (carAsk.count / 2) * 7 + i * 7;
      items.push({ tile: ['car-sedan', 'car-suv', 'car-hatch'][i % 3], type: 'car', x, z: anchor.z + s * (road ? roadW / 2 - 1.3 : 3), rot: s > 0 ? Math.PI : 0,
        params: { model: ['car_sedan', 'car_suv', 'car_hatch'][i % 3], paint: COLOURS[carAsk.colour] || ['#f2f2f0', '#1f3552', '#8b9093', '#7a1a1a', '#121314'][i % 5], drive: false, speed: 40, route: 120 } });
    }
    said.push(plural(carAsk.count, 'parked car'));
  }
  if (carAsk && road && carAsk.colour) items.forEach((it) => { if (it.type === 'road') it.params.carColour = COLOURS[carAsk.colour]; });
  const truckAsk = has('truck');
  if (truckAsk) for (let i = 0; i < truckAsk.count; i++) {
    items.push({ tile: 'truck', type: 'truck', x: anchor.x, z: anchor.z + (i % 2 ? 1.7 : -1.7) * (lanes === 4 ? 3 : 1), rot: i % 2 ? Math.PI : 0, params: { paint: ['#33475b', '#7a1a1a', '#f2f2f0'][i % 3], drive: true, speed: 50, route: road ? L : 160 } });
    said.push(plural(truckAsk.count, 'truck'));
  }
  if (treeAsk) {
    const n = treeAsk.count, rows = road ? 2 : 1, per = Math.ceil(n / rows);
    for (let r = 0; r < rows; r++) {
      const s = r ? -1 : 1, z = road ? anchor.z + s * (edge + 1.6) : anchor.z + s * (depthOf(sides[0]) + edge + 10);
      items.push({ tile: 'tree-row', type: 'treeRow', x: anchor.x, z, rot: 0, params: { count: r ? n - per : per, spacing: Math.max(6, Math.min(16, Math.floor((L - 20) / Math.max(1, per)))), scale: 0.8, mixed: true } });
    }
    said.push(plural(n, 'tree'));
  }
  if (lampAsk && !road) { for (let i = 0; i < lampAsk.count; i++) items.push({ tile: 'lamp', type: 'lamp', x: anchor.x - lampAsk.count * 12 + i * 24, z: anchor.z + edge, rot: Math.PI, params: {} }); said.push(plural(lampAsk.count, 'street light')); }
  else if (lampAsk) said.push('street lights');
  if (peopleAsk && (!road || peopleAsk.standing)) { items.push({ tile: 'crowd', type: 'crowd', x: anchor.x, z: anchor.z, rot: 0, params: { count: Math.min(60, peopleAsk.count), radius: 12, walk: !peopleAsk.standing } }); said.push(plural(peopleAsk.count, 'person', 'people')); }
  else if (peopleAsk) said.push(`${plural(Math.min(40, peopleAsk.count), 'person', 'people')} on the footpaths`);

  // ends and behind
  const end = anchor.x + L / 2;
  const park = has('park');
  if (park) { const radius = 28; items.push({ tile: 'park', type: 'park', x: end + radius + 12, z: anchor.z, rot: 0, params: { radius, trees: 20, people: 10, path: true } }); said.push('a park'); }
  const water = has('water');
  if (water) {
    const river = /river|canal|stream/.test(water.word), back = anchor.z - (depthOf(sides[1]) + edge + (river ? 34 : 30));
    items.push(river ? { tile: 'river', type: 'water', x: anchor.x, z: back, rot: 0, params: { length: L + 80, width: 34, banks: true } }
      : { tile: 'pond', type: 'water', x: anchor.x - L / 2 - 36, z: anchor.z, rot: 0, params: { length: 44, width: 26, banks: true } });
    said.push(river ? 'a river' : 'a pond');
  }
  const lawn = has('lawn');
  if (lawn) { const plaza = /plaza|square/.test(lawn.word); items.push({ tile: plaza ? 'plaza' : 'lawn', type: 'lawn', x: anchor.x - L / 2 - 26, z: anchor.z + (water && !/river/.test(water.word) ? 50 : 0), rot: 0, params: { width: 34, depth: 30, surface: plaza ? 'pavers' : 'grass' } }); said.push(plaza ? 'a plaza' : 'a lawn'); }
  const cp = has('carPark');
  if (cp) { items.push({ tile: 'car-park', type: 'carPark', x: anchor.x, z: anchor.z + depthOf(sides[0]) + edge + 22, rot: 0, params: { bays: 24, fill: 70 } }); said.push('a car park'); }

  return { items, summary: items.length ? `Added ${said.join(', ')}.` : '' };
}
