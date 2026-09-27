// @ts-check
/**
 * The globe lab's smoke helpers, shared by `globe.smoke.spec.mjs` and
 * `globe-sky.smoke.spec.mjs` (moved here unchanged from the first when the
 * second arrived, round-3 plan 2026-09-27-0532 §4 F). Not a spec: the
 * Playwright config matches `*.smoke.spec.mjs` only.
 */

/**
 * Waits until the page has arrived at `target` and its tiles have settled.
 * A new view loads every committed level under SwiftShader: 30-50 s
 * measured, so 60 s timed out once on a loaded machine.
 */
export async function arriveAt(page, target) {
  const started = Date.now();
  // Children of a just-parsed tile are queued only at the next update, so
  // one poll can see "nothing pending" between two levels: the tile count
  // must hold still for a second.
  await page.waitForFunction(
    ({ lat, lng }) => {
      const s = window.__globeLab.state();
      const settled =
        s.phase === "arrived" &&
        s.target?.lat === lat &&
        s.target?.lng === lng &&
        s.pendingTiles === 0 &&
        s.mapsLoaded === s.mapsTotal &&
        s.centreLatLon !== null;
      const w = window;
      const key = `${lat},${lng},${s.loadedTiles}`;
      if (!settled || w.__settleKey !== key) {
        w.__settleKey = key;
        w.__settleSince = performance.now();
        return false;
      }
      return performance.now() - w.__settleSince >= 1000;
    },
    target,
    { timeout: 120_000, polling: 100 },
  );
  // The settle time per view: a slow creep shows here long before 120 s.
  console.log(
    `settled at ${target.lat},${target.lng} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  return page.evaluate(() => window.__globeLab.state());
}

/**
 * Sets the hash and waits until the page has applied it: a new target or
 * timing restarts the intro, anything else (the time, the tuning) applies
 * live, and either way `appliedHash` says when.
 */
export async function applyHash(page, hash) {
  await page.evaluate((h) => {
    if (location.hash.slice(1) !== h) location.hash = h;
  }, hash);
  await page.waitForFunction(
    (h) => window.__globeLab.state().appliedHash === h,
    hash,
  );
}

/** Rec. 709 luminance of an 8-bit RGBA pixel. */
export const luminance = (px) =>
  0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
export const meanOf = (values) =>
  values.reduce((a, b) => a + b, 0) / values.length;
export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
/** An n x n grid of normalised canvas points, `half` either side of `c`. */
export const gridAround = (c, half, n) => {
  const points = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      points.push([
        c[0] - half + (2 * half * i) / (n - 1),
        c[1] - half + (2 * half * j) / (n - 1),
      ]);
    }
  }
  return points;
};
