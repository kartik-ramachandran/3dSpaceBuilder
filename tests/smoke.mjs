// Smoke test: opens the page in Chromium, walks the plane, hotel and office flows, checks the
// Claude prompt path with a mocked `sample` capability, fails on any page error, and writes
// screenshots to docs/screenshots/.
//
// Usage:  npm test              (dev page, src/ modules)
//         npm test -- --dist    (built single-file page in dist/)
//         OFFLINE=1 npm test    (no web fonts; for sandboxes without internet)
// First run: npx playwright install chromium   (or set CHROME_PATH to an installed Chrome)
// Three.js is served from node_modules, so the test runs without network access.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOTS = join(ROOT, 'docs/screenshots');
const PORT = Number(process.env.PORT) || 5199;
const PAGE = `http://localhost:${PORT}/${process.argv.includes('--dist') ? 'dist/' : ''}`;

const MOCK_SPEC = {
  kind: 'plane', name: 'Tasman Hopper', subtitle: 'Auckland → Queenstown · A321neo', currency: 'NZD',
  shell: { engines: 2, route: 'AKL → ZQN', livery: '#0f6b5c' },
  zones: [
    { name: 'Front Row', type: 'business', capacity: 12, layout: '2-2', price: 620, priceUnit: 'one-way', features: ['Extra legroom'] },
    { name: 'Economy', type: 'economy', capacity: 186, layout: '3-3', price: 179, priceUnit: 'one-way', features: ['23 kg bag'] },
  ],
};

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.error(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

async function openPage(browser, viewport, init) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(String(e)); console.error(e); });
  page.on('console', (message) => {
    if (message.type() === 'error' && /THREE|WebGL|shader/i.test(message.text())) {
      errors.push(message.text()); console.error(message.text());
    }
  });
  if (init) await page.addInitScript(init);
  // Serve Three.js from node_modules so the test doesn't depend on the CDN.
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => {
    const rel = new URL(route.request().url()).pathname.split('/three@0.160.0/')[1];
    route.fulfill({ path: join(ROOT, 'node_modules/three', rel), contentType: 'text/javascript' });
  });
  // OFFLINE=1: skip Google Fonts (screenshots otherwise wait for them) and use fallback faces.
  if (process.env.OFFLINE) await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.zbtn', { timeout: 60000 });
  return { page, errors, close: () => ctx.close() };
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

await mkdir(SHOTS, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

try {
  // Desktop: plane preset, zone card, window view, upgrade, back
  {
    const { page, errors, close } = await openPage(browser, { width: 1440, height: 900 });
    await page.waitForTimeout(4500);
    check((await page.textContent('#spaceName')) === 'Long-haul Jet', 'plane preset loads');
    await shot(page, 'plane-overview');
    await page.click('.zbtn[data-zone="business-studio"]');
    await page.waitForTimeout(1000);
    check(await page.isVisible('#zoneCard'), 'zone card opens');
    await page.click('#flyBtn');
    await page.waitForTimeout(3200);
    check((await page.textContent('#viewTitle')).startsWith('Seat'), 'window view shows a seat');
    await shot(page, 'plane-window-view');
    await page.click('#upgradeBtn');
    await page.waitForTimeout(2600);
    check((await page.textContent('#viewSub')).includes('First Apartment'), 'upgrade flies to First');
    await page.click('#backBtn');
    await page.waitForTimeout(2300);

    for (const [kind, prompt] of [
      ['hotel', 'Boutique harbour hotel on Auckland waterfront, 14 floors, rooftop pool and helipad, suites near the top and a penthouse'],
      ['office', 'Waterfront co-working building in Auckland, 4 levels, hot desks, dedicated desks, private offices, meeting rooms, cafe and event space'],
    ]) {
      await page.fill('#prompt', prompt);
      await page.click('#buildBtn');
      await page.waitForTimeout(4200);
      check((await page.textContent('#kindLabel')).toLowerCase() === kind, `offline parser builds a ${kind}`);
      await shot(page, `${kind}-overview`);
      await page.click('#zoneList li:nth-child(2) .zbtn');
      await page.waitForTimeout(800);
      await page.click('#flyBtn');
      await page.waitForTimeout(3200);
      await shot(page, `${kind}-window-view`);
      await page.click('#backBtn');
      await page.waitForTimeout(2200);
    }
    check(errors.length === 0, `no page errors on desktop flow ${errors.join(' | ')}`);
    await close();
  }

  // Claude path with a mocked `sample` capability
  {
    const init = `window.claude = { use: async (n) => { if (n !== 'sample') return null;
      const f = async () => ({ text: '', truncated: false });
      f.json = async (prompt) => { window.__prompt = prompt; await new Promise((r) => setTimeout(r, 400)); return ${JSON.stringify(MOCK_SPEC)}; };
      return f; } };`;
    const { page, errors, close } = await openPage(browser, { width: 1280, height: 800 }, init);
    await page.waitForTimeout(2000);
    await page.fill('#prompt', 'Regional jet to Queenstown');
    await page.click('#buildBtn');
    await page.waitForTimeout(3500);
    check((await page.textContent('#spaceName')) === 'Tasman Hopper', 'Claude reply is rendered');
    check((await page.textContent('#statusText')).includes('by Claude'), 'status credits Claude');
    check((await page.evaluate('window.__prompt')).includes('Regional jet to Queenstown'), 'prompt is sent to Claude');
    await shot(page, 'claude-mocked-plane');
    check(errors.length === 0, `no page errors on Claude path ${errors.join(' | ')}`);
    await close();
  }

  // Phone: plane overview and zone card
  {
    const { page, errors, close } = await openPage(browser, { width: 390, height: 844 });
    await page.waitForTimeout(4500);
    await shot(page, 'phone-plane');
    await page.click('#zoneList li:nth-child(3) .zbtn');
    await page.waitForTimeout(1000);
    await shot(page, 'phone-zone-card');
    check(errors.length === 0, `no page errors on phone ${errors.join(' | ')}`);
    await close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
