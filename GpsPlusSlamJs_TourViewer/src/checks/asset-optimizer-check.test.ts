/**
 * Why these tests matter: the asset optimizer check page and its e2e
 * judge the shipped optimizers with these measures. A measure that is
 * wrong makes every floor in the e2e meaningless: SSIM must say 1 for the
 * same picture and less for a damaged one, the lag must find a known
 * shift in either direction, the WAV must be a file a browser reads, and
 * the test files must be the same for the same seed so a sweep compares
 * like with like.
 */
import { describe, expect, it } from "vitest";

import {
  bestLag,
  lumaOf,
  seeded,
  ssim,
  testPicturePixels,
  testSoundPlanes,
  wavOf,
} from "./asset-optimizer-check.js";

describe("the check's test files", () => {
  it("are the same for the same seed and differ for another", () => {
    expect(testPicturePixels(32, 24, 7)).toEqual(testPicturePixels(32, 24, 7));
    expect(testPicturePixels(32, 24, 7)).not.toEqual(
      testPicturePixels(32, 24, 8),
    );
    const a = seeded(3);
    const b = seeded(3);
    expect([a(), a()]).toEqual([b(), b()]);
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
    const random = seeded(5);
    const light = luma.map((v) => v + (random() - 0.5) * 10);
    const heavy = luma.map((v) => v + (random() - 0.5) * 80);
    const lightScore = ssim(luma, light, 64, 48);
    const heavyScore = ssim(luma, heavy, 64, 48);
    expect(lightScore).toBeLessThan(1);
    expect(heavyScore).toBeLessThan(lightScore);
    expect(() => ssim(luma, luma, 64, 47)).toThrow();
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
