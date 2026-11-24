// Location factors for Thane flats, from (synthetic) real-map water and roads.
import assert from 'node:assert/strict';
import { normalize } from '../src/spec/schema.js';
import { buildValuations } from '../src/spec/valuations.js';
import { developmentLayout } from '../src/spec/site-layout.js';
import { locationFactors, applyFactors } from '../src/thane/location-value.js';
import { distanceToWater, distanceToLines } from '../src/thane/real-context.js';

const spec = normalize({ kind: 'development', currency: 'INR', shell: { buildings: 6, rows: 2, floors: 4, unitsPerFloor: 4, basePrice: 8500000 } });
const layout = developmentLayout(spec.shell);
const square = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }, { x: x0, z: z0 }];

// geometry helpers
assert.equal(distanceToWater({ x: 0, z: 0 }, [{ rings: [square(-5, -5, 5, 5)] }]), 0, 'inside water is distance 0');
assert.equal(Math.round(distanceToWater({ x: 20, z: 0 }, [{ rings: [square(-5, -5, 5, 5)] }])), 15);
assert.equal(Math.round(distanceToLines({ x: 0, z: 10 }, [[{ x: -50, z: 0 }, { x: 50, z: 0 }]])), 10);

// A river channel 60 m north of the site, a trunk road 80 m south, a minor street along the front.
const ctx = {
  water: [{ cls: 'river', rings: [square(-300, -layout.siteZ / 2 - 80, 300, -layout.siteZ / 2 - 60)] }],
  roads: [
    { cls: 'trunk', name: 'Ghodbunder Road', pts: [{ x: -400, z: layout.siteZ / 2 + 80 }, { x: 400, z: layout.siteZ / 2 + 80 }] },
    { cls: 'minor', pts: [{ x: -200, z: layout.siteZ / 2 + 20 }, { x: 200, z: layout.siteZ / 2 + 20 }] },
  ],
};
const f = locationFactors(spec.zones, layout, ctx);
assert.equal(f.size, spec.zones.length, 'every flat gets factors');
const by = (pred) => spec.zones.filter(pred).map((z) => f.get(z.id));
const sum = (e, re) => e.effects.filter((x) => re.test(x.label)).reduce((s, x) => s + x.pct, 0);

const towerTop = by((z) => z.tower && z.floor === 100)[0], towerLow = by((z) => z.tower && z.floor === 3)[0];
assert.ok(sum(towerTop, /Water view/) > 0, 'a top-floor tower flat sees the water');
assert.ok(sum(towerTop, /Water view/) >= sum(towerLow, /Water view/), 'higher floors see more water');
assert.ok(by((z) => z.floor === 1).some((e) => sum(e, /flood/) < 0), 'some ground floors near the channel carry flood risk');
assert.ok(by((z) => z.floor >= 3).every((e) => sum(e, /flood/) === 0), 'upper floors carry no flood discount');
const noisy = by((z) => !z.tower && z.floor === 1).map((e) => sum(e, /Traffic noise/));
assert.ok(Math.min(...noisy) < 0, 'flats nearest the trunk road get a traffic-noise discount');
assert.ok(by(() => true).every((e) => e.effects.every((x) => !/Traffic noise/.test(x.label) || /Ghodbunder Road/.test(x.label))), 'noise names the real road');

// applied to the dummy values
const base = buildValuations(spec), priced = applyFactors(base, f);
const id = spec.zones.find((z) => z.tower && z.floor === 100).id;
assert.equal(priced.byZone.get(id).latest.value, Math.round(base.byZone.get(id).latest.value * f.get(id).factor / 1000) * 1000, 'value scaled by the location factor');
assert.ok(priced.byZone.size === spec.zones.length && priced.min < priced.max);
const none = applyFactors(base, null);
assert.equal(none.byZone.get(id).latest.value, base.byZone.get(id).latest.value, 'no data yet: values unchanged');
console.log(`ok: Thane location factors — water view, channel flood risk, named road noise, applied to all ${spec.zones.length} flats`);
