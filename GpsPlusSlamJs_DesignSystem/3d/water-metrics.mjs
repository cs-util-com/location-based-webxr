/**
 * Pixel metrics for the water polish's smoke (round-3 plan 2026-09-27-0532,
 * stream W; DEC-FB3-9). Test support, free of Playwright and three, so a
 * unit test runs them on synthetic frames and the smoke imports them into
 * the page (the frames stay in the browser; only numbers come back).
 *
 * A frame is `{ width, height, data }`: RGBA bytes, bottom row first (what
 * `readPixels` returns). A mask is a Uint8Array of width × height, 1 where
 * a pixel counts. Luminance is Rec. 709 on the 8-bit values (display space;
 * every claim is relative, ON against OFF at the same pixels).
 */

/** Luminance of pixel i (index into width × height). */
export function luma(frame, i) {
  const d = frame.data;
  return 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
}

/** 1 where two frames of the same view differ (the pond shown vs hidden). */
export function diffMask(a, b, threshold = 3) {
  const n = a.width * a.height;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d =
      Math.abs(a.data[4 * i] - b.data[4 * i]) +
      Math.abs(a.data[4 * i + 1] - b.data[4 * i + 1]) +
      Math.abs(a.data[4 * i + 2] - b.data[4 * i + 2]);
    if (d > threshold) mask[i] = 1;
  }
  return mask;
}

/**
 * The mask shrunk by `r` pixels (a pixel stays when its whole
 * (2r+1)² neighbourhood is in the mask), so edges do not count as texture.
 */
export function erode(mask, width, height, r = 2) {
  const out = new Uint8Array(mask.length);
  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!mask[(y + dy) * width + x + dx]) {
            all = 0;
            break;
          }
        }
      }
      out[y * width + x] = all;
    }
  }
  return out;
}

/**
 * The mask split into `n` bands by row, each holding an equal share of the
 * mask's pixels; band 0 holds the LOWEST rows of the image (bottom row first
 * in the data: the NEAR water in a view across the pond).
 */
export function bands(mask, width, n) {
  const rows = [];
  let total = 0;
  for (let y = 0; y * width < mask.length; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) c += mask[y * width + x];
    rows.push(c);
    total += c;
  }
  const out = Array.from({ length: n }, () => new Uint8Array(mask.length));
  let seen = 0;
  rows.forEach((count, y) => {
    const band = Math.min(n - 1, Math.floor((seen / Math.max(1, total)) * n));
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i]) out[band][i] = 1;
    }
    seen += count;
  });
  return out;
}

/** The whole frame as a rectangle `{ x0, y0, x1, y1 }` (x1, y1 exclusive). */
const whole = (frame) => ({ x0: 0, y0: 0, x1: frame.width, y1: frame.height });

/**
 * Mean and standard deviation of luminance over the mask, or over the
 * mask's pixels inside `rect` only.
 */
export function stats(frame, mask, rect = whole(frame)) {
  const w = frame.width;
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let i = y * w + rect.x0; i < y * w + rect.x1; i++) {
      if (!mask[i]) continue;
      const l = luma(frame, i);
      n += 1;
      sum += l;
      sum2 += l * l;
    }
  }
  if (n === 0) return { n, mean: 0, std: 0 };
  const mean = sum / n;
  return { n, mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

/**
 * Pixel-scale texture: the mean absolute 4-neighbour Laplacian of
 * luminance over the mask (0 for a smooth gradient; glitter and aliasing
 * drive it up). A pixel counts when it and its 4 neighbours are in the
 * mask, and, with `rect`, inside the rectangle.
 */
export function laplacian(frame, mask, rect = whole(frame)) {
  const w = frame.width;
  let n = 0;
  let sum = 0;
  for (let y = rect.y0 + 1; y < rect.y1 - 1; y++) {
    for (let x = rect.x0 + 1; x < rect.x1 - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || !mask[i - 1] || !mask[i + 1]) continue;
      if (!mask[i - w] || !mask[i + w]) continue;
      const l =
        4 * luma(frame, i) -
        luma(frame, i - 1) -
        luma(frame, i + 1) -
        luma(frame, i - w) -
        luma(frame, i + w);
      sum += Math.abs(l);
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Sparkles: pixels brighter than the upper quartile of their (2r+1)² − 1
 * neighbours by more than `margin` luminance levels (a glint one or two
 * pixels wide; an edge or a bright area has bright neighbours), as a share
 * of the mask's pixels.
 */
export function sparkles(frame, mask, margin = 40, r = 2) {
  const w = frame.width;
  const h = frame.height;
  const around = [];
  let n = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x < r || x >= w - r || y < r || y >= h - r) continue;
    n += 1;
    const l = luma(frame, i);
    around.length = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx || dy) around.push(luma(frame, i + dy * w + dx));
      }
    }
    around.sort((a, b) => a - b);
    if (l - around[Math.floor(around.length * 0.75)] > margin) count += 1;
  }
  return n === 0 ? 0 : count / n;
}

/**
 * Patchiness: split the mask's bounding box into `cell`-pixel squares, take
 * each square's texture where at least half of it is in the mask (the
 * pixel-scale `laplacian`, or with `measure` "std" the standard
 * deviation, for a field of slopes), and return the coefficient of
 * variation across squares (0 when every patch has the same texture).
 */
export function patchiness(frame, mask, cell = 32, measure = "laplacian") {
  const w = frame.width;
  const h = frame.height;
  const values = [];
  // Each square reads only its own pixels (no whole-frame mask per square).
  for (let y0 = 0; y0 + cell <= h; y0 += cell) {
    for (let x0 = 0; x0 + cell <= w; x0 += cell) {
      const rect = { x0, y0, x1: x0 + cell, y1: y0 + cell };
      let inside = 0;
      for (let y = y0; y < y0 + cell; y++) {
        for (let x = x0; x < x0 + cell; x++) inside += mask[y * w + x];
      }
      if (inside * 2 >= cell * cell) {
        values.push(
          measure === "std"
            ? stats(frame, mask, rect).std
            : laplacian(frame, mask, rect),
        );
      }
    }
  }
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Repetition: the highest normalised autocorrelation of luminance (mean
 * removed) over a mask-filled square of side `size` (pixels, searched on
 * a 16-pixel grid), at shifts of at least `minLag` pixels in any direction
 * up to `size / 2`, on a `step`-pixel lattice. 1 is an exact repeat. With
 * `highpass` > 0 the square's box mean over (2·highpass+1)² is subtracted
 * first, so waves longer than the window (which correlate at every shift)
 * do not count as repetition. With `windows` > 1 it is the MEAN over that
 * many squares spread evenly over the fitting positions (one square's
 * value depends on where it sits). Returns null when no square fits.
 */
export function repetition(
  frame,
  mask,
  { size = 128, minLag = 12, step = 2, highpass = 0, windows = 1 } = {},
) {
  const w = frame.width;
  const h = frame.height;
  const origins = [];
  for (let y0 = 0; y0 + size <= h; y0 += 16) {
    for (let x0 = 0; x0 + size <= w; x0 += 16) {
      let full = true;
      for (let y = y0; y < y0 + size && full; y += 4) {
        for (let x = x0; x < x0 + size; x += 4) {
          if (!mask[y * w + x]) {
            full = false;
            break;
          }
        }
      }
      if (full) origins.push([x0, y0]);
    }
  }
  if (origins.length === 0) return null;
  const picks =
    windows <= 1
      ? [origins[0]]
      : Array.from(
          { length: windows },
          (_, k) =>
            origins[Math.round((k * (origins.length - 1)) / (windows - 1))],
        );
  let total = 0;
  for (const origin of picks) {
    total += repetitionAt(frame, origin, { size, minLag, step, highpass });
  }
  return total / picks.length;
}

/** `repetition` for the square at `origin` ([x0, y0]). */
function repetitionAt(frame, [x0, y0], { size, minLag, step, highpass }) {
  const w = frame.width;
  const f = new Float64Array(size * size);
  let mean = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = luma(frame, (y0 + y) * w + x0 + x);
      f[y * size + x] = v;
      mean += v;
    }
  }
  mean /= size * size;
  for (let i = 0; i < f.length; i++) f[i] -= mean;
  if (highpass > 0) highpassInPlace(f, size, highpass);
  const half = size / 2;
  const corr = (dx, dy) => {
    let num = 0;
    let a2 = 0;
    let b2 = 0;
    for (let y = Math.max(0, -dy); y < size - Math.max(0, dy); y += step) {
      for (let x = Math.max(0, -dx); x < size - Math.max(0, dx); x += step) {
        const a = f[y * size + x];
        const b = f[(y + dy) * size + x + dx];
        num += a * b;
        a2 += a * a;
        b2 += b * b;
      }
    }
    return a2 > 0 && b2 > 0 ? num / Math.sqrt(a2 * b2) : 0;
  };
  let best = -1;
  for (let dy = 0; dy <= half; dy += step) {
    for (let dx = -half; dx <= half; dx += step) {
      if (dy === 0 && dx <= 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < minLag) continue;
      best = Math.max(best, corr(dx, dy));
    }
  }
  return best;
}

/** Subtract each sample's box mean (clamped at the edges), in place. */
function highpassInPlace(f, size, r) {
  const sat = new Float64Array((size + 1) * (size + 1));
  for (let y = 0; y < size; y++) {
    let row = 0;
    for (let x = 0; x < size; x++) {
      row += f[y * size + x];
      sat[(y + 1) * (size + 1) + x + 1] = sat[y * (size + 1) + x + 1] + row;
    }
  }
  const box = new Float64Array(f.length);
  for (let y = 0; y < size; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(size, y + r + 1);
    for (let x = 0; x < size; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(size, x + r + 1);
      const s =
        sat[y1 * (size + 1) + x1] -
        sat[y0 * (size + 1) + x1] -
        sat[y1 * (size + 1) + x0] +
        sat[y0 * (size + 1) + x0];
      box[y * size + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  for (let i = 0; i < f.length; i++) f[i] -= box[i];
}

/** Share of mask pixels whose RGB differs by more than `threshold` in sum. */
export function changed(a, b, mask, threshold = 6) {
  let n = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    n += 1;
    const d =
      Math.abs(a.data[4 * i] - b.data[4 * i]) +
      Math.abs(a.data[4 * i + 1] - b.data[4 * i + 1]) +
      Math.abs(a.data[4 * i + 2] - b.data[4 * i + 2]);
    if (d > threshold) count += 1;
  }
  return n === 0 ? 0 : count / n;
}

/** True when the two frames are byte-identical. */
export function identical(a, b) {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/**
 * One channel of a frame (0 red, 1 green, 2 blue) as a grey frame, so the
 * luminance metrics read it: the normal view's x or z.
 */
export function channelFrame(frame, channel) {
  const data = new Uint8Array(frame.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const v = frame.data[i + channel];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: frame.width, height: frame.height, data };
}

/** Mean absolute luminance difference over the mask (shimmer between two times). */
export function meanAbsDiff(a, b, mask) {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    n += 1;
    sum += Math.abs(luma(a, i) - luma(b, i));
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * The element-wise median of a list of results of the same shape: numbers
 * by their median, booleans true only when all are, null when any is (a
 * metric with nothing to read), arrays and objects field by field.
 */
export function medianRecord(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new RangeError("medianRecord needs a non-empty list");
  }
  const [first] = list;
  if (list.some((v) => v === null)) return null;
  if (typeof first === "number") {
    const s = [...list].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  if (typeof first === "boolean") return list.every(Boolean);
  if (Array.isArray(first)) {
    return first.map((_, i) => medianRecord(list.map((v) => v[i])));
  }
  if (typeof first === "object") {
    return Object.fromEntries(
      Object.keys(first).map((k) => [k, medianRecord(list.map((v) => v[k]))]),
    );
  }
  throw new RangeError(`medianRecord cannot take a ${typeof first}`);
}

/** The six polish switches (the framework's names). */
const SWITCHES = [
  "lostVariance",
  "sunSize",
  "fresnelDamp",
  "antiTiling",
  "gusts",
  "body",
];

/**
 * Place a camera on the look-dev page (`api` is `window.__lookdev`):
 * "lake" (the page's view across the pond), "glint" (looking toward the
 * sun across the pond, `h` metres up, so the sun's reflection falls on the
 * pond's centre) or "top" (straight down from `h` metres).
 */
function placePondView(api, view, h) {
  const { lake } = api.floating();
  if (view === "lake") {
    api.setView("lake");
  } else if (view === "glint") {
    const s = api.sunDirection();
    const flat = Math.hypot(s[0], s[2]);
    const dist = h / (s[1] / flat);
    api.placeCameraAt(
      [
        lake.x - (s[0] / flat) * dist,
        lake.y + h,
        lake.z - (s[2] / flat) * dist,
      ],
      [lake.x, lake.y, lake.z],
    );
  } else if (view === "top") {
    api.placeCameraAt(
      [lake.x, lake.y + h, lake.z + 0.01],
      [lake.x, lake.y, lake.z],
    );
  } else {
    throw new Error(`unknown pond view ${view}`);
  }
}

/**
 * IN THE PAGE: measure the pond for each config `{ flags, params }` of
 * `spec.configs` (the first is the baseline; every config reads the SAME
 * waves at each of `spec.times`, and 1/30 s later for the shimmer). Each
 * number is the MEDIAN over the times (`medianRecord`), so no verdict
 * rests on one wave pattern; with `perTime` each config also carries its
 * per-time results. The pond's mask is taken at the first time.
 * `spec`: `{ preset, view, h, times, normals, bands, rep, cells, margins,
 * perTime }` (`time`, one time, is the older spelling of `times`).
 * With `normals` the pond draws its world normal and the metrics read its
 * x (red) channel: `rep` (repetition options), `cells` (patchiness of the
 * slope's spread), `std`. Otherwise per band (band 0 the nearest):
 * mean, std, lap, shimmer, the sparkle share per margin, and the share of
 * pixels changed against the baseline.
 */
export function probePond(api, spec) {
  const {
    preset,
    view,
    h = 10,
    time = 7.3,
    times = [time],
    perTime = false,
    normals = false,
    bands: nBands = 3,
    rep = [],
    cells = [32],
    margins = [],
  } = spec;
  api.pauseLoop(true);
  api.setPreset(preset);
  api.setCloudCover(0);
  const off = Object.fromEntries(SWITCHES.map((s) => [s, false]));
  api.setWaterPolish(off);
  api.resetWaterPolishParams();
  api.setWaterNormalView(false);
  placePondView(api, view, h);
  api.setWaterTime(times[0]);
  api.setFloatingVisible(false);
  const hidden = api.readFrame();
  api.setFloatingVisible(true);
  const shown = api.readFrame();
  const mask = erode(diffMask(hidden, shown), shown.width, shown.height, 2);
  const bandMasks = bands(mask, shown.width, nBands);
  api.setWaterNormalView(normals);
  const out = { pond: mask.reduce((s, v) => s + v, 0), times, configs: {} };
  let bases = null;
  for (const [name, config] of Object.entries(spec.configs)) {
    api.setWaterPolish({ ...off, ...(config.flags ?? {}) });
    api.resetWaterPolishParams();
    api.setWaterPolishParams(config.params ?? {});
    const frames = [];
    const results = times.map((t, k) => {
      const base = bases ? bases[k] : null;
      api.setWaterTime(t);
      const f = api.readFrame();
      frames.push(f);
      return measurePond(api, {
        f,
        t,
        base,
        mask,
        bandMasks,
        normals,
        rep,
        cells,
        margins,
      });
    });
    bases ??= frames;
    out.configs[name] = medianRecord(results);
    if (perTime) out.configs[name].perTime = results;
  }
  api.setWaterPolish(off);
  api.resetWaterPolishParams();
  api.setWaterNormalView(false);
  return out;
}

/** One config at one wave time (`probePond`); `base` null for the baseline. */
function measurePond(
  api,
  { f, t, base, mask, bandMasks, normals, rep, cells, margins },
) {
  const r = {};
  if (normals) {
    const x = channelFrame(f, 0);
    for (const opt of rep) {
      r[`rep${opt.size}h${opt.highpass}`] = repetition(x, mask, opt);
    }
    for (const cell of cells)
      r[`patch${cell}`] = patchiness(x, mask, cell, "std");
    r.std = stats(x, mask).std;
  } else {
    api.setWaterTime(t + 1 / 30);
    const g = api.readFrame();
    r.bands = bandMasks.map((b) => {
      const st = stats(f, b);
      const band = {
        n: st.n,
        mean: st.mean,
        std: st.std,
        lap: laplacian(f, b),
        shimmer: meanAbsDiff(f, g, b),
      };
      for (const margin of margins)
        band[`spark${margin}`] = sparkles(f, b, margin);
      if (base) band.changed = changed(base, f, b);
      return band;
    });
    for (const cell of cells) r[`patch${cell}`] = patchiness(f, mask, cell);
  }
  if (base) {
    r.changed = changed(base, f, mask);
    r.identical = identical(base, f);
  }
  return r;
}
