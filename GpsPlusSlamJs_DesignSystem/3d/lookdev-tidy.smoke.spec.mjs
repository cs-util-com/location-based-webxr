// @ts-check
/**
 * The look-dev page's round-3 tidy (plan 2026-09-27-0532, stream A): the
 * catalog labels at the owner's distance, the old white and gold ramp as a
 * catalog row, and the city's varied materials with their cost.
 *
 * Why this file matters: each claim here is something the owner asked for
 * in words ("labels from about twice the distance", "one set of spheres",
 * "does a mix of matte and shiny cost more?"), and each can silently not
 * happen: a label rule nobody reads, a row that lands off the grid, a
 * switch that builds the same two meshes. Costs are logged as ratios within
 * one page load (SwiftShader timings are relative only).
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

/** The label-cap sweep (plan §8 finding 16). */
const K_SWEEP = [16, 24, 41];
/** The owner's fade (DEC round 3): full to 50 m, gone at 140 m. */
const FADE = { near: 50, far: 140 };

/** The viewports the K sweep runs at: the smoke's desktop and a portrait phone. */
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  portrait: { width: 390, height: 844 },
};

/** Wait two animation frames, so the page has resized to a new viewport. */
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

// WHY (owner feedback round 3, item 5): the labels appeared too close; the
// owner asked for about twice the distance, so the fade runs 50-140 m (was
// 25-70 m). From 100 m a label must show (the old rule hid it at 70 m), and
// from past 140 m none. And K, the nearest-labels cap, now decides more than
// the fade: at the catalog view every sphere is inside 140 m. K must be
// spent on labels the viewer can SEE (round-3 review, finding 1): ranked by
// distance alone, 6 of K = 16 went to spheres beside or behind the camera
// while 6 spheres on screen got none. So every shown label's anchor is on
// the canvas, and the count is exactly min(K, labels on screen), at the
// desktop viewport and a portrait phone's. Logged per view for the owner.
test("catalog labels show from about twice the old distance, and K caps the ON-SCREEN ones (K sweep logged)", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&city=0&catalog=1");
  const byDistance = await page.evaluate((fade) => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setCloudCover(0);
    const spheres = d.catalogSpheres();
    // Stand straight back (+z) from the nearest row's middle sphere, at its
    // height, so the nearest sphere is exactly `m` metres away.
    const lastZ = Math.max(...spheres.map((s) => s.z));
    const row = spheres.filter((s) => s.z === lastZ);
    const mid = row[Math.floor(row.length / 2)];
    const labelsFrom = (m) => {
      d.placeCameraAt([mid.x, mid.y, mid.z + m], [mid.x, mid.y, mid.z]);
      d.readPixels([[0.5, 0.5]]);
      return d.catalogInfo().labelIds.length;
    };
    return { 100: labelsFrom(100), [fade.far + 5]: labelsFrom(fade.far + 5) };
  }, FADE);
  console.log(`labels by distance: ${JSON.stringify(byDistance)}`);
  expect(byDistance[100]).toBeGreaterThan(0);
  expect(byDistance[FADE.far + 5]).toBe(0);
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(viewport);
    await settle(page);
    const sweep = await page.evaluate((ks) => {
      const d = window.__lookdev;
      const out = {};
      for (const view of ["catalog", "city", "lake", "sun", "antisun"]) {
        out[view] = {};
        d.setView(view);
        // A label anchor is on screen when it projects inside the canvas.
        const onScreen = d
          .catalogSpheres()
          .filter((s) => {
            const [u, v] = d.project(s.label);
            return u >= 0 && u <= 1 && v >= 0 && v <= 1;
          })
          .map((s) => s.id);
        for (const k of ks) {
          d.setLabelRule({ k });
          d.readPixels([[0.5, 0.5]]);
          out[view][k] = { shown: d.catalogInfo().labelIds, onScreen };
        }
      }
      d.setLabelRule({ k: 16 });
      return out;
    }, K_SWEEP);
    for (const [view, byK] of Object.entries(sweep)) {
      for (const [k, { shown, onScreen }] of Object.entries(byK)) {
        const off = shown.filter((id) => !onScreen.includes(id));
        console.log(
          `labels ${name} ${view} K=${k}: ${shown.length} shown of ${onScreen.length} on screen, ${off.length} off screen [${shown.join(", ")}]`,
        );
        expect(off, `${name} ${view} K=${k}: labels off screen`).toEqual([]);
      }
    }
    // At the catalog view every sphere is inside the fade, so K decides.
    for (const k of K_SWEEP) {
      const { shown, onScreen } = sweep.catalog[k];
      expect(shown, `${name} catalog K=${k}`).toHaveLength(
        Math.min(k, onScreen.length),
      );
    }
  }
  expect(errors).toEqual([]);
});

// WHY (owner feedback round 3, item 6; DEC-FB3-1): the page had two sets of
// spheres, the white and gold ramp (always there, unlabelled) and the
// catalog, at different spacings. The ramp is now one labelled catalog row:
// twelve spheres on one line at the catalog's pitch and height, labelled
// like every other row, and gone with the catalog. The old separate spheres
// must be gone too (no second set), which the caster flags' parts show.
test("the old white and gold ramp is one labelled catalog row, shown and hidden with the catalog", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&city=0&catalog=1");
  const on = await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setCloudCover(0);
    d.setView("catalog");
    d.readPixels([[0.5, 0.5]]);
    return {
      spheres: d.catalogSpheres(),
      labels: d.catalogInfo().labelIds,
      sphereMeshes: d.sphereMeshes(),
    };
  });
  const ramp = on.spheres.filter((s) => s.id.startsWith("ramp-"));
  const others = on.spheres.filter((s) => !s.id.startsWith("ramp-"));
  const rampLabels = on.labels.filter((id) => id.startsWith("ramp-"));
  console.log(
    `ramp row: ${ramp.map((s) => `${s.id}@${s.x},${s.y},${s.z}`).join(" ")}; ${rampLabels.length} of its labels shown`,
  );
  expect(ramp).toHaveLength(12);
  // One row: one z, the catalog's height, the catalog's pitch.
  expect(new Set(ramp.map((s) => s.z)).size).toBe(1);
  expect([...new Set(ramp.map((s) => s.y))]).toEqual([
    ...new Set(others.map((s) => s.y)),
  ]);
  const firstRow = others.filter((s) => s.z === others[0].z);
  const pitch = firstRow[1].x - firstRow[0].x;
  const xs = ramp.map((s) => s.x).sort((a, b) => a - b);
  expect(xs[0]).toBe(firstRow[0].x);
  for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBe(pitch);
  // Labelled like the rest: some of its labels show at the catalog view.
  expect(rampLabels.length).toBeGreaterThan(0);
  // No second set of spheres beside the catalog: every sphere mesh in the
  // scene is the catalog's (round-3 review, finding 3: a key list of the
  // caster flags could not fail).
  expect(on.sphereMeshes.outside).toBe(0);
  expect(on.sphereMeshes.catalog).toBe(on.spheres.length);
  const off = await page.evaluate(() => {
    const d = window.__lookdev;
    d.setCatalog(false);
    d.readPixels([[0.5, 0.5]]);
    return { spheres: d.catalogSpheres(), labels: d.catalogInfo().labelIds };
  });
  expect(off).toEqual({ spheres: [], labels: [] });
  expect(errors).toEqual([]);
});

const sum = (px) => px[0] + px[1] + px[2];

/** The material counts the varied-city sweep covers (plan §6). */
const MATERIAL_SWEEP = [4, 8, 12];
/** A catalog entry id a building may wear: standard or physical only. */
const POOL_ID = /^(standard|physical|ramp)-/;

// WHY (owner feedback round 3, item 7; DEC-FB3-3): the city's buildings wear
// catalog materials at random, so matte and shiny mix out to the horizon.
// Each material is its own InstancedMesh, so what must hold is: N materials
// are N meshes of N distinct pool entries (no classic, toon or unlit
// building), the meshes together still show exactly the nearest n lots
// (the split must not lose or double a lot, or the material count would
// change the city), a draw per material per pass, and the switch and count
// travel in the address. The smoke boot pins the plain city (varied=0), so
// this test switches it on itself.
test("the varied city wears N pool materials, one mesh each, the same lots, a draw each", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&city=0");
  const plain = await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setView("city");
    d.setCity(2500, 42);
    return d.cityInfo();
  });
  expect(plain.materials).toEqual(["dense-concrete", "dense-glass"]);
  expect(plain.instances).toBe(2500);
  const byCount = {};
  for (const n of MATERIAL_SWEEP) {
    byCount[n] = await page.evaluate((k) => {
      const d = window.__lookdev;
      d.setVaried(true, k);
      const info = d.cityInfo();
      d.setCity(100000, 42);
      const full = d.drawCalls();
      d.setVaried(false);
      const fullPlain = d.drawCalls();
      d.setVaried(true, k);
      d.setCity(2500, 42);
      return { info, full, fullPlain, hash: location.hash };
    }, n);
    const { info, full, fullPlain, hash } = byCount[n];
    console.log(
      `varied ${n}: ${info.meshes} meshes [${info.materials.join(", ")}], ${info.instances} lots, ${full} draws against ${fullPlain} plain`,
    );
    expect(info.meshes).toBe(n);
    expect(new Set(info.materials).size).toBe(n);
    for (const id of info.materials) expect(id).toMatch(POOL_ID);
    expect(info.instances).toBe(2500);
    expect(info.varied).toBe(true);
    // One draw per material per pass (shadows are off here: one pass).
    expect(full - fullPlain).toBe(n - 2);
    expect(hash).toContain("varied=1");
    expect(hash).toContain(`materials=${n}`);
  }
  // The readout names the count next to the draws.
  await expect(page.locator("[data-stats]")).toContainText(
    "city 12 catalog materials",
  );
  expect(errors).toEqual([]);
});

// WHY: a varied mesh holds about 1/N of the lots, spread over the whole
// disc, so each needs the full-allocation bounds the plain meshes have (a
// sphere measured at a small count culls the far fill in any view that
// misses the centre, the W1 bug), and each must cast and receive like the
// plain city. The far probe stands inside the farthest lot looking outward,
// first at a small count (the stale-bounds trigger), then at all lots.
test("the varied city casts, receives, and is drawn far out", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=noon&tone=neutral&city=0&shadows=1&varied=1&materials=12",
  );
  const probe = (count) =>
    page.evaluate((n) => {
      const d = window.__lookdev;
      d.pauseLoop(true);
      d.setCity(n, 42);
      const [x, z] = d.cityInfo().farthest;
      const r = Math.hypot(x, z);
      d.placeCameraAt(
        [(x * (r - 150)) / r, 25, (z * (r - 150)) / r],
        [x, 12, z],
      );
      return d.readPixels([[0.5, 0.55]])[0];
    }, count);
  const few = await probe(100);
  const all = await probe(100000);
  const info = await page.evaluate(() => window.__lookdev.cityInfo());
  // A draw per material per PASS: when the maps re-render, the scene, the
  // central map and the ring map each draw every mesh.
  const draws = await page.evaluate(() => {
    const d = window.__lookdev;
    d.setView("city");
    const varied = d.timeFrames(1, { shadowMaps: true }).draws;
    d.setVaried(false);
    const plain = d.timeFrames(1, { shadowMaps: true }).draws;
    return { varied, plain };
  });
  console.log(
    `varied far probe: ${few} with 100 lots, ${all} with all; map-frame draws ${draws.varied} varied, ${draws.plain} plain`,
  );
  expect(info.meshes).toBe(12);
  expect(info.casts).toBe(true);
  expect(info.receives).toBe(true);
  expect(Math.abs(sum(all) - sum(few))).toBeGreaterThan(30);
  expect(draws.varied - draws.plain).toBe(3 * (12 - 2));
  expect(errors).toEqual([]);
});

/** Level thresholds the finish A/B's pixel share is swept over. */
const FINISH_LEVELS = [5, 10, 20, 40];
/**
 * Declared floor on the share of pixels that move by more than 10 levels
 * between all shiny and all matte. Measured 2026-09-27 at golden hour:
 * 0.58 (0.63 / 0.58 / 0.50 / 0.43 at 5 / 10 / 20 / 40 levels); a no-op A/B
 * reads 0. Half the measurement, so the floor holds across the sweep.
 */
const FINISH_MOVED_MIN = 0.3;

// WHY (DEC-FB3-3, the owner's A/B): "all shiny" and "all matte" set every
// city material's roughness to 0 or 1 and nothing else, so the A/B compares
// the same meshes, the same draws and the same programs; the pixels must
// differ, or the A/B is a no-op the owner would read as "no difference".
test("the finish A/B changes the city's roughness and pixels, not its draws or programs", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=golden&tone=neutral&city=2500&pitch=42&varied=1&materials=12",
  );
  const grid = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 5; j++) grid.push([0.4 + i * 0.07, 0.35 + j * 0.08]);
  }
  const read = (finish) =>
    page.evaluate(
      ([f, points]) => {
        const d = window.__lookdev;
        d.pauseLoop(true);
        d.setCloudCover(0);
        d.setCityFinish(f);
        // Inside the ring, looking outward along it: the frame is full of
        // varied buildings (the city view shows mostly the block and sky).
        d.placeCameraAt([300, 40, 0], [800, 10, 0]);
        const pixels = d.readPixels(points);
        const info = d.cityInfo();
        return {
          pixels,
          draws: d.stats().drawCalls,
          programs: d.catalogInfo().programs,
          roughness: info.roughness,
          hash: location.hash,
        };
      },
      [finish, grid],
    );
  const mixed = await read("mixed");
  const shiny = await read("shiny");
  const matte = await read("matte");
  // The share of pixels that move by more than each level threshold.
  const share = (levels) =>
    shiny.pixels.filter(
      (px, k) => Math.abs(sum(px) - sum(matte.pixels[k])) > levels,
    ).length / grid.length;
  const shares = Object.fromEntries(
    FINISH_LEVELS.map((levels) => [levels, share(levels)]),
  );
  console.log(
    `finish A/B: share of pixels moved shiny vs matte by level ${JSON.stringify(shares)}; draws ${mixed.draws}/${shiny.draws}/${matte.draws}; programs ${mixed.programs}/${shiny.programs}/${matte.programs}`,
  );
  expect(new Set(mixed.roughness).size).toBeGreaterThan(1);
  expect(shiny.roughness.every((r) => r === 0)).toBe(true);
  expect(matte.roughness.every((r) => r === 1)).toBe(true);
  expect(shiny.draws).toBe(matte.draws);
  expect(shiny.programs).toBe(matte.programs);
  expect(mixed.programs).toBe(shiny.programs);
  expect(shares[10]).toBeGreaterThanOrEqual(FINISH_MOVED_MIN);
  expect(matte.hash).toContain("finish=matte");
  expect(errors).toEqual([]);
});

// The owner's cost question (DEC-FB3-3; plan §3, §6), LOGGED for the record,
// not asserted beyond the draw counts: SwiftShader timings are relative, so
// every cost is a ratio against the plain city in the same page load, over
// interleaved rounds. On the default page (the densest city, shadows on):
// the steady frame (the shadow maps are cached) and a frame that re-renders
// both maps (after the sun moves), per material count and per finish.
// ON DEMAND (`LOOKDEV_COST=1`): it renders about 70 frames of 42,000
// buildings, minutes on SwiftShader, and its numbers are for the round-3
// record, not a gate; the draw counts it logs are asserted in the gated
// tests above.
test("the varied city's cost against the plain city (logged)", async ({
  page,
}) => {
  test.skip(!process.env.LOOKDEV_COST, "on demand: LOOKDEV_COST=1");
  test.setTimeout(900_000);
  const errors = await boot(
    page,
    "preset=golden&tone=neutral&city=100000&pitch=20&shadows=1",
  );
  const configs = [
    { id: "plain", varied: false, n: 12, finish: "mixed" },
    ...MATERIAL_SWEEP.map((n) => ({
      id: `n${n}`,
      varied: true,
      n,
      finish: "mixed",
    })),
    { id: "n12-shiny", varied: true, n: 12, finish: "shiny" },
    { id: "n12-matte", varied: true, n: 12, finish: "matte" },
  ];
  const rounds = 2;
  const results = await page.evaluate(
    ([list, roundCount]) => {
      const d = window.__lookdev;
      d.pauseLoop(true);
      d.setCloudCover(0);
      d.setView("city");
      const out = Object.fromEntries(
        list.map((c) => [c.id, { steady: [], maps: [] }]),
      );
      for (let round = 0; round < roundCount; round++) {
        for (const c of list) {
          d.setVaried(c.varied, c.n);
          d.setCityFinish(c.finish);
          const steady = d.timeFrames(3);
          const maps = d.timeFrames(2, { shadowMaps: true });
          out[c.id].steady.push(steady.medianMs);
          out[c.id].maps.push(maps.medianMs);
          out[c.id].steadyDraws = steady.draws;
          out[c.id].mapDraws = maps.draws;
          out[c.id].programs = steady.programs;
        }
      }
      return out;
    },
    [configs, rounds],
  );
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const base = results.plain;
  for (const c of configs) {
    const r = results[c.id];
    console.log(
      `cost ${c.id}: steady ${r.steadyDraws} draws x${(mean(r.steady) / mean(base.steady)).toFixed(2)}; ` +
        `map frame ${r.mapDraws} draws x${(mean(r.maps) / mean(base.maps)).toFixed(2)}; programs ${r.programs} ` +
        `(raw ms steady ${r.steady.map((x) => x.toFixed(0)).join("/")}, maps ${r.maps.map((x) => x.toFixed(0)).join("/")})`,
    );
  }
  // A draw per material per pass: one pass steady, three (scene, central
  // map, ring map) when the maps re-render.
  for (const n of MATERIAL_SWEEP) {
    const r = results[`n${n}`];
    expect(r.steadyDraws - base.steadyDraws).toBe(n - 2);
    expect(r.mapDraws - base.mapDraws).toBe(3 * (n - 2));
  }
  // The finish is a uniform: the same draws and programs.
  expect(results["n12-shiny"].mapDraws).toBe(results["n12-matte"].mapDraws);
  expect(results["n12-shiny"].programs).toBe(results["n12-matte"].programs);
  expect(errors).toEqual([]);
});

// WHY (round-3 review, finding 7): a link is a view. Links written before
// round 3 name `city` (the page always wrote it) but never `varied`, and the
// varied city is on by default now, so an old link would open in a
// different look than the one it was shared for. A hash that names `city`
// without `varied` therefore means the plain city; naming `varied=1` turns
// it on. Checked on load and on a hash change.
test("an old link that names the city but not the varied materials keeps the plain city", async ({
  page,
}) => {
  const old =
    "preset=noon&tone=neutral&tier=phone&cloudMode=dome&shadows=0&city=2500&pitch=42&water=P50&catalog=0";
  const errors = await boot(page, old, { pageDefaults: true });
  const info = () => page.evaluate(() => window.__lookdev.cityInfo());
  await page.evaluate(() => window.__lookdev.pauseLoop(true));
  expect((await info()).varied).toBe(false);
  expect((await info()).materials).toEqual(["dense-concrete", "dense-glass"]);
  await page.evaluate((hash) => {
    location.hash = `#${hash}&varied=1`;
  }, old);
  await expect.poll(async () => (await info()).varied).toBe(true);
  await page.evaluate((hash) => {
    location.hash = `#${hash}`;
  }, old);
  await expect.poll(async () => (await info()).varied).toBe(false);
  expect(errors).toEqual([]);
});

// WHY (round-3 review, finding 7): on a hash change, a key the new hash does
// not name keeps its CURRENT value, not the page default (the reader only
// writes the keys it is given). This pins that contract, which the smoke's
// pinned hashes and the opening-state test both rest on. (It passed before
// the review fix too: the comment, not the behaviour, was wrong.)
test("a hash change keeps the current value of a key it does not name", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral");
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setShadows(true); // not the pinned value, not named below
  });
  await page.evaluate(() => {
    location.hash = "#preset=golden&tone=aces";
  });
  await expect
    .poll(() => page.evaluate(() => window.__lookdev.stats().state))
    .toMatchObject({
      preset: "golden",
      tone: "aces",
      shadows: true,
      catalog: false,
      cloudMode: "dome",
    });
  expect(errors).toEqual([]);
});

// WHY (round-3 review, finding 12): the panel offers 4, 8 and 12 materials,
// but a link (or setVaried) may name any count in the pool's range; the
// select must show that count, not go blank and hide what the city wears.
test("a material count the panel does not list still shows in its select", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=noon&tone=neutral&city=100&pitch=42&varied=1&materials=5",
  );
  await page.evaluate(() => window.__lookdev.pauseLoop(true));
  expect((await page.evaluate(() => window.__lookdev.cityInfo())).meshes).toBe(
    5,
  );
  await expect(page.locator("#city-materials")).toHaveValue("5");
  await page.selectOption("#city-materials", "8");
  expect((await page.evaluate(() => window.__lookdev.cityInfo())).meshes).toBe(
    8,
  );
  expect(errors).toEqual([]);
});
