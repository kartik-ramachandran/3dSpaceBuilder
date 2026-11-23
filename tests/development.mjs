// Residential developments: every apartment is its own zone with its own value.
import assert from 'node:assert/strict';
import { normalize } from '../src/spec/schema.js';
import { offlineSpec } from '../src/spec/offline-parser.js';

const dev = normalize(offlineSpec('Residential development with 6 apartment buildings in 2 rows, 4 floors, 4 apartments per floor, base price NZD 650,000'));
assert.equal(dev.kind, 'development');
assert.deepEqual([dev.shell.buildings, dev.shell.rows, dev.shell.floors, dev.shell.unitsPerFloor, dev.shell.basePrice], [6, 2, 4, 4, 650000]);
assert.equal(dev.zones.length, 6 * 4 * 4, 'one zone per apartment');
assert.equal(new Set(dev.zones.map((z) => z.id)).size, dev.zones.length, 'apartment ids are unique');
assert.ok(dev.zones.every((z) => Number.isInteger(z.price) && z.price > 0), 'every apartment has its own value');
assert.ok(dev.zones.every((z) => z.valueSource === 'illustrative' && z.priceUnit === 'example value'), 'generated values are labelled as examples');
assert.equal(dev.zones[0].name, 'A · 101'); assert.equal(dev.zones[0].price, 650000);
const at = (b, f, u) => dev.zones.find((z) => z.building === b && z.floor === f && z.unit === u);
assert.ok(at(1, 2, 1).price > at(1, 1, 1).price, 'higher floors are worth more');
assert.ok(at(1, 1, 2).price > at(1, 1, 1).price, 'larger 2-bed units are worth more');

// A value from the brief overrides one apartment and is labelled as provided.
const brief = normalize({ kind: 'development', shell: { buildings: 2, floors: 2, unitsPerFloor: 2, basePrice: 500000 },
  zones: [{ building: 1, floor: 2, unit: 1, price: 777000, bedrooms: 3, area: 110 }, { building: 2, floor: 1, unit: 2, area: 95 }] });
const given = brief.zones.find((z) => z.id === 'apartment-a-201');
assert.equal(given.price, 777000); assert.equal(given.valueSource, 'provided'); assert.equal(given.priceUnit, 'provided value'); assert.equal(given.bedrooms, 3);
const sizeOnly = brief.zones.find((z) => z.id === 'apartment-b-102');
assert.equal(sizeOnly.area, 95); assert.equal(sizeOnly.valueSource, 'illustrative', 'size without a price keeps an example value');

// Shell limits, and plane prompts that mention "apartments" stay planes.
const clamped = normalize({ kind: 'development', shell: { buildings: 99, rows: 99, floors: 0, unitsPerFloor: 1 } });
assert.deepEqual([clamped.shell.buildings, clamped.shell.rows, clamped.shell.floors, clamped.shell.unitsPerFloor], [8, 4, 1, 2]);
assert.equal(normalize(offlineSpec('A long-haul jet with first apartments')).kind, 'plane');
console.log('ok: development spec — one value per apartment, provided overrides, limits, routing');
