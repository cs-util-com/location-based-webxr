/**
 * Tests for the terrain lab's comparison plan and metric helpers (globe
 * round-5 plan 2026-10-01-0945 §3.3 "Judged end to end").
 *
 * Why this file matters: the comparison page's numbers are what the owner
 * picks a colour approach by, and they are logged, not asserted. So the
 * pieces under them are pinned here: every row is a style the lab has, the
 * plan captures what §3.3 names (300, 100, 30 and 10 km, a day and a low
 * sun, the 150 km hand-over), the ground grids sit where the fly-in looks,
 * and the statistics are the textbook ones.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { farWeights, srgbToLinear } from "./terrain-far-field.js";
import { readTerrainParams } from "./terrain-params.js";
import { flyInPoseAtAltitude, orbitPosition } from "./terrain-camera.js";
import {
  COMPARE_PLAN,
  COMPARE_VARIANTS,
  captureAltitudesKm,
  captureHash,
  darkTail,
  contrastStepM,
  footprintPoints,
  groundGrid,
  groundPixelsPerM,
  imageryPixelCentre,
  linearMeanSrgb,
  onCanvas,
  quantile,
  stats,
  withSkySweep,
} from "./terrain-compare.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

/**
 * An independent pinhole projection (look-at the origin, vertical FOV, square
 * pixels) of an ENU ground point, in pixels: the closed form in
 * `groundPixelsPerM` is checked against it.
 */
function pinholePx(pose, heightPx, fovDeg, [east, north]) {
  const [cx, cy, cz] = orbitPosition(pose);
  // three's frame: x east, y up, z south.
  const p = [east - cx, 0 - cy, -north - cz];
  const len = (v) => Math.hypot(...v);
  const norm = (v) => v.map((c) => c / len(v));
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const forward = norm([-cx, -cy, -cz]);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const f = heightPx / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const depth = dot(p, forward);
  return [(f * dot(p, right)) / depth, (f * dot(p, up)) / depth];
}

describe("the comparison's rows and plan", () => {
  it("has the rows §3.3 names, each a style the lab reads", () => {
    assert.deepEqual(
      COMPARE_VARIANTS.map((v) => v.id),
      ["A", "B", "C", "C1-d0", "C1-d0.5", "C3", "C2", "C2-w24"],
    );
    for (const v of COMPARE_VARIANTS) {
      const p = readTerrainParams(new URLSearchParams(v.hash).toString());
      assert.equal(p.style, v.hash.style, v.id);
      assert.deepEqual(p.notes, [], v.id);
    }
    assert.equal(
      new Set(COMPARE_VARIANTS.map((v) => v.id)).size,
      COMPARE_VARIANTS.length,
    );
  });

  it("captures 300, 100, 30 and 10 km at a day and a low sun, with the 150 km hand-over", () => {
    assert.deepEqual([...COMPARE_PLAN.altitudesKm], [300, 100, 30, 10]);
    assert.deepEqual(
      COMPARE_PLAN.suns.map((s) => s.id),
      ["day", "low"],
    );
    assert.equal(COMPARE_PLAN.handOverKm, 150);
    for (const s of COMPARE_PLAN.suns)
      assert.ok(Number.isFinite(Date.parse(s.time)), s.id);
  });

  // The far field is on in every capture only so every row has the
  // globe's imagery for its hand-over reference: it must change no capture
  // of a near style. Style C is the exception by design: it IS the far
  // field, so its captures sit where the blend acts (review 2026-10-01-1650
  // nit: at 300 km and below C drew exactly A).
  it("keeps the far field's weight at 0 at every near capture, and C's captures inside its blend", () => {
    const p = readTerrainParams(
      new URLSearchParams(COMPARE_PLAN.shared).toString(),
    );
    assert.equal(p.farOn, true);
    const weights = (km) =>
      farWeights(km * 1000, { on: true, highKm: p.farHigh, lowKm: p.farLow });
    for (const v of COMPARE_VARIANTS.filter((v) => v.id !== "C")) {
      for (const km of [...captureAltitudesKm(v), COMPARE_PLAN.handOverKm]) {
        assert.equal(weights(km).near, 1, `${v.id} ${km} km`);
      }
    }
    const c = COMPARE_VARIANTS.find((v) => v.id === "C");
    const near = captureAltitudesKm(c).map((km) => weights(km).near);
    assert.ok(
      near.some((w) => w < 1),
      `C's captures ${near}`,
    );
    assert.ok(near.every((w) => w >= 0 && w <= 1));
  });

  // Review 2026-10-01-1650 M1: the contrast is read from pixels, so the
  // pixel ratio is part of the measurement and must not follow the viewer's
  // screen.
  it("pins the capture pixel ratio to 1", () => {
    assert.equal(COMPARE_PLAN.shared.dpr, 1);
    const p = readTerrainParams(
      new URLSearchParams(COMPARE_PLAN.shared).toString(),
    );
    assert.equal(p.dpr, 1);
  });

  it("writes a capture's hash the lab reads back exactly", () => {
    const variant = COMPARE_VARIANTS.find((v) => v.id === "C1-d0.5");
    const sun = COMPARE_PLAN.suns[1];
    const hash = captureHash(variant, sun, {
      altitudeM: 30_000,
      tiltDeg: 52.5,
      headingDeg: 351.25,
    });
    const p = readTerrainParams(hash);
    assert.equal(p.place, "alps");
    assert.equal(p.style, "globe-albedo");
    assert.equal(p.detail, 0.5);
    assert.equal(p.light, 1);
    assert.deepEqual(p.camera, {
      altitudeM: 30_000,
      tiltDeg: 52.5,
      headingDeg: 351.25,
    });
    assert.equal(new URLSearchParams(hash).get("time"), sun.time);
  });
});

describe("groundGrid", () => {
  it("is posts x posts points stepM apart, centred on the origin", () => {
    const g = groundGrid(3, 1000);
    assert.equal(g.length, 9);
    assert.deepEqual(g[0], { x: -1000, y: -1000 });
    assert.deepEqual(g[4], { x: 0, y: 0 });
    assert.deepEqual(g[8], { x: 1000, y: 1000 });
    assert.equal(groundGrid(11, 1000).length, 121);
  });
  it("refuses a bad size or step", () => {
    assert.throws(() => groundGrid(0, 10), RangeError);
    assert.throws(() => groundGrid(3, 0), RangeError);
    assert.throws(() => groundGrid(2.5, 10), RangeError);
  });
});

describe("the statistics", () => {
  it("are the population mean and standard deviation over the finite values", () => {
    const s = stats([2, 4, 4, 4, 5, 5, 7, 9, Number.NaN]);
    assert.equal(s.mean, 5);
    assert.equal(s.std, 2);
    assert.equal(s.n, 8);
    assert.ok(Number.isNaN(stats([]).mean));
  });
  it("takes the nearest-rank quantile", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(quantile(v, 0.95), 95);
    assert.equal(quantile(v, 0), 1);
    assert.equal(quantile(v, 1), 100);
    assert.ok(Number.isNaN(quantile([], 0.5)));
  });
  it("keeps only points on the canvas", () => {
    assert.equal(onCanvas([0.5, 0.5]), true);
    assert.equal(onCanvas([-0.01, 0.5]), false);
    assert.equal(onCanvas([0.5, 1.2]), false);
  });
});

describe("the contrast grid's pixel scale (review 2026-10-01-1650 M1)", () => {
  // The closed form against an independent pinhole projection: a 1 km step
  // across and along the view at the target, for the fly-in's poses.
  it("is the pinhole camera's pixels per metre across and along the view", () => {
    for (const km of [10, 30, 100, 150, 300]) {
      const pose = flyInPoseAtAltitude(km * 1000);
      const got = groundPixelsPerM(pose, 500, 50);
      const h = (pose.headingDeg * Math.PI) / 180;
      // Across: perpendicular to the heading; along: the heading itself.
      const across = [Math.cos(h) * 500, -Math.sin(h) * 500];
      const along = [Math.sin(h) * 500, Math.cos(h) * 500];
      const span = (d) => {
        const a = pinholePx(pose, 500, 50, d);
        const b = pinholePx(pose, 500, 50, [-d[0], -d[1]]);
        return Math.hypot(a[0] - b[0], a[1] - b[1]) / 1000;
      };
      close(got.across, span(across), 0.002 * got.across, `${km} km across`);
      close(got.along, span(along), 0.01 * got.along, `${km} km along`);
    }
  });

  // The review's own numbers for the 800 x 500 frame at 300 km: 1 km is
  // about 1.15 px across and 0.74 px along (the page's comment said 3 px).
  it("matches the review's numbers at 300 km in a 500 px high frame", () => {
    const got = groundPixelsPerM(flyInPoseAtAltitude(300_000), 500, 50);
    close(got.across * 1000, 1.15, 0.01, "across");
    close(got.along * 1000, 0.74, 0.01, "along");
  });

  it("refuses a frame or field of view that cannot project", () => {
    const pose = flyInPoseAtAltitude(100_000);
    assert.throws(() => groundPixelsPerM(pose, 0, 50), RangeError);
    assert.throws(() => groundPixelsPerM(pose, 500, 0), RangeError);
    assert.throws(() => groundPixelsPerM(pose, 500, 180), RangeError);
  });

  // Posts closer than a few pixels read the same pixel twice, and the
  // spread then measures the frame's resolution, not the relief. So the
  // step grows with the altitude until the posts are `minPostPx` apart
  // along the view, and never shrinks below the plan's 1 km.
  it("spaces the contrast posts at least minPostPx apart, never under the plan's step", () => {
    for (const km of COMPARE_PLAN.altitudesKm) {
      const pose = flyInPoseAtAltitude(km * 1000);
      const step = contrastStepM(pose, 500, 50);
      const { along } = groundPixelsPerM(pose, 500, 50);
      assert.ok(step >= COMPARE_PLAN.contrastStepM, `${km} km: ${step}`);
      assert.ok(
        step * along >= COMPARE_PLAN.minPostPx - 1e-9,
        `${km} km: ${step * along} px`,
      );
      assert.equal(step % 100, 0, `${km} km: a whole 100 m`);
    }
    // Low down 1 km is already wide on the frame; high up it is not.
    assert.equal(contrastStepM(flyInPoseAtAltitude(10_000), 500, 50), 1000);
    assert.ok(contrastStepM(flyInPoseAtAltitude(300_000), 500, 50) > 3000);
  });
});

describe("the footprint-averaged hand-over (review 2026-10-01-1650 M2)", () => {
  // The globe's pixel is one imagery pixel: the render is averaged over
  // exactly that pixel's footprint, so the box must be centred on it.
  it("snaps a position to its imagery pixel's centre", () => {
    const level = 5;
    const deg = 180 / 2 ** level / 256;
    const c = imageryPixelCentre(46.56, 9.14, level);
    close(((c.lng + 180) / deg) % 1, 0.5, 1e-9, "lng at a centre");
    close(((90 - c.lat) / deg) % 1, 0.5, 1e-9, "lat at a centre");
    assert.ok(Math.abs(c.lng - 9.14) <= deg / 2 + 1e-12);
    assert.ok(Math.abs(c.lat - 46.56) <= deg / 2 + 1e-12);
    // Idempotent: a centre is its own centre.
    assert.deepEqual(imageryPixelCentre(c.lat, c.lng, level), c);
  });

  it("samples a footprint on an n x n grid of cell centres", () => {
    const pts = footprintPoints(1000, -500, 2000, 1000, 2);
    assert.deepEqual(pts, [
      { x: 500, y: -750 },
      { x: 1500, y: -750 },
      { x: 500, y: -250 },
      { x: 1500, y: -250 },
    ]);
    assert.throws(() => footprintPoints(0, 0, 1, 1, 0), RangeError);
  });

  // A box average of a render is an average of LIGHT: two pixels, black and
  // white, average to the sRGB of linear 0.5 (0.735), not to 0.5.
  it("averages colours in linear light", () => {
    const mean = linearMeanSrgb([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    mean.forEach((v) => close(srgbToLinear(v), 0.5, 1e-3, "grey"));
    assert.deepEqual(
      linearMeanSrgb([[0.2, 0.4, 0.6]]).map((v) => +v.toFixed(3)),
      [0.2, 0.4, 0.6],
    );
    assert.equal(linearMeanSrgb([]), null);
  });
});

describe("the sky-fill sweep (DEC-GL5-11)", () => {
  // The sky floor is judged across a range, never at one value: every
  // picked row is captured at every floor of the sweep, each its own row.
  it("repeats each row at every floor, the floor in its hash and its id", () => {
    const rows = withSkySweep(
      COMPARE_VARIANTS.filter((v) => ["B", "C1-d0.5"].includes(v.id)),
      [0, 0.5],
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ["B@sky0", "B@sky0.5", "C1-d0.5@sky0", "C1-d0.5@sky0.5"],
    );
    assert.equal(rows[3].hash.sky, 0.5);
    assert.equal(rows[3].hash.style, "globe-albedo");
    assert.equal(rows[3].hash.detail, 0.5);
    assert.match(rows[3].label, /sky floor 0\.5/);
    // The lab reads the floor back from the capture's hash.
    const pose = flyInPoseAtAltitude(30_000);
    const hash = captureHash(rows[3], COMPARE_PLAN.suns[1], pose);
    assert.equal(readTerrainParams(hash).sky, 0.5);
  });

  it("keeps the rows as they are with no floors, and a row's own altitudes", () => {
    assert.deepEqual(withSkySweep(COMPARE_VARIANTS, []), COMPARE_VARIANTS);
    const c = withSkySweep(
      COMPARE_VARIANTS.filter((v) => v.id === "C"),
      [1],
    );
    assert.deepEqual(c[0].altitudesKm, [1500, 900, 600, 300]);
  });

  it("refuses a floor outside 0-1", () => {
    assert.throws(() => withSkySweep(COMPARE_VARIANTS, [1.5]), RangeError);
    assert.throws(() => withSkySweep(COMPARE_VARIANTS, [NaN]), RangeError);
  });
});

describe("the dark tail (DEC-GL5-11: do the shadows keep their colour?)", () => {
  // The low-sun question is about the darkest ground: its luminance, and
  // whether it still carries a hue (CIELAB chroma) or has sunk to grey.
  it("reads the darkest share's luminance quantile and mean chroma", () => {
    const grey = [10, 10, 10];
    const green = [20, 60, 10];
    const white = [250, 250, 250];
    const px = [
      ...Array(8).fill(white),
      grey,
      [12, 12, 12],
      ...Array(10).fill(green),
    ];
    const t = darkTail(px, 0.1);
    // 20 pixels: the darkest tenth is the two greys.
    assert.equal(t.n, 2);
    // Nearest rank: the 2nd of 20, the lighter grey.
    close(t.p, 12, 1e-9, "p10");
    assert.ok(t.chroma < 0.5, `grey has no chroma: ${t.chroma}`);
    const g = darkTail(Array(10).fill(green), 0.1);
    assert.ok(g.chroma > 20, `green keeps its chroma: ${g.chroma}`);
  });

  it("is NaN-free on an empty set", () => {
    const t = darkTail([], 0.1);
    assert.equal(t.n, 0);
    assert.ok(Number.isNaN(t.p) && Number.isNaN(t.chroma));
  });
});
