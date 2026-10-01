/**
 * The terrain lab's comparison page (globe round-5 plan 2026-10-01-0945 §3.3
 * "Judged end to end"): ONE terrain lab in a frame, driven through its test
 * hooks along its fly-in onto the Alps, captured at 300, 100, 30 and 10 km
 * at a day and a low sun, one row per colour approach, with the numbers the
 * owner picks by: the colour difference to the globe's pixel at the
 * hand-over altitude, the local contrast at 1-10 km and the frame cost.
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
  captureHash,
  groundGrid,
  onCanvas,
  quantile,
  stats,
} from "./terrain-compare.js";
import { flyInPoseAtAltitude } from "./terrain-camera.js";
import { deltaE76 } from "./terrain-globe-colour.js";
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
const altitudesKm = quick ? [100] : [...COMPARE_PLAN.altitudesKm];
const suns = quick ? [COMPARE_PLAN.suns[0]] : [...COMPARE_PLAN.suns];

/** The page's results, for a reader and for the smoke. */
const results = { done: false, error: null, rows: [] };
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
    if (f) out.push({ ...p, h: f.heightM, lift: s.effectiveE * (f.heightM - s.datum) });
  }
  return out;
}

const luminance = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];

/** Local contrast: the luminance spread over the 11 x 11 km ground grid. */
function localContrast(s) {
  const ground = lifted(
    groundGrid(COMPARE_PLAN.contrastPosts, COMPARE_PLAN.contrastStepM),
    s,
  );
  const at = lab().projectAll(ground.map((p) => [p.x, p.lift, -p.y]));
  const keep = at.map(onCanvas);
  const px = lab().readPixels(at.filter((_, i) => keep[i]));
  return stats(px.map(luminance));
}

/**
 * The colour difference to the globe's pixel at the hand-over: each ground
 * point's rendered colour against what the globe draws there (its imagery
 * under its sun, lit flat: `sunLitColour(imagery, max(0, sun.z))`).
 */
function handOverDifference(s) {
  const ground = lifted(
    groundGrid(COMPARE_PLAN.handOverPosts, COMPARE_PLAN.handOverStepM),
    s,
  );
  const at = lab().projectAll(ground.map((p) => [p.x, p.lift, -p.y]));
  const use = ground
    .map((p, i) => ({ p, uv: at[i] }))
    .filter(({ uv }) => onCanvas(uv));
  const px = lab().readPixels(use.map(({ uv }) => uv));
  const light = Math.max(0, s.sun.enu[2]);
  const diffs = use
    .map(({ p }, i) => {
      const { lat, lng } = lab().toLatLng(p.x, p.y);
      const imagery = lab().imageryAt(lat, lng);
      if (!imagery) return Number.NaN;
      const globe = sunLitColour(imagery, light);
      return deltaE76(
        globe,
        px[i].slice(0, 3).map((v) => v / 255),
      );
    })
    .filter(Number.isFinite);
  return { mean: stats(diffs).mean, p95: quantile(diffs, 0.95), n: diffs.length };
}

/** A capture as a small canvas (the buffer's rows flipped to the top). */
function thumbnail() {
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
  return canvas;
}

const fmt = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "-");

/** The header: the captures' columns, then the numbers. */
function header() {
  const row = document.createElement("tr");
  const cells = ["Variant"];
  for (const sun of suns) {
    for (const km of altitudesKm) cells.push(`${sun.label}, ${km} km`);
  }
  cells.push(
    `ΔE to the globe at ${COMPARE_PLAN.handOverKm} km (mean / p95)`,
    "Local contrast 1-10 km (luminance sd / mean / sd over mean, per altitude)",
    "Frame cost (x A)",
  );
  for (const text of cells) {
    const th = document.createElement("th");
    th.textContent = text;
    row.append(th);
  }
  table.append(row);
}

async function run() {
  header();
  const first = captureHash(
    variants[0],
    suns[0],
    flyInPoseAtAltitude(altitudesKm[0] * 1000),
  );
  frame.src = `./index.html#${first}`;
  await until(() => lab()?.ready || lab()?.error, 120_000, "the lab");
  if (lab().error) throw new Error(lab().error);
  let costA = null;
  for (const variant of variants) {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.textContent = variant.label;
    row.append(name);
    table.append(row);
    const out = { id: variant.id, label: variant.label, suns: {} };
    for (const sun of suns) {
      const perSun = { contrast: {}, handOver: null };
      out.suns[sun.id] = perSun;
      const hand = flyInPoseAtAltitude(COMPARE_PLAN.handOverKm * 1000);
      say(`${variant.label}: ${sun.label}, the hand-over at ${COMPARE_PLAN.handOverKm} km`);
      let s = await show(captureHash(variant, sun, hand));
      perSun.handOver = handOverDifference(s);
      perSun.sunElevationDeg = s.sun.elevationDeg;
      for (const km of altitudesKm) {
        say(`${variant.label}: ${sun.label}, ${km} km`);
        s = await show(captureHash(variant, sun, flyInPoseAtAltitude(km * 1000)));
        perSun.contrast[km] = localContrast(s);
        const cell = document.createElement("td");
        cell.append(thumbnail());
        row.append(cell);
      }
    }
    // The cost at the day sun, 30 km (or the one altitude of a quick run).
    const costKm = altitudesKm.includes(30) ? 30 : altitudesKm[0];
    await show(captureHash(variant, suns[0], flyInPoseAtAltitude(costKm * 1000)));
    const ms = lab().frameCost(COMPARE_PLAN.costFrames);
    costA ??= ms;
    out.frameMs = ms;
    out.costRatio = ms / costA;
    const numbers = [
      suns
        .map((sun) => {
          const h = out.suns[sun.id].handOver;
          return `${sun.label}: ${fmt(h.mean)} / ${fmt(h.p95)}`;
        })
        .join("; "),
      suns
        .map(
          (sun) =>
            `${sun.label}: ` +
            altitudesKm
              .map((km) => {
                const c = out.suns[sun.id].contrast[km];
                return `${km} km ${fmt(c.std)} / ${fmt(c.mean, 0)} / ${fmt(c.std / c.mean, 2)}`;
              })
              .join(", "),
        )
        .join("; "),
      `${fmt(out.costRatio, 2)}`,
    ];
    for (const text of numbers) {
      const cell = document.createElement("td");
      cell.className = "compare-numbers";
      cell.textContent = text;
      row.append(cell);
    }
    results.rows.push(out);
    console.log(
      `compare ${variant.id}: ` +
        suns
          .map((sun) => {
            const p = out.suns[sun.id];
            return (
              `${sun.id} (sun ${fmt(p.sunElevationDeg)}°) ΔE@${COMPARE_PLAN.handOverKm}km ` +
              `${fmt(p.handOver.mean, 2)}/${fmt(p.handOver.p95, 2)} (n ${p.handOver.n}), contrast ` +
              altitudesKm
                .map((km) => {
                  const c = p.contrast[km];
                  return `${km}:sd ${fmt(c.std, 2)} mean ${fmt(c.mean, 1)} cv ${fmt(c.std / c.mean, 3)}`;
                })
                .join(" ")
            );
          })
          .join("; ") +
        `; cost x${fmt(out.costRatio, 2)} (${fmt(ms, 0)} ms)`,
    );
  }
  say(`Done: ${variants.length} variants, ${suns.length} suns, ${altitudesKm.length} altitudes.`);
  results.done = true;
}

run().catch((e) => {
  results.error = String(e?.stack ?? e);
  results.done = true;
  say(`Failed: ${e?.message ?? e}`);
});
