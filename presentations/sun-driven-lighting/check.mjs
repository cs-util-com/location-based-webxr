// Authoring verification only; presenting needs no Playwright or workspace packages.
import { chromium } from '../../GpsPlusSlamJs_RecorderApp/node_modules/@playwright/test/index.mjs';
import { server } from './serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = fileURLToPath(new URL('./assets/previews/', import.meta.url));
await mkdir(output, {recursive:true});
let browser;
try {
  browser = await chromium.launch({channel:process.env.DECK_BROWSER_CHANNEL || 'msedge', headless:true});
  const errors = [], remote = [], results = [];
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith(base)) return route.continue();
    remote.push(route.request().url()); return route.abort();
  });
  await page.goto(base);
  await page.waitForFunction(() => window.Reveal?.isReady());
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(16, 25, 30)', 'Dark projector background');
  assert.equal(await page.locator('.slides > section').count(), 13);
  assert.equal(await page.locator('aside.notes').count(), 13);
  for (const [width,height] of [[1280,720],[1024,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(() => Reveal.layout());
    for (let i=0; i<13; i++) {
      await page.evaluate(i => Reveal.slide(i), i);
      await page.waitForTimeout(550);
      const overflow = await page.evaluate(() => {
        const slide = Reveal.getCurrentSlide(), box = slide.getBoundingClientRect();
        return [...slide.querySelectorAll('h1,h2,h3,p,article,figure,.ribbon,.closing,.node,.mode-grid,.validation-paths')]
          .filter(e => !e.closest('aside.notes'))
          .filter(e => { const r=e.getBoundingClientRect(); return r.bottom>box.bottom+2 || r.right>box.right+2 || r.left<box.left-2; })
          .map(e => e.textContent.trim().slice(0,70));
      });
      assert.deepEqual(overflow, [], `Overflow on slide ${i+1} at ${width}x${height}`);
      if (width===1280) await page.screenshot({path:`${output}${String(i+1).padStart(2,'0')}.png`});
    }
    results.push(`${width}x${height}: all thirteen slides fit`);
  }
  await page.evaluate(() => Reveal.slide(0));
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => Reveal.getIndices().h),1);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => Reveal.getIndices().h),0);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => Reveal.isOverview()),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => Reveal.isOverview()),false);
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('s');
  const notes = await popupPromise;
  await notes.waitForLoadState();
  await notes.waitForTimeout(700);
  assert.ok((await notes.content()).includes('speaker'), 'Speaker view loads');
  await notes.close();
  assert.deepEqual(errors,[]); assert.deepEqual(remote,[]);
  const filePage = await browser.newPage();
  await filePage.goto(new URL('./index.html',import.meta.url).href);
  await filePage.waitForFunction(() => window.Reveal?.isReady());
  assert.equal(await filePage.locator('.slides > section').count(),13);
  const report = {date:new Date().toISOString(),results,slides:13,notes:13,keyboard:true,speakerView:true,directFileOpen:true,remoteRequests:remote,pageErrors:errors};
  await writeFile(new URL('./assets/verification.json',import.meta.url), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }

