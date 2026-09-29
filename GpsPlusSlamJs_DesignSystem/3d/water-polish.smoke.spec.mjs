// @ts-check
/**
 * The water polish on the look-dev pond (round-3 plan 2026-09-27-0532,
 * stream W; DEC-FB3-9): six tricks on top of the P50 waves, one switch and
 * hash key each (the framework's `water-polish.ts`).
 *
 * Why this file matters: the owner judges each trick ALONE against P50, so
 * (1) every switch off must be P50 exactly, byte for byte, (2) each switch
 * must compile (a shader error only logs, and the pond silently stops
 * drawing) and change the pond where it should, and (3) each claim is
 * measured AGAINST THE EFFECT OFF at the same pixels, in the same page load,
 * with the wave clock and the sky pinned. The metrics are
 * `water-metrics.mjs`, imported into the page so the frames stay there.
 * Colour claims are relative (lessons-learned: no golden images here).
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

const SWITCHES = [
  "lostVariance",
  "sunSize",
  "fresnelDamp",
  "antiTiling",
  "gusts",
  "body",
];
const KEYS = {
  lostVariance: "waterRough",
  sunSize: "waterSun",
  fresnelDamp: "waterFresnel",
  antiTiling: "waterTiles",
  gusts: "waterGusts",
  body: "waterBody",
};
/**
 * The anti-tiling check: repetition of the normal view's x slope over five
 * 384-pixel windows, high-passed at 16 px (TILE_BOUND: the least drop;
 * measured 2026-09-28 with a 30 m mask cell 0.981 -> 0.949, with the
 * default 15 m cell 0.981 -> 0.901; the bound is half the smaller drop).
 */
const TILE_REP = { size: 384, minLag: 16, step: 8, highpass: 16, windows: 5 };
const TILE_BOUND = 0.015;
/** The polish keys named off, for a boot that measures against P50. */
const OFF_HASH = Object.entries(KEYS)
  .map(([, key]) => `${key}=0`)
  .join("&");

/**
 * Boot the plain scene with P50 and every polish switch named off, the
 * clouds cleared and the loop paused (every frame is a test's own).
 */
async function bootPond(page, preset) {
  const errors = await boot(
    page,
    `preset=${preset}&tone=neutral&city=0&water=P50&${OFF_HASH}`,
  );
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setCloudCover(0);
  });
  return errors;
}

// WHY: "P50 alone" must BE today's P50. The framework pins the shader
// source of the all-off water (water-surface-material.test.ts); this
// proves it on the GPU from the page's side: a switch turned on and off
// again leaves the pond's pixels byte-identical (no parameter, program or
// uniform leaks), each switch compiles and changes the pond, and each
// travels in the address for a phone link.
test("every water polish switch compiles, changes the pond, travels in the address, and off restores P50 byte for byte", async ({
  page,
}) => {
  const errors = await bootPond(page, "golden");
  // Two views, so every trick has somewhere to act: across the pond at
  // golden hour (the far water, the body), and toward the noon sun from
  // 40 m (the glitter).
  const result = [];
  for (const view of [{ preset: "golden" }, { preset: "noon", glint: 40 }]) {
    result.push(
      await page.evaluate(
        async ({ switches, view }) => {
          const m = await import("/3d/water-metrics.mjs");
          const d = window.__lookdev;
          d.setPreset(view.preset);
          d.setCloudCover(0);
          if (view.glint) {
            const s = d.sunDirection();
            const { lake } = d.floating();
            const flat = Math.hypot(s[0], s[2]);
            const dist = view.glint / (s[1] / flat);
            d.placeCameraAt(
              [
                lake.x - (s[0] / flat) * dist,
                lake.y + view.glint,
                lake.z - (s[2] / flat) * dist,
              ],
              [lake.x, lake.y, lake.z],
            );
          } else {
            d.setView("lake");
          }
          d.setWaterTime(7.3);
          d.setFloatingVisible(false);
          const hidden = d.readFrame();
          d.setFloatingVisible(true);
          const off = d.readFrame();
          const mask = m.diffMask(hidden, off);
          const out = { pond: mask.reduce((s, v) => s + v, 0), switches: {} };
          for (const name of switches) {
            d.setWaterPolish({ [name]: true });
            const on = d.readFrame();
            const hash = location.hash;
            const polish = d.waterPolish();
            d.setWaterPolish({ [name]: false });
            const back = d.readFrame();
            out.switches[name] = {
              changed: m.changed(off, on, mask),
              differs: !m.identical(off, on),
              restored: m.identical(off, back),
              hash,
              alone: Object.entries(polish)
                .filter(([, v]) => v)
                .map(([k]) => k),
            };
          }
          // Every switch on at once, then off: still P50.
          d.setWaterPolish(Object.fromEntries(switches.map((s) => [s, true])));
          d.readFrame();
          d.setWaterPolish(Object.fromEntries(switches.map((s) => [s, false])));
          out.allRestored = m.identical(off, d.readFrame());
          return out;
        },
        { switches: SWITCHES, view },
      ),
    );
  }
  console.log(`water polish switches: ${JSON.stringify(round(result))}`);
  for (const view of result) {
    expect(view.pond).toBeGreaterThan(20_000);
    for (const name of SWITCHES) {
      const s = view.switches[name];
      expect(s.alone, name).toEqual([name]);
      expect(s.hash, name).toContain(`${KEYS[name]}=1`);
      expect(s.restored, `${name} off is P50 again`).toBe(true);
    }
    expect(view.allRestored).toBe(true);
  }
  // Each trick changes the pond in at least one of the views (where and in
  // which direction: the per-trick tests below).
  for (const name of SWITCHES) {
    expect(
      result.some((view) => view.switches[name].differs),
      `${name} changes the pond`,
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

// WHY (DEC-FB3-9): each per-wave trick must do what its label says, measured
// against P50 at the same pixels and the same waves:
// - lost variance: the FAR water's pixel-scale texture and its shimmer
//   between two frames 1/30 s apart drop, and the NEAR water (whose waves
//   are all resolved, nothing lost) does not change at all;
// - gusts: the slopes' spread varies more from patch to patch (the normal
//   view, top-down, so the sky's own gradient does not count);
// - anti-tiling: the finest ripples' repetition drops (the normal view).
// Measured 2026-09-28 at the defaults (record: water polish results):
// far lap x0.84, far shimmer x0.83, near 0 changed; gusts patch x2.06
// (top) and x1.09 (lake); tiles repetition see TILE_BOUND. Thresholds sit
// about half-way between no effect and the measured effect.
test("the per-wave tricks: far water turns to sheen, gusts make patches, the finest ripples repeat less", async ({
  page,
}) => {
  const errors = await bootPond(page, "golden");
  const lake = await probe(page, {
    preset: "golden",
    view: "lake",
    cells: [32],
    configs: {
      off: {},
      rough: { flags: { lostVariance: true } },
      gusts: { flags: { gusts: true } },
    },
  });
  const top = await probe(page, {
    preset: "noon",
    view: "top",
    h: 60,
    normals: true,
    rep: [TILE_REP],
    cells: [32],
    configs: {
      off: {},
      tiles: { flags: { antiTiling: true } },
      gusts: { flags: { gusts: true } },
    },
  });
  console.log(`per-wave tricks: ${JSON.stringify(round({ lake, top }))}`);
  const [nearOff, , farOff] = lake.configs.off.bands;
  const [nearRough, , farRough] = lake.configs.rough.bands;
  expect(farRough.lap / farOff.lap).toBeLessThan(0.92);
  expect(farRough.shimmer / farOff.shimmer).toBeLessThan(0.92);
  expect(nearRough.changed).toBeLessThan(0.001);
  expect(nearRough.mean).toBeCloseTo(nearOff.mean, 1);
  expect(lake.configs.gusts.patch32 / lake.configs.off.patch32).toBeGreaterThan(
    1.04,
  );
  expect(top.configs.gusts.patch32 / top.configs.off.patch32).toBeGreaterThan(
    1.5,
  );
  const repKey = `rep${TILE_REP.size}h${TILE_REP.highpass}`;
  expect(top.configs.off[repKey] - top.configs.tiles[repKey]).toBeGreaterThan(
    TILE_BOUND,
  );
  expect(errors).toEqual([]);
});

// WHY (DEC-FB3-9): each lighting trick, measured the same way:
// - the sun's size: the one-pixel glints (a pixel brighter than the upper
//   quartile of its 24 neighbours by 30 levels) in the glitter band, seen
//   from 40 m looking toward the noon sun, all but vanish;
// - the body: seen straight down at noon, the water's shading no longer
//   follows the wave normal (the texture away from the glint drops to a
//   tenth), and looking toward a low sun, backlit crests add light;
// - the Fresnel damp over the lost-variance roughness changes no pixel by
//   more than 6 levels in sum (three's own environment term already damps
//   rough water; the record's finding).
// Measured 2026-09-28: sparkles 0.160 per mille -> 0.003; body top-down
// far-band std x0.10; crest (0.2 against 0) near +3 %, mid +3 %; damp 0.
test("the lighting tricks: no one-pixel glints, a body lit from above, backlit crests, and a damp that adds nothing", async ({
  page,
}) => {
  const errors = await bootPond(page, "noon");
  const glint = await probe(page, {
    preset: "noon",
    view: "glint",
    h: 40,
    margins: [30],
    configs: { off: {}, sun: { flags: { sunSize: true } } },
  });
  const top = await probe(page, {
    preset: "noon",
    view: "top",
    h: 60,
    configs: { off: {}, body: { flags: { body: true } } },
  });
  const crest = await probe(page, {
    preset: "golden",
    view: "glint",
    h: 10,
    configs: {
      noCrest: { flags: { body: true }, params: { crestStrength: 0 } },
      crest: { flags: { body: true } },
    },
  });
  const damp = await probe(page, {
    preset: "golden",
    view: "lake",
    configs: {
      rough: { flags: { lostVariance: true } },
      damp: { flags: { lostVariance: true, fresnelDamp: true } },
    },
  });
  console.log(
    `lighting tricks: ${JSON.stringify(round({ glint, top, crest, damp }))}`,
  );
  const sparkOff = glint.configs.off.bands[1].spark30;
  expect(sparkOff).toBeGreaterThan(5e-5);
  expect(glint.configs.sun.bands[1].spark30).toBeLessThan(sparkOff / 4);
  const far = (c) => c.bands[2].std;
  expect(far(top.configs.body) / far(top.configs.off)).toBeLessThan(0.3);
  const lit = (c) => c.bands[0].mean + c.bands[1].mean;
  expect(lit(crest.configs.crest) / lit(crest.configs.noCrest)).toBeGreaterThan(
    1.01,
  );
  expect(damp.configs.damp.changed).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

/** In the page: `probePond` (water-metrics.mjs) for one spec. */
const probe = (page, spec) =>
  page.evaluate(async (s) => {
    const m = await import("/3d/water-metrics.mjs");
    return m.probePond(window.__lookdev, s);
  }, spec);

/** Round a result's numbers for the log. */
const round = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) =>
      typeof v === "number" ? +v.toPrecision(4) : v,
    ),
  );

/** `values` of one parameter as configs, each on top of `flags`. */
const sweep = (flags, param, values) => ({
  off: {},
  ...Object.fromEntries(
    values.map((v) => [`${param}=${v}`, { flags, params: { [param]: v } }]),
  ),
});

/**
 * The on-demand tests stay under 5 minutes each, so one never holds the
 * machine's single browser slot for long (the coordinator stopped a 36 min
 * run of an earlier all-in-one cost test, 2026-09-28).
 */
const ON_DEMAND_TIMEOUT_MS = 280_000;

// ON DEMAND (WATER_COST=1): each trick's cost as an on/off frame-time
// ratio within ONE page load, in the page's opening state (the dense city,
// shadows, the catalog, the slab clouds, P50), one test per tier, from the
// opening (city) view. OFF and ON alternate for two rounds, each round a
// median of three timed frames; each round's ratio is reported. SwiftShader
// times are RELATIVE only. The viewport is a quarter of the default's
// pixels: a frame of the opening state costs about 2.3 s on SwiftShader at
// 1280 x 800, and the ratio of two shader variants does not depend on the
// frame's size (both draw the same share of water pixels).
test.describe("on demand: the water polish's cost", () => {
  test.use({ viewport: { width: 640, height: 400 } });
  for (const tier of ["phone", "desktop"]) {
    test(`on demand: the water polish's frame-time cost on the ${tier} tier`, async ({
      page,
    }) => {
      test.skip(!process.env.WATER_COST, "on demand: WATER_COST=1");
      test.setTimeout(ON_DEMAND_TIMEOUT_MS);
      const errors = await boot(page, `water=P50&tier=${tier}&${OFF_HASH}`, {
        pageDefaults: true,
      });
      const configs = {
        ...Object.fromEntries(SWITCHES.map((s) => [s, { [s]: true }])),
        all: Object.fromEntries(SWITCHES.map((s) => [s, true])),
      };
      const report = [];
      for (const [name, flags] of Object.entries(configs)) {
        const rounds = await page.evaluate(
          ({ flags, switches }) => {
            const d = window.__lookdev;
            d.pauseLoop(true);
            const off = Object.fromEntries(switches.map((s) => [s, false]));
            const out = [];
            for (let r = 0; r < 2; r++) {
              d.setWaterPolish(off);
              const a = d.timeFrames(3).medianMs;
              d.setWaterPolish({ ...off, ...flags });
              const b = d.timeFrames(3).medianMs;
              out.push({ off: a, on: b });
            }
            d.setWaterPolish(off);
            return out;
          },
          { flags, switches: SWITCHES },
        );
        const line = {
          tier,
          name,
          ratios: rounds.map((r) => +(r.on / r.off).toFixed(3)),
          offMs: +rounds[0].off.toFixed(1),
        };
        report.push(line);
        console.log(`water cost ${JSON.stringify(line)}`);
      }
      expect(report).toHaveLength(7);
      expect(errors).toEqual([]);
    });
  }
});

/** The lake view, the view top-down from 60 m in the normal view. */
const LAKE = { view: "lake", cells: [32, 64] };
const TOP = {
  view: "top",
  h: 60,
  normals: true,
  rep: [
    { size: 384, minLag: 16, step: 8, highpass: 8, windows: 5 },
    { size: 384, minLag: 16, step: 8, highpass: 16, windows: 5 },
    { size: 256, minLag: 16, step: 4, highpass: 16, windows: 5 },
  ],
  cells: [32, 64, 128],
};

/**
 * The sweeps, one test per trick: every constant the polish introduces,
 * swept over a plausible range (owner rule 2026-09-13), each against P50 at
 * the same pixels, with the metric's own windows swept too. Each entry is
 * a list of [label, spec].
 */
const SWEEPS = {
  1: () =>
    ["golden", "noon"].map((preset) => [
      `varianceScale lake ${preset}`,
      {
        preset,
        ...LAKE,
        configs: sweep(
          { lostVariance: true },
          "varianceScale",
          [0.25, 0.5, 1, 2, 4],
        ),
      },
    ]),
  2: () =>
    [
      ["noon", 40],
      ["noon", 10],
      ["golden", 10],
    ].map(([preset, h]) => [
      `sunSizeScale glint ${preset} h${h}`,
      {
        preset,
        view: "glint",
        h,
        margins: [30, 40, 60],
        configs: sweep({ sunSize: true }, "sunSizeScale", [0.5, 1, 2, 4]),
      },
    ]),
  3: () => [
    [
      "fresnelDamp over lostVariance, lake golden",
      {
        preset: "golden",
        ...LAKE,
        configs: {
          off: { flags: { lostVariance: true } },
          ...Object.fromEntries(
            [3, 6, 12, 50].map((v) => [
              `fresnelDamp=${v}`,
              {
                flags: { lostVariance: true, fresnelDamp: true },
                params: { fresnelDamp: v },
              },
            ]),
          ),
        },
      },
    ],
  ],
  4: () =>
    [
      ["tileRotationRad", [0.3, 0.5, 0.9, 1.4]],
      ["tileScale", [0.6, 0.83, 1.2, 1.6]],
      ["tileMaskM", [8, 15, 30, 60]],
      ["tileMinK", [0.6, 1.5, 3]],
    ].map(([param, values]) => [
      `${param} top`,
      {
        preset: "noon",
        ...TOP,
        configs: sweep({ antiTiling: true }, param, values),
      },
    ]),
  5: () =>
    [
      ["gustScaleM", [25, 50, 100]],
      ["gustDepth", [0.4, 0.7, 1]],
      ["gustMinK", [0.3, 0.6, 1.5]],
    ].flatMap(([param, values]) => [
      [
        `${param} top`,
        {
          preset: "noon",
          ...TOP,
          configs: sweep({ gusts: true }, param, values),
        },
      ],
      [
        `${param} lake golden`,
        {
          preset: "golden",
          ...LAKE,
          configs: sweep({ gusts: true }, param, values),
        },
      ],
    ]),
  6: () => [
    ...[
      ["crestStrength", [0, 0.05, 0.2, 0.5]],
      ["crestPower", [2, 4, 8]],
      ["crestSlope", [0.05, 0.1, 0.2]],
    ].map(([param, values]) => [
      `${param} glint golden`,
      {
        preset: "golden",
        view: "glint",
        h: 10,
        configs: sweep({ body: true }, param, values),
      },
    ]),
    [
      "body top noon (shading, not normals)",
      {
        preset: "noon",
        view: "top",
        h: 60,
        configs: { off: {}, body: { flags: { body: true } } },
      },
    ],
  ],
};

// ON DEMAND (WATER_SWEEP=all, or a list of tricks such as 4,5): the sweeps
// above, in the plain scene (a frame there costs a fraction of the opening
// state's). The record logs the numbers, the value picked and what would
// reverse the verdict.
for (const [trick, specs] of Object.entries(SWEEPS)) {
  test(`on demand: the water polish's sweeps, trick ${trick}`, async ({
    page,
  }) => {
    const only = String(process.env.WATER_SWEEP ?? "").split(",");
    test.skip(
      !(only.includes("all") || only.includes(trick)),
      "on demand: WATER_SWEEP=all, or a list of tricks",
    );
    test.setTimeout(ON_DEMAND_TIMEOUT_MS);
    const errors = await bootPond(page, "golden");
    for (const [label, spec] of specs()) {
      const r = await probe(page, spec);
      console.log(`water sweep ${trick} ${label}: ${JSON.stringify(round(r))}`);
    }
    expect(errors).toEqual([]);
  });
}
