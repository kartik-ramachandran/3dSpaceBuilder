// Regression: Tech HQ wheel input must stop before solid floors and furniture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';

const server = await startServer(5209);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => { errors.push(String(e)); console.error(e); });
  page.on('console', (m) => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route('**/api/health', (route) => route.fulfill({ json: { claude: false } }));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => route.fulfill({
    path: `node_modules/three/${new URL(route.request().url()).pathname.split('/three@0.160.0/')[1]}`, contentType: 'text/javascript',
  }));
  // Read-only camera inspection and deterministic setup exist only in this test response.
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  await page.route('**/src/main.js', (route) => route.fulfill({ contentType: 'text/javascript', body: source + `
    window.navigationTest = {
      state: () => ({ position: camera.position.toArray(), target: controls.target.toArray(),
        direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
        distance: controls.getDistance(), min: controls.minDistance, max: controls.maxDistance,
        rotating: controls.autoRotate, mode }),
      setup: (position, target) => {
        cancelCameraTween(); camera.position.fromArray(position); controls.target.fromArray(target);
        controls.autoRotate = false; controls.enableDamping = false; controls.update();
        camera.clearViewOffset(); camera.updateProjectionMatrix(); navigation.reset(); navigation.update(0, true);
      },
      attemptMovement: (offset) => {
        const move = new THREE.Vector3(...offset);
        camera.position.add(move); controls.target.add(move); navigation.update(1 / 60, true);
      },
      attemptOrbit: (offset) => {
        camera.position.add(new THREE.Vector3(...offset)); navigation.update(1 / 60, true);
      },
      padFrames: () => { for (let i = 0; i < 30; i++) { movePad.update(1 / 60); navigation.update(1 / 60, true); } },
      idle: () => { for (let i = 0; i < 120; i++) navigation.update(1 / 60, true); },
      desk: () => {
        const mesh = world.group.getObjectByName('desk / wood');
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
        return new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld).toArray();
      },
      step: (delta, count = 100) => {
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true }));
        for (let i = 0; i < count; i++) navigation.update(1 / 60, true);
      }
    };` }));
  await page.goto('http://localhost:5209/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.navigationTest && document.querySelectorAll('.zbtn').length > 0, { timeout: 45000 });
  await page.selectOption('#examples', { label: 'Tech HQ' });
  await page.waitForFunction(() => document.querySelector('#spaceName').textContent === 'Northgate Tech Park');
  await page.waitForTimeout(2400);
  const state = () => page.evaluate(() => navigationTest.state());
  const difference = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  await page.evaluate(() => navigationTest.setup([80, 60, 90], [0, 12, 0]));
  const beforePan = await state();
  await page.mouse.move(550, 330); await page.mouse.down({ button: 'right' });
  await page.mouse.move(640, 385, { steps: 10 }); await page.mouse.up({ button: 'right' });
  const panned = await state();
  assert(difference(panned.position, beforePan.position) > 1, 'right-drag moves the camera sideways and vertically');
  assert(difference(panned.target, beforePan.target) > 1, 'right-drag moves the focus with the camera');
  assert(difference(panned.direction, beforePan.direction) < 1e-6, 'right-drag preserves the viewing angle');
  assert(Math.abs(panned.distance - beforePan.distance) < 1e-6, 'panning does not zoom');
  await page.mouse.move(550, 330); await page.mouse.down();
  await page.mouse.move(620, 385, { steps: 10 }); await page.mouse.up();
  const rotated = await state();
  assert(difference(rotated.direction, panned.direction) > 0.01, 'normal dragging rotates');
  assert(Math.abs(rotated.direction[1] - panned.direction[1]) > 0.01, 'vertical dragging changes the tilt');
  assert(difference(rotated.target, panned.target) < 1e-6, 'rotation keeps a stable focus');
  await page.keyboard.press('ArrowUp');
  const keyed = await state();
  assert(difference(keyed.position, rotated.position) > 0.1, 'arrow keys pan after focusing the canvas');
  assert(difference(keyed.direction, rotated.direction) < 1e-6, 'keyboard pan preserves the viewing angle');
  console.log('ok: normal dragging changes tilt; right-drag and keyboard pan preserve direction');
  const pad = await page.locator('#movePad').boundingBox();
  await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2); await page.mouse.down();
  await page.mouse.move(pad.x + pad.width * 0.78, pad.y + pad.height * 0.22);
  await page.evaluate(() => navigationTest.padFrames());
  const movedByPad = await state();
  assert(difference(movedByPad.position, keyed.position) > 1, 'thumbstick moves the camera diagonally');
  assert(difference(movedByPad.direction, keyed.direction) < 1e-6, 'thumbstick never spins the view');
  await page.mouse.up();
  const padReleased = await state(); await page.evaluate(() => navigationTest.padFrames());
  assert(difference((await state()).position, padReleased.position) < 1e-6, 'thumbstick stops immediately after release');
  assert.equal(await page.locator('#movePad').evaluate(el => el.classList.contains('active')), false);
  await page.locator('#movePad').focus(); await page.keyboard.down('ArrowLeft');
  await page.evaluate(() => navigationTest.padFrames()); await page.keyboard.up('ArrowLeft');
  assert(difference((await state()).position, padReleased.position) > 1, 'thumbstick supports keyboard input');
  console.log('ok: analog thumbstick movement, direction stability, release and keyboard input');
  assert.equal((await state()).rotating, false, 'new scenes do not rotate automatically');
  await page.mouse.move(600, 350); await page.mouse.down();
  await page.mouse.move(660, 375, { steps: 5 }); await page.mouse.up();
  const released = await state();
  await page.evaluate(() => navigationTest.idle());
  assert(Math.hypot(...(await state()).position.map((v, i) => v - released.position[i])) < 1e-7, 'camera stops immediately on mouse release');
  const wheelStopped = await page.evaluate(() => { navigationTest.step(-80, 1); return navigationTest.state(); });
  await page.evaluate(() => navigationTest.idle());
  assert(Math.hypot(...(await state()).position.map((v, i) => v - wheelStopped.position[i])) < 1e-7, 'scrolling does not leave zoom inertia');
  await page.mouse.move(600, 350); await page.mouse.wheel(0, -120);
  assert.equal((await state()).rotating, false, 'wheel stops automatic rotation');
  console.log('ok: Tech HQ stays still when idle, after mouse release, and after scrolling');

  // Start above a real Tech HQ desk, inside its floor, and push directly at its top.
  const desk = await page.evaluate(() => navigationTest.desk());
  const tabletop = desk[1] + 0.7725;
  await page.evaluate(({ desk }) => navigationTest.setup([desk[0], desk[1] + 2.4, desk[2] + 0.15], [desk[0], desk[1] - 2, desk[2]]), { desk });
  const approach = await page.evaluate(() => {
    const samples = [];
    for (let i = 0; i < 80; i++) { navigationTest.step(-10000, 12); samples.push(navigationTest.state()); }
    return samples;
  });
  assert(approach.every((s) => s.position.every(Number.isFinite)), 'camera stays finite');
  assert(approach.every((s) => s.position[1] > tabletop + 0.5), 'repeated large scrolls cannot cross the tabletop');
  assert(approach.at(-1).position[1] < desk[1] + 2.2, 'camera still moves close enough to inspect the desk');
  const stopped = await state();
  await page.evaluate(() => { for (let i = 0; i < 12; i++) navigationTest.step(120, 12); });
  assert((await state()).position[1] > stopped.position[1] + 0.1, 'zoom out works after reaching the surface');
  console.log('ok: large scroll bursts stop before the table; zoom-out recovers');

  // Aim at the empty central corridor: the floor itself must stop the camera.
  const floor = 0.4 + 2 * 4 + 0.175;
  await page.evaluate(({ floor }) => navigationTest.setup([0, floor + 2.7, 0], [0, floor - 2, -0.01]), { floor });
  await page.evaluate(() => { for (let i = 0; i < 100; i++) navigationTest.step(-10000, 12); });
  assert((await state()).position[1] >= floor + 0.5, 'camera cannot cross a floor');
  await page.evaluate(({ floor }) => {
    navigationTest.setup([0, floor + 2.7, 0], [0, floor - 2, -0.01]);
    navigationTest.attemptMovement([0, -12, 0]);
  }, { floor });
  assert((await state()).position[1] >= floor + 0.5, 'a single movement cannot tunnel through a floor');
  await page.evaluate(({ floor }) => navigationTest.setup([0, floor + 2.7, 0], [0, floor - 2, -0.01]), { floor });
  const beforeBlockedOrbit = await state();
  await page.evaluate(() => navigationTest.attemptOrbit([0, -12, 0]));
  const blockedOrbit = await state();
  assert(difference(blockedOrbit.target, beforeBlockedOrbit.target) < 1e-6, 'blocked rotation never shifts the focus');
  assert(difference(blockedOrbit.position, beforeBlockedOrbit.position) < 1e-6, 'blocked rotation restores the last safe camera position');
  await page.evaluate(() => { for (let i = 0; i < 150; i++) navigationTest.step(10000, 12); });
  const distant = await state();
  assert(distant.distance <= distant.max + 0.001, 'zoom out stays bounded');
  console.log('ok: floor collision stops tunnelling; maximum distance remains bounded');

  await page.click('#resetBtn'); await page.waitForTimeout(1300);
  await page.click('.zbtn[data-zone="meeting-rooms"]');
  await page.mouse.move(600, 350); await page.mouse.wheel(0, -80);
  await page.waitForTimeout(1500);
  const settled = await state();
  await page.waitForTimeout(500);
  const still = await state();
  assert(Math.hypot(...still.position.map((v, i) => v - settled.position[i])) < 0.01, 'camera settles after interrupting a floor transition');
  await page.selectOption('#examples', { label: 'Harbour hotel' });
  await page.waitForFunction(() => document.querySelector('#kindLabel').textContent === 'Hotel');
  const hotelAngle = await state();
  await page.click('#levelBtn');
  await page.waitForFunction(() => Math.abs(navigationTest.state().direction[1]) < 1e-7);
  const levelled = await state();
  assert(Math.abs(levelled.distance - hotelAngle.distance) < 1e-5, 'Level view preserves zoom');
  assert(difference(levelled.target, hotelAngle.target) < 1e-5, 'Level view keeps the hotel centred');
  await page.mouse.move(500, 350); await page.mouse.down();
  await page.mouse.move(500, 440, { steps: 10 }); await page.mouse.up();
  const tilted = await state();
  assert(Math.abs(tilted.direction[1]) > 0.05, 'normal dragging changes the hotel angle after levelling');
  await page.keyboard.down('Shift'); await page.mouse.move(500, 350); await page.mouse.down();
  await page.mouse.move(540, 370, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Shift');
  assert(difference((await state()).direction, tilted.direction) < 1e-6, 'Shift-drag remains a movement gesture');
  console.log('ok: hotel tilt can be changed by normal dragging; Level view straightens it without changing zoom');
  assert.deepEqual(errors, [], 'no browser or shader errors');
  console.log('Tech HQ navigation passed: table/floor clearance, bounded wheel bursts, zoom-out recovery, transition interruption.');
} finally { await browser.close(); server.close(); }
