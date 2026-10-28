// @ts-check
/**
 * The reference views of the globe, captured to PNG for a before/after
 * comparison of a refactor (the view-core move out of `globe-lab.js`, the
 * full-globe editor plan 2026-10-27-1850). A capture tool, not a check of a
 * look: it runs only when `GLOBE_SHOTS_DIR` names the folder the images go
 * to, and `globe-reference-shots-compare.mjs` puts two such folders side by
 * side.
 *
 *   GLOBE_SHOTS_DIR=C:/gps/shots/before pnpm run test:e2e labs/globe/globe-reference-shots.smoke.spec.mjs
 *   node labs/globe/globe-reference-shots-compare.mjs C:/gps/shots/before C:/gps/shots/after C:/gps/shots/diff
 *
 * The page is the owner's reference link with time and motion pinned: the
 * time is fixed (the clock stands, so the clouds do not drift and the stars
 * do not turn), every view is a held camera (`placeView`, which also ends
 * the approach and resets the speed dust), and every network answer is
 * local and deterministic: the height tiles are the relief's synthetic
 * surface generated in the page, Overpass answers an empty city, and the
 * OSM map is a numbered test pattern per tile. A request to any other host
 * fails the run, so a capture never depends on the network.
 *
 * A second test runs on Playwright's clock: one view with the clouds'
 * default drift (`7-drift.png`), and a per-frame trace of the intro flight
 * (`trace.json`: the camera's pose, the clouds' offset, the world frame's
 * target and the speed dust), stepped frame by frame, so state a refactor
 * changed shows even where no image would.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { routeCityFixture } from "./globe-smoke-helpers.mjs";

const OUT = process.env.GLOBE_SHOTS_DIR ?? "";

/** The owner's reference link (2026-10-28 investigation §1), as given. */
const REFERENCE_HASH =
  "at=46.948,7.4474&land=1&flight=2&osm=1&eye=1&dust=1&time=2026-10-05T11:00:00Z";

/**
 * The motion pinned for a comparison: the clouds drift on real time even
 * with the clock pinned (`time=`), so two runs of one build caught them at
 * different places (58 % of the approach view's pixels differed by more
 * than one level). A far rate of 0 holds them at their seeded place.
 */
const PINNED = "&cloudDrift=0";

const AT = { lat: 46.948, lng: 7.4474 };

/** The intro flight's frames the trace records (16 ms each). */
const TRACE_FRAMES = 240;

/**
 * Fails the run on a request to a host that is not the dev server: every
 * answer a capture depends on is a local route. Registered FIRST, so the
 * specific routes (registered after it, and so asked first) answer their
 * hosts and only what they leave falls through to it.
 */
async function refuseForeignHosts(context, foreign) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return route.fallback();
    }
    foreign.push(url.origin + url.pathname);
    return route.abort();
  });
}

/**
 * The fixed views: `altitudeKm` above the ellipsoid, or `aglM` above the
 * drawn ground under the place (read from the page after a first hold at
 * 3 km, so the street view stands on whatever surface the relief draws).
 */
const VIEWS = [
  // The whole Earth, looking straight down (pitch -89: -90 has no heading).
  { name: "1-space", altitudeKm: 20_000, headingDeg: 0, pitchDeg: -89 },
  // Space looking away from the Earth: the stars, the sky pass, the sun.
  { name: "2-space-sky", altitudeKm: 20_000, headingDeg: 180, pitchDeg: 25 },
  // The approach: the curvature, the atmosphere's rim, the cloud shadows.
  { name: "3-approach", altitudeKm: 300, headingDeg: 0, pitchDeg: -35 },
  // Above the clouds: the relief from the band, the OSM map far away.
  { name: "4-above-clouds", altitudeKm: 30, headingDeg: 20, pitchDeg: -25 },
  // Below the clouds: haze, the ground sky, the relief and the map.
  { name: "5-below-clouds", aglM: 1500, headingDeg: 200, pitchDeg: -8 },
  // Landed, at street level: the eye camera, the map underfoot, the horizon.
  { name: "6-street", aglM: 2, headingDeg: 30, pitchDeg: 2 },
];

/**
 * A 256 px OSM test pattern for tile z/x/y: a two-colour checker by the
 * tile's parity with a border and its numbers, so a tile drawn at the wrong
 * place or level shows.
 */
async function routeOsmPattern(context, page) {
  const cache = new Map();
  await context.route(
    (url) => url.hostname === "tile.openstreetmap.org",
    async (route) => {
      const [z, x, y] = new URL(route.request().url()).pathname
        .replace(/\.png$/, "")
        .split("/")
        .slice(-3)
        .map(Number);
      const key = `${z}/${x}/${y}`;
      if (!cache.has(key)) {
        const b64 = await page.evaluate(
          async ([tz, tx, ty]) => {
            const c = new OffscreenCanvas(256, 256);
            const g = c.getContext("2d");
            g.fillStyle = (tx + ty) % 2 === 0 ? "#d8c9a8" : "#a9c3d6";
            g.fillRect(0, 0, 256, 256);
            g.strokeStyle = "#5a2a2a";
            g.lineWidth = 6;
            g.strokeRect(3, 3, 250, 250);
            g.fillStyle = "#202020";
            g.font = "bold 28px sans-serif";
            g.fillText(`${tz}/${tx}/${ty}`, 16, 140);
            const bytes = new Uint8Array(
              await (
                await c.convertToBlob({ type: "image/png" })
              ).arrayBuffer(),
            );
            let s = "";
            for (const b of bytes) s += String.fromCharCode(b);
            return btoa(s);
          },
          [z, x, y],
        );
        cache.set(key, Buffer.from(b64, "base64"));
      }
      return route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "image/png",
        },
        body: cache.get(key),
      });
    },
  );
}

/**
 * Waits until the held view has stopped loading: the globe's tiles and
 * maps, the relief's queues and the OSM map's requests hold still for
 * `quietMs` (children of a parsed tile are queued only at the next update,
 * so one idle poll is not enough).
 */
async function settle(page, { timeoutMs, quietMs = 3000 }) {
  const started = Date.now();
  await page.waitForFunction(
    (quiet) => {
      const s = window.__globeLab.state();
      const idle =
        s.pendingTiles === 0 &&
        s.mapsLoaded === s.mapsTotal &&
        (!s.relief || s.relief.share <= 0 || s.relief.settled);
      const key = [
        s.loadedTiles,
        s.relief?.stats?.loaded,
        s.relief?.visibleTiles,
        s.osm?.requests,
      ].join(",");
      const w = /** @type {any} */ (window);
      if (!idle || w.__shotKey !== key) {
        w.__shotKey = key;
        w.__shotSince = performance.now();
        return false;
      }
      return performance.now() - w.__shotSince >= quiet;
    },
    quietMs,
    { timeout: timeoutMs, polling: 250 },
  );
  return (Date.now() - started) / 1000;
}

/**
 * Routes every network answer locally (a foreign host is recorded in
 * `foreign`), opens the lab at `hash`, waits for it to be ready and hides
 * everything but the drawing: the panel, the readout (it counts frames)
 * and the status lines are DOM over the canvas; the credits are read as
 * text.
 */
async function openReference(page, context, hash, foreign) {
  await refuseForeignHosts(context, foreign);
  await routeCityFixture(context, page, { version: 0.6, elements: [] });
  await routeOsmPattern(context, page);
  await page.goto(`/labs/globe/#${hash}`);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 120_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  await page.addStyleTag({
    content: "body > :not(#globe-canvas) { visibility: hidden !important; }",
  });
}

const holdView = (page, view) =>
  page.evaluate((v) => window.__globeLab.placeView(v), view);

// WHY: a refactor that must leave the globe looking exactly as before needs
// the same views rendered before and after it; this captures them with
// everything that moves on its own pinned, so a difference is the code's.
test("the reference views render and settle", async ({ page, context }) => {
  test.skip(!OUT, "set GLOBE_SHOTS_DIR to capture the reference views");
  test.setTimeout(3_600_000);
  mkdirSync(OUT, { recursive: true });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const foreign = [];
  await openReference(page, context, `${REFERENCE_HASH}${PINNED}`, foreign);
  const report = [];
  for (const v of VIEWS) {
    let altitudeKm = v.altitudeKm;
    if (altitudeKm === undefined) {
      await holdView(page, {
        ...AT,
        altitudeKm: 3,
        headingDeg: 0,
        pitchDeg: -89,
      });
      await settle(page, { timeoutMs: 900_000 });
      const groundM = await page.evaluate(
        () => window.__globeLab.state().relief?.groundUnderCameraM ?? 0,
      );
      altitudeKm = (groundM + v.aglM) / 1000;
    }
    const view = {
      ...AT,
      altitudeKm,
      headingDeg: v.headingDeg,
      pitchDeg: v.pitchDeg,
    };
    await holdView(page, view);
    const seconds = await settle(page, { timeoutMs: 900_000 });
    await page.screenshot({ path: join(OUT, `${v.name}.png`) });
    const facts = await page.evaluate(() => {
      const s = window.__globeLab.state();
      return {
        credits: document.getElementById("globe-credits")?.textContent ?? "",
        loadedTiles: s.loadedTiles,
        relief: s.relief
          ? {
              share: s.relief.share,
              visibleTiles: s.relief.visibleTiles,
              groundUnderCameraM: s.relief.groundUnderCameraM,
            }
          : null,
        osmRequests: s.osm?.requests ?? null,
        cameraNear: s.eye?.near ?? null,
      };
    });
    report.push({ ...v, view, settledInS: seconds, ...facts });
    console.log(`${v.name}: settled in ${seconds.toFixed(1)} s`);
  }
  writeFileSync(join(OUT, "views.json"), JSON.stringify(report, null, 2));
  // The routes draw their tiles in the page (the OSM pattern, the city
  // fixture's heights); a tile still in flight when the test ends would
  // fail the run after every view passed.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.unrouteAll({ behavior: "ignoreErrors" });
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

// WHY: the pinned views above hold the clouds still, so a refactor that
// broke their drift, or moved the frame's state without changing a held
// image (the intro's camera path, the world frame's target, the dust),
// would pass them. On Playwright's clock the frames are stepped 16 ms at a
// time from one paused instant, so two builds compute the same frames and
// any difference in the trace is the code's.
test("the drift view and the intro trace on Playwright's clock", async ({
  page,
  context,
}) => {
  test.skip(!OUT, "set GLOBE_SHOTS_DIR to capture the reference views");
  test.setTimeout(3_600_000);
  mkdirSync(OUT, { recursive: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const foreign = [];
  await page.clock.install({ time: Date.UTC(2026, 9, 5, 11) });
  await openReference(page, context, REFERENCE_HASH, foreign);
  const approach = VIEWS.find((v) => v.name === "3-approach");
  const view = {
    ...AT,
    altitudeKm: approach.altitudeKm,
    headingDeg: approach.headingDeg,
    pitchDeg: approach.pitchDeg,
  };
  await holdView(page, view);
  await settle(page, { timeoutMs: 900_000 });
  // From here the clock stands; only runFor moves it.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  // A changed far rate and back re-seeds the clouds at this instant (the
  // lab's hash reaction), so the drift no longer carries the loading's
  // real-time frames.
  const setHash = (hash) =>
    page.evaluate((h) => {
      location.hash = h;
    }, hash);
  await setHash(`${REFERENCE_HASH}&cloudDrift=0.5`);
  await setHash(REFERENCE_HASH);
  await holdView(page, view);
  await page.clock.runFor(5000);
  await page.screenshot({ path: join(OUT, "7-drift.png") });
  // The intro flight from this instant: another target and back restarts
  // it (and re-seeds the clouds), then every frame's state is recorded
  // right after the frame ran.
  await setHash(
    `${REFERENCE_HASH.replace("at=46.948,7.4474", "at=0,0")}&cloudDrift=0.5`,
  );
  await setHash(REFERENCE_HASH);
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__trace = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        cb(t);
        const s = w.__globeLab.state();
        w.__trace.push({
          cameraDistanceM: s.cameraDistanceM,
          cameraDirection: s.cameraDirection,
          cameraForward: s.cameraForward,
          cloudLonOffsetRad: s.cloudLonOffsetRad,
          worldFrame: s.worldFrame,
          dust: s.dust,
        });
      });
  });
  for (let i = 0; i < TRACE_FRAMES; i++) await page.clock.runFor(16);
  const trace = await page.evaluate(() => /** @type {any} */ (window).__trace);
  writeFileSync(join(OUT, "trace.json"), JSON.stringify(trace, null, 1));
  console.log(`trace: ${trace.length} frames`);
  expect(trace.length).toBeGreaterThan(TRACE_FRAMES / 2);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.unrouteAll({ behavior: "ignoreErrors" });
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});
