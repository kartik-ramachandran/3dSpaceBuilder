import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';
import { PRESETS } from '../src/spec/schema.js';

const server = await startServer(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errors = [];
  page.on('pageerror', (e) => { errors.push(String(e)); console.error(e); });
  page.on('console', (m) => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/health', (r) => r.fulfill({ json: { claude: false } }));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r) => r.fulfill({ path: `node_modules/three/${new URL(r.request().url()).pathname.split('/three@0.160.0/')[1]}`, contentType: 'text/javascript' }));
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  await page.route('**/src/main.js', (r) => r.fulfill({ contentType: 'text/javascript', body: source + `
    window.hoverProbe = {
      state: () => ({ kind: world.kind, glass, hovered, selected, seat: seatHighlight.group.visible ? seatHighlight.group.userData.instanceId : null,
        outlined: [...world.zones].filter(([id,z]) => z.hoverOutline?.visible).map(([id]) => id),
        intensity: world.zones.get(hovered)?.mats.furn.emissiveIntensity || 0 }),
      point: (id, exclude = -1) => {
        scene.updateMatrixWorld(true); camera.updateMatrixWorld();
        const zone = world.zones.get(id);
        const mesh = zone.seatMeshes?.[0] || world.group.getObjectByName(zone.z.name + ' seats');
        const m = new THREE.Matrix4();
        const step = world.kind === 'plane' ? 1 : Math.max(1, Math.floor(mesh.count / 100));
        for (let i=0; i<mesh.count; i+=step) {
          mesh.getMatrixAt(i,m);
          const p = new THREE.Vector3(0,0.8,0).applyMatrix4(m).applyMatrix4(mesh.matrixWorld).project(camera);
          const x = (p.x+1)/2*innerWidth, y=(1-p.y)/2*innerHeight;
          if(p.z>=1 || document.elementFromPoint(x,y)!==canvas) continue;
          const hit = pickDetail(x,y);
          if(hit?.zone === id && (world.kind !== 'plane' || hit.seat && hit.seat.instanceId !== exclude))
            return { x,y,id,seat:hit.seat?.instanceId,label:hit.seat?.object.userData.seatLabels?.[hit.seat.instanceId] };
        }
        return null;
      },
      shift: (x,y) => {
        camera.position.x += 100; controls.target.x += 100; controls.update(); navigation.reset();
        return pickDetail(x,y)?.zone || null;
      }
    };` }));
  await page.addInitScript((spec) => localStorage.setItem('p2s:last', JSON.stringify(spec)), PRESETS.stadium);
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.hoverProbe && hoverProbe.state().glass > 0.99, null, { timeout: 60000 });
  const state = () => page.evaluate(() => hoverProbe.state());
  const moveTo = async (point) => {
    assert(point, 'a visible hover target exists'); await page.mouse.move(point.x, point.y);
    await page.waitForFunction((id) => hoverProbe.state().hovered === id && hoverProbe.state().intensity > 0.2, point.id);
  };
  for (const id of ['east-grandstand', 'west-club-stand']) {
    await moveTo(await page.evaluate((id) => hoverProbe.point(id), id));
    assert.deepEqual((await state()).outlined, [id], 'only the hovered stadium section has an outline');
    assert(await page.locator(`.zbtn[data-zone="${id}"]`).evaluate(el => el.classList.contains('hot')));
  }
  await page.mouse.move(10, 10);
  await page.waitForFunction(() => hoverProbe.state().hovered === null);
  assert.deepEqual((await state()).outlined, []);
  await page.locator('.zbtn[data-zone="east-grandstand"]').hover();
  await page.waitForFunction(() => hoverProbe.state().outlined.includes('east-grandstand'));
  console.log('ok: stadium section tint/outline, matching list hover and cleanup');

  await page.selectOption('#examples', { label: 'Flagship jet' });
  await page.waitForFunction(() => hoverProbe.state().kind === 'plane' && hoverProbe.state().glass > 0.99);
  const first = await page.evaluate(() => hoverProbe.point('business-studio'));
  await moveTo(first); assert.equal((await state()).seat, first.seat);
  assert((await page.textContent('#tagName')).includes(first.label));
  const second = await page.evaluate((previous) => hoverProbe.point('business-studio', previous), first.seat);
  await moveTo(second); await page.waitForFunction((id) => hoverProbe.state().seat === id, second.seat);
  assert.notEqual(first.seat, second.seat, 'individual seats are distinguished inside the same cabin');
  assert((await page.textContent('#tagName')).includes(second.label));
  await page.mouse.click(second.x, second.y);
  assert.equal((await state()).selected, 'business-studio');
  await page.mouse.move(10, 10); await page.waitForFunction(() => hoverProbe.state().hovered === null);
  assert.equal((await state()).seat, null); assert.equal((await state()).selected, 'business-studio', 'leaving clears hover without clearing selection');
  await moveTo(first);
  const expected = await page.evaluate(({ x,y }) => hoverProbe.shift(x,y), first);
  await page.waitForFunction((id) => hoverProbe.state().hovered === id, expected);
  console.log('ok: individual plane seats, seat labels, selection, pointer leave and stationary-pointer camera movement');

  for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const pad = await page.locator('#movePad').boundingBox();
    assert(pad.x > size.width / 2 && pad.x + pad.width <= size.width, 'joystick stays on the right and inside the viewport');
  }
  assert.deepEqual(errors, []);
  console.log('Hover and right-side joystick checks passed.');
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
