// Actual headless Chromium interactions. Browser GPS is emulated, not outdoor evidence.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { chromium } from '../../../GpsPlusSlamJs_RecorderApp/node_modules/@playwright/test/index.mjs';
import { createServer } from '../../../GpsPlusSlamJs_SunPositionDemo/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
await mkdir(`${root}artifacts`, { recursive: true });
const server = await createServer({ root, configFile: false, cacheDir: `${root}.vite`,
  server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [repo] } } });
let browser;
const evidence = [];
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const channel = process.env.PROTOTYPE_BROWSER_CHANNEL
    ?? (existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : undefined);
  browser = await chromium.launch({ headless: true, channel });
  for (const folder of ['a-commands', 'b-configuration', 'c-snapshot']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.probe = { timers: new Set(), watches: new Set(), callbacks: 0 };
      const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
      // Count only intervals scheduled by the prototype panel, not HMR/logging.
      window.setInterval = (...args) => {
        const id = set(...args);
        if (new Error().stack?.includes('/shared/panel.ts')) window.probe.timers.add(id);
        return id;
      };
      window.clearInterval = (id) => { window.probe.timers.delete(id); clear(id); };
      // Exercise the real framework watch mapping with a controlled browser boundary.
      navigator.geolocation.watchPosition = (success) => {
        const id = 123; window.probe.watches.add(id);
        queueMicrotask(() => { window.probe.callbacks++; success({ timestamp: 1782043200000,
          coords: { latitude: 48.1, longitude: 11.5, accuracy: 8, altitude: null,
            altitudeAccuracy: null, heading: null, speed: null } }); });
        return id;
      };
      navigator.geolocation.clearWatch = (id) => window.probe.watches.delete(id);
    });
    await page.goto(`${url}/${folder}/`);
    await page.locator('#state').waitFor();
    const read = async () => JSON.parse(await page.locator('#state').innerText());
    const count = async () => Number((await page.locator('#publications').innerText()).split(': ')[1]);
    const apply = async () => { if (folder.startsWith('b')) await page.locator('#apply').click(); };
    assert.equal((await read()).status, 'waiting-for-location');
    await page.locator('#test-clock').click();
    await page.locator('#synthetic').click();
    assert.equal((await read()).sample.locationSource, 'live');
    const steps = ['Default waits; synthetic live/real becomes ready'];
    for (const [location, time] of [['fixed', 'real'], ['live', 'fixed'], ['fixed', 'fixed'], ['live', 'real']]) {
      const before = await read();
      await page.locator('#location-mode').selectOption(location);
      await page.locator('#time-mode').selectOption(time);
      if (folder.startsWith('b')) {
        assert.deepEqual(await read(), before);
        assert.match(await page.locator('#draft-status').innerText(), /Unapplied/);
      }
      await apply();
      const sample = (await read()).sample;
      assert.equal(sample.locationSource, location); assert.equal(sample.timeSource, time);
    }
    steps.push('All four modes; B drafts do not change effective state before Apply');
    await page.locator('#location-mode').selectOption('fixed'); await apply();
    const beforeBackground = await count(); await page.locator('#synthetic').click();
    assert.equal(await count(), beforeBackground);
    await page.locator('#location-mode').selectOption('live'); await apply();
    assert.equal((await read()).sample.latitudeDeg, 50.94);
    await page.locator('#latitude').fill('999'); await apply();
    assert.deepEqual(await read(), { status: 'invalid-input', reason: 'location' });
    await page.locator('#latitude').fill('0'); await apply();
    await page.locator('#instant').fill('2026-06-21T12:00:00'); await apply();
    assert.deepEqual(await read(), { status: 'invalid-input', reason: 'time' });
    assert.match(await page.locator('#input-error').innerText(), /explicit offset/);
    await page.locator('#instant').fill('2026-06-21T14:00:00+02:00'); await apply();
    assert.equal((await read()).utc, '2026-06-21T12:00:00.000Z');
    await page.locator('#slider').fill('360'); await apply();
    assert.equal((await read()).utc, '2026-06-21T06:00:00.000Z');
    const fixed = await read(); await page.locator('#advance').click();
    assert.deepEqual(await read(), fixed);
    await page.locator('#time-mode').selectOption('real'); await apply();
    assert.equal((await read()).utc, '2026-06-21T13:00:00.000Z');
    steps.push('Background cache; invalid location/time recovery; offset UTC; slider; fixed/real clock switching');
    for (const action of ['next', 'next', 'previous', 'repeat']) {
      const before = await count(); await page.locator(`#${action}`).click();
      assert.equal(await count(), before + 1);
      assert.equal((await read()).sample.locationSource, 'fixed');
      assert.equal((await read()).sample.timeSource, 'fixed');
    }
    await page.screenshot({ path: `${root}artifacts/${folder}.png`, fullPage: true });
    const beforeClear = await read(); await page.locator('#clear').click();
    assert.deepEqual(await read(), beforeClear);
    await page.locator('#location-mode').selectOption('live'); await apply();
    assert.equal((await read()).status, 'waiting-for-location');
    await page.locator('#time-mode').selectOption('real'); await apply();
    await page.locator('#gps-start').click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).status === 'ready');
    assert.equal((await read()).sample.latitudeDeg, 48.1);
    const active = await page.evaluate(() => ({ timers: window.probe.timers.size, watches: window.probe.watches.size }));
    assert.equal(active.timers, 1); assert.equal(active.watches, 1);
    await page.locator('#dispose').click();
    assert.equal((await read()).status, 'disposed');
    assert.deepEqual(await page.evaluate(() => ({ timers: window.probe.timers.size, watches: window.probe.watches.size })), { timers: 0, watches: 0 });
    await page.locator('#reset').click();
    assert.equal((await read()).status, 'waiting-for-location');
    steps.push('Atomic pair stepping; cache clear; emulated browser → real framework callback; disposal clears timer/watch; recreation');
    assert.deepEqual(errors, []);
    evidence.push({ variant: folder, passed: true, steps, pageErrors: errors });
    await page.close();
    console.log(`PASS browser ${folder}`);
  }
  await writeFile(`${root}artifacts/browser-results.json`, JSON.stringify({
    capturedAt: new Date().toISOString(), browser: await browser.version(),
    gps: 'Emulated browser geolocation; no physical device/outdoor claim', evidence,
  }, null, 2));
} finally {
  await browser?.close(); await server.close();
}
