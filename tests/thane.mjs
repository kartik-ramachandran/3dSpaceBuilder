import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';
const server=await startServer(0);
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],warnings=[];
  page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e));});
  page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE',m.text().slice(0,600));}if(m.type()==='warning'){warnings.push(m.text());console.log('WARN',m.text().slice(0,250));}});
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**',r=>r.fulfill({path:`node_modules/three/${new URL(r.request().url()).pathname.split('/three@0.160.0/')[1]}`,contentType:'text/javascript'}));
  console.log('opening'); await page.goto(`http://127.0.0.1:${server.address().port}/${process.env.THANE_PATH || 'thane.html'}`,{waitUntil:'domcontentloaded'}); console.log('opened'); await page.waitForTimeout(1500); console.log('STATE', await page.evaluate(()=>({state:window.thaneAtlas?.state,status:document.querySelector('#status').textContent,lib:!!window.maplibregl,version:window.maplibregl?.version}))); 
  await page.waitForFunction(()=>window.thaneAtlas?.state.ready,null,{timeout:45000});
  await page.waitForTimeout(3000);
  console.log('ready',await page.evaluate(()=>thaneAtlas.state));
  await page.screenshot({path:'docs/thane-city.png'});
  await page.locator('#nextStep').click();
  await page.waitForFunction(()=>thaneAtlas.state.stage==='neighbourhood'&&thaneAtlas.state.zoom>15);
  await page.waitForTimeout(2000);
  await page.screenshot({path:'docs/thane-vrindavan.png'});
  await page.locator('#nextStep').click();
  await page.waitForFunction(()=>thaneAtlas.state.stage==='development'&&thaneAtlas.state.zoom>16);
  await page.locator('#floorNumber').fill('100');await page.locator('#floorNumber').press('Tab');
  assert.match(await page.locator('#unitDetail').innerText(),/10001/);
  assert.match(await page.locator('#unitDetail').innerText(),/DUMMY VALUATION/);
  await page.locator('[data-unit="apartment-g-10002"]').click();
  assert.equal((await page.evaluate(()=>thaneAtlas.state)).selected,'apartment-g-10002');
  await page.waitForTimeout(2000);
  await page.screenshot({path:'docs/thane-residences.png'});
  const pick = await page.evaluate(() => {
    const layer=thaneAtlas.layer;
    for(const [id,z] of layer.getWorld().zones){
      if(!z.z.tower || z.z.floor % 10)continue;
      const p=layer.projectUnit(id);
      if(p.x<400||p.x>1000||p.y<180||p.y>750)continue;
      const hit=layer.pick(p);if(hit)return {id:hit,...p};
    }
  });
  assert(pick, 'a tower flat can be picked through the map projection');
  await page.mouse.click(pick.x,pick.y);
  assert.equal((await page.evaluate(()=>thaneAtlas.state)).selected,pick.id);
  await page.locator('#focusFlat').click();await page.waitForTimeout(1000);
  await page.locator('#streetView').click();await page.waitForTimeout(1500);
  assert((await page.evaluate(()=>thaneAtlas.state)).zoom>20);
  await page.screenshot({path:'docs/thane-street.png'});
  await page.locator('[data-stage="city"]').click();
  assert.equal((await page.evaluate(()=>thaneAtlas.state)).stage,'city');
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-stage="development"]').click();
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'docs/thane-mobile.png'});
  console.log('WARNINGS',warnings.slice(0,8));
  assert.deepEqual(errors,[]);
  console.log('ok: Thane -> Vrindavan -> residences, level 100 values, unit selection, city return, mobile layout');
} catch(e) {console.error('FAIL',e);throw e;} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
