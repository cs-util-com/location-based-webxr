// @ts-check
/**
 * The globe's atmosphere seen from space (round-4 plan 2026-09-28-2105
 * DEC-GL4-4, `globe-atmosphere.js`).
 *
 * Why this file matters: the owner's reference shows a bright, almost
 * white-cyan band just inside the Earth's edge and a soft blue halo just
 * outside it, ONLY where the sun shines, fading towards the terminator,
 * and a blue veil over the day side. The pass is physical (a march through
 * the framework's atmosphere tables), so none of that is tuned per effect;
 * this checks the pass produces each of those where it should and nothing
 * where it should not, each against the same view with the pass off, and
 * logs what it costs on both tiers and how it bands per sample count.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  bootGlobe,
  luminance,
  meanOf,
} from "./globe-smoke-helpers.mjs";
import { GLOBE_ATMOSPHERE } from "./globe-atmosphere-frame.js";

/**
 * The equinox noon, the camera over 91.86°E, 90° east of the subsolar
 * point (1.86°E): the sun is to the west, so the screen's left limb is lit
 * and the right limb is in the night; the terminator runs through the
 * disc's centre. No stars or Milky Way, and navy space pinned off (round 5
 * made 0.1 the default; every bound here was measured on black space, and
 * the navy lifts the night limb to about 10 levels), so space reads black;
 * the clouds pinned in place.
 */
const VIEW =
  "at=0,91.86&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&stars=0&milkyWay=0&space=0";

/** The Earth's disc radius and the canvas size, in drawing-buffer pixels. */
async function discGeometry(page) {
  const s = await page.evaluate(() => window.__globeLab.state());
  const { width, height } = await page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (
      document.getElementById("globe-canvas")
    );
    return { width: c.width, height: c.height };
  });
  const rPx =
    ((height / 2) * Math.tan(Math.asin(s.radiusM / s.distance))) /
    Math.tan((s.fovY * Math.PI) / 360);
  return { rPx, width, height, kmPerPx: s.radiusM / 1000 / rPx };
}

/** Normalised canvas points along the middle row at pixel offsets from the centre. */
const rowPoints = ({ width }, offsetsPx) =>
  offsetsPx.map((dx) => [(width / 2 + dx + 0.5) / width, 0.5]);

const readLum = async (page, points) =>
  (await page.evaluate((p) => window.__globeLab.readPixels(p), points)).map(
    luminance,
  );

/**
 * The floors, 8-bit luminance, against the pass off, reported at x0.5, x1
 * and x2 (owner rule 2026-09-13):
 * - the lit limb must brighten by `LIMB`, inside and just outside the edge;
 * - the night limb must change by less than `NIGHT`;
 * - the day side's centre must turn bluer (blue minus red up by `VEIL`).
 */
const FLOOR = { LIMB: 20, NIGHT: 6, VEIL: 3 };
const SWEEP = [0.5, 1, 2];

test("the rim glows on the lit limb only, and veils the day side blue", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, `${VIEW}&atmo=0`);
  const g = await discGeometry(page);
  const r = Math.round(g.rPx);
  // The band inside the edge (the last 4 % of the radius) and just
  // outside it (the first 3 %), on the lit (left) and the night (right)
  // side; the day side 60 % of the way to the lit edge.
  const inside = Array.from(
    { length: Math.max(3, Math.round(0.04 * r)) },
    (_, i) => r - 1 - i,
  );
  const outside = Array.from(
    { length: Math.max(3, Math.round(0.03 * r)) },
    (_, i) => r + 1 + i,
  );
  const probes = {
    litIn: rowPoints(
      g,
      inside.map((d) => -d),
    ),
    litOut: rowPoints(
      g,
      outside.map((d) => -d),
    ),
    nightIn: rowPoints(g, inside),
    nightOut: rowPoints(g, outside),
  };
  const read = async () => {
    const out = {};
    for (const [k, pts] of Object.entries(probes))
      out[k] = await readLum(page, pts);
    const [day] = await page.evaluate(
      (p) => window.__globeLab.readPixels(p),
      rowPoints(g, [-Math.round(0.6 * r)]),
    );
    const [far] = await page.evaluate(
      (p) => window.__globeLab.readPixels(p),
      [[0.02, 0.02]],
    );
    return { ...out, day, far };
  };
  const off = await read();
  await applyHash(page, VIEW);
  const on = await read();
  const maxDelta = (k) => Math.max(...on[k].map((v, i) => v - off[k][i]));
  const maxAbsDelta = (k) =>
    Math.max(...on[k].map((v, i) => Math.abs(v - off[k][i])));
  const report = {
    litIn: maxDelta("litIn"),
    litOut: maxDelta("litOut"),
    nightIn: maxAbsDelta("nightIn"),
    nightOut: maxAbsDelta("nightOut"),
    veil: on.day[2] - on.day[0] - (off.day[2] - off.day[0]),
  };
  const verdict = (k) =>
    report.litIn > FLOOR.LIMB * k &&
    report.litOut > FLOOR.LIMB * k &&
    report.nightIn < FLOOR.NIGHT * k &&
    report.nightOut < FLOOR.NIGHT * k &&
    report.veil > FLOOR.VEIL * k;
  console.log(
    `atmosphere at ${g.kmPerPx.toFixed(1)} km a pixel (disc ${r} px): ` +
      Object.entries(report)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`)
        .join(", ") +
      `; day ${JSON.stringify(off.day)} -> ${JSON.stringify(on.day)}; ` +
      SWEEP.map((k) => `x${k} ${verdict(k) ? "ok" : "NO"}`).join(" "),
  );
  expect(report.litIn).toBeGreaterThan(FLOOR.LIMB);
  expect(report.litOut).toBeGreaterThan(FLOOR.LIMB);
  expect(report.nightIn).toBeLessThan(FLOOR.NIGHT);
  expect(report.nightOut).toBeLessThan(FLOOR.NIGHT);
  expect(report.veil).toBeGreaterThan(FLOOR.VEIL);
  // The halo is blue: more blue than red just outside the lit edge.
  const [halo] = await page.evaluate(
    (p) => window.__globeLab.readPixels(p),
    rowPoints(g, [-(r + 2)]),
  );
  expect(halo[2]).toBeGreaterThan(halo[0]);
  // Far out in space nothing changes.
  expect(luminance(on.far)).toBeLessThan(luminance(off.far) + 2);
  const state = await page.evaluate(() => window.__globeLab.state().atmosphere);
  expect(state).toMatchObject({ on: true, supported: true });
  expect(errors).toEqual([]);
});

/**
 * How far out from the lit edge the halo's SATURATED plateau may reach, as
 * a fraction of the shell's thickness (100 km x k). Physically the limb is brightest a
 * little above the ground, where a grazing ray's optical depth falls to
 * about 1 (about 20 km for the real air: 8 km scale height, a grazing
 * depth of 7-20 at the ground), and the thicker shell keeps that depth
 * (review B2), so the peak moves out with k. Measured 2026-09-30 with the
 * grazing compensation: a near-white plateau (163-168 levels, saturated
 * by the tone mapping) from the edge out to under a pixel (17.7 km) at
 * k = 1, about 30 km at 6 and 60 km at 10, then one fall-off (to half by
 * about 150 km at 6, 250 km at 10), and no rise near the shell's top (600
 * / 1000 km). Where the "top" sits inside the plateau is 8-bit noise
 * (review 2026-10-01 m2), so the plateau ends where the profile first
 * drops PLATEAU_DROP levels below its maximum, and the fall-off is checked
 * from there. Reported at x0.5, x1, x2.
 */
const PEAK_FRACTION = 0.3;
/**
 * Levels below the maximum that end the saturated plateau; 4 and 16 are
 * read from the same profile and reported (review 2026-10-01-2124 Minor
 * 7), the bound asserted at 8.
 */
const PLATEAU_DROP = 8;
const PLATEAU_DROPS = [4, PLATEAU_DROP, 16];

// WHY: the owner judges the halo's width by eye (DEC-GL4-11: as wide as
// the reference by default, the thickness slider back down to the physical
// air); this puts numbers on it. Across the lit edge, the luminance inside
// the disc and out into space per distance, at both ends of the slider and
// at the default, and the colour at the brightest point, which must stay
// blue whatever the width. Out in space the halo holds a saturated
// plateau near the edge and then falls off; it must not rise again.
test("the rim's profile at both ends of the thickness slider", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, VIEW);
  const g = await discGeometry(page);
  const r = Math.round(g.rPx);
  const inside = [-600, -300, -150, -60, -20];
  const outside = [
    0, 10, 20, 30, 45, 60, 90, 120, 150, 200, 300, 450, 600, 1000,
  ];
  const kms = [...inside, ...outside];
  const points = rowPoints(
    g,
    kms.map((km) =>
      km < 0
        ? -(r - 1 + Math.round(km / g.kmPerPx))
        : -(r + 1 + Math.round(km / g.kmPerPx)),
    ),
  );
  const rows = [];
  for (const thickness of [1, GLOBE_ATMOSPHERE.thickness, 10]) {
    await applyHash(page, `${VIEW}&atmoThickness=${thickness}`);
    const px = await page.evaluate(
      (p) => window.__globeLab.readPixels(p),
      points,
    );
    const lum = px.map(luminance);
    const out = lum.slice(inside.length);
    const top = Math.max(...out);
    const endAtFor = (drop) =>
      Math.max(
        0,
        out.findIndex((v) => v < top - drop),
      );
    const endAt = endAtFor(PLATEAU_DROP);
    rows.push({
      thickness,
      lum,
      out,
      endAt,
      endKm: outside[endAt] ?? 0,
      endKmByDrop: PLATEAU_DROPS.map((d) => outside[endAtFor(d)] ?? 0),
      brightest: px[lum.indexOf(Math.max(...lum))] ?? [0, 0, 0, 0],
    });
  }
  console.log(
    `rim profile, km from the lit edge (negative inside; ${g.kmPerPx.toFixed(1)} km a pixel): ` +
      rows
        .map(
          (row) =>
            `x${row.thickness}: ${kms.map((km, i) => `${km} ${(row.lum[i] ?? 0).toFixed(0)}`).join(", ")}; plateau ends at ${row.endKm} km (bound ${(PEAK_FRACTION * 100 * row.thickness).toFixed(0)} km: ` +
            [0.5, 1, 2]
              .map(
                (k) =>
                  `x${k} ${row.endKm <= PEAK_FRACTION * 100 * row.thickness * k ? "ok" : "NO"}`,
              )
              .join(" ") +
            `); by drop ${PLATEAU_DROPS.map((d, i) => `${d}: ${row.endKmByDrop[i]} km ${row.endKmByDrop[i] <= PEAK_FRACTION * 100 * row.thickness ? "ok" : "NO"}`).join(", ")}; brightest RGB ${row.brightest.slice(0, 3).join("/")}`,
        )
        .join("; "),
  );
  for (const row of rows) {
    // A saturated plateau near the edge, then a fall-off with no second
    // rise (1 level of slack for 8-bit rounding).
    expect(row.endKm).toBeLessThanOrEqual(PEAK_FRACTION * 100 * row.thickness);
    for (let i = row.endAt + 1; i < row.out.length; i++) {
      expect(row.out[i]).toBeLessThanOrEqual((row.out[i - 1] ?? 0) + 1);
    }
    // The rim's brightest point is blue-white, not grey or warm.
    expect(row.brightest[2]).toBeGreaterThan(row.brightest[0]);
  }
  expect(errors).toEqual([]);
});

/** Normalised canvas points on a circle of `radiusPx` about the centre, at angles from the top (clockwise, degrees). */
const circlePoints = ({ width, height }, radiusPx, degs) =>
  degs.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [
      (width / 2 + radiusPx * Math.sin(a) + 0.5) / width,
      (height / 2 - radiusPx * Math.cos(a) + 0.5) / height,
    ];
  });

/** An RGB pixel's chromaticity: each channel's share of the sum. */
const chroma = ([r, g, b]) => {
  const sum = Math.max(1, r + g + b);
  return [r / sum, g / sum, b / sum];
};

// WHY (review B2, DEC-GL4-11): the owner's rule is that the thickness
// slider changes the rim's WIDTH, not its colour. Density read at h / k
// with steps weighted 1 / k keeps the vertical optical depth, but a
// grazing ray's grows only as sqrt(k), so an uncompensated shell would
// turn the limb thinner and bluer as it widens. The colour is compared at
// the same place RELATIVE to the rim's width (a fraction of the shell's
// thickness inside and outside the lit edge), across k = 1, the default
// and 10.
test("the rim's colour stays the same across the thickness slider", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, VIEW);
  const g = await discGeometry(page);
  const r = g.rPx;
  // Fractions of the shell's thickness (100 km x k) from the lit edge.
  const fractions = [-1, -0.5, -0.25, -0.1, 0.05, 0.15, 0.3];
  const rows = [];
  for (const k of [1, GLOBE_ATMOSPHERE.thickness, 10]) {
    await applyHash(page, `${VIEW}&atmoThickness=${k}`);
    const px = await page.evaluate(
      (p) => window.__globeLab.readPixels(p),
      rowPoints(
        g,
        fractions.map((f) => -Math.round(r + (f * 100 * k) / g.kmPerPx)),
      ),
    );
    rows.push({ k, px, chroma: px.map(chroma) });
  }
  const shift = fractions.map((_, i) =>
    Math.max(
      ...rows.flatMap((a) =>
        rows.map((b) =>
          Math.max(
            ...[0, 1, 2].map((c) =>
              Math.abs((a.chroma[i]?.[c] ?? 0) - (b.chroma[i]?.[c] ?? 0)),
            ),
          ),
        ),
      ),
    ),
  );
  console.log(
    `rim colour per thickness (fractions of the shell from the lit edge ${fractions.join(", ")}): ` +
      rows
        .map(
          (row) =>
            `x${row.k}: ${row.px.map((p) => p.slice(0, 3).join("/")).join(" ")}`,
        )
        .join("; ") +
      `; largest chromaticity shift per place ${shift.map((v) => v.toFixed(3)).join(" ")}`,
  );
  // Outside the edge (the air alone, no ground behind it) the colour must
  // hold across k: measured 0.017-0.026 with the grazing compensation,
  // 0.030-0.112 without it (2026-09-30). Inside, the places sample
  // different ground at each k (a cloud at x10), so they are logged only.
  const HALO_SHIFT = 0.05;
  const halo = shift.filter((_, i) => (fractions[i] ?? 0) > 0);
  console.log(
    `halo colour shift ${Math.max(...halo).toFixed(3)} (bound ${HALO_SHIFT}: ` +
      SWEEP.map(
        (k) => `x${k} ${Math.max(...halo) < HALO_SHIFT * k ? "ok" : "NO"}`,
      ).join(" ") +
      ")",
  );
  expect(Math.max(...halo)).toBeLessThan(HALO_SHIFT);
  expect(errors).toEqual([]);
});

// WHY (review B3): a thin violet line showed along the night limb near
// where the terminator meets the edge, while the pass is on by default.
// The limb just inside and just outside the edge is read around the
// terminator's crossing at the top of the disc, from 40 degrees on the
// lit side to 40 on the night side, with the pass on and off; "violet" is
// how far red and blue both exceed green.
test("the limb at the terminator's crossing", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, `${VIEW}&atmo=0`);
  const g = await discGeometry(page);
  const degs = [-40, -20, -10, -5, 0, 5, 10, 20, 40];
  const read = async () => ({
    inside: await page.evaluate(
      (p) => window.__globeLab.readPixels(p),
      circlePoints(g, g.rPx - 2, degs),
    ),
    outside: await page.evaluate(
      (p) => window.__globeLab.readPixels(p),
      circlePoints(g, g.rPx + 3, degs),
    ),
  });
  const off = await read();
  await applyHash(page, VIEW);
  const on = await read();
  const violet = ([r, g2, b]) => Math.min(r, b) - g2;
  const fmt = (list) => list.map((p) => p.slice(0, 3).join("/")).join(" ");
  console.log(
    `terminator crossing at the top, degrees ${degs.join(", ")} (negative = lit side): ` +
      `inside on ${fmt(on.inside)}; off ${fmt(off.inside)}; outside on ${fmt(on.outside)}; ` +
      `violet inside ${on.inside.map(violet).join(" ")}, outside ${on.outside.map(violet).join(" ")}`,
  );
  // The documented range (globe-atmosphere.js.md, reviews B3 and M1/m3):
  // since the lowest-point weighting the spot at the crossing reads
  // 33/21/51 just inside and 74/48/74 just outside (violet index 12 and
  // 26, luminance up to 55; before it, 27/16/45 and 46/35/56, violet 11),
  // and from 5 degrees into the night the limb is dark (0-3 levels). The
  // bounds hold the documented values with about a third of headroom, so
  // a further unnoticed change of the spot fails here; reported at x0.5,
  // x1, x2.
  const NIGHT_LUM = 6;
  const SPOT_VIOLET = 35;
  const SPOT_LUM = 75;
  const night = degs
    .map((d, i) => [d, i])
    .filter(([d]) => d >= 5)
    .flatMap(([, i]) => [on.inside[i], on.outside[i]]);
  const nightMax = Math.max(...night.map(luminance));
  const spot = [on.inside[degs.indexOf(0)], on.outside[degs.indexOf(0)]];
  const spotViolet = Math.max(...spot.map(violet));
  const spotLum = Math.max(...spot.map(luminance));
  const bounded = (v, bound) =>
    `${v.toFixed(1)} (bound ${bound}: ${SWEEP.map((k) => `x${k} ${v < bound * k ? "ok" : "NO"}`).join(" ")})`;
  console.log(
    `terminator: night limb max ${bounded(nightMax, NIGHT_LUM)}, spot violet ${bounded(spotViolet, SPOT_VIOLET)}, spot luminance ${bounded(spotLum, SPOT_LUM)}`,
  );
  expect(nightMax).toBeLessThan(NIGHT_LUM);
  expect(spotViolet).toBeLessThan(SPOT_VIOLET);
  expect(spotLum).toBeLessThan(SPOT_LUM);
  expect(errors).toEqual([]);
});

/** The sample counts swept (the research's {6, 8, 12, 16, 24}). */
const STEPS = [6, 8, 12, 16, 24];

// WHY: too few samples band (the dense layer is thin at the limb), and
// that is the other side of the cost trade. Two profiles, across the lit
// limb and from the lit edge towards the centre, each compared with a 64
// sample reference: the largest error, and the largest step between
// neighbouring pixels beyond the reference's own (a ring shows as a step).
test("the banding per sample count, against 64 samples", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, VIEW);
  const g = await discGeometry(page);
  const r = Math.round(g.rPx);
  // Either side of the disc's edge but not across it: the ground-to-space
  // step at the edge itself is the same at every count, and its exact
  // pixel moves with the 8-bit rounding, which read as a "ring" of 0.2-5.2
  // levels at random (review 2026-10-01 m1).
  const limbIn = rowPoints(
    g,
    Array.from({ length: 30 }, (_, i) => -(r - 32 + i)),
  );
  const limbOut = rowPoints(
    g,
    Array.from({ length: 30 }, (_, i) => -(r + 3 + i)),
  );
  const radial = rowPoints(
    g,
    Array.from({ length: 60 }, (_, i) => -Math.round((r * (i + 1)) / 61)),
  );
  const profile = async (steps) => {
    await applyHash(page, `${VIEW}&atmoSteps=${steps}`);
    return {
      limbIn: await readLum(page, limbIn),
      limbOut: await readLum(page, limbOut),
      radial: await readLum(page, radial),
    };
  };
  const reference = await profile(64);
  const jump = (v) => Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i])));
  const rows = [];
  for (const steps of STEPS) {
    const p = await profile(steps);
    const worst = {};
    for (const k of /** @type {const} */ (["limbIn", "limbOut", "radial"])) {
      worst[k] = {
        error: Math.max(...p[k].map((v, i) => Math.abs(v - reference[k][i]))),
        extraJump: jump(p[k]) - jump(reference[k]),
      };
    }
    rows.push({ steps, ...worst });
  }
  console.log(
    `atmosphere banding vs 64 samples: ` +
      rows
        .map(
          (r) =>
            `${r.steps}: limb inside error ${r.limbIn.error.toFixed(1)} extra step ${r.limbIn.extraJump.toFixed(1)}, ` +
            `limb outside error ${r.limbOut.error.toFixed(1)} extra step ${r.limbOut.extraJump.toFixed(1)}, ` +
            `radial error ${r.radial.error.toFixed(1)} extra step ${r.radial.extraJump.toFixed(1)}`,
        )
        .join("; ") +
      ` (limb means ${meanOf(reference.limbIn).toFixed(1)} inside, ${meanOf(reference.limbOut).toFixed(1)} outside)`,
  );
  // At both defaults (12 samples, 8 on a touch screen) no ring: no step
  // between neighbouring pixels larger than the reference's own by RING
  // levels, either side of the edge or across the disc (reported at x0.5,
  // x1, x2).
  const RING = 4;
  for (const steps of [GLOBE_ATMOSPHERE.steps, GLOBE_ATMOSPHERE.coarseSteps]) {
    const at = rows.find((row) => row.steps === steps);
    expect(at, `${steps} samples swept`).toBeDefined();
    const worstJump = Math.max(
      at?.limbIn.extraJump ?? Infinity,
      at?.limbOut.extraJump ?? Infinity,
      at?.radial.extraJump ?? Infinity,
    );
    console.log(
      `ring at ${steps} steps: worst extra step ${worstJump.toFixed(1)}; ` +
        SWEEP.map((k) => `x${k} ${worstJump < RING * k ? "ok" : "NO"}`).join(
          " ",
        ),
    );
    expect(worstJump).toBeLessThan(RING);
  }
  expect(errors).toEqual([]);
});

/**
 * Frames per timing, readings per setting (the median counts). Kept small
 * so a slow march cannot run a test past its bound: under SwiftShader a
 * full-screen frame at the phone's pixel ratio is slow.
 */
const FRAMES = 4;
const REPEATS = 3;
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 };

async function medianMs(page) {
  const t = [];
  for (let k = 0; k < REPEATS; k++) {
    t.push(await page.evaluate((n) => window.__globeLab.timeFrames(n), FRAMES));
  }
  return t.sort((a, b) => a - b)[Math.floor(REPEATS / 2)];
}

// WHY: the research estimated a phone would pay 1.5-5 ms for this march;
// the owner decides with the ratio in hand. Logged per sample count and,
// on the phone tier, per pixel-ratio cap; SwiftShader timings are relative
// only, so each is a ratio to the pass off in the same page and setting.
// A MEASUREMENT, not a check (it cannot fail on a cost), so it runs only
// when asked: GLOBE_COST=1 (review B8; about 4 min of browser time that
// every gate would otherwise spend).
for (const [tier, use, cap] of /** @type {const} */ ([
  ["desktop 1280x800", {}, 1],
  ["phone 412x915", PHONE, 1],
  ["phone 412x915", PHONE, 1.5],
  ["phone 412x915", PHONE, 2],
])) {
  test.describe(`${tier}, pixel ratio ${cap}`, () => {
    test.use(use);
    test(`what the atmosphere costs (${tier}, pixel ratio ${cap})`, async ({
      page,
    }) => {
      test.skip(
        !process.env.GLOBE_COST,
        "a cost measurement: run with GLOBE_COST=1",
      );
      test.setTimeout(120_000);
      const view = `${VIEW}&pixelRatio=${cap}`;
      const errors = await bootGlobe(page, `${view}&atmo=0`);
      const off = await medianMs(page);
      const rows = [];
      for (const steps of STEPS) {
        await applyHash(page, `${view}&atmoSteps=${steps}`);
        rows.push({ steps, ratio: (await medianMs(page)) / off });
      }
      console.log(
        `atmosphere cost, ${tier} at pixel ratio ${cap} (frame time on / off; off ${(off / FRAMES).toFixed(0)} ms a frame, SwiftShader, relative only): ` +
          rows.map((r) => `${r.steps} steps x${r.ratio.toFixed(2)}`).join(", "),
      );
      for (const r of rows) expect(Number.isFinite(r.ratio)).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

/** The page's origin, for the geolocation grant the pin's dive needs. */
const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
/** The equator under the equinox noon sun: the dive's target. */
const UNDER_THE_SUN = { latitude: 0, longitude: 1.86 };

/**
 * Held after the pin's dive at `altKm` over the sub-solar point, with the
 * camera pitched 110 degrees up from straight down (`pitchView`), so the
 * screen's centre looks 20 degrees above the level towards the north and
 * the upper half shows the sky. The rim's light is amplified (strength 4)
 * and the sun's disc, the stars and the clouds are off, so the pixels are
 * the air's own.
 */
async function skyFromInside(page, context, altKm, thickness) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(UNDER_THE_SUN);
  const errors = await bootGlobe(
    page,
    `at=0,1.86&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&cloudOpacity=0&stars=0&milkyWay=0&sky=0&atmoStrength=4&atmoThickness=${thickness}&diveMs=1000&handOver=0&handOverKm=${altKm}`,
  );
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "landed" && s.pin.phase === "idle";
    },
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(() => window.__globeLab.pitchView(110));
  const fovY = await page.evaluate(() => window.__globeLab.state().fovY);
  // Screen rows at elevations 5-35 degrees above the level (the centre
  // looks at 20), each averaged over three columns.
  const elevations = [5, 15, 25, 35];
  const rowOf = (e) =>
    0.5 -
    Math.tan(((e - 20) * Math.PI) / 180) / Math.tan((fovY * Math.PI) / 360) / 2;
  const points = elevations.flatMap((e) =>
    [0.3, 0.5, 0.7].map((u) => [u, rowOf(e)]),
  );
  const px = await page.evaluate(
    (p) => window.__globeLab.readPixels(p),
    points,
  );
  const rows = elevations.map((e, i) => {
    const three = px.slice(3 * i, 3 * i + 3);
    return {
      e,
      lum: meanOf(three.map(luminance)),
      rgb: [0, 1, 2].map((c) => meanOf(three.map((p) => p[c]))),
    };
  });
  const state = await page.evaluate(() => window.__globeLab.state());
  return { errors, rows, altitudeKm: state.altitudeM / 1000 };
}

// WHY (review 2026-10-01, M1): the drawn shell is k times thicker than the
// real air, and from INSIDE it (the dive's last 150 km, the one-scene
// flight) a ray that climbs has its lowest point at the camera. A view
// from 150 km inside the k = 6 shell reads the air at 150 / 6 = 25 km, so
// its sky must look like the real air's from 25 km (k = 1): the same
// optical depth along every climbing ray. With the limb's weight (sqrt k)
// given to those rays too, the sky got about 2.45 times the optical depth.
/**
 * Views from inside the k-thick shell and the real air they must match:
 * a camera h km up inside it reads the air at h / k, so its sky must look
 * like the real air's from h / k (k = 1). Three pairs (review
 * 2026-10-01-2124 Minor 7: one pair was one point).
 */
const SKY_PAIRS = [
  { insideKm: 150, k: 6 },
  { insideKm: 60, k: 6 },
  { insideKm: 300, k: 10 },
];
for (const { insideKm, k } of SKY_PAIRS) {
  const realKm = insideKm / k;
  test.describe
    .serial(`the sky from ${insideKm} km inside the k = ${k} shell`, () => {
    /** @type {{ e: number, lum: number, rgb: number[] }[]} */
    let thick = [];
    test(`from ${insideKm} km at k = ${k}`, async ({ page, context }) => {
      test.setTimeout(120_000);
      const r = await skyFromInside(page, context, insideKm, k);
      thick = r.rows;
      console.log(
        `sky from ${r.altitudeKm.toFixed(0)} km at k = ${k}: ${thick.map((row) => `${row.e} deg ${row.lum.toFixed(1)} (${row.rgb.map((v) => v.toFixed(0)).join("/")})`).join(", ")}`,
      );
      expect(r.errors).toEqual([]);
    });

    test(`matches the real air from ${realKm} km (k = 1)`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000);
      const r = await skyFromInside(page, context, realKm, 1);
      const ratios = r.rows.map(
        (row, i) => (thick[i]?.lum ?? 0) / Math.max(1, row.lum),
      );
      console.log(
        `sky from ${r.altitudeKm.toFixed(0)} km at k = 1: ${r.rows.map((row) => `${row.e} deg ${row.lum.toFixed(1)} (${row.rgb.map((v) => v.toFixed(0)).join("/")})`).join(", ")}; k${k}/k1 ${ratios.map((v) => v.toFixed(2)).join(" ")}`,
      );
      // Measured 2026-10-01 for 150 km at k = 6: 0.98-1.02 with the
      // lowest-point rule, 1.41-1.72 with the limb's weight on climbing
      // rays (the review's 2.45 times the optical depth). Bound 15 %,
      // reported at x0.5, x1, x2.
      const SKY_MATCH = 0.15;
      const worst = Math.max(...ratios.map((v) => Math.abs(v - 1)));
      console.log(
        `sky match ${insideKm} km at k = ${k} vs ${realKm} km: worst ${worst.toFixed(3)} (bound ${SKY_MATCH}: ${SWEEP.map((x) => `x${x} ${worst < SKY_MATCH * x ? "ok" : "NO"}`).join(" ")})`,
      );
      expect(thick.length).toBe(r.rows.length);
      for (const row of r.rows) expect(row.lum).toBeGreaterThan(2);
      expect(worst).toBeLessThan(SKY_MATCH);
      expect(r.errors).toEqual([]);
    });
  });
}

// WHY (review 2026-10-01, M2): the march's cost is only known on the CPU
// rasteriser; it is read on the phone from the plate. The button
// must show that it is working (disabled, "Measuring...") and then give
// the device line both medians, and come back.
test("the plate measures the atmosphere's cost and shows it in the device line", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, VIEW);
  const button = page.locator("[data-atmo-cost]");
  const idle = (await button.textContent())?.trim();
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveText("Measuring...");
  await expect(button).toBeEnabled({ timeout: 90_000 });
  await expect(button).toHaveText(idle ?? "");
  const s = await page.evaluate(() => window.__globeLab.state());
  console.log(`atmosphere cost on this machine: "${s.atmosphereCost}"`);
  expect(s.atmosphereCost).toMatch(
    /^Atmosphere: \d+\.\d ms a frame on, \d+\.\d ms off \(x\d+\.\d\d\)$/,
  );
  expect(s.deviceLine).toContain(s.atmosphereCost);
  expect(s.atmosphere.on).toBe(true);
  expect(errors).toEqual([]);
});
