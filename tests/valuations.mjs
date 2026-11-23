// Demo valuation data and the quarter × floor trend fit used by the development valuation panel.
import assert from 'node:assert/strict';
import { normalize } from '../src/spec/schema.js';
import { buildValuations, fitTrend, quarterLabel, QUARTERS } from '../src/spec/valuations.js';

const dev = normalize({ kind: 'development', shell: { buildings: 6, rows: 2, floors: 4, unitsPerFloor: 4, basePrice: 650000 } });
const a = buildValuations(dev), b = buildValuations(dev);
assert.deepEqual(a.all, b.all, 'the same development always gets the same demo data');
assert.equal(a.byZone.size, dev.zones.length, 'every apartment has an entry');
assert.ok(a.valuedCount > dev.zones.length * 0.5 && a.valuedCount < dev.zones.length, 'most, but not all, apartments are valued');
assert.ok(a.all.every((v) => v.q >= 0 && v.q < QUARTERS && v.rate > 0 && v.value > 0), 'valuations are in range');
for (const e of a.byZone.values()) {
  assert.ok(['H', 'M', 'L'].includes(e.confidence));
  if (e.latest) assert.equal(e.latest, e.valuations[e.valuations.length - 1], 'latest is the most recent valuation');
}
assert.ok(a.min < a.max, 'latest rates span a range');
assert.equal(quarterLabel(0), '2022 Q1'); assert.equal(quarterLabel(QUARTERS - 1), '2025 Q4');

// The fit recovers an exact quadratic and scores R² = 1.
const truth = (q, f) => 9000 + 120 * q + 300 * f + 4 * q * q - 10 * q * f + 15 * f * f;
const pts = [];
for (let q = 0; q < 16; q += 2) for (let f = 1; f <= 6; f++) pts.push({ q, floor: f, rate: truth(q, f) });
const fit = fitTrend(pts);
assert.ok(Math.abs(fit.predict(7, 3) - truth(7, 3)) < 1e-3, 'fit reproduces the surface');
assert.ok(fit.r2 > 0.999999);
assert.equal(fitTrend(pts.slice(0, 5)), null, 'too few points to fit returns null');

// On the demo data, the trend explains a fair share of the variation (rates rise with floor and time).
const demo = fitTrend(a.all);
assert.ok(demo.r2 > 0.3 && demo.r2 <= 1, `demo R² is plausible (${demo.r2.toFixed(2)})`);
assert.ok(demo.predict(14, 4) > demo.predict(1, 1), 'later, higher valuations trend up');
console.log(`ok: valuations — deterministic demo data, exact quadratic fit, demo R² ${demo.r2.toFixed(2)}`);
