/*
 * Real surroundings from the loaded OpenStreetMap vector tiles: water areas (river channels, lakes,
 * ponds) and the road network, converted to the development's local metres. These drive the water,
 * the road surfaces and traffic, and the location factors on each flat's dummy value.
 *
 * Local frame (matches development-layer.js): x east, z south, y up, origin at the development anchor.
 */
const ROAD_CLASSES = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1, minor: 1, service: 1 };
const WATER_CLASSES = { river: 1, lake: 1, pond: 1, reservoir: 1, basin: 1 };

/** Converts lng/lat to local metres around `location` using the map's Mercator projection. */
export function createGeo(location, ml = window.maplibregl) {
  const origin = ml.MercatorCoordinate.fromLngLat(location, 0), s = origin.meterInMercatorCoordinateUnits();
  return {
    origin, scale: s,
    toLocal(lng, lat) { const m = ml.MercatorCoordinate.fromLngLat([lng, lat], 0); return { x: (m.x - origin.x) / s, z: (m.y - origin.y) / s }; },
    /** A MercatorCoordinate (e.g. the camera position) in local metres, including height. */
    mercatorToLocal(m) { return { x: (m.x - origin.x) / s, y: (m.z - origin.z) / s, z: (m.y - origin.y) / s }; },
  };
}

/**
 * Reads water and roads within `radius` metres from the tiles the map has loaded.
 * Vector tiles repeat features that cross tile edges, so geometry is de-duplicated.
 */
export function collectContext(map, geo, radius = 1400) {
  const seen = new Set(), water = [], roads = [];
  const near = (pts) => pts.some((p) => Math.abs(p.x) < radius && Math.abs(p.z) < radius);
  const key = (kind, pts) => `${kind}:${pts.length}:${pts[0].x.toFixed(1)},${pts[0].z.toFixed(1)}:${pts[pts.length - 1].x.toFixed(1)},${pts[pts.length - 1].z.toFixed(1)}`;
  const local = (ring) => ring.map(([lng, lat]) => geo.toLocal(lng, lat));

  for (const f of map.querySourceFeatures('city', { sourceLayer: 'water' })) {
    const cls = f.properties.class;
    if (!WATER_CLASSES[cls]) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map(local);
      if (rings[0].length < 4 || !near(rings[0])) continue;
      const k = key('w', rings[0]); if (seen.has(k)) continue; seen.add(k);
      water.push({ cls, name: f.properties.name || null, rings });
    }
  }
  for (const f of map.querySourceFeatures('city', { sourceLayer: 'transportation' })) {
    const cls = f.properties.class;
    if (!ROAD_CLASSES[cls] || f.properties.brunnel === 'tunnel') continue;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) {
      const pts = local(line);
      if (pts.length < 2 || !near(pts)) continue;
      const k = key('r', pts); if (seen.has(k)) continue; seen.add(k);
      roads.push({ cls, name: f.properties.name || null, oneway: f.properties.oneway === 1, bridge: f.properties.brunnel === 'bridge', pts });
    }
  }
  return { water, roads, signature: `${water.length}/${roads.length}` };
}

/* ---------- distances, used by the location factors ---------- */
function segDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}
export function distanceToLines(p, lines) {
  let best = Infinity;
  for (const pts of lines) for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(p, pts[i - 1], pts[i]));
  return best;
}
function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
/** Distance from a point to the nearest edge of a water area (0 if inside it). */
export function distanceToWater(p, water) {
  let best = Infinity;
  for (const w of water) { if (inside(p, w.rings[0])) return 0; best = Math.min(best, distanceToLines(p, [w.rings[0]])); }
  return best;
}
