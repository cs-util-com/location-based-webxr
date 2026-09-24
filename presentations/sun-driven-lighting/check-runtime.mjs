// Browser/runtime checks; use --existing to check an already running launcher.
import { chromium } from '../../GpsPlusSlamJs_RecorderApp/node_modules/@playwright/test/index.mjs';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { demos, presentationPort, localUrl } from './runtime-config.mjs';
const existing = process.argv.includes('--existing');
let launcher, browser;
const report = { demos: [], presentation: localUrl(presentationPort) };
try {
  if (!existing) {
    launcher = fork(new URL('./launch.mjs', import.meta.url), [], { stdio: ['ignore','inherit','inherit','ipc'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Launcher timed out')), 900000);
      launcher.once('message', message => { clearTimeout(timer); message === 'ready' ? resolve() : reject(Error(String(message))); });
      launcher.once('exit', code => { clearTimeout(timer); reject(Error(`Launcher exited ${code}`)); });
    });
  }
  const conflict = fork(new URL('./launch.mjs', import.meta.url), [], { silent: true });
  let conflictOutput = '';
  conflict.stderr.on('data', data => { conflictOutput += data; });
  const [conflictCode] = await once(conflict, 'exit');
  assert.equal(conflictCode, 1);
  assert.match(conflictOutput, /Port 5193 unavailable/);
  report.portConflictFailsClearly = true;
  browser = await chromium.launch({ channel: process.env.DECK_BROWSER_CHANNEL || 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  context.on('page', popup => popup.on('pageerror', error => errors.push(error.message)));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(localUrl(presentationPort));
  await page.waitForFunction(() => window.Reveal?.isReady());
  const transition = await page.evaluate(() => ({type:Reveal.getConfig().transition,speed:Reveal.getConfig().transitionSpeed}));
  assert.deepEqual(transition, {type:'fade',speed:'default'});
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);
  const fade = await page.evaluate(() => { const style=getComputedStyle(Reveal.getCurrentSlide()); return {duration:style.transitionDuration,property:style.transitionProperty}; });
  assert.ok(fade.duration.split(',').some(value => parseFloat(value)>=0.45 && parseFloat(value)<=0.5));
  assert.equal(fade.property, "opacity");
  await page.waitForFunction(() => Number(getComputedStyle(Reveal.getCurrentSlide()).opacity) === 1);
  report.fade = fade;
  await page.keyboard.press('f');
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  report.fullscreen = true;
  const notesPromise = page.waitForEvent('popup');
  await page.keyboard.press('s');
  const notes = await notesPromise;
  await notes.waitForLoadState();
  await notes.waitForFunction(() => !!document.querySelector('#speaker-controls'));
  await notes.close();
  report.speakerNotes = true;
  for (const demo of demos) {
    const link = page.locator(`[data-demo="${demo.id}"]`);
    const slideIndex = await link.evaluate(element => [...document.querySelectorAll('.slides > section')].indexOf(element.closest('section')));
    await page.evaluate(index => Reveal.slide(index), slideIndex);
    await page.waitForTimeout(550);
    assert.equal(await link.getAttribute('href'), localUrl(demo.port));
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForURL(localUrl(demo.port));
    await popup.waitForLoadState();
    assert.equal(new URL(popup.url()).port, String(demo.port));
    assert.ok((await popup.title()).includes(demo.title), `${demo.id}: unexpected title ${await popup.title()}`);
    if (demo.id === 'sun-position') await popup.waitForFunction(() => document.querySelector('#vector-length')?.textContent.length > 0);
    else if (demo.id === 'adapter') { await popup.locator('#apply-pair').click(); await popup.locator('#result').waitFor({ state:'visible' }); }
    else await popup.locator('canvas').waitFor({state:'visible'});
    await popup.waitForTimeout(400);
    assert.equal(await popup.evaluate(() => window.opener === null), true);
    await popup.close(); await page.bringToFront();
    assert.equal(await page.evaluate(() => Reveal.getIndices().h), slideIndex);
    report.demos.push({name:demo.label,url:localUrl(demo.port),opensAndReturns:true});
  }
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
} catch (error) {
  console.error("Runtime verification failed:", error);
  throw error;
} finally {
  await browser?.close();
  if (launcher && launcher.exitCode === null) {
    const exited = once(launcher, 'exit'); launcher.send('stop');
    const [code] = await exited;
    assert.equal(code, 0, 'Launcher cleanup must succeed');
    for (const port of [presentationPort,...demos.map(d=>d.port)]) {
      const probe=createServer(); await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
    }
    report.shutdownReleasesAllPorts = true;
  }
}
await writeFile(new URL('./assets/runtime-verification.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
