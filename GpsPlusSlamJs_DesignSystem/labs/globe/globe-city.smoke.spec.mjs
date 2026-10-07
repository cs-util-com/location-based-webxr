/**
 * The city in the globe's scene (globe city plan 2026-10-05-0040 §12.5 C4,
 * §14): built in a worker from the Osm library alone, drawn through
 * `gps-plus-slam-osm/three`, placed on the globe's Earth-centred group.
 *
 * Nothing leaves 127.0.0.1: Overpass answers with a grid of fixture buildings
 * around the target, and every height tile (the prefetch's and the city
 * worker's) is the synthetic Terrarium tile the relief draws in smokes
 * (`../globe-terrain/synthetic-heights.js`), generated in the page, so the
 * city and the relief read the same numbers.
 */
import { expect, test } from "@playwright/test";

import { applyHash, bootGlobe } from "./globe-smoke-helpers.mjs";

const BERN = { lat: 46.948, lng: 7.4474 };
const BASE = `spinMs=0&turnMs=0&time=2026-10-05T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&detail=0&cloudShell=0&cloudVolume=0&at=${BERN.lat},${BERN.lng}`;

/**
 * The fixture's grid cells: a 5 x 5 grid 200 m apart, and one building far
 * out (1.6 km north, 1.8 km west), where a missing ruler correction would
 * be about 3 m (R2) while the grid's 280 m corner would show only 0.4 m.
 */
const CELLS = [
  ...[-2, -1, 0, 1, 2].flatMap((i) => [-2, -1, 0, 1, 2].map((j) => [i, j])),
  [8, -9],
];

/** The cells as 30 m square, 20 m tall buildings. */
function overpassFixture() {
  const elements = [];
  const mLat = 1 / 110_946;
  const mLng = 1 / (111_319.49 * Math.cos((BERN.lat * Math.PI) / 180));
  let id = 1;
  for (const [i, j] of CELLS) {
    {
      const lat = BERN.lat + i * 200 * mLat;
      const lng = BERN.lng + j * 200 * mLng;
      const dLat = 15 * mLat;
      const dLng = 15 * mLng;
      elements.push({
        type: "way",
        id: id++,
        tags: { building: "yes", height: "20" },
        geometry: [
          { lat: lat - dLat, lon: lng - dLng },
          { lat: lat - dLat, lon: lng + dLng },
          { lat: lat + dLat, lon: lng + dLng },
          { lat: lat + dLat, lon: lng - dLng },
          { lat: lat - dLat, lon: lng - dLng },
        ],
      });
    }
  }
  return { version: 0.6, elements };
}

/** The Overpass hosts (as the arrival helper lists them), never a local module. */
const isOverpass = (url) =>
  /(^|\.)overpass-api\.de$|^overpass\.private\.coffee$|^overpass\.kumi\.systems$/.test(
    url.hostname,
  ) ||
  (url.hostname === "maps.mail.ru" && url.pathname.includes("/overpass/"));

/** Routes Overpass to the fixture and every height tile to the synthetic one. */
async function routeCity(context, page) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "*",
  };
  const seen = { overpass: 0, heights: 0 };
  const body = JSON.stringify(overpassFixture());
  await context.route(
    (url) =>
      isOverpass(url) ||
      url.hostname === "tiles.mapterhorn.com" ||
      (url.hostname === "s3.amazonaws.com" &&
        url.pathname.startsWith("/elevation-tiles-prod/")),
    async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: cors });
      }
      const url = new URL(request.url());
      if (isOverpass(url)) {
        seen.overpass += 1;
        return route.fulfill({
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
          body,
        });
      }
      seen.heights += 1;
      const [z, x, y] = url.pathname
        .replace(/\.(png|webp)$/, "")
        .split("/")
        .slice(-3)
        .map(Number);
      const b64 = await page.evaluate(
        async ([tz, tx, ty, module]) => {
          // The page's own module, by a path passed in: a literal here reads
          // as an unresolved import to the dead-code check.
          const { syntheticTile } = await import(module);
          const blob = await syntheticTile(tz, tx, ty);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = "";
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        },
        [z, x, y, "/labs/globe-terrain/synthetic-heights.js"],
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

/** The ruler of the Osm library's frame (the AR core's), metres a degree. */
const RULER = { north: 39_940_652.7422 / 360, east: 40_075_016.6856 / 360 };

/** A fixture building's four corners: grid cell (i, j), 15 m half size. */
function corners(i, j) {
  const mLat = 1 / RULER.north;
  const mLng = 1 / (RULER.east * Math.cos((BERN.lat * Math.PI) / 180));
  const lat = BERN.lat + i * 200 * mLat;
  const lng = BERN.lng + j * 200 * mLng;
  return [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ].map(([a, b]) => ({ lat: lat + a * 15 * mLat, lng: lng + b * 15 * mLng }));
}

/** Waits for the city to finish (ready or failed) and returns the probe. */
async function cityDone(page) {
  await page.waitForFunction(
    () => {
      const c = window.__globeLab.state().city;
      return c && (c.phase === "ready" || c.phase === "failed");
    },
    null,
    { timeout: 200_000 },
  );
  // Every building vertex (25 boxes are a few thousand at most).
  return page.evaluate(() => window.__globeLab.cityProbe(20_000));
}

// WHY (globe city plan 2026-10-05-0040 §12.5 C4, §14 D-K5): the descent's
// city is OsmDemo's city, built through the Osm library's public API in a
// worker and drawn in the globe's scene. The placement is checked against
// an independent ECEF computation of the fixture's corners, horizontally
// (the vertical is C5's measured gap): within 1.5 m, the flat frame's own
// curvature bound of `ecefFromCityAt`; uncorrected or rotated it would be
// metres (R2) or tens of metres off.
test("the city builds at Bern from a link, through the Osm library, where its latitude and longitude are", async ({
  page,
  context,
}) => {
  test.setTimeout(400_000);
  const seen = await routeCity(context, page);
  const errors = await bootGlobe(
    page,
    `${BASE}&view=${BERN.lat - 0.02},${BERN.lng},3,0,-35`,
    { plain: false, phase: "user", routeCity: false },
  );
  const probe = await cityDone(page);
  if (process.env.CITY_SHOT) {
    await page.screenshot({ path: process.env.CITY_SHOT });
  }
  const placement = await page.evaluate(
    ({ vertices, targets }) => {
      let worstM = 0;
      const each = [];
      for (const t of targets) {
        // The GEODETIC normal (heights are along it), from two heights:
        // the geocentric direction is 0.19 degrees off at 47 N, which read
        // 1.4 m of false offset for vertices 420 m up.
        const q = window.__globeLab.cityExpected(t.lat, t.lng, 0);
        const q1 = window.__globeLab.cityExpected(t.lat, t.lng, 1000);
        const up = q1.map((c, k) => (c - q[k]) / 1000);
        let best = Infinity;
        for (const p of vertices) {
          const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
          const along = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
          const h = Math.hypot(
            d[0] - along * up[0],
            d[1] - along * up[1],
            d[2] - along * up[2],
          );
          best = Math.min(best, h);
        }
        worstM = Math.max(worstM, best);
        each.push(Math.round(best * 100) / 100);
      }
      return { worstM, each };
    },
    {
      vertices: probe.vertices,
      targets: [
        ...corners(0, 0),
        ...corners(2, 2),
        ...corners(-2, 1),
        ...corners(8, -9),
      ],
    },
  );
  const { worstM: worst, each } = placement;
  const sweep = [0.5, 1, 2]
    .map((k) => `x${k} ${worst <= 1.5 * k ? "ok" : "NO"}`)
    .join(" ");
  console.log(
    `city at Bern: ${JSON.stringify(probe.counts)}, ground ${probe.groundM?.toFixed(1)} m, ${probe.objects} objects, drawn ${probe.drawn}; worst corner ${worst.toFixed(2)} m horizontally (bound 1.5 m: ${sweep}; per corner ${each.join(" ")}); vertices ${probe.vertices.length}; requests ${JSON.stringify(seen)}`,
  );
  expect(errors).toEqual([]);
  expect(probe.phase).toBe("ready");
  expect(probe.counts.volumes).toBe(CELLS.length);
  expect(probe.drawn).toBe(true);
  expect(probe.vertices.length).toBeGreaterThan(100);
  expect(worst).toBeLessThan(1.5);

  // WHY (r790 milestone review F2): the horizontal check above cannot see a
  // city at the wrong height (a datum sign, another zoom or source, the
  // geoid), which is D-K1's whole premise: the city and the relief read the
  // same numbers. Each tested building's base (its lowest vertex, measured
  // along the geodetic normal) must stand on the relief's own height, the
  // lowest under its corners (a base sits on the lowest ground of its ring).
  //
  // THE BOUND STATES A KNOWN MISMATCH. The Osm library's `sampleTile` puts a
  // Terrarium sample at its pixel's corner, the relief's plugin at its
  // centre (measured here: the city's field at the target equals the
  // relief's height 13 m, half a z12 pixel, east of it). Which is right is
  // an open library question (its 2026-08-18 follow-up: "verify against the
  // spec first"; the format document is silent), filed as validation
  // finding F11. So each base may differ by the relief's own rise over half
  // a pixel in each axis, plus 1 m of interpolation; a datum, zoom or source
  // error is tens to hundreds of metres and still fails.
  const vertical = await page.evaluate(
    ({ vertices, buildings }) => {
      const lab = window.__globeLab;
      const HALF_PIXEL_M = 13;
      const out = [];
      for (const ring of buildings) {
        const ground = Math.min(
          ...ring.map((c) => lab.reliefHeightAt(c.lat, c.lng) ?? Infinity),
        );
        const c = ring[0];
        const dLat = HALF_PIXEL_M / 110_946;
        const dLng = dLat / Math.cos((c.lat * Math.PI) / 180);
        const rise = (a, b) => Math.abs((a ?? NaN) - (b ?? NaN));
        const allowed =
          1 +
          rise(
            lab.reliefHeightAt(c.lat, c.lng + dLng),
            lab.reliefHeightAt(c.lat, c.lng - dLng),
          ) /
            2 +
          rise(
            lab.reliefHeightAt(c.lat + dLat, c.lng),
            lab.reliefHeightAt(c.lat - dLat, c.lng),
          ) /
            2;
        const q = lab.cityExpected(c.lat, c.lng, 0);
        const q1 = lab.cityExpected(c.lat, c.lng, 1000);
        const up = q1.map((v, k) => (v - q[k]) / 1000);
        let base = Infinity;
        for (const p of vertices) {
          const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
          const along = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
          const flat = Math.hypot(
            d[0] - along * up[0],
            d[1] - along * up[1],
            d[2] - along * up[2],
          );
          // This building's vertices only (30 m footprints, 200 m apart).
          if (flat < 40) base = Math.min(base, along);
        }
        out.push({ gap: base - ground, allowed });
      }
      return out;
    },
    {
      vertices: probe.vertices,
      buildings: [corners(0, 0), corners(2, 2), corners(-2, 1), corners(8, -9)],
    },
  );
  const worstShare = Math.max(
    ...vertical.map((v) => Math.abs(v.gap) / v.allowed),
  );
  console.log(
    `city bases against the relief's height: ${vertical.map((v) => `${v.gap.toFixed(2)}/${v.allowed.toFixed(2)}`).join(" ")} m (gap/allowed; worst ${(worstShare * 100).toFixed(0)} %: ${[0.5, 1, 2].map((k) => `x${k} ${worstShare <= k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(vertical.every((v) => Number.isFinite(v.gap))).toBe(true);
  expect(worstShare).toBeLessThan(1);
});

// WHY (§12.5 C4, R17): the city appears below `cityKm` (30 km) by a dithered
// fade, so its whole extent never switches on in one frame, and is not drawn
// at all above it.
test("the city is not drawn above 30 km and fades in below it", async ({
  page,
  context,
}) => {
  test.setTimeout(400_000);
  await routeCity(context, page);
  const high = `${BASE}&view=${BERN.lat - 0.2},${BERN.lng},40,0,-45`;
  const errors = await bootGlobe(page, high, {
    plain: false,
    phase: "user",
    routeCity: false,
  });
  const above = await cityDone(page);
  await applyHash(page, `${BASE}&view=${BERN.lat - 0.15},${BERN.lng},25,0,-45`);
  await page.waitForFunction(
    () => window.__globeLab.state().city?.fade > 0,
    null,
    { timeout: 30_000 },
  );
  const between = await page.evaluate(() => window.__globeLab.cityProbe());
  console.log(
    `city fade: ${above.fade} at 40 km (drawn ${above.drawn}), ${between.fade.toFixed(2)} at 25 km (drawn ${between.drawn})`,
  );
  expect(errors).toEqual([]);
  expect(above.phase).toBe("ready");
  expect(above.fade).toBe(0);
  expect(above.drawn).toBe(false);
  expect(between.fade).toBeGreaterThan(0);
  expect(between.fade).toBeLessThan(1);
  expect(between.drawn).toBe(true);
});

// WHY (§12.4 R15, §12.5 C6): the pin flies to the device's position, so
// without this a phone could only ever land where it is. `land=1` on an
// `at=` link flies the same dive to the link's place, lands there and
// builds its city.
test("a land=1 link flies to its own place, lands and builds its city", async ({
  page,
  context,
}) => {
  test.setTimeout(400_000);
  await routeCity(context, page);
  const errors = await bootGlobe(page, `${BASE}&land=1&diveMs=4000`, {
    plain: false,
    phase: "landed",
    routeCity: false,
  });
  const probe = await cityDone(page);
  const st = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `land=1: landed ${(st.altitudeM / 1000).toFixed(2)} km up at ${st.pin.located?.lat}, ${st.pin.located?.lng}; "${st.pin.status}"; city ${probe.phase}, fade ${probe.fade}`,
  );
  expect(errors).toEqual([]);
  expect(st.pin.located).toEqual(BERN);
  expect(st.pin.phase).toBe("idle");
  expect(st.altitudeM).toBeLessThan(3_500);
  expect(probe.phase).toBe("ready");
  expect(probe.fade).toBe(1);
  expect(probe.drawn).toBe(true);
});

// WHY (owner, 2026-10-07, r790 on a phone): a land=1 link "sticks at 2 m
// and races over the ground instead of coming in slowly from far out". The
// dive started at load, before any frame had placed the camera, so it set
// off from the world frame's origin, the ground at the target. The test
// above saw only where the dive ended. This one reads the altitude every
// frame from the first: the dive must begin from the intro's view, far out,
// and never go below the landing altitude before it lands.
test("a land=1 link's dive starts far out and never skims the ground", async ({
  page,
  context,
}) => {
  test.setTimeout(400_000);
  await routeCity(context, page);
  await page.addInitScript(() => {
    window.__altitudes = [];
    const sample = () => {
      const s = window.__globeLab?.ready ? window.__globeLab.state() : null;
      if (s) {
        window.__altitudes.push({
          m: s.altitudeM,
          phase: s.phase,
          pin: s.pin?.phase,
        });
      }
      if (s?.phase !== "landed") requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // 8 s: SwiftShader draws about a frame a second here, and a 4 s dive
  // left six samples.
  const errors = await bootGlobe(page, `${BASE}&land=1&diveMs=8000`, {
    plain: false,
    phase: "landed",
    routeCity: false,
  });
  const all = await page.evaluate(() => window.__altitudes);
  // From the dive's start (the pin leaves idle): the page reports ready
  // before its first frame, so earlier samples read the unplaced camera.
  const diveAt = all.findIndex((s) => s.pin && s.pin !== "idle");
  expect(diveAt).toBeGreaterThanOrEqual(0);
  const samples = all.slice(diveAt);
  const landKm = 2;
  const startKm = samples[0].m / 1000;
  const flying = samples.filter((s) => s.phase !== "landed");
  const lowestKm = Math.min(...flying.map((s) => s.m)) / 1000;
  const FAR_KM = 1_000;
  console.log(
    `land=1 path: ${samples.length} of ${all.length} frames from the dive's start (pin ${samples[0].pin}), first at ${startKm.toFixed(1)} km (far: ${[0.5, 1, 2].map((k) => `x${k} ${startKm > FAR_KM * k ? "ok" : "NO"}`).join(" ")}), lowest before landing ${lowestKm.toFixed(3)} km (landing ${landKm} km)`,
  );
  expect(errors).toEqual([]);
  expect(samples.length).toBeGreaterThan(10);
  expect(startKm).toBeGreaterThan(FAR_KM);
  expect(lowestKm).toBeGreaterThan(landKm * 0.9);
});
