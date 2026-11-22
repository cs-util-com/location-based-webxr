/**
 * The asset optimizer check's pure parts (`asset-optimizer-check.html`):
 * the test files it makes (a photo-like picture's pixels, a speech-like or
 * music-like sound as a WAV file) and the measures it shows next to each
 * result (SSIM of two pictures, the lag between two sounds). The page and
 * its e2e run the shipped optimizer rows on these; nothing in the Tour
 * Viewer imports this module.
 *
 * @see asset-optimizer-check.ts.md
 */

import { glbReferencesProblem } from "gps-plus-slam-app-framework/ar/tour-media";
import { readGlbChunks } from "gps-plus-slam-app-framework/utils/glb-chunks";
import { mulberry32 } from "gps-plus-slam-app-framework/utils/mulberry32";

import { clamp01 } from "../landing/clamp01.js";

function wholeAtLeast(value: number, least: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < least) {
    throw new Error(`${what} must be a whole number of at least ${least}`);
  }
}

/** RGBA pixels of a photo-like test picture: a sky gradient, a row of
 *  houses with windows, round shapes and a fine grain, so an encoder meets
 *  edges, flat areas and texture as in a photo. */
export function testPicturePixels(
  width: number,
  height: number,
  seed = 1,
): Uint8ClampedArray {
  wholeAtLeast(width, 1, "the width");
  wholeAtLeast(height, 1, "the height");
  const random = mulberry32(seed);
  const px = new Uint8ClampedArray(width * height * 4);
  const ground = Math.round(height * 0.62);
  const houses = Array.from({ length: 9 }, () => ({
    x: random() * width,
    w: (0.06 + random() * 0.1) * width,
    h: (0.12 + random() * 0.25) * height,
    r: 120 + random() * 120,
    g: 80 + random() * 100,
    b: 60 + random() * 80,
  }));
  const discs = Array.from({ length: 6 }, () => ({
    x: random() * width,
    y: random() * ground,
    r: (0.02 + random() * 0.06) * Math.min(width, height),
    c: 180 + random() * 70,
  }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r: number;
      let g: number;
      let b: number;
      if (y < ground) {
        const t = y / ground;
        r = 90 + 110 * t;
        g = 140 + 80 * t;
        b = 230 - 30 * t;
      } else {
        const t = (y - ground) / Math.max(1, height - ground);
        r = 70 + 40 * t + 20 * Math.sin(x * 0.05);
        g = 110 + 30 * t;
        b = 50 + 20 * t;
      }
      for (const h of houses) {
        if (x < h.x || x >= h.x + h.w || y >= ground || y < ground - h.h) {
          continue;
        }
        const lit =
          Math.floor((x - h.x) / (h.w / 6)) % 2 === 1 &&
          Math.floor((ground - y) / (h.h / 8)) % 2 === 1;
        r = lit ? 230 : h.r;
        g = lit ? 220 : h.g;
        b = lit ? 150 : h.b;
      }
      for (const d of discs) {
        const dx = x - d.x;
        const dy = y - d.y;
        if (dx * dx + dy * dy < d.r * d.r) {
          r = d.c;
          g = d.c * 0.9;
          b = d.c * 0.6;
        }
      }
      const grain = (random() - 0.5) * 14;
      const i = (y * width + x) * 4;
      px[i] = r + grain;
      px[i + 1] = g + grain;
      px[i + 2] = b + grain;
      px[i + 3] = 255;
    }
  }
  return px;
}

type Rgb = readonly [number, number, number];

/** The words of the cartoon's label, as [start, length] pairs per line,
 *  in units of the picture's shorter side. */
function labelWords(seed: number): number[][][] {
  const random = mulberry32(seed);
  return [0, 1, 2, 3].map(() => {
    const words: number[][] = [];
    for (let x = 0; x < 0.26;) {
      const length = 0.02 + random() * 0.05;
      words.push([x, Math.min(length, 0.26 - x)]);
      x += length + 0.012;
    }
    return words;
  });
}

/** The colour of the cartoon at (x, y), in units of the picture's
 *  shorter side from its centre. */
function cartoonAt(
  x: number,
  y: number,
  shaded: boolean,
  words: number[][][],
): Rgb {
  // Shading: a light from the upper left over everything, and a rounding
  // of each disc towards its rim, as many AI-made figures have.
  const light = shaded ? 0.72 + 0.4 * clamp01(0.55 - 0.5 * (x + y)) : 1;
  const tone = (c: Rgb, round = 0): Rgb =>
    shaded
      ? [
          c[0] * light * (1 - 0.25 * round),
          c[1] * light * (1 - 0.25 * round),
          c[2] * light * (1 - 0.25 * round),
        ]
      : c;
  const disc = (cx: number, cy: number, r: number) =>
    Math.hypot(x - cx, y - cy) / r;
  const OUTLINE: Rgb = [30, 25, 35];
  const edge = 0.008;
  let c: Rgb = y < 0.25 ? tone([150, 205, 240]) : tone([110, 190, 90]);
  if (disc(0.6, -0.35, 0.09) < 1)
    c = tone([255, 215, 80], disc(0.6, -0.35, 0.09));
  for (const [cx, cy, r] of [
    [-0.5, -0.38, 0.06],
    [-0.43, -0.4, 0.075],
    [-0.36, -0.37, 0.055],
  ] as const) {
    if (disc(cx, cy, r) < 1) c = tone([250, 250, 250]);
  }
  // The label: a white board with four lines of dark "words".
  const lx = -0.62;
  const ly = 0.05;
  if (x >= lx && x < lx + 0.3 && y >= ly && y < ly + 0.2) {
    c = [245, 245, 240];
    words.forEach((line, row) => {
      const top = ly + 0.03 + row * 0.04;
      if (y < top || y >= top + 0.014) return;
      for (const [start, length] of line) {
        const u = x - lx - 0.02 - start!;
        if (u >= 0 && u < length!) c = [40, 40, 60];
      }
    });
  }
  // The body: an ellipse with an outline.
  const body = Math.hypot(x / 0.17, (y - 0.2) / 0.22);
  if (body < 1) {
    c = (1 - body) * 0.17 < edge ? OUTLINE : tone([230, 110, 60], body);
  }
  const head = disc(0, -0.12, 0.14);
  if (head < 1) {
    c = (1 - head) * 0.14 < edge ? OUTLINE : tone([250, 205, 170], head);
    if (y < -0.17 && head < 0.97) c = tone([90, 55, 35]);
    for (const side of [-1, 1]) {
      const eye = disc(side * 0.05, -0.12, 0.028);
      if (eye < 1) c = eye < 0.45 ? [20, 20, 30] : [255, 255, 255];
    }
    const mouth = disc(0, -0.08, 0.055);
    if (y > -0.065 && mouth < 1 && mouth > 0.8) c = [150, 40, 50];
  }
  return c;
}

/** RGBA pixels of a cartoon figure: a few flat colours (sky, ground,
 *  sun, clouds, a figure with black outlines, a label of dark "words")
 *  with anti-aliased edges (2 x 2 samples a pixel), or with `shaded` the
 *  same figure lit and rounded as many AI-made pictures are, so it has
 *  smooth gradients instead of flat areas. */
export function cartoonPicturePixels(
  width: number,
  height: number,
  { shaded, seed = 1 }: { readonly shaded: boolean; readonly seed?: number },
): Uint8ClampedArray {
  wholeAtLeast(width, 1, "the width");
  wholeAtLeast(height, 1, "the height");
  const words = labelWords(seed);
  const unit = Math.min(width, height);
  const px = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let pxl = 0; pxl < width; pxl++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ] as const) {
        const c = cartoonAt(
          (pxl + dx - width / 2) / unit,
          (py + dy - height / 2) / unit,
          shaded,
          words,
        );
        r += c[0];
        g += c[1];
        b += c[2];
      }
      const i = (py * width + pxl) * 4;
      px[i] = r / 4;
      px[i + 1] = g / 4;
      px[i + 2] = b / 4;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** How two RGBA pictures of one size differ, over their colour channels:
 *  the PSNR in dB (Infinity for the same pixels) and the near-worst
 *  error, the 99.9th percentile of each pixel's largest channel error
 *  (0..255), which sees ringing at edges and smeared text that PSNR
 *  averages away. */
export function pictureErrors(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
): { readonly psnr: number; readonly nearWorst: number } {
  if (a.length !== b.length || a.length === 0 || a.length % 4 !== 0) {
    throw new Error("the pictures are not of one size");
  }
  const pixels = a.length / 4;
  const histogram = new Uint32Array(256);
  let squares = 0;
  for (let i = 0; i < a.length; i += 4) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!);
      squares += d * d;
      if (d > worst) worst = d;
    }
    histogram[worst]!++;
  }
  const mse = squares / (pixels * 3);
  let nearWorst = 0;
  let seen = 0;
  while (nearWorst < 255) {
    seen += histogram[nearWorst]!;
    if (seen >= 0.999 * pixels) break;
    nearWorst++;
  }
  return {
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
    nearWorst,
  };
}

/** The share of RGBA pixels (0..1) whose colour, read at `bits` bits a
 *  channel, is one of the `top` most common: nearly 1 for a picture of a
 *  few flat colours, low for a photo's grain and gradients. Fewer bits
 *  merge near colours, so a smooth gradient counts as flatter. */
export function commonColourShare(
  rgba: Uint8ClampedArray,
  top: number,
  bits: number,
): number {
  wholeAtLeast(top, 1, "the number of colours");
  wholeAtLeast(bits, 1, "the bits a channel");
  if (bits > 8) throw new Error("the bits a channel must be at most 8");
  if (rgba.length === 0 || rgba.length % 4 !== 0) {
    throw new Error("no RGBA pixels");
  }
  const shift = 8 - bits;
  const counts = new Map<number, number>();
  for (let i = 0; i < rgba.length; i += 4) {
    const key =
      ((rgba[i]! >> shift) << 16) |
      ((rgba[i + 1]! >> shift) << 8) |
      (rgba[i + 2]! >> shift);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const most = [...counts.values()].sort((a, b) => b - a).slice(0, top);
  return most.reduce((sum, n) => sum + n, 0) / (rgba.length / 4);
}

export type TestSoundKind = "speech" | "music";

/** The planes of a test sound: speech-like (one voice of moving pitch in
 *  syllables, mono) or music-like (a chord on each side, stereo). */
export function testSoundPlanes(
  kind: TestSoundKind,
  seconds: number,
  sampleRate: number,
  seed = 1,
): Float32Array[] {
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    throw new Error("a test sound lasts more than no time");
  }
  wholeAtLeast(sampleRate, 8000, "the sample rate");
  const frames = Math.round(seconds * sampleRate);
  const random = mulberry32(seed);
  if (kind === "speech") {
    const plane = new Float32Array(frames);
    let phase = 0;
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const f0 = 120 + 40 * Math.sin(2 * Math.PI * 0.7 * t);
      phase += (2 * Math.PI * f0) / sampleRate;
      const syllable = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2;
      let v = 0;
      for (let k = 1; k <= 8; k++) v += Math.sin(k * phase) / k;
      plane[i] = 0.25 * syllable * v + 0.01 * (random() - 0.5);
    }
    return [plane];
  }
  const chord = (notes: readonly number[]) => {
    const plane = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const beat = 0.6 + 0.4 * Math.max(0, Math.cos(2 * Math.PI * 2 * t));
      let v = 0;
      for (const f of notes) v += Math.sin(2 * Math.PI * f * t);
      plane[i] = (0.5 * beat * v) / notes.length;
    }
    return plane;
  };
  return [chord([220, 277.18, 329.63]), chord([164.81, 246.94, 392])];
}

/** `planes` as a 16-bit PCM WAV file's bytes. */
export function wavOf(
  planes: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  const channels = planes.length;
  if (channels < 1) throw new Error("a WAV file of no channels");
  const frames = planes[0]!.length;
  if (planes.some((p) => p.length !== frames)) {
    throw new Error("the channels are of different lengths");
  }
  wholeAtLeast(sampleRate, 1, "the sample rate");
  const dataBytes = frames * channels * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const plane of planes) {
      const v = Math.max(-1, Math.min(1, plane[i]!));
      view.setInt16(at, Math.round(v * 32767), true);
      at += 2;
    }
  }
  return out;
}

/** The luma (BT.601) of RGBA pixels. */
export function lumaOf(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      0.299 * rgba[i * 4]! +
      0.587 * rgba[i * 4 + 1]! +
      0.114 * rgba[i * 4 + 2]!;
  }
  return out;
}

/** The mean SSIM of two lumas of `width` x `height` over 8 x 8 windows
 *  (1 for the same picture, lower the more they differ). */
export function ssim(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
): number {
  wholeAtLeast(width, 8, "the width");
  wholeAtLeast(height, 8, "the height");
  if (a.length !== width * height || b.length !== width * height) {
    throw new Error("the pictures are not of the size given");
  }
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  let sum = 0;
  let windows = 0;
  for (let y0 = 0; y0 + 8 <= height; y0 += 8) {
    for (let x0 = 0; x0 + 8 <= width; x0 += 8) {
      let ma = 0;
      let mb = 0;
      for (let y = y0; y < y0 + 8; y++) {
        for (let x = x0; x < x0 + 8; x++) {
          ma += a[y * width + x]!;
          mb += b[y * width + x]!;
        }
      }
      ma /= 64;
      mb /= 64;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let y = y0; y < y0 + 8; y++) {
        for (let x = x0; x < x0 + 8; x++) {
          const da = a[y * width + x]! - ma;
          const db = b[y * width + x]! - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= 63;
      vb /= 63;
      cov /= 63;
      sum +=
        ((2 * ma * mb + c1) * (2 * cov + c2)) /
        ((ma * ma + mb * mb + c1) * (va + vb + c2));
      windows++;
    }
  }
  return sum / windows;
}

/** The lag (in samples, within `maxLag`) at which `b` best matches `a`
 *  over `length` samples from `start`, and the normalised correlation
 *  there. A positive lag: `b` is late. */
export function bestLag(
  a: Float32Array,
  b: Float32Array,
  start: number,
  length: number,
  maxLag: number,
): { lag: number; correlation: number } {
  wholeAtLeast(start, maxLag, "the start");
  wholeAtLeast(length, 1, "the length");
  if (start + length + maxLag > Math.min(a.length, b.length)) {
    throw new Error("the window does not fit the sounds");
  }
  let best = { lag: 0, correlation: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = start; i < start + length; i++) {
      const x = a[i]!;
      const y = b[i + lag]!;
      ab += x * y;
      aa += x * x;
      bb += y * y;
    }
    const correlation = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
    if (correlation > best.correlation) best = { lag, correlation };
  }
  return best;
}

/** A model file's bytes by kind: `textures` are the buffer views its
 *  images name (a view two images share counts once), `geometry` is the
 *  rest (vertices, indices, the saved coarser levels, the JSON). Throws
 *  with words on a file that is no GLB, whose buffers, pictures or buffer
 *  views reach outside it (the tour's own rule, `glbReferencesProblem`),
 *  or whose images name a buffer view it does not have. */
export function glbByteShares(bytes: Uint8Array): {
  readonly total: number;
  readonly textures: number;
  readonly geometry: number;
} {
  const chunks = readGlbChunks(bytes);
  if (!chunks.ok) throw new Error(`the file is no GLB: ${chunks.reason}`);
  const reaches = glbReferencesProblem(chunks.json);
  if (reaches !== null) {
    throw new Error(`the file is no tour model: ${reaches}`);
  }
  const json = chunks.json as {
    bufferViews?: { byteLength?: number }[];
    images?: unknown[];
  };
  const list = json.bufferViews ?? [];
  const named = new Set<number>();
  for (const image of json.images ?? []) {
    const index = (image as { bufferView?: unknown } | null)?.bufferView;
    if (index === undefined) continue;
    if (
      typeof index !== "number" ||
      typeof list[index]?.byteLength !== "number"
    ) {
      throw new Error(
        `an image names buffer view ${JSON.stringify(index)}, not in the file`,
      );
    }
    named.add(index);
  }
  let textures = 0;
  for (const index of named) textures += list[index]!.byteLength!;
  return { total: bytes.length, textures, geometry: bytes.length - textures };
}
