// @ts-check
/**
 * The AR shadows pixel page (W4 AR shadows plan 2026-09-26-0549, M2).
 *
 * Why this file matters: the framework's unit tests prove the scene-graph
 * contract (who receives, who casts, when the map renders) but never draw a
 * pixel. This spec draws the real `OcclusionMesh` receiver, the real
 * `createArShadows` rig and real casters in headless Chromium (SwiftShader)
 * and checks each pixel against the analytic oracle
 * (`test-utils/shadow-oracle.ts`): dark exactly where a virtual caster's
 * shadow falls, clear everywhere else. Claims are about the canvas ALPHA,
 * which is what darkens the camera image in AR; they are relative to the
 * receiver's own opacity, never golden images.
 *
 * Every verdict is swept (owner rule 2026-09-13): the probe margin over 2-8
 * shadow texels and the sun over four elevations. The margin that the hard
 * assertions use is declared once below; the others are reported.
 */
import { expect, test } from "@playwright/test";

/** Margins swept; the page classifies every probe at each of them. */
const MARGINS = [2, 3, 4, 6, 8];
/**
 * The margin the hard assertions use: the smallest clean margin, rounded up
 * one step for headroom on other GPUs. Measured 2026-09-26 (SwiftShader):
 * zero violations already at 2 texels, at every sun of the sweep and every
 * map of the map sweep (texels 0.49-1.95 cm). PCF (3×3), the one-texel
 * normal bias and rasterisation all sit inside it.
 */
const ASSERT_MARGIN = 3;
/** A1: inside, alpha ≥ this share of the receiver's opacity. */
const INSIDE_SHARE = 0.9;
/** A2: outside, alpha ≤ this (8-bit), i.e. 2 %. */
const OUTSIDE_MAX = 5;
/** The reference sun and the sweep (degrees). */
const REFERENCE_SUN = { elevationDeg: 35, azimuthDeg: 205 };
const SUN_SWEEP = [20, 35, 55, 80];

/** Boot the lab page and fail on any console or page error. */
async function boot(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/labs/ar-shadows/");
  await page.waitForFunction(
    () => window.__arShadowsLab?.ready || window.__arShadowsLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__arShadowsLab.error)).toBeNull();
  return errors;
}

/** Configure, render and sample once, in the page. */
function sample(page, config = {}) {
  return page.evaluate(
    ([c, margins]) => {
      window.__arShadowsLab.configure(c);
      return window.__arShadowsLab.sample({ margins });
    },
    [config, MARGINS],
  );
}

/** The floor probes that the oracle puts wholly inside / outside at margin m. */
function floorAt(result, m, cls) {
  const i = MARGINS.indexOf(m);
  return result.probes.filter(
    (p) => p.target === "floor" && p.flat && p.cls[i] === cls,
  );
}

/** A1/A2 violations at margin m: inside too light, outside too dark. */
function violations(result, m) {
  const insideMin = INSIDE_SHARE * result.opacity * 255;
  const tooLight = floorAt(result, m, "inside").filter(
    (p) => p.alpha < insideMin,
  );
  const tooDark = floorAt(result, m, "outside").filter(
    (p) => p.alpha > OUTSIDE_MAX,
  );
  return { tooLight, tooDark };
}

test("the page boots without errors and draws probes on every class", async ({
  page,
}) => {
  const errors = await boot(page);
  const r = await sample(page, REFERENCE_SUN);
  expect(errors).toEqual([]);
  // Without enough probes of each kind the claims below would pass vacuously.
  expect(floorAt(r, ASSERT_MARGIN, "inside").length).toBeGreaterThan(200);
  expect(floorAt(r, ASSERT_MARGIN, "outside").length).toBeGreaterThan(2000);
  expect(
    r.probes.filter((p) => p.target === "floor" && p.flat && p.kerb).length,
  ).toBeGreaterThan(100);
  expect(r.probes.filter((p) => p.terrainShadow).length).toBeGreaterThan(50);
  expect(r.probes.filter((p) => p.nonCasterShadow).length).toBeGreaterThan(20);
  expect(r.probes.filter((p) => p.target === "caster").length).toBeGreaterThan(
    100,
  );
  expect(r.probes.filter((p) => p.behindTerrain).length).toBeGreaterThan(10);
});

// A1/A2 across the margin sweep: the hard claim at ASSERT_MARGIN, the whole
// table logged so a regression at a smaller margin is visible in the output.
test("A1/A2: dark inside the analytic shadow, clear outside it", async ({
  page,
}) => {
  await boot(page);
  const r = await sample(page, REFERENCE_SUN);
  const table = MARGINS.map((m) => {
    const v = violations(r, m);
    return `${m} texels: ${floorAt(r, m, "inside").length} inside (${v.tooLight.length} too light), ${floorAt(r, m, "outside").length} outside (${v.tooDark.length} too dark)`;
  });
  console.log(
    `margin sweep, opacity ${r.opacity.toFixed(3)}:\n  ${table.join("\n  ")}`,
  );
  const v = violations(r, ASSERT_MARGIN);
  expect(v.tooLight.slice(0, 5)).toEqual([]);
  expect(v.tooDark.slice(0, 5)).toEqual([]);
});

// A5, reduced to what a canvas can show: over an alpha canvas the browser
// composites premultiplied colour, so a shadow pixel of RGB 0 and alpha a
// yields camera × (1 − a) on every background. Shadow pixels must therefore
// be black; any colour would tint the camera image.
test("A5: a shadow darkens and never tints (premultiplied black)", async ({
  page,
}) => {
  await boot(page);
  const r = await sample(page, REFERENCE_SUN);
  const tinted = floorAt(r, ASSERT_MARGIN, "inside").filter(
    (p) => p.rgbMax > 1,
  );
  expect(tinted.slice(0, 5)).toEqual([]);
});

// A3 and A4: the reconstructed room and a non-casting object never cast.
// Each has a mutation check: flip the one flag that would make it cast and
// the same probes must darken, so the clear verdict is not vacuous.
for (const c of [
  {
    claim: "A3: the ridge's own shadow",
    flag: "terrainShadow",
    mutation: "mesh-casts",
  },
  {
    claim: "A4: the non-caster's footprint",
    flag: "nonCasterShadow",
    mutation: "non-caster-casts",
  },
]) {
  test(`${c.claim} stays clear, and darkens under the mutation`, async ({
    page,
  }) => {
    await boot(page);
    const r = await sample(page, REFERENCE_SUN);
    const probes = r.probes.filter((p) => p[c.flag]);
    expect(probes.filter((p) => p.alpha > OUTSIDE_MAX).slice(0, 5)).toEqual([]);
    const m = await sample(page, { ...REFERENCE_SUN, mutation: c.mutation });
    const mutated = m.probes.filter((p) => p[c.flag]);
    const dark = mutated.filter(
      (p) => p.alpha >= INSIDE_SHARE * m.opacity * 255,
    );
    expect(dark.length).toBeGreaterThan(0.8 * mutated.length);
  });
}

// A6: a caster in front of the floor is drawn opaque (its own shadow never
// shows through it), and the depth-only room still hides a caster behind it.
test("A6: casters hide their shadows, the room still occludes", async ({
  page,
}) => {
  await boot(page);
  const r = await sample(page, REFERENCE_SUN);
  const casters = r.probes.filter((p) => p.target === "caster");
  expect(casters.filter((p) => p.alpha < 250).slice(0, 5)).toEqual([]);
  const behind = r.probes.filter((p) => p.behindTerrain);
  expect(
    behind.filter((p) => p.alpha > r.opacity * 255 + OUTSIDE_MAX).slice(0, 5),
  ).toEqual([]);
});

// A7 and A10: with no mesh and no fallback nothing darkens; with the
// fallback plane the flat floor's shadows come back; with BOTH, the plane
// hides itself and no pixel darkens twice.
test("A7/A10: no mesh, no shadow; the fallback takes over, never twice", async ({
  page,
}) => {
  await boot(page);
  const none = await sample(page, {
    ...REFERENCE_SUN,
    mesh: false,
    fallback: false,
  });
  // Behind the ridge the hidden box now shows (no mesh hides it): not floor.
  const floorPixels = none.probes.filter(
    (p) => p.target === "floor" && !p.behindTerrain,
  );
  expect(floorPixels.length).toBeGreaterThan(2000);
  expect(floorPixels.filter((p) => p.alpha > OUTSIDE_MAX).slice(0, 5)).toEqual(
    [],
  );

  const plane = await sample(page, {
    ...REFERENCE_SUN,
    mesh: false,
    fallback: true,
  });
  // The plane lies at y = 0, so only the ground-level floor is judged.
  const ground = (p) => !p.kerb;
  const planeInside = floorAt(plane, ASSERT_MARGIN, "inside").filter(ground);
  expect(planeInside.length).toBeGreaterThan(100);
  expect(
    planeInside
      .filter((p) => p.alpha < INSIDE_SHARE * plane.opacity * 255)
      .slice(0, 5),
  ).toEqual([]);

  const both = await sample(page, {
    ...REFERENCE_SUN,
    mesh: true,
    fallback: true,
  });
  const twice = floorAt(both, ASSERT_MARGIN, "inside").filter(
    (p) => p.alpha > both.opacity * 255 + 3,
  );
  expect(twice.slice(0, 5)).toEqual([]);
});

// A8: a moving caster's shadow follows it on the next frame (the dynamic
// re-render rule on a real GPU; the unit tests prove only the flags).
test("A8: a moved caster's shadow follows it", async ({ page }) => {
  await boot(page);
  await sample(page, REFERENCE_SUN);
  const moved = await page.evaluate((margins) => {
    window.__arShadowsLab.moveCaster(0, [-0.6, 1.0, -2.4]);
    return window.__arShadowsLab.sample({ margins });
  }, MARGINS);
  const v = violations(moved, ASSERT_MARGIN);
  expect(v.tooLight.slice(0, 5)).toEqual([]);
  expect(v.tooDark.slice(0, 5)).toEqual([]);
});

// The map's half width R and size N set the texel (2R/N); the margins are
// in texels, so the claim must hold for every configuration the plan
// considers, not only the default (R 5 m, N 1024).
const MAP_SWEEP = [
  { halfWidthM: 5, mapSize: 512 },
  { halfWidthM: 5, mapSize: 1024 },
  { halfWidthM: 5, mapSize: 2048 },
  { halfWidthM: 10, mapSize: 1024 },
  { halfWidthM: 10, mapSize: 2048 },
];
test("A1/A2 hold across the map sizes and half widths", async ({ page }) => {
  await boot(page);
  const rows = [];
  for (const map of MAP_SWEEP) {
    const r = await sample(page, { ...REFERENCE_SUN, ...map });
    const v = violations(r, ASSERT_MARGIN);
    rows.push({
      ...map,
      texelCm: +(r.texelM * 100).toFixed(2),
      inside: floorAt(r, ASSERT_MARGIN, "inside").length,
      tooLight: v.tooLight.length,
      tooDark: v.tooDark.length,
    });
  }
  console.log(`map sweep at ${ASSERT_MARGIN} texels: ${JSON.stringify(rows)}`);
  for (const row of rows) {
    const at = `R ${row.halfWidthM} N ${row.mapSize}`;
    expect(row.inside, `inside probes at ${at}`).toBeGreaterThan(50);
    expect(row, at).toMatchObject({ tooLight: 0, tooDark: 0 });
  }
});

// A9: direction and length across the sun sweep. Low suns stretch shadows
// and steepen the map's texel footprint on the floor, so every elevation is
// judged, not only the reference.
test("A9: the shadow follows the sun across the elevation sweep", async ({
  page,
}) => {
  await boot(page);
  const rows = [];
  for (const elevationDeg of SUN_SWEEP) {
    const r = await sample(page, { ...REFERENCE_SUN, elevationDeg });
    const v = violations(r, ASSERT_MARGIN);
    rows.push({
      elevationDeg,
      inside: floorAt(r, ASSERT_MARGIN, "inside").length,
      tooLight: v.tooLight.length,
      tooDark: v.tooDark.length,
    });
  }
  console.log(`sun sweep at ${ASSERT_MARGIN} texels: ${JSON.stringify(rows)}`);
  for (const row of rows) {
    expect(row.inside, `inside probes at ${row.elevationDeg}°`).toBeGreaterThan(
      50,
    );
    expect(row, `at ${row.elevationDeg}°`).toMatchObject({
      tooLight: 0,
      tooDark: 0,
    });
  }
});
