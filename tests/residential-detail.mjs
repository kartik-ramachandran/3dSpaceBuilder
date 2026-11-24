import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';
import { PRESETS } from '../src/spec/schema.js';
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route('**/api/health', r => r.fulfill({ json: { claude: false } }));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `node_modules/three/${new URL(r.request().url()).pathname.split('/three@0.160.0/')[1]}`, contentType: 'text/javascript' }));
  const source = await readFile('src/main.js', 'utf8');
  await page.route('**/src/main.js', r => r.fulfill({ contentType: 'text/javascript', body: source + `
    window.detailProbe = {
      inspect() { const towers = [], walkers = []; world.group.traverse(o => { if(o.userData.storeys) towers.push(o.userData.storeys); if(o.name === 'Footpath pedestrian') walkers.push(o); });
        world.update(0, 0); const before = walkers[0].position.clone(); world.update(0.016, 1);
        return { towers, walkers: walkers.length, moved: before.distanceTo(walkers[0].position), height: world.fitBox.max.y, calls: renderer.info.render.calls, units: world.zones.size };
      },
      selectTop() {
        const z = spec.zones.find(z => z.tower && z.floor === 100);
        const zo = world.zones.get(z.id);
        world.group.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster(zo.anchor.clone().add(new THREE.Vector3(0, 0, 5)), new THREE.Vector3(0, 0, -1));
        const hit = raycaster.intersectObjects(zo.hits, false)[0];
        selectZone(z.id);
        return { id: z.id, hit: hit?.object.userData.zone };
      },
      street() { camera.position.set(100, 28, 95); controls.target.set(0, 45, 0); controls.update(); }
    };` }));
  await page.addInitScript(sp => localStorage.setItem('p2s:last', JSON.stringify(sp)), PRESETS.development);
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`);
  await page.waitForFunction(() => window.detailProbe, null, { timeout: 60000 });
  const state = await page.evaluate(() => detailProbe.inspect());
  assert.equal(state.units, 1296);
  assert.deepEqual(state.towers, [100,100,100]); assert.equal(state.walkers,36); assert(state.moved > 0.5); assert(state.height > 320);
  const picked = await page.evaluate(() => detailProbe.selectTop());
  assert.equal(picked.hit, picked.id);
  assert.match(await page.locator('#vpUnit').innerText(), /dummy valuation/);
  assert.match(await page.locator('#valLede').innerText(), /1296 apartments across 9 buildings/);
  await page.screenshot({ path: 'docs/residential-overview.png' });
  await page.evaluate(() => detailProbe.street());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'docs/residential-street.png' });
  assert.deepEqual(errors, []);
  console.log('ok: residential scene, 100-storey towers, walking motion and shaders', state);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

