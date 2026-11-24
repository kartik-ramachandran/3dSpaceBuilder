// Site layers (river, roads, motorway, flood, solar) and their location effects on apartment values.
import assert from 'node:assert/strict';
import { normalize } from '../src/spec/schema.js';
import { buildValuations } from '../src/spec/valuations.js';
import { developmentLayout } from '../src/spec/site-layout.js';
import { siteFeatures, locationEffects, winterSun, applyLayers, layerSummary } from '../src/spec/site-layers.js';

const sp = normalize({ kind: 'development', shell: { buildings: 6, rows: 2, floors: 4, unitsPerFloor: 4, basePrice: 650000 } });
const L = developmentLayout(sp.shell), F = siteFeatures(L);
const at = (b, f, u) => sp.zones.find((z) => z.building === b && z.floor === f && z.unit === u);
const ALL = { river: { on: true }, roads: { on: true }, motorway: { on: true }, flood: { on: true, event: 100 }, solar: { on: true } };
const eff = (z, layers, layer) => locationEffects(z, L, F, layers).filter((e) => !layer || e.layer === layer);
const sum = (es) => es.reduce((s, e) => s + e.pct, 0);

// Layers that are off, or removed, have no effect.
assert.equal(eff(at(1, 1, 1), {}).length, 0, 'no layers, no effects');
assert.equal(eff(at(1, 1, 1), { ...ALL, river: { on: false }, roads: { on: false }, motorway: { on: false }, flood: { on: false, event: 100 }, solar: { on: false } }).length, 0, 'all layers off, no effects');

// River: the front row gets a view that improves with height; back rows only a top-floor glimpse.
assert.ok(sum(eff(at(1, 3, 2), ALL, 'river')) > sum(eff(at(1, 1, 2), ALL, 'river')) && sum(eff(at(1, 1, 2), ALL, 'river')) > 0, 'river view rises with floor');
assert.equal(eff(at(4, 2, 2), ALL, 'river').length, 0, 'back row, lower floors: no river view');
assert.ok(sum(eff(at(4, 4, 2), ALL, 'river')) > 0, 'back row top floor: a glimpse');

// Motorway noise is worse closer to it (back row) and higher up.
assert.ok(sum(eff(at(4, 1, 1), ALL, 'motorway')) < sum(eff(at(1, 1, 1), ALL, 'motorway')), 'back row is noisier than the front row');
assert.ok(sum(eff(at(4, 4, 1), ALL, 'motorway')) < sum(eff(at(4, 1, 1), ALL, 'motorway')), 'upper floors hear more of it');

// Flood: larger events reach more ground-floor apartments; only lower floors are discounted.
const inFlood = (event) => sp.zones.filter((z) => z.floor === 1 && eff(z, { flood: { on: true, event } }).length).length;
assert.ok(inFlood(20) < inFlood(100) && inFlood(100) < inFlood(500), `flood extent grows with the event (${inFlood(20)}, ${inFlood(100)}, ${inFlood(500)})`);
assert.ok(sp.zones.filter((z) => z.floor >= 3).every((z) => !eff(z, { flood: { on: true, event: 500 } }).some((e) => /floor/i.test(e.label))), 'upper floors are not discounted as flooded');

// Solar: the front row has full winter sun; behind it, sun rises with the floor.
assert.equal(winterSun(at(1, 1, 1), L).hours, 1);
const hrs = [1, 2, 3, 4].map((f) => winterSun(at(4, f, 1), L).hours);
assert.ok(hrs[0] < hrs[1] && hrs[1] < hrs[2] && hrs[2] <= hrs[3], `back-row sun rises with floor (${hrs.map((h) => h.toFixed(2))})`);

// applyLayers scales each apartment's valuations by its location factor and reports per-layer summaries.
const base = buildValuations(sp), withLayers = applyLayers(base, sp, L, ALL), none = applyLayers(base, sp, L, {});
const id = sp.zones.find((z) => base.byZone.get(z.id).latest).id;
assert.equal(none.byZone.get(id).latest.rate, base.byZone.get(id).latest.rate, 'no layers leaves values unchanged');
const e = withLayers.byZone.get(id);
assert.ok(Math.abs(e.latest.rate - Math.round(base.byZone.get(id).latest.rate * e.factor / 10) * 10) <= 10, 'rate is scaled by the location factor');
assert.equal(withLayers.all.length, base.all.length);
const floodSummary = layerSummary(withLayers, 'flood');
assert.ok(floodSummary.count > 0 && floodSummary.max < 0, 'flood summary counts discounted apartments');
console.log(`ok: site layers — toggles, river view, motorway noise, flood extents ${inFlood(20)}/${inFlood(100)}/${inFlood(500)}, winter sun, applied values`);
