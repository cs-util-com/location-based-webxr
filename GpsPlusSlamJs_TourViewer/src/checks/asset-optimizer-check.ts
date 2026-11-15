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

/** A seeded generator (mulberry32): the same seed, the same test file. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const random = seeded(seed);
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
  const random = seeded(seed);
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
