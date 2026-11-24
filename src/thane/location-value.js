/*
 * Location factors for each flat from the real surroundings (OpenStreetMap water and roads).
 * The percentages are illustrative demo assumptions applied to dummy values, not a valuation method.
 */
import { DEV } from '../spec/site-layout.js';
import { distanceToLines, distanceToWater } from './real-context.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ARTERIAL = { motorway: 1, trunk: 1, primary: 1 };

/** Returns Map(zoneId → { effects: [{ label, pct }], factor }) */
export function locationFactors(zones, layout, ctx) {
  const views = ctx.water.filter((w) => w.cls === 'river' || w.cls === 'lake' || w.cls === 'reservoir');
  const channels = ctx.water.filter((w) => w.cls === 'river');
  const arterials = ctx.roads.filter((r) => ARTERIAL[r.cls]);
  const streets = ctx.roads.filter((r) => !ARTERIAL[r.cls]);
  const cache = new Map(), out = new Map();
  for (const z of zones) {
    const u = layout.unitAt(z);
    const k = `${Math.round(u.x)},${Math.round(u.z)}`;
    if (!cache.has(k)) {
      const near = (list) => { let best = Infinity, which = null; for (const r of list) { const d = distanceToLines(u, [r.pts]); if (d < best) { best = d; which = r; } } return { d: best, road: which }; };
      cache.set(k, { water: distanceToWater(u, views), channel: distanceToWater(u, channels), arterial: near(arterials), street: near(streets).d });
    }
    const d = cache.get(k), h = DEV.BASE + (z.floor - 1) * DEV.FH, effects = [];
    const add = (label, pct) => { if (Math.abs(pct) >= 0.002) effects.push({ label, pct }); };
    // Views of water: close by from any floor, further away only above the surrounding rooftops (~20 m)
    if (d.water < 900) add(`Water view · ${Math.round(d.water)} m to the ${d.water === d.channel ? 'river channel' : 'lake'}`, 0.07 * clamp01(1 - d.water / 900) * (h > 20 ? 1 : d.water < 150 ? 0.5 : 0));
    // Low floors near a river channel carry monsoon flooding risk
    if (z.floor <= 2 && d.channel < 200) add('Near river channel: monsoon flood risk', -0.1 * clamp01(1 - d.channel / 200) * (z.floor === 1 ? 1 : 0.4));
    // Arterial roads: noise when close (worse on lower floors), access when within walking distance
    if (d.arterial.road) {
      const name = d.arterial.road.name || `${d.arterial.road.cls} road`;
      add(`Traffic noise · ${Math.round(d.arterial.d)} m to ${name}`, -0.07 * clamp01(1 - d.arterial.d / 300) * (z.floor <= 12 ? 1 : 0.6));
      if (d.arterial.d < 500) add(`Arterial road access · ${name}`, 0.02);
    }
    if (d.street < 40) add('Street frontage', 0.01);
    out.set(z.id, { effects, factor: effects.reduce((m, e) => m * (1 + e.pct), 1) });
  }
  return out;
}

/** Valuations with each flat's location factor applied; same shape as buildValuations(). */
export function applyFactors(values, factors) {
  const byZone = new Map(), all = [];
  for (const [id, e] of values.byZone) {
    const f = factors?.get(id) || { effects: [], factor: 1 };
    const valuations = e.valuations.map((v) => ({ ...v, rate: Math.round(v.rate * f.factor / 10) * 10, value: Math.round(v.value * f.factor / 1000) * 1000 }));
    all.push(...valuations);
    byZone.set(id, { ...e, valuations, latest: valuations[valuations.length - 1] || null, baseLatest: e.latest, effects: f.effects, factor: f.factor });
  }
  const rates = [...byZone.values()].filter((e) => e.latest).map((e) => e.latest.rate);
  return { byZone, all, min: Math.min(...rates), max: Math.max(...rates), valuedCount: rates.length };
}
