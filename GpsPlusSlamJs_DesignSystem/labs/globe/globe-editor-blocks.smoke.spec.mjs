// @ts-check
/**
 * The globe's building blocks for the 3D tour editor (tour editor plan
 * 2026-10-17-1816 §13, milestone G1), in the globe lab: what the G0 spikes
 * found missing or broken, held on the real page.
 *
 * Why this file matters: each block is unit-tested in the Globe package,
 * but the G0 spikes' failures were all ones only the page shows (a cache
 * that stalls silently, a relief that vanishes when a second overlay is
 * added, a near plane that clips the ground at eye height). Heights are
 * synthetic and every tile server is routed: nothing leaves 127.0.0.1.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&detail=0&cloudShell=0&cloudVolume=0";

/** A low oblique view over the synthetic Alps: many relief tiles wanted. */
const LOW_VIEW = "46.5,9.0,3,0,-20";

/**
 * A view looking steeply down from 3 km: few tiles, so the relief settles
 * with room in its cache however slow the tile route is (the 512 px tiles
 * are generated in the page).
 */
const DOWN_VIEW = "46.5,9.0,3,0,-70";

// WHY (G0 spikes 2026-10-17, the headline finding): with 512 px heights the
// relief cache filled and the tree stopped refining, with nothing on the
// page saying so. The page must SAY it: a cache too small for the view
// reads `stalled` in the lab's state (and the Debug panel's line), and a
// cache with room for the view does not. Swept 2026-10-18 at this view
// (256 px synthetic heights, settled): 64 MiB (the phone default) and 128
// MiB stay full and miss tiles; 256 (the desktop default) and 1024 MiB hold the
// view's whole tree in about 130 MiB. The two ends are kept here: 8 MiB,
// the lab's floor, and 256.
test("a relief cache too small for the view reads stalled; one with room does not", async ({
  context,
}) => {
  test.setTimeout(900_000);
  const results = [];
  for (const mib of [8, 256]) {
    // A page of its own per budget: a hash-only navigation does not reload
    // the lab, so the counts would carry over from the budget before.
    const page = await context.newPage();
    const errors = await bootGlobe(
      page,
      `${BASE}&reliefCacheMiB=${mib}&view=${LOW_VIEW}`,
      { phase: "user" },
    );
    // Either the stall shows, or the relief settles (the room for the
    // whole tree means parsing about 230 synthetic tiles: minutes here).
    await page.waitForFunction(
      () => {
        const r = window.__globeLab.state().relief;
        return Boolean(r?.cache && (r.cache.stalled || r.settled));
      },
      null,
      { timeout: 420_000 },
    );
    await page.evaluate(() => window.__globeLab.timeFrames(3));
    const cache = await page.evaluate(
      () => window.__globeLab.state().relief.cache,
    );
    results.push({ mib, cache, errors });
    await page.close();
  }
  console.log(
    `relief cache at ${LOW_VIEW}: ${results
      .map(
        ({ mib, cache: c }) =>
          `${mib} MiB: ${(c.usedBytes / 2 ** 20).toFixed(1)} of ${(c.maxBytes / 2 ** 20).toFixed(1)} MiB, full ${c.full}, refused ${c.refusedRequests} requests and ${c.refusedLoads} loads, stalled ${c.stalled}`,
      )
      .join("; ")}`,
  );
  const [small, roomy] = results;
  expect(small.errors).toEqual([]);
  expect(roomy.errors).toEqual([]);
  expect(small.cache.maxBytes).toBe(8 * 2 ** 20);
  expect(
    small.cache.refusedRequests + small.cache.refusedLoads,
  ).toBeGreaterThan(0);
  expect(small.cache.stalled).toBe(true);
  expect(roomy.cache.maxBytes).toBe(256 * 2 ** 20);
  expect(roomy.cache.full).toBe(false);
  expect(roomy.cache.stalled).toBe(false);
});

/** The synthetic heights' surface (`../globe-terrain/synthetic-heights.js`, seaM 0). */
const syntheticHeightM = (lat, lng) =>
  Math.max(
    0,
    1000 +
      900 *
        Math.sin((2 * Math.PI * lng) / 0.5) *
        Math.sin((2 * Math.PI * lat) / 0.4) +
      300 *
        Math.sin((2 * Math.PI * lng) / 0.07) *
        Math.cos((2 * Math.PI * lat) / 0.06),
  );

/** The zoom the fake Mapterhorn's coverage gap starts at. */
const GAP_ZOOM = 11;

/**
 * A fake of both height hosts on the CONTEXT (the page's and the city
 * worker's requests): Mapterhorn answers 512 px synthetic tiles, except a
 * coverage gap with a 404: every tile from zoom 11 on whose zoom-11
 * ancestor has x + y odd. The gap is nested, as the real coverage is (a
 * tile exists only where its parent does), and wider than the real one
 * (z13 and finer), so the check does not depend on the depth the view
 * reaches; the view's centre (46.5 N, 9 E) sits on a zoom-11 tile edge,
 * so it holds tiles of both kinds. AWS answers 256 px synthetic tiles of
 * the same surface (the city worker's heights). Returns the requests seen.
 */
async function routeHeightHosts(context, page) {
  const seen = { mapterhorn: 0, gaps: [], aws: [] };
  const cors = { "Access-Control-Allow-Origin": "*" };
  await context.route(
    (url) =>
      url.hostname === "tiles.mapterhorn.com" ||
      (url.hostname === "s3.amazonaws.com" &&
        url.pathname.startsWith("/elevation-tiles-prod/")),
    async (route) => {
      const url = new URL(route.request().url());
      const [z, x, y] = url.pathname
        .replace(/\.(png|webp)$/, "")
        .split("/")
        .slice(-3)
        .map(Number);
      const mapterhorn = url.hostname === "tiles.mapterhorn.com";
      if (mapterhorn) {
        seen.mapterhorn += 1;
        const shift = z - GAP_ZOOM;
        if (shift >= 0 && ((x >> shift) + (y >> shift)) % 2 === 1) {
          seen.gaps.push(`${z}/${x}/${y}`);
          return route.fulfill({ status: 404, headers: cors, body: "" });
        }
      } else {
        seen.aws.push(`${z}/${x}/${y}`);
      }
      const b64 = await page.evaluate(
        async ([tz, tx, ty, size, module]) => {
          const { syntheticTile } = await import(module);
          const blob = await syntheticTile(tz, tx, ty, 0, size);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = "";
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        },
        [
          z,
          x,
          y,
          mapterhorn ? 512 : 256,
          "/labs/globe-terrain/synthetic-heights.js",
        ],
      );
      return route.fulfill({
        status: 200,
        headers: { ...cors, "Content-Type": "image/png" },
        body: Buffer.from(b64, "base64"),
      });
    },
  );
  return seen;
}

// WHY (G0 spikes 2026-10-17, Q1 and "Coverage"; G1 review M2 and L1): the
// 3D editor draws Mapterhorn (512 px, national LiDAR at z13-14), which
// answers 404 outside national coverage. Without a fallback a 404 tile
// fails and the library keeps its coarser ancestor drawn over the whole
// parent, for good. On the real page, against a fake of both hosts: the
// relief must load Mapterhorn's tiles at their size, draw a missing tile
// from Mapterhorn's own nearest ancestor (no second source, so AWS is
// never asked by the relief), draw without an error, stand at the surface
// the source serves, and credit Mapterhorn and Copernicus GLO-30 with
// their links.
test("the Mapterhorn relief draws, fills a 404 from its own ancestor, and credits its sources", async ({
  page,
  context,
}) => {
  test.setTimeout(400_000);
  // The tiles are generated in the lab page itself (its own module).
  const seen = await routeHeightHosts(context, page);
  const errors = await bootGlobe(
    page,
    // No cache override and no device class (G1 re-review item 1): the
    // lab picks the device from the input (headless Chromium has a fine
    // pointer, so desktop) and the cache is that device's budget, the one
    // an app gets from `reliefTerrainOptions`.
    BASE.replace("&reliefHeights=synthetic", "") +
      `&reliefSource=mapterhorn&view=${DOWN_VIEW}`,
    { phase: "user", routeCity: false },
  );
  await page.waitForFunction(
    () => {
      const r = window.__globeLab.state().relief;
      return Boolean(r?.settled && r.fallback?.fallbacks > 0);
    },
    null,
    { timeout: 240_000 },
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const out = await page.evaluate(() => {
    const s = window.__globeLab.state();
    const live = JSON.parse(window.__globeLab.debug.exportText()).live;
    return {
      relief: s.relief,
      lat: live.lat,
      lng: live.lng,
      credits: document.getElementById("globe-credits").textContent,
      links: [...document.querySelectorAll("#globe-credits a")].map((a) =>
        a.getAttribute("href"),
      ),
    };
  });
  const expected = syntheticHeightM(out.lat, out.lng);
  const gapZooms = [...new Set(seen.gaps.map((t) => Number(t.split("/")[0])))];
  console.log(
    `Mapterhorn relief at ${DOWN_VIEW}: ${seen.mapterhorn} Mapterhorn requests, ${seen.gaps.length} answered 404 (zooms ${gapZooms.sort((a, b) => a - b).join(",")}), ${seen.aws.length} AWS requests; fallback ${JSON.stringify(out.relief.fallback)}; ${out.relief.visibleTiles} tiles visible, ${out.relief.litTiles} lit; ground under the camera ${out.relief.groundUnderCameraM?.toFixed(1)} m against the surface's ${expected.toFixed(1)} m; cache ${JSON.stringify(out.relief.cache)}`,
  );
  // The browser logs each 404 of the coverage gap itself (a failed
  // resource load); nothing else may reach the console.
  const missing = errors.filter((e) =>
    /Failed to load resource: .* 404 \(Not Found\)/.test(e),
  );
  expect(errors.filter((e) => !missing.includes(e))).toEqual([]);
  expect(missing.length).toBeLessThanOrEqual(seen.gaps.length);
  expect(out.relief.source).toBe("mapterhorn");
  expect(seen.gaps.length).toBeGreaterThan(0);
  expect(out.relief.fallback.fallbacks).toBeGreaterThan(0);
  expect(out.relief.fallback.failures).toBe(0);
  // No second source: nothing asks AWS (the city's heights come from the
  // relief's own source, G1 1d).
  expect(seen.aws).toEqual([]);
  // The walk went up: a 404 was answered above the finest zoom asked.
  expect(Math.min(...gapZooms)).toBeLessThan(Math.max(...gapZooms));
  expect(out.relief.litTiles).toBeGreaterThan(0);
  // The 300 m ripple has a 5 km wavelength: a few metres of mesh error.
  expect(Math.abs(out.relief.groundUnderCameraM - expected)).toBeLessThan(10);
  expect(out.credits).toContain("Elevation data © Mapterhorn");
  expect(out.credits).toContain("Copernicus GLO-30");
  expect(out.credits).not.toContain("Mapzen");
  expect(out.links).toContain("https://mapterhorn.com/attribution");
  // The device's own budget holds the view: desktop, Mapterhorn's 512 px
  // tiles, about 604 MiB.
  expect(out.relief.device).toBe("desktop");
  expect(out.relief.cache.maxBytes / 2 ** 20).toBeCloseTo(604, -1);
  expect(out.relief.cache.stalled).toBe(false);
});

/** An eye-height view: 1 m over the ellipsoid, under the synthetic ground, so the clearance lifts it. */
const EYE_VIEW = "46.5,9.0,0.001,0,-20";

/** A channel move larger than this many levels counts (the planes smoke's). */
const FLICKER_LEVELS = 16;

// WHY (G0 spikes 2026-10-17, Q3): the globe's camera could not go to eye
// height: the flight's 100 m clearance lifted it every frame, the
// controls stopped at 10 m / 5 m, and a near plane of 0.3 x the height
// clipped items within 12 m. In first person (`eye=1`), on the real page
// and in both depth buffers the mode allows (never logarithmic): the
// camera stands 1.7 m over the drawn ground, the ground at its feet is
// drawn (no hole in the lower two thirds) without z-fighting, the ground
// is picked where the drawn relief is, and an item half a metre away is
// drawn because the near plane follows it. The positive control: the same
// item, not registered, is clipped by the ground's near plane.
test("first person stands at eye height, draws the ground at its feet and a near item, in standard and reversed depth", async ({
  context,
}) => {
  test.setTimeout(600_000);
  const results = [];
  for (const depth of ["standard", "reversed"]) {
    const page = await context.newPage();
    const errors = await bootGlobe(
      page,
      `${BASE}&eye=1&depth=${depth}&holeColor=1&view=${EYE_VIEW}`,
      { phase: "user" },
    );
    await page.waitForFunction(
      () => {
        const r = window.__globeLab.state().relief;
        return Boolean(
          r?.settled && r.visibleTiles > 0 && r.groundUnderCameraM !== null,
        );
      },
      null,
      { timeout: 240_000 },
    );
    await page.evaluate(() => window.__globeLab.timeFrames(3));
    const out = await page.evaluate((levels) => {
      const lab = window.__globeLab;
      const s = lab.state();
      const probe = lab.planeProbe({ jitterM: 0.001, levels });
      const pick = lab.groundHitAt(0.5, 0.8);
      const red = ([r, g, b]) => r > 200 && g < 60 && b < 60;
      // The positive control first: an unregistered item 0.45 m away.
      lab.placeEyeItem(0.55, 0.1, false);

      const [clipped] = lab.readPixels([[0.5, 0.5]]);
      const nearWithout = lab.state().eye.near;
      lab.clearEyeItems();
      lab.placeEyeItem(0.55, 0.1);

      const [drawn] = lab.readPixels([[0.5, 0.5]]);
      const nearWith = lab.state().eye.near;
      lab.clearEyeItems();
      return {
        eye: s.eye,
        clearanceM: s.relief.clearanceM,
        overGroundM: s.altitudeM - s.relief.groundUnderCameraM,
        probe,
        pick,
        clipped: red(clipped),
        drawn: red(drawn),
        nearWithout,
        nearWith,
      };
    }, FLICKER_LEVELS);
    results.push({ depth, errors, out });
    await page.close();
  }
  for (const { depth, out } of results) {
    console.log(
      `first person, ${depth} depth (three gave ${out.eye.depth}): ${out.overGroundM.toFixed(2)} m over the drawn ground (clearance ${out.clearanceM} m), near ${out.probe.near.toFixed(3)} m, far ${(out.probe.far / 1000).toFixed(0)} km; holes in the lower two thirds ${out.probe.backgroundShare.toFixed(4)}; 1 mm apart ${out.probe.changedShare.toExponential(2)} of ${out.probe.pixels} pixels; pick ${out.pick ? `${out.pick.t.toFixed(2)} m ahead, ${(out.pick.heightM - out.pick.groundM).toFixed(4)} m off the sampled ground, ${out.pick.samples} samples` : "none"}; item 0.45 m away: unregistered ${out.clipped ? "drawn" : "clipped"} (near ${out.nearWithout.toFixed(3)}), registered ${out.drawn ? "drawn" : "clipped"} (near ${out.nearWith.toFixed(3)})`,
    );
  }
  for (const { depth, errors, out } of results) {
    expect(errors).toEqual([]);
    expect(out.eye.on).toBe(true);
    expect(out.eye.depth).toBe(depth);
    expect(out.clearanceM).toBe(1.7);
    expect(Math.abs(out.overGroundM - 1.7)).toBeLessThan(0.5);
    // 0.3 x the clearance (the controls keep the camera a little over the
    // drawn mesh, which can stand above the sampled ground; the planes
    // were fitted a frame before the height was read).
    expect(out.probe.near).toBeLessThanOrEqual(0.3 * out.overGroundM + 0.01);
    expect(out.probe.near).toBeGreaterThanOrEqual(0.1);
    expect(out.probe.backgroundShare).toBe(0);
    expect(out.probe.changedShare).toBeLessThanOrEqual(1e-3);
    expect(out.pick).not.toBeNull();
    expect(Math.abs(out.pick.heightM - out.pick.groundM)).toBeLessThan(0.01);
    expect(out.clipped).toBe(false);
    expect(out.drawn).toBe(true);
    expect(out.nearWith).toBeCloseTo(0.5 * 0.45, 3);
  }
});

/**
 * A fake of the OSM tile host on the CONTEXT: every request answered with
 * a solid magenta tile and counted with its zoom, place and time.
 */
async function routeOsm(context, page) {
  const seen = [];
  let png = null;
  await context.route(
    (url) => url.hostname === "tile.openstreetmap.org",
    async (route) => {
      const [z, x, y] = new URL(route.request().url()).pathname
        .replace(/\.png$/, "")
        .split("/")
        .slice(-3)
        .map(Number);
      seen.push({ z, x, y, t: Date.now() });
      png ??= Buffer.from(
        await page.evaluate(async () => {
          const c = new OffscreenCanvas(256, 256);
          const g = c.getContext("2d");
          g.fillStyle = "#ff00ff";
          g.fillRect(0, 0, 256, 256);
          const bytes = new Uint8Array(
            await (await c.convertToBlob({ type: "image/png" })).arrayBuffer(),
          );
          let s = "";
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        }),
        "base64",
      );
      return route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "image/png",
        },
        body: png,
      });
    },
  );
  return seen;
}

/** A tile's centre (degrees) from its z/x/y (Web Mercator). */
const tileCentre = ({ z, x, y }) => {
  const n = 2 ** z;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return { lat, lng };
};

/** Metres between two places (a sphere is close enough at this range). */
const metresBetween = (a, b) => {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** The most requests in any sliding minute. */
const worstMinute = (times) => {
  let worst = 0;
  for (let i = 0; i < times.length; i++) {
    let j = i;
    while (j < times.length && times[j] < times[i] + 60_000) j++;
    worst = Math.max(worst, j - i);
  }
  return worst;
};

/**
 * Boots a first-person page with `extra`; waits for the settled relief
 * unless `settle` is false.
 */
async function eyePage(context, extra, { settle = true } = {}) {
  const page = await context.newPage();
  const seen = await routeOsm(context, page);
  const errors = await bootGlobe(page, `${BASE}&eye=1${extra}`, {
    phase: "user",
  });
  if (!settle) return { page, seen, errors };
  await page.waitForFunction(
    () => {
      const r = window.__globeLab.state().relief;
      return Boolean(r?.settled && r.visibleTiles > 0);
    },
    null,
    { timeout: 240_000 },
  );
  return { page, seen, errors };
}

// WHY (G0 spikes 2026-10-17, Q5; the OSM tile usage policy): raster OSM
// tiles are someone else's servers. On the real page, against a fake of
// the host: none is asked for by default; with the setting on at eye
// height they are asked for only at z15 and finer, only near the camera,
// never more than 150 in a minute, drawn at the camera's feet and credited
// with the copyright link; from 400 m over the ground none is asked for
// and the map is not drawn. The map needs the relief at z15 or finer near
// the camera: the eye run draws the editor's denser mesh (level 17, about
// 6.5 m between vertices), the others the default (z13 there).
test("OSM tiles: none by default; near the camera only, z15 and finer, under the ceiling, credited; none from 400 m up", async ({
  context,
}) => {
  test.setTimeout(1_800_000);
  const out = {};
  {
    // Off by default: the same view, no setting.
    const { page, seen, errors } = await eyePage(context, `&view=${EYE_VIEW}`);
    await page.evaluate(() => window.__globeLab.timeFrames(30));
    out.off = {
      errors,
      requests: seen.length,
      osm: await page.evaluate(() => window.__globeLab.state().osm),
    };
    await page.close();
    await context.unrouteAll({ behavior: "ignoreErrors" });
  }
  {
    // The deep tree takes minutes to generate in the page (measured
    // 2026-10-18: the first map request at about 280 s, settled at 400 s).
    const { page, seen, errors } = await eyePage(
      context,
      `&osm=1&reliefMeshLevel=17&reliefCacheMiB=1024&view=${EYE_VIEW}`,
      { settle: false },
    );
    await page.waitForFunction(
      () => (window.__globeLab.state().osm?.requests ?? 0) > 0,
      null,
      { timeout: 600_000, polling: 1_000 },
    );
    // Then the map at the feet: fetched, composed and drawn (about 70 s
    // after the first request in a probe; the pixel and the overlay's
    // state are printed if it never comes).
    await page
      .waitForFunction(
        () => {
          const [[r, g, b]] = window.__globeLab.readPixels([[0.5, 0.95]]);
          return r > 1.5 * g + 20 && b > 1.5 * g + 20;
        },
        null,
        { timeout: 420_000, polling: 2_000 },
      )
      .catch(async (error) => {
        const lab = await page.evaluate(() => ({
          feet: window.__globeLab.readPixels([[0.5, 0.95]])[0],
          osm: window.__globeLab.state().osm,
          relief: window.__globeLab.state().relief.settled,
        }));
        console.log(`no map at the feet: ${JSON.stringify(lab)}`);
        throw error;
      });
    const state = await page.evaluate(() => {
      const lab = window.__globeLab;
      lab.timeFrames(5);
      const live = JSON.parse(lab.debug.exportText()).live;
      const [feet] = lab.readPixels([[0.5, 0.95]]);
      return {
        osm: lab.state().osm,
        at: { lat: live.lat, lng: live.lng },
        feet,
        credits: document.getElementById("globe-credits").textContent,
        links: [...document.querySelectorAll("#globe-credits a")].map((a) =>
          a.getAttribute("href"),
        ),
      };
    });
    out.eye = { errors, seen: [...seen], ...state };
    await page.close();
    await context.unrouteAll({ behavior: "ignoreErrors" });
  }
  {
    // 400 m over the synthetic ground (about 870 m here).
    const { page, seen, errors } = await eyePage(
      context,
      "&osm=1&view=46.5,9.0,1.27,0,-30",
    );
    await page.evaluate(() => window.__globeLab.timeFrames(30));
    const [feet] = await page.evaluate(() =>
      window.__globeLab.readPixels([[0.5, 0.95]]),
    );
    out.high = {
      errors,
      requests: seen.length,
      feet,
      osm: await page.evaluate(() => window.__globeLab.state().osm),
    };
    await page.close();
  }
  const eye = out.eye;
  const zooms = [...new Set(eye.seen.map((t) => t.z))].sort();
  const farthest = Math.max(
    ...eye.seen.map((t) => metresBetween(eye.at, tileCentre(t))),
  );
  console.log(
    `OSM tiles: off ${out.off.requests} requests; eye height ${eye.seen.length} requests at z${zooms.join(",")}, the farthest tile centre ${farthest.toFixed(0)} m away, worst minute ${worstMinute(eye.seen.map((t) => t.t))}, lab ${JSON.stringify(eye.osm)}, the pixel at the feet ${eye.feet.join(",")}; 400 m up ${out.high.requests} requests, active ${out.high.osm?.active}, the pixel at the bottom ${out.high.feet.join(",")}`,
  );
  const magenta = ([r, g, b]) => r > 1.5 * g + 20 && b > 1.5 * g + 20;
  for (const run of [out.off, eye, out.high]) expect(run.errors).toEqual([]);
  expect(out.off.requests).toBe(0);
  expect(out.off.osm.attached).toBe(false);
  expect(eye.seen.length).toBeGreaterThan(0);
  expect(eye.osm.requests).toBe(eye.seen.length);
  expect(Math.min(...zooms)).toBeGreaterThanOrEqual(15);
  // Within the fade (300 m) of a region the camera can reach: a z15 tile
  // is about 850 m across here, so its centre is at most ~900 m off.
  expect(farthest).toBeLessThan(300 + 900);
  // The policy's ceiling, held as a statement more than a test: at about
  // 18 requests a run this cannot fail (G1 review L7). What would catch
  // a request storm is the sliding-minute ceiling's own unit tests
  // (`globe-osm-overlay.test.ts`).
  expect(worstMinute(eye.seen.map((t) => t.t))).toBeLessThanOrEqual(150);
  expect(eye.osm.unpatchedShaders).toBe(0);
  expect(magenta(eye.feet)).toBe(true);
  expect(eye.credits).toContain("© OpenStreetMap contributors");
  expect(eye.links).toContain("https://www.openstreetmap.org/copyright");
  expect(out.high.requests).toBe(0);
  expect(out.high.osm.active).toBe(false);
  expect(magenta(out.high.feet)).toBe(false);
});
