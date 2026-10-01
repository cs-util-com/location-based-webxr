/**
 * The terrain lab's comparison page (globe round-5 plan 2026-10-01-0945 §3.3
 * "Judged end to end"): ONE terrain lab in a frame, driven through its test
 * hooks along its fly-in onto the Alps, captured at 300, 100, 30 and 10 km
 * at a day and a low sun, one row per colour approach, with the numbers the
 * owner picks by: the colour difference to the globe's pixel at the
 * hand-over altitude (per ground point, and averaged over each imagery
 * pixel's footprint), the local contrast on the ground and the frame cost.
 * The numbers are LOGGED (a table, the console, `window.__terrainCompare`),
 * never asserted.
 *
 * `?quick=1` runs two rows at one altitude and one sun (the smoke's
 * bounded run). `?rows=A,C1-d0.5` picks rows by id.
 *
 * @see compare.js.md
 */
import {
  COMPARE_PLAN,
  COMPARE_VARIANTS,
  captureAltitudesKm,
  captureHash,
  contrastStepM,
  footprintPoints,
  groundGrid,
  groundPixelsPerM,
  imageryPixelCentre,
  linearMeanSrgb,
  onCanvas,
  quantile,
  stats,
} from "./terrain-compare.js";
import { flyInPoseAtAltitude } from "./terrain-camera.js";
import { FAR_FIELD } from "./terrain-far-field.js";
import { deltaE76, footprintM } from "./terrain-globe-colour.js";
import { sunLitColour } from "./terrain-sun.js";

const frame = /** @type {HTMLIFrameElement} */ (
  document.getElementById("compare-frame")
);
const table = document.getElementById("compare-table");
const statusLine = document.getElementById("compare-status");

const query = new URLSearchParams(location.search);
const quick = query.get("quick") === "1";
const wanted = (query.get("rows") ?? "").split(",").filter(Boolean);
const variants = quick
  ? COMPARE_VARIANTS.filter((v) => ["A", "C1-d0.5"].includes(v.id))
  : wanted.length > 0
    ? COMPARE_VARIANTS.filter((v) => wanted.includes(v.id))
    : COMPARE_VARIANTS;
/** A row's capture altitudes (C has its own); one for a quick run. */
const altitudesFor = (variant) =>
  quick ? [100] : [...captureAltitudesKm(variant)];
const suns = quick ? [COMPARE_PLAN.suns[0]] : [...COMPARE_PLAN.suns];

/** The page's results, for a reader and for the smoke. */
const results = {
  done: false,
  error: null,
  rows: [],
  buffer: null,
  pixelRatio: null,
};
window.__terrainCompare = results;

const say = (text) => {
  statusLine.textContent = text;
};

/** Resolves when `test` is true, polled each animation frame (bounded). */
function until(test, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const step = () => {
      let ok = false;
      try {
        ok = test();
      } catch {
        ok = false;
      }
      if (ok) return resolve();
      if (performance.now() - started > timeoutMs) {
        return reject(new Error(`timed out waiting for ${what}`));
      }
      requestAnimationFrame(step);
    };
    step();
  });
}

const lab = () => frame.contentWindow?.__terrainLab;

/** Sets the lab's hash and waits until it is applied and its data is in. */
async function show(hash) {
  frame.contentWindow.location.hash = hash;
  await until(() => lab().state().appliedHash === hash, 30_000, "the hash");
  await until(
    () => {
      const s = lab().state();
      if (s.hasData === null) return false;
      if (s.imageryOn && s.farState !== "ready" && s.farState !== "failed") {
        return false;
      }
      if (s.style === "globe-albedo" && s.farState === "ready") {
        if (!s.globeColour.albedo || !s.globeColour.coarse) return false;
      }
      if (s.style === "globe-bands" && s.farState === "ready") {
        if (!s.globeColour.bands) return false;
      }
      return s.svfDone || !s.loadingVisible;
    },
    180_000,
    "the relief and its imagery",
  );
  return lab().state();
}

/** Ground points of a grid, with heights, lifted as the page draws them. */
function lifted(points, s) {
  const out = [];
  for (const p of points) {
    const f = lab().fieldAt(p.x, p.y);
    if (f)
      out.push({
        ...p,
        h: f.heightM,
        lift: s.effectiveE * (f.heightM - s.datum),
      });
  }
  return out;
}

const luminance = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];

/**
 * The median distance in drawing pixels between grid neighbours (the posts
 * as projected, `posts` x `posts`, row by row), the smaller of the two
 * directions: the measured post spacing beside the modelled one.
 */
function postSpacingPx(at, posts, buffer) {
  const gaps = { x: [], y: [] };
  for (let j = 0; j < posts; j++) {
    for (let i = 0; i < posts; i++) {
      const a = at[j * posts + i];
      const d = (b) =>
        Math.hypot((b[0] - a[0]) * buffer.width, (b[1] - a[1]) * buffer.height);
      if (i + 1 < posts) gaps.x.push(d(at[j * posts + i + 1]));
      if (j + 1 < posts) gaps.y.push(d(at[(j + 1) * posts + i]));
    }
  }
  return Math.min(quantile(gaps.x, 0.5), quantile(gaps.y, 0.5));
}

/**
 * Local contrast: the luminance spread over an 11 x 11 ground grid around
 * the place, its step widened per altitude until the posts are
 * `minPostPx` drawing pixels apart along the view (review 2026-10-01-1650
 * M1), with the pixel scale it rests on: the modelled px/km and the
 * measured post spacing.
 */
function localContrast(s, pose) {
  const stepM = contrastStepM(pose, s.buffer.height, s.fovDeg);
  const perM = groundPixelsPerM(pose, s.buffer.height, s.fovDeg);
  const posts = COMPARE_PLAN.contrastPosts;
  const grid = groundGrid(posts, stepM);
  const ground = lifted(grid, s);
  const at = lab().projectAll(ground.map((p) => [p.x, p.lift, -p.y]));
  const keep = at.map(onCanvas);
  const px = lab().readPixels(at.filter((_, i) => keep[i]));
  return {
    ...stats(px.map(luminance)),
    stepM,
    scaled: stepM > COMPARE_PLAN.contrastStepM,
    pxPerKm: { across: perM.across * 1000, along: perM.along * 1000 },
    postPx:
      ground.length === grid.length
        ? postSpacingPx(at, posts, s.buffer)
        : Number.NaN,
  };
}

/** Mean, 95th percentile and count of the finite differences. */
const summary = (diffs) => {
  const d = diffs.filter(Number.isFinite);
  return { mean: stats(d).mean, p95: quantile(d, 0.95), n: d.length };
};

/**
 * The colour difference to the globe's pixel at the hand-over, two ways
 * (review 2026-10-01-1650 M2). The globe's pixel is modelled as the globe
 * draws flat ground: its imagery under its sun, `sunLitColour(imagery,
 * max(0, sun.z))` at the page's `sunIntensity`, with no atmosphere veil and
 * no specular (compare.js.md says what that omits and whom it favours).
 *
 * - `point`: each ground point's rendered pixel against the bilinear
 *   imagery there. Relief shading counts as colour error here.
 * - `footprint`: the render box-averaged in linear light over each imagery
 *   pixel's footprint (`footprintSamples`^2 points over the 2.45 km pixel)
 *   against that one pixel's globe colour: what the globe shows at the
 *   hand-over, where one imagery pixel is a few screen pixels. A footprint
 *   with any point off the canvas or off the field is left out.
 */
function handOverDifference(s) {
  const grid = groundGrid(
    COMPARE_PLAN.handOverPosts,
    COMPARE_PLAN.handOverStepM,
  );
  const ground = lifted(grid, s);
  const light = Math.max(0, s.sun.enu[2]);
  const globeAt = (lat, lng) => {
    const imagery = lab().imageryAt(lat, lng);
    return imagery ? sunLitColour(imagery, light, s.sunIntensity) : null;
  };
  // The footprints: each grid point's imagery pixel, sampled n x n.
  const n = COMPARE_PLAN.footprintSamples;
  const boxes = [];
  for (const p of ground) {
    const ll = lab().toLatLng(p.x, p.y);
    const centre = imageryPixelCentre(ll.lat, ll.lng, FAR_FIELD.level);
    const e = lab().toEnu(centre.lat, centre.lng);
    const [wx, wy] = footprintM(FAR_FIELD.level, centre.lat);
    const pts = lifted(footprintPoints(e.x, e.y, wx, wy, n), s);
    if (pts.length === n * n) boxes.push({ centre, pts });
  }
  const all = [...ground, ...boxes.flatMap((b) => b.pts)];
  const at = lab().projectAll(all.map((p) => [p.x, p.lift, -p.y]));
  const on = at.map(onCanvas);
  const px = lab().readPixels(at.map((uv, i) => (on[i] ? uv : [0, 0])));
  const rgb = (i) => px[i].slice(0, 3).map((v) => v / 255);
  const point = ground.map((p, i) => {
    if (!on[i]) return Number.NaN;
    const { lat, lng } = lab().toLatLng(p.x, p.y);
    const globe = globeAt(lat, lng);
    return globe ? deltaE76(globe, rgb(i)) : Number.NaN;
  });
  let next = ground.length;
  const footprint = boxes.map((b) => {
    const idx = b.pts.map((_, j) => next + j);
    next += b.pts.length;
    if (!idx.every((i) => on[i])) return Number.NaN;
    const globe = globeAt(b.centre.lat, b.centre.lng);
    return globe ? deltaE76(globe, linearMeanSrgb(idx.map(rgb))) : Number.NaN;
  });
  return { point: summary(point), footprint: summary(footprint) };
}

/** A capture as a small captioned canvas (the buffer's rows flipped). */
function thumbnail(caption) {
  const { width, height, px } = lab().capture();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  for (let row = 0; row < height; row++) {
    const from = (height - 1 - row) * width * 4;
    image.data.set(px.subarray(from, from + width * 4), row * width * 4);
  }
  context.putImageData(image, 0, 0);
  canvas.className = "compare-thumb";
  const figure = document.createElement("figure");
  const text = document.createElement("figcaption");
  text.textContent = caption;
  figure.append(canvas, text);
  return figure;
}

const fmt = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "-");

/** The header: one column of captures per sun, then the numbers. */
function header(first) {
  const row = document.createElement("tr");
  const cells = ["Variant"];
  for (const sun of suns) cells.push(`${sun.label}: captures along the fly-in`);
  cells.push(
    `ΔE to the globe at ${COMPARE_PLAN.handOverKm} km, mean / p95: per point; averaged over each imagery pixel`,
    "Local contrast per altitude: luminance sd / mean / sd over mean, on posts [step] apart (* step widened to keep the posts 3 px apart)",
    `Frame cost: x the first row (${first.label}), mean ± sd of ${COMPARE_PLAN.costFrames} frames`,
  );
  for (const text of cells) {
    const th = document.createElement("th");
    th.textContent = text;
    row.append(th);
  }
  table.append(row);
}

async function run() {
  header(variants[0]);
  const first = captureHash(
    variants[0],
    suns[0],
    flyInPoseAtAltitude(altitudesFor(variants[0])[0] * 1000),
  );
  frame.src = `./index.html#${first}`;
  await until(() => lab()?.ready || lab()?.error, 120_000, "the lab");
  if (lab().error) throw new Error(lab().error);
  let costFirst = null;
  for (const variant of variants) {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.textContent = variant.label;
    row.append(name);
    table.append(row);
    const out = { id: variant.id, label: variant.label, suns: {} };
    const altitudesKm = altitudesFor(variant);
    for (const sun of suns) {
      const perSun = { contrast: {}, handOver: null };
      out.suns[sun.id] = perSun;
      const hand = flyInPoseAtAltitude(COMPARE_PLAN.handOverKm * 1000);
      say(
        `${variant.label}: ${sun.label}, the hand-over at ${COMPARE_PLAN.handOverKm} km`,
      );
      let s = await show(captureHash(variant, sun, hand));
      results.buffer ??= { ...s.buffer };
      results.pixelRatio ??= s.pixelRatio;
      perSun.handOver = handOverDifference(s);
      perSun.sunElevationDeg = s.sun.elevationDeg;
      const cell = document.createElement("td");
      cell.className = "compare-captures";
      for (const km of altitudesKm) {
        say(`${variant.label}: ${sun.label}, ${km} km`);
        const pose = flyInPoseAtAltitude(km * 1000);
        s = await show(captureHash(variant, sun, pose));
        perSun.contrast[km] = localContrast(s, pose);
        cell.append(thumbnail(`${km} km`));
      }
      row.append(cell);
    }
    // The cost at the day sun, 30 km (or the row's lowest altitude).
    const costKm = altitudesKm.includes(30) ? 30 : altitudesKm.at(-1);
    await show(
      captureHash(variant, suns[0], flyInPoseAtAltitude(costKm * 1000)),
    );
    const cost = stats(lab().frameCost(COMPARE_PLAN.costFrames));
    costFirst ??= cost.mean;
    out.frame = { meanMs: cost.mean, sdMs: cost.std, atKm: costKm };
    out.costRatio = cost.mean / costFirst;
    const contrastText = (c, km) =>
      `${km} km ${fmt(c.std)} / ${fmt(c.mean, 0)} / ${fmt(c.std / c.mean, 2)} ` +
      `[${fmt(c.stepM / 1000, 1)} km${c.scaled ? "*" : ""}]`;
    const numbers = [
      suns
        .map((sun) => {
          const h = out.suns[sun.id].handOver;
          return (
            `${sun.label}: ${fmt(h.point.mean)} / ${fmt(h.point.p95)}; ` +
            `${fmt(h.footprint.mean)} / ${fmt(h.footprint.p95)}`
          );
        })
        .join(" | "),
      suns
        .map(
          (sun) =>
            `${sun.label}: ` +
            altitudesKm
              .map((km) => contrastText(out.suns[sun.id].contrast[km], km))
              .join(", "),
        )
        .join(" | "),
      `x${fmt(out.costRatio, 2)} (${fmt(cost.mean, 0)} ± ${fmt(cost.std, 0)} ms at ${costKm} km)`,
    ];
    for (const text of numbers) {
      const td = document.createElement("td");
      td.className = "compare-numbers";
      td.textContent = text;
      row.append(td);
    }
    results.rows.push(out);
    console.log(
      `compare ${variant.id}: ` +
        suns
          .map((sun) => {
            const p = out.suns[sun.id];
            return (
              `${sun.id} (sun ${fmt(p.sunElevationDeg)}°) ΔE@${COMPARE_PLAN.handOverKm}km ` +
              `point ${fmt(p.handOver.point.mean, 2)}/${fmt(p.handOver.point.p95, 2)} (n ${p.handOver.point.n}) ` +
              `footprint ${fmt(p.handOver.footprint.mean, 2)}/${fmt(p.handOver.footprint.p95, 2)} (n ${p.handOver.footprint.n}), contrast ` +
              altitudesKm
                .map((km) => {
                  const c = p.contrast[km];
                  return (
                    `${km}:sd ${fmt(c.std, 2)} mean ${fmt(c.mean, 1)} cv ${fmt(c.std / c.mean, 3)} ` +
                    `step ${c.stepM} m${c.scaled ? "*" : ""} posts ${fmt(c.postPx, 1)} px ` +
                    `(model ${fmt(c.pxPerKm.along, 2)} along / ${fmt(c.pxPerKm.across, 2)} across px/km)`
                  );
                })
                .join(" ")
            );
          })
          .join("; ") +
        `; cost x${fmt(out.costRatio, 2)} (${fmt(cost.mean, 0)} ± ${fmt(cost.std, 0)} ms)`,
    );
  }
  console.log(
    `compare buffer ${results.buffer.width} x ${results.buffer.height} at pixel ratio ${results.pixelRatio}`,
  );
  say(
    `Done: ${variants.length} variants, ${suns.length} suns; drawing buffer ` +
      `${results.buffer.width} x ${results.buffer.height} (pixel ratio ${results.pixelRatio}).`,
  );
  results.done = true;
}

run().catch((e) => {
  results.error = String(e?.stack ?? e);
  results.done = true;
  say(`Failed: ${e?.message ?? e}`);
});
