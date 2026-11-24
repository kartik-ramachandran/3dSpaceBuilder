/*
 * Site layers for a residential development: river, local roads, motorway, flood area and solar.
 * Each layer has a place on the site (shared with the 3D scene) and location effects on apartment values.
 * All figures are illustrative demo assumptions, not valuation methodology. Plain numbers, no Three.js.
 */
import { DEV } from './site-layout.js';

export const LAYER_TYPES = [
  { id: 'river', name: 'River', color: '#4fa3c7', blurb: 'Views of the water from the front row and upper floors' },
  { id: 'roads', name: 'Local roads', color: '#c9c3b5', blurb: 'Street access; some ground-floor street noise' },
  { id: 'motorway', name: 'Motorway', color: '#f2a65a', blurb: 'Traffic noise falling off with distance' },
  { id: 'flood', name: 'Flood area', color: '#3d8bff', blurb: 'Lower floors inside the modelled flood extent' },
  { id: 'solar', name: 'Solar', color: '#ffd23f', blurb: 'Winter sun, shading by the row in front, rooftop panels' },
];
export const FLOOD_EVENTS = { 20: { label: '1-in-20 year', level: 0.75, inland: 2, ground: -0.08, first: 0 },
  100: { label: '1-in-100 year', level: 1.1, inland: 6, ground: -0.12, first: 0 },
  500: { label: '1-in-500 year', level: 1.7, inland: 14, ground: -0.16, first: -0.04 } };
// Sun elevation through a winter's day (about 9 am to 3 pm, hourly-ish), roughly Auckland at the solstice
export const WINTER_SUN_DEG = [8, 15, 21, 26, 29, 30, 29, 26, 21, 15, 8];

/** Where each feature sits, in site coordinates (see site-layout.js for the axes). */
export function siteFeatures(layout) {
  const { siteX, siteZ } = layout;
  return {
    river: { width: 20, zAt: (x) => siteZ / 2 + 44 + 5 * Math.sin(x / 38 + 0.6) },
    roads: { front: siteZ / 2 + 22, back: -siteZ / 2 - 14, side: siteX / 2 + 14, width: 7 },
    motorway: { z: -siteZ / 2 - 44, width: 26 },
    flood: { edgeAt: (x, event) => siteZ / 2 - FLOOD_EVENTS[event].inland + 6 * Math.sin(x / 22 + 2.0) },
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Location effects for one apartment. `layers` maps layer id → { on, event? } for the layers on the site;
 * a layer that is missing or switched off has no effect.
 * Returns [{ layer, label, pct }] where pct is a fraction (+0.05 = +5%).
 */
export function locationEffects(zone, layout, features, layers) {
  const on = (id) => layers[id]?.on;
  const u = layout.unitAt(zone), f = zone.floor, out = [];
  const add = (layer, label, pct) => { if (Math.abs(pct) >= 0.002) out.push({ layer, label, pct }); };
  const front = u.z + DEV.D / 2, back = u.z - DEV.D / 2;

  if (on('river')) {
    // the front row looks straight over it; rows behind only see it over the front row from the top floor
    if (u.row === 0) add('river', 'River view', Math.min(0.08, 0.03 + 0.012 * (f - 1)));
    else if (f === layout.floors && layout.floors > 1) add('river', 'River glimpse (top floor)', 0.015);
  }
  if (on('roads')) {
    add('roads', 'Street access', 0.015);
    const nearFront = u.row === 0 && features.roads.front - front < 25;
    if (f === 1 && nearFront) add('roads', 'Ground-floor street noise', -0.01);
  }
  if (on('motorway')) {
    const d = Math.max(0, back - (features.motorway.z + features.motorway.width / 2));
    add('motorway', 'Motorway noise', -0.09 * clamp01(1 - d / 110) * (1 + 0.08 * (f - 1)));
  }
  if (on('flood')) {
    const ev = FLOOD_EVENTS[layers.flood.event || 100];
    if (u.z > features.flood.edgeAt(u.x, layers.flood.event || 100)) {
      if (f === 1) add('flood', `Ground floor in ${ev.label} flood area`, ev.ground);
      else if (f === 2 && ev.first) add('flood', `First floor near ${ev.label} flood level`, ev.first);
      add('flood', 'Building in flood area (access, insurance)', -0.015);
    }
  }
  if (on('solar')) {
    const sun = winterSun(zone, layout);
    add('solar', sun.hours >= 0.99 ? 'Full winter sun' : sun.hours <= 0.01 ? 'No winter midday sun' : `Part winter sun (${Math.round(sun.hours * 100)}%)`, -0.05 + 0.09 * sun.hours);
    add('solar', 'Rooftop solar (lower power bills)', 0.012);
  }
  return out;
}

/**
 * Share of a winter day's sun reaching an apartment's north-facing windows (0..1). The front row is
 * unshaded; behind it, the row in front casts a shadow up the facade to height H − gap × tan(elevation),
 * so low morning and afternoon sun is blocked for lower floors while the midday sun gets over.
 */
export function winterSun(zone, layout) {
  const u = layout.unitAt(zone);
  if (u.row === 0) return { hours: 1 };
  const gap = DEV.GAP_Z;                                     // distance to the back face of the row in front
  const sill = DEV.BASE + (zone.floor - 1) * DEV.FH + 0.9, head = sill + 1.4;
  const lit = WINTER_SUN_DEG.map((deg) => {
    const shadowTop = layout.H - gap * Math.tan(deg * Math.PI / 180);
    return clamp01((head - shadowTop) / (head - sill));
  });
  return { hours: lit.reduce((s, v) => s + v, 0) / lit.length };
}

/**
 * Valuation data with location effects applied: same shape as buildValuations(), with each apartment's
 * valuations scaled by its location factor, plus { effects, factor, baseLatest } per apartment.
 */
export function applyLayers(base, spec, layout, layers) {
  const features = siteFeatures(layout);
  const byZone = new Map(), all = [];
  for (const z of spec.zones) {
    const e = base.byZone.get(z.id);
    const effects = locationEffects(z, layout, features, layers);
    const factor = effects.reduce((m, x) => m * (1 + x.pct), 1);
    const valuations = e.valuations.map((v) => ({ ...v, rate: Math.round(v.rate * factor / 10) * 10, value: Math.round(v.value * factor / 1000) * 1000 }));
    all.push(...valuations);
    byZone.set(z.id, { ...e, valuations, latest: valuations[valuations.length - 1] || null, baseLatest: e.latest, effects, factor });
  }
  const rates = [...byZone.values()].filter((e) => e.latest).map((e) => e.latest.rate);
  return { byZone, all, valuedCount: rates.length, min: rates.length ? Math.min(...rates) : 0, max: rates.length ? Math.max(...rates) : 1 };
}

/** Per layer: how many apartments it touches and the range of its effect, for the layer list. */
export function layerSummary(data, layerId) {
  const totals = [];
  for (const e of data.byZone.values()) {
    const sum = e.effects.filter((x) => x.layer === layerId).reduce((s, x) => s + x.pct, 0);
    if (sum) totals.push(sum);
  }
  return { count: totals.length, min: totals.length ? Math.min(...totals) : 0, max: totals.length ? Math.max(...totals) : 0 };
}
