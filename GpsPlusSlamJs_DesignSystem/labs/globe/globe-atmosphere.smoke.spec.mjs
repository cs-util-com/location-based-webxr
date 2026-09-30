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
 * disc's centre. No stars or Milky Way, so space reads black; the clouds
 * pinned in place.
 */
const VIEW =
  "at=0,91.86&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&stars=0&milkyWay=0";

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
 * Where the halo may peak outside the lit edge, as a fraction of the
 * shell's thickness (100 km x k). Physically the limb is brightest a
 * little above the ground, where a grazing ray's optical depth falls to
 * about 1 (about 20 km for the real air: 8 km scale height, a grazing
 * depth of 7-20 at the ground), and the thicker shell keeps that depth
 * (review B2), so the peak moves out with k. Measured 2026-09-30 with the
 * grazing compensation: a near-white plateau (163-167 levels) from the
 * edge out to under a pixel (17.7 km) at k = 1, about 30 km at 6 and 60 km
 * at 10, its top at 0, 10 and 45 km, then one fall-off (to half by about 150 km at 6, 250 km at 10);
 * no rise near the shell's top (600 / 1000 km). Without the compensation
 * the top sat at the edge. Reported at x0.5, x1, x2.
 */
const PEAK_FRACTION = 0.3;

// WHY: the owner judges the halo's width by eye (DEC-GL4-11: as wide as
// the reference by default, the thickness slider back down to the physical
// air); this puts numbers on it. Across the lit edge, the luminance inside
// the disc and out into space per distance, at both ends of the slider and
// at the default, and the colour at the brightest point, which must stay
// blue whatever the width. Out in space the halo rises to one peak near
// the edge and then falls off; it must not rise again.
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
    const peakAt = out.indexOf(Math.max(...out));
    rows.push({
      thickness,
      lum,
      out,
      peakAt,
      peakKm: outside[peakAt] ?? 0,
      brightest: px[lum.indexOf(Math.max(...lum))] ?? [0, 0, 0, 0],
    });
  }
  console.log(
    `rim profile, km from the lit edge (negative inside; ${g.kmPerPx.toFixed(1)} km a pixel): ` +
      rows
        .map(
          (row) =>
            `x${row.thickness}: ${kms.map((km, i) => `${km} ${(row.lum[i] ?? 0).toFixed(0)}`).join(", ")}; halo peak at ${row.peakKm} km (bound ${(PEAK_FRACTION * 100 * row.thickness).toFixed(0)} km: ` +
            [0.5, 1, 2]
              .map(
                (k) =>
                  `x${k} ${row.peakKm <= PEAK_FRACTION * 100 * row.thickness * k ? "ok" : "NO"}`,
              )
              .join(" ") +
            `); brightest RGB ${row.brightest.slice(0, 3).join("/")}`,
        )
        .join("; "),
  );
  for (const row of rows) {
    // One peak near the edge, then a fall-off with no second rise (1
    // level of slack for 8-bit rounding).
    expect(row.peakKm).toBeLessThanOrEqual(PEAK_FRACTION * 100 * row.thickness);
    for (let i = row.peakAt + 1; i < row.out.length; i++) {
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
  const limb = rowPoints(
    g,
    Array.from({ length: 41 }, (_, i) => -(r - 20 + i)),
  );
  const radial = rowPoints(
    g,
    Array.from({ length: 60 }, (_, i) => -Math.round((r * (i + 1)) / 61)),
  );
  const profile = async (steps) => {
    await applyHash(page, `${VIEW}&atmoSteps=${steps}`);
    return {
      limb: await readLum(page, limb),
      radial: await readLum(page, radial),
    };
  };
  const reference = await profile(64);
  const jump = (v) => Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i])));
  const rows = [];
  for (const steps of STEPS) {
    const p = await profile(steps);
    const worst = {};
    for (const k of /** @type {const} */ (["limb", "radial"])) {
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
            `${r.steps}: limb error ${r.limb.error.toFixed(1)} extra step ${r.limb.extraJump.toFixed(1)}, ` +
            `radial error ${r.radial.error.toFixed(1)} extra step ${r.radial.extraJump.toFixed(1)}`,
        )
        .join("; ") +
      ` (limb mean ${meanOf(reference.limb).toFixed(1)})`,
  );
  // At the default count no ring: no step between neighbouring pixels
  // larger than the reference's own by `RING` levels (reported at x0.5,
  // x1, x2; measured at most 1.6 at every count, 2026-09-30).
  const RING = 4;
  const atDefault = rows.find((r) => r.steps === GLOBE_ATMOSPHERE.steps);
  expect(atDefault).toBeDefined();
  const worstJump = Math.max(
    atDefault?.limb.extraJump ?? Infinity,
    atDefault?.radial.extraJump ?? Infinity,
  );
  console.log(
    `ring at ${GLOBE_ATMOSPHERE.steps} steps: worst extra step ${worstJump.toFixed(1)}; ` +
      SWEEP.map((k) => `x${k} ${worstJump < RING * k ? "ok" : "NO"}`).join(" "),
  );
  expect(worstJump).toBeLessThan(RING);
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
