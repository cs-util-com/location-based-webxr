/**
 * Why these tests matter: the asset optimizer check page and its e2e
 * judge the shipped optimizers with these measures. A measure that is
 * wrong makes every floor in the e2e meaningless: SSIM must say 1 for the
 * same picture and less for a damaged one, the lag must find a known
 * shift in either direction, the WAV must be a file a browser reads, and
 * the test files must be the same for the same seed so a sweep compares
 * like with like.
 */
import { mulberry32 } from "gps-plus-slam-app-framework/utils/mulberry32";
import { describe, expect, it } from "vitest";

import {
  bestLag,
  cartoonPicturePixels,
  commonColourShare,
  glbByteShares,
  lumaOf,
  pictureErrors,
  ssim,
  testPicturePixels,
  testSoundPlanes,
  wavOf,
} from "./asset-optimizer-check.js";
import { handGlb } from "../editor/asset-shelf/test-support/hand-glb.js";

/** The distinct colours of RGBA pixels. */
const coloursOf = (rgba: Uint8ClampedArray) => {
  const seen = new Set<number>();
  for (let i = 0; i < rgba.length; i += 4) {
    seen.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
  }
  return seen.size;
};

describe("the check's test files", () => {
  it("are the same for the same seed and differ for another", () => {
    expect(testPicturePixels(32, 24, 7)).toEqual(testPicturePixels(32, 24, 7));
    expect(testPicturePixels(32, 24, 7)).not.toEqual(
      testPicturePixels(32, 24, 8),
    );
  });

  // The flat-colour samples stand in for cartoon and AI-made pictures: the
  // flat one must really be a few colours (its anti-aliased edges add
  // some, on few pixels), the shaded one must not, so the two bracket the
  // case the picture presets are chosen for.
  it("draw a cartoon figure flat or shaded, the same for the same seed", () => {
    const flat = cartoonPicturePixels(160, 120, { shaded: false });
    const again = cartoonPicturePixels(160, 120, { shaded: false });
    // Compared by hand: a deep equality of typed arrays this size takes
    // seconds.
    expect(flat.every((v, i) => v === again[i])).toBe(true);
    expect(flat).toHaveLength(160 * 120 * 4);
    const shaded = cartoonPicturePixels(160, 120, { shaded: true });
    expect(coloursOf(shaded)).toBeGreaterThan(4 * coloursOf(flat));
    const alpha = flat.filter((_, i) => i % 4 === 3);
    expect(alpha.every((a) => a === 255)).toBe(true);
    expect(() => cartoonPicturePixels(0, 10, { shaded: false })).toThrow();
  });

  it("make speech mono and music stereo, of the length asked", () => {
    expect(testSoundPlanes("speech", 0.5, 48000)).toHaveLength(1);
    const music = testSoundPlanes("music", 0.25, 44100);
    expect(music).toHaveLength(2);
    expect(music[0]).toHaveLength(11025);
    expect(() => testSoundPlanes("speech", 0, 48000)).toThrow();
  });

  it("write a 16-bit WAV with its header and samples", () => {
    const bytes = wavOf([Float32Array.of(0, 1, -1)], 48000);
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32767);
    expect(() =>
      wavOf([new Float32Array(2), new Float32Array(3)], 48000),
    ).toThrow();
  });
});

describe("the check's measures", () => {
  it("SSIM is 1 for the same picture and drops as it is damaged", () => {
    const luma = lumaOf(testPicturePixels(64, 48));
    expect(ssim(luma, luma, 64, 48)).toBeCloseTo(1, 6);
    const random = mulberry32(5);
    const light = luma.map((v) => v + (random() - 0.5) * 10);
    const heavy = luma.map((v) => v + (random() - 0.5) * 80);
    const lightScore = ssim(luma, light, 64, 48);
    const heavyScore = ssim(luma, heavy, 64, 48);
    expect(lightScore).toBeLessThan(1);
    expect(heavyScore).toBeLessThan(lightScore);
    expect(() => ssim(luma, luma, 64, 47)).toThrow();
  });

  // PSNR and the near-worst pixel error are the quality proxies of the
  // flat-colour sweep: PSNR must be infinite for the same pixels and match
  // the textbook value for a known error, and the near-worst error must
  // see a few damaged pixels that PSNR averages away.
  it("pixel errors: infinite PSNR for the same, the textbook value for a known error", () => {
    const a = cartoonPicturePixels(64, 48, { shaded: true });
    expect(pictureErrors(a, a)).toEqual({ psnr: Infinity, nearWorst: 0 });
    const shifted = a.map((v, i) =>
      i % 4 === 3 ? v : v > 127 ? v - 10 : v + 10,
    );
    const known = pictureErrors(a, shifted);
    expect(known.psnr).toBeCloseTo(20 * Math.log10(255 / 10), 6);
    expect(known.nearWorst).toBe(10);
    const spots = a.slice();
    for (let p = 0; p < 20; p++) {
      spots[p * 4 * 97] = spots[p * 4 * 97]! > 127 ? 0 : 255;
    }
    const spotted = pictureErrors(a, spots);
    expect(spotted.psnr).toBeGreaterThan(30);
    expect(spotted.nearWorst).toBeGreaterThan(100);
    expect(() => pictureErrors(a, a.subarray(4))).toThrow();
  });

  // The share of pixels in a picture's most common colours is the measure
  // a flat-colour classifier would read; the page shows it and the
  // optimizer e2e sweeps its threshold. It must say nearly 1 for the flat
  // cartoon and much less for the grainy photo-like picture, at every
  // colour depth it is read at.
  it("common-colour share: nearly all for a flat cartoon, little for a grainy picture", () => {
    const flat = cartoonPicturePixels(200, 150, { shaded: false });
    const grainy = testPicturePixels(200, 150);
    for (const bits of [4, 5, 8]) {
      expect(commonColourShare(flat, 16, bits)).toBeGreaterThan(0.95);
      expect(commonColourShare(grainy, 16, bits)).toBeLessThan(0.7);
    }
    const one = new Uint8ClampedArray(40).fill(200);
    expect(commonColourShare(one, 1, 8)).toBe(1);
    expect(() => commonColourShare(flat, 0, 8)).toThrow();
    expect(() => commonColourShare(flat, 16, 9)).toThrow();
  });

  it("finds a known shift between two sounds, either way", () => {
    const [a] = testSoundPlanes("speech", 0.5, 48000);
    for (const shift of [-37, 0, 120]) {
      const b = new Float32Array(a!.length);
      for (let i = 0; i < b.length; i++) b[i] = a![i - shift] ?? 0;
      const found = bestLag(a!, b, 4800, 9600, 200);
      expect(found.lag).toBe(shift);
      expect(found.correlation).toBeGreaterThan(0.99);
    }
    expect(() => bestLag(a!, a!, 0, 100, 200)).toThrow();
  });
});

describe("a model file's bytes by kind", () => {
  // Why this test matters: which slider comes first, and what the size
  // panel says each part costs, rest on this split; a view two images
  // share must count once, and a file whose views do not read must say so
  // rather than report a wrong share.
  it("counts the image views once as textures and the rest as geometry", () => {
    const glb = handGlb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: 136 }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: 36, byteLength: 100 },
        ],
        images: [{ bufferView: 0 }, { bufferView: 0 }, { uri: "x.png" }],
      },
      new Uint8Array(136),
    );
    expect(glbByteShares(glb)).toEqual({
      total: glb.length,
      textures: 36,
      geometry: glb.length - 36,
    });
    const none = handGlb({ asset: { version: "2.0" } });
    expect(glbByteShares(none)).toEqual({
      total: none.length,
      textures: 0,
      geometry: none.length,
    });
    const broken = handGlb({
      asset: { version: "2.0" },
      images: [{ bufferView: 4 }],
    });
    expect(() => glbByteShares(broken)).toThrow(/buffer view/);
    expect(() => glbByteShares(new Uint8Array(8))).toThrow(/GLB/);
  });
});
