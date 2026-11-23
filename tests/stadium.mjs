import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';
import { normalize, PRESETS } from '../src/spec/schema.js';
import { offlineSpec } from '../src/spec/offline-parser.js';

for (const [prompt, sport, capacity] of [
  ['Cricket stadium with 20,000 seats, 2 tiers', 'cricket', 20000],
  ['City football stadium with 30000 seats', 'football', 30000],
  ['Soccer stadium with 100000 spectators', 'football', 100000],
  ['Rugby stadium with 18000 seats and no roof', 'rugby', 18000],
]) {
  const spec = normalize(offlineSpec(prompt));
  assert.equal(spec.kind, 'stadium'); assert.equal(spec.shell.sport, sport);
  assert.equal(spec.zones.reduce((n, z) => n + z.capacity, 0), capacity);
  assert(spec.zones.every((z) => z.priceUnit === '/match'));
}
assert.equal(normalize({ kind: 'stadium', shell: { sport: 'soccer', tiers: 99, roof: false } }).shell.sport, 'football');
assert.equal(normalize({ kind: 'stadium', shell: { tiers: 99 } }).shell.tiers, 3);
console.log('ok: stadium prompt routing, capacity, sport aliases, validation');

const server = await startServer(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(String(e)); console.error(e); });
  page.on('console', (m) => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route('**/api/health', (route) => route.fulfill({ json: { claude: false, references: true } }));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => route.fulfill({ path: `node_modules/three/${new URL(route.request().url()).pathname.split('/three@0.160.0/')[1]}`, contentType: 'text/javascript' }));
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  await page.route('**/src/main.js', (route) => route.fulfill({ contentType: 'text/javascript', body: source + `
    window.stadiumTest = () => {
      const meshes = []; let invalid = false;
      world.group.traverse(o => { if (o.isMesh) { meshes.push(o.name); const p=o.geometry.getAttribute('position'); for(let i=0;i<p.array.length;i++) if(!Number.isFinite(p.array[i])) invalid=true; } });
      return { sport: world.sport, zones: world.zones.size, invalid, meshes, rotating: controls.autoRotate, mode,
        eyes: [...world.zones.values()].map(z => ({ eye: z.seats[0].pos.toArray(), look: z.look.toArray() })) };
    };` }));
  await page.addInitScript((spec) => localStorage.setItem('p2s:last', JSON.stringify(spec)), PRESETS.stadium);
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.stadiumTest && document.querySelectorAll('.zbtn').length === 4, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  for (const [sport, button, landmark] of [
    ['cricket', 'Cricket stadium', 'Cricket wickets'],
    ['football', 'Football stadium', 'Football goals'],
    ['rugby', 'Rugby stadium', 'Rugby goalposts'],
  ]) {
    await page.selectOption('#examples', { label: button });
    await page.waitForFunction((sport) => window.stadiumTest().sport === sport, sport);
    const info = await page.evaluate(() => stadiumTest());
    assert.equal(info.zones, 4); assert.equal(info.invalid, false); assert.equal(info.rotating, false);
    assert(info.meshes.includes(landmark)); assert(info.meshes.includes(`${sport} field`));
    assert(info.eyes.every(({eye,look}) => eye.every(Number.isFinite) && look[0]*eye[0] + look[2]*eye[2] < 0), 'seat views point toward the field');
    assert.equal(await page.textContent('#kindLabel'), 'Stadium');
    assert.equal(await page.textContent('#zonesTitle'), 'Stands & tickets');
    await page.click('.zbtn[data-zone="east-grandstand"]');
    assert.equal(await page.textContent('#flyBtn'), 'View from this stand');
    await page.click('#flyBtn');
    await page.waitForFunction(() => stadiumTest().mode === 'view');
    assert((await page.textContent('#viewTitle')).includes('East Grandstand'));
    assert.equal(await page.locator('#view .frame').evaluate((el) => getComputedStyle(el).display), 'none', 'stadium view has no window frame');
    await page.click('#upgradeBtn'); await page.waitForFunction(() => document.querySelector('#viewTitle').textContent.includes('West Club'));
    await page.click('#backBtn'); await page.waitForFunction(() => stadiumTest().mode === 'overview');
    console.log(`ok: ${sport} scene, landmarks, seating, ticket selection, seat view and upgrade`);
  }
  await page.click('#glassBtn'); assert.equal(await page.getAttribute('#glassBtn', 'aria-pressed'), 'false');
  await page.fill('#prompt', 'Cricket stadium with 1 tier and no roof'); await page.click('#buildBtn');
  await page.waitForFunction(() => document.querySelector('#glassBtn').disabled);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption('#examples', { label: 'Football stadium' });
  await page.waitForFunction(() => stadiumTest().sport === 'football');
  assert.equal(await page.locator('.zbtn').count(), 4);
  assert.deepEqual(errors, []);
  console.log('Stadium checks passed, including roof toggle, uncovered stadium and the mobile examples dropdown.');
  if (process.env.SCREENSHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.click('#resetBtn'); await page.waitForTimeout(2000);
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/stadium-football.png', timeout: 60000 });
  }
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
