// @ts-check
/**
 * The globe lab's smoke helpers, shared by `globe.smoke.spec.mjs` and
 * `globe-sky.smoke.spec.mjs` (moved here unchanged from the first when the
 * second arrived, round-3 plan 2026-09-27-0532 §4 F). Not a spec: the
 * Playwright config matches `*.smoke.spec.mjs` only.
 */
import { expect } from "@playwright/test";

/**
 * Opens the lab at `hash`, waits until it is ready without an error and
 * has arrived at its target, and returns the list the page's console
 * errors collect into.
 */
export async function bootGlobe(page, hash, { phase = "arrived" } = {}) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  // A pin press starts the arrival prefetch: its city data is answered here.
  await routeCityData(page);
  await page.goto(`/labs/globe/#${hash}`);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  await page.waitForFunction(
    (want) => window.__globeLab.state().phase === want,
    phase,
    { timeout: 90_000 },
  );
  return errors;
}

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

/**
 * The look before round 4 (plan 2026-09-28-2105 DEC-GL4-1 made the owner's
 * tuned values the defaults: sun 5, night lights 0.7, disc 1°, glow 0.95,
 * stars to 7.5 at gain 4, Milky Way 0.03; round 5 added stars to 8.5 and
 * navy space 0.1). Every pixel floor in the globe
 * smokes was measured on this look, so a view that measures pixels pins it
 * rather than re-measuring against a brighter default.
 */
const PRE_ROUND4_LOOK = {
  sunIntensity: String(Math.PI),
  nightGain: "1",
  sunSize: "0.533",
  sunGlow: "1",
  starMag: "6.5",
  starGain: "1",
  milkyWay: "0.02",
  space: "0",
  // No atmosphere pass (round 4 DEC-GL4-4 turned it on by default): the
  // floors were measured on the bare surface and sky.
  atmo: "0",
};

/**
 * `hash` with every pre-round-4 look key it does not name appended. Apply
 * it to the FINAL hash: the page reads a key's first occurrence, so a key
 * appended after the pin would be ignored.
 */
export function withPreRound4Look(hash) {
  const params = new URLSearchParams(hash);
  const missing = Object.entries(PRE_ROUND4_LOOK)
    .filter(([key]) => !params.has(key))
    .map(([key, value]) => `${key}=${value}`);
  return [hash, ...missing].filter(Boolean).join("&");
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

/**
 * Whether a request is the city data the pin's arrival prefetch fetches:
 * an Overpass endpoint (OsmDemo's pool, `overpass-source.ts`) or a DEM tile
 * (Mapterhorn or the AWS Terrarium bucket).
 */
const isCityData = (url) =>
  /(^|\.)overpass-api\.de$|^overpass\.private\.coffee$|^overpass\.kumi\.systems$/.test(
    url.hostname,
  ) ||
  (url.hostname === "maps.mail.ru" && url.pathname.includes("/overpass/")) ||
  url.hostname === "tiles.mapterhorn.com" ||
  (url.hostname === "s3.amazonaws.com" &&
    url.pathname.startsWith("/elevation-tiles-prod/"));

/**
 * Answers the pin's arrival prefetch (round-5 plan 2026-10-01-0945 §3.6)
 * here, so no smoke ever sends a request to the donated Overpass servers or
 * the DEM hosts: Overpass with an empty tile, a DEM tile with a few bytes,
 * a CORS preflight with its headers (cross-origin, so the browser checks
 * them on a fulfilled response too). Everything else is left to the page.
 * `holdOverpass` keeps the Overpass answers back until `release()`, for a
 * test that needs a cold load in flight. Returns the requests seen.
 */
export async function routeCityData(page, { holdOverpass = false } = {}) {
  const seen = { overpass: 0, dem: 0 };
  let release = () => {};
  const released = holdOverpass
    ? new Promise((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "*",
  };
  await page.route(isCityData, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors });
    }
    const url = new URL(request.url());
    if (/overpass/.test(url.hostname + url.pathname)) {
      seen.overpass += 1;
      await released;
      return route
        .fulfill({
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
          body: JSON.stringify({ version: 0.6, elements: [] }),
        })
        .catch(() => {});
    }
    seen.dem += 1;
    return route.fulfill({
      status: 200,
      headers: { ...cors, "Content-Type": "image/png" },
      body: Buffer.from([137, 80, 78, 71]),
    });
  });
  return { seen, release: () => release() };
}
