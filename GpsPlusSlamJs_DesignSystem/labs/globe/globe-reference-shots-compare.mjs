// @ts-check
/**
 * Puts two captures of the globe's reference views side by side
 * (`globe-reference-shots.smoke.spec.mjs` writes them) and measures every
 * pair: the pixels whose largest channel difference exceeds a threshold,
 * at several thresholds, and the largest difference anywhere. Writes, per
 * view, `<name>-pair.png` (before | after | the difference amplified) into
 * the output folder and prints one line per view; `views.json` facts that
 * differ (the credits, the tile counts) are printed too, and the intro
 * trace's first differing frame per field (`trace.json`).
 *
 *   node labs/globe/globe-reference-shots-compare.mjs <before> <after> <out>
 *
 * Exits 1 when one of the fixed views (or the trace) is missing from either
 * side, or the sizes or the trace's lengths differ; a pixel or trace
 * difference is reported, never judged: whether it is visible is the
 * reader's call, with the image in front of them.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

/**
 * The thresholds (8-bit levels) the changed-pixel shares are counted at;
 * `>0` is every changed pixel, so "identical" is a number, not a reading.
 */
const THRESHOLDS = [0, 1, 4, 16, 48];

/**
 * The views the capture writes. Fixed, not read from a folder: a view the
 * capture failed to write on BOTH sides would otherwise pass unnoticed.
 */
export const VIEW_NAMES = [
  "1-space",
  "2-space-sky",
  "3-approach",
  "4-above-clouds",
  "5-below-clouds",
  "6-street",
  "7-drift",
];

/**
 * A trace without its repeated frames: a frame equal in every field to the
 * one before it (an animation frame the page drew without the clock moving)
 * carries no new state, and how many there are depends on the browser's
 * scheduling, not on the code under test.
 */
export function dropRepeatedFrames(trace) {
  return trace.filter(
    (f, i) => i === 0 || JSON.stringify(f) !== JSON.stringify(trace[i - 1]),
  );
}

/**
 * Two intro traces (one entry per frame): null when they match exactly,
 * else `{ lengths }` for traces of different lengths, or `{ fields }` with,
 * per field that differs, its first differing frame and the largest numeric
 * difference over all frames (null for a field that is not numeric).
 */
export function diffTrace(a, b) {
  if (a.length !== b.length) return { lengths: [a.length, b.length] };
  const numbers = (v) =>
    typeof v === "number"
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(numbers)
        : v && typeof v === "object"
          ? Object.values(v).flatMap(numbers)
          : [];
  const fields = {};
  for (let i = 0; i < a.length; i++) {
    for (const key of new Set([...Object.keys(a[i]), ...Object.keys(b[i])])) {
      const x = a[i][key];
      const y = b[i][key];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      const f = (fields[key] ??= { firstFrame: i, maxAbs: 0 });
      const nx = numbers(x);
      const ny = numbers(y);
      if (f.maxAbs !== null && nx.length === ny.length && nx.length > 0) {
        for (let k = 0; k < nx.length; k++) {
          f.maxAbs = Math.max(f.maxAbs, Math.abs(nx[k] - ny[k]));
        }
      } else {
        f.maxAbs = null;
      }
    }
  }
  return Object.keys(fields).length === 0 ? null : { fields };
}

/**
 * The difference of two RGBA buffers of the same size: the share of pixels
 * whose largest channel difference exceeds each threshold, the largest
 * difference, and the difference image (the largest channel's difference,
 * amplified `gain` times, as grey, opaque).
 */
export function diffRgba(a, b, { thresholds = THRESHOLDS, gain = 8 } = {}) {
  if (a.length !== b.length || a.length % 4 !== 0) {
    throw new RangeError(
      `buffers must be RGBA of one size, got ${a.length} and ${b.length}`,
    );
  }
  const pixels = a.length / 4;
  const over = thresholds.map(() => 0);
  const image = new Uint8Array(a.length);
  let max = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const d = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
    );
    if (d > max) max = d;
    for (let t = 0; t < thresholds.length; t++) {
      if (d > thresholds[t]) over[t] += 1;
    }
    const g = Math.min(255, d * gain);
    image[i] = g;
    image[i + 1] = g;
    image[i + 2] = g;
    image[i + 3] = 255;
  }
  return {
    max,
    shares: Object.fromEntries(
      thresholds.map((t, k) => [`>${t}`, over[k] / pixels]),
    ),
    image,
  };
}

const raw = async (path) => {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

export async function main([before, after, out]) {
  if (!before || !after || !out) {
    console.error(
      "usage: globe-reference-shots-compare.mjs <before> <after> <out>",
    );
    return 2;
  }
  mkdirSync(out, { recursive: true });
  let failed = false;
  for (const name of VIEW_NAMES.map((v) => `${v}.png`)) {
    const gone = [before, after].filter((dir) => !existsSync(join(dir, name)));
    if (gone.length > 0) {
      console.log(`${name}: MISSING in ${gone.join(" and ")}`);
      failed = true;
      continue;
    }
    const b = join(after, name);
    const x = await raw(join(before, name));
    const y = await raw(b);
    if (x.width !== y.width || x.height !== y.height) {
      console.log(
        `${name}: SIZE ${x.width}x${x.height} vs ${y.width}x${y.height}`,
      );
      failed = true;
      continue;
    }
    const d = diffRgba(x.data, y.data);
    const { width: w, height: h } = x;
    const asImage = (data) => ({
      input: Buffer.from(data),
      raw: { width: w, height: h, channels: 4 },
    });
    await sharp({
      create: { width: w * 3, height: h, channels: 4, background: "#000" },
    })
      .composite([
        { ...asImage(x.data), left: 0, top: 0 },
        { ...asImage(y.data), left: w, top: 0 },
        { ...asImage(d.image), left: 2 * w, top: 0 },
      ])
      .png()
      .toFile(join(out, name.replace(/\.png$/, "-pair.png")));
    const shares = Object.entries(d.shares)
      .map(([k, v]) => `${k}: ${(v * 100).toFixed(3)} %`)
      .join(", ");
    console.log(`${name}: max ${d.max}, ${shares}`);
  }
  const facts = (dir) => {
    const f = join(dir, "views.json");
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  };
  const fa = facts(before);
  const fb = facts(after);
  for (const v of fa) {
    const w = fb.find((o) => o.name === v.name);
    if (!w) continue;
    for (const key of [
      "credits",
      "loadedTiles",
      "relief",
      "osmRequests",
      "cameraNear",
      "view",
    ]) {
      if (JSON.stringify(v[key]) !== JSON.stringify(w[key])) {
        console.log(
          `${v.name} ${key}: ${JSON.stringify(v[key])} -> ${JSON.stringify(w[key])}`,
        );
      }
    }
  }
  const traces = [before, after].map((dir) => join(dir, "trace.json"));
  const goneTrace = traces.filter((f) => !existsSync(f));
  if (goneTrace.length > 0) {
    console.log(`trace.json: MISSING as ${goneTrace.join(" and ")}`);
    failed = true;
  } else {
    const [ra, rb] = traces.map((f) => JSON.parse(readFileSync(f, "utf8")));
    const [ta, tb] = [ra, rb].map(dropRepeatedFrames);
    if (ta.length !== ra.length || tb.length !== rb.length) {
      console.log(
        `trace: ${ra.length - ta.length} and ${rb.length - tb.length} repeated frames dropped`,
      );
    }
    const d = diffTrace(ta, tb);
    if (d === null) console.log(`trace: ${ta.length} frames, identical`);
    else if (d.lengths) {
      console.log(`trace: LENGTHS ${d.lengths[0]} vs ${d.lengths[1]}`);
      failed = true;
    } else {
      for (const [key, f] of Object.entries(d.fields)) {
        console.log(
          `trace ${key}: differs from frame ${f.firstFrame}, max |d| ${f.maxAbs}`,
        );
      }
    }
  }
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2));
}
