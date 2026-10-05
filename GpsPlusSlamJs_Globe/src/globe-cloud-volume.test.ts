/**
 * The cloud volume's arithmetic (volume-cloud plan 2026-10-05-0016, C2).
 *
 * Why this file matters: the volume near the camera must put its clouds
 * where the globe's own map has them (or the swap from the shell plops),
 * must fade in by altitude without a jump, and its disc and the shell's
 * hole must shrink together, so no altitude draws the clouds twice or not
 * at all. The coverage chunk's position-to-map mapping is checked against
 * its CPU twin here.
 */
import { describe, expect, it } from "vitest";

import {
  CLOUD_VOLUME,
  CLOUD_VOLUME_COVERAGE_GLSL,
  cloudVolumeMapUv,
  cloudVolumeShare,
} from "./globe-cloud-volume.js";

const R = 6_371_000;

describe("cloudVolumeShare", () => {
  it("is 1 below the ceiling minus the fade, 0 at and above the ceiling", () => {
    expect(cloudVolumeShare(10)).toBe(1);
    expect(cloudVolumeShare(CLOUD_VOLUME.ceilingKm - CLOUD_VOLUME.fadeKm)).toBe(
      1,
    );
    expect(cloudVolumeShare(CLOUD_VOLUME.ceilingKm)).toBe(0);
    expect(cloudVolumeShare(100)).toBe(0);
    const mid = cloudVolumeShare(
      CLOUD_VOLUME.ceilingKm - CLOUD_VOLUME.fadeKm / 2,
    );
    expect(mid).toBeCloseTo(0.5, 12);
  });

  it("falls monotonically with altitude", () => {
    let last = 1;
    for (let km = 0; km <= 60; km += 0.5) {
      const s = cloudVolumeShare(km);
      expect(s).toBeLessThanOrEqual(last);
      last = s;
    }
  });

  it("refuses a non-finite altitude or a fade that is not positive", () => {
    expect(() => cloudVolumeShare(Number.NaN)).toThrow(RangeError);
    expect(() => cloudVolumeShare(10, { ceilingKm: 40, fadeKm: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("cloudVolumeMapUv", () => {
  // The map's u is the longitude (atan(n.y, n.x) / 2 pi + 0.5) and v the
  // latitude (asin(n.z) / pi + 0.5), drifting east by the clouds' offset:
  // the globe surface's own mapping (GLOBE_CLOUD_GLSL).
  it("puts the target itself at the target's map position", () => {
    const [u, v] = cloudVolumeMapUv(0, 0, {
      latRad: 0.8,
      lonRad: 0.16,
      lonOffsetRad: 0,
    });
    expect(u).toBeCloseTo(0.16 / (2 * Math.PI) + 0.5, 12);
    expect(v).toBeCloseTo(0.8 / Math.PI + 0.5, 12);
  });

  it("moves east with x and south with z (the local frame), and with the drift", () => {
    const origin = { latRad: 0.8, lonRad: 0.16, lonOffsetRad: 0 };
    const [u0, v0] = cloudVolumeMapUv(0, 0, origin);
    const [ue] = cloudVolumeMapUv(10_000, 0, origin);
    const [, vs] = cloudVolumeMapUv(0, 10_000, origin);
    expect(ue - u0).toBeCloseTo(
      10_000 / (R * Math.cos(0.8)) / (2 * Math.PI),
      9,
    );
    expect(v0 - vs).toBeCloseTo(10_000 / R / Math.PI, 9);
    const [ud] = cloudVolumeMapUv(0, 0, { ...origin, lonOffsetRad: 0.1 });
    expect(u0 - ud).toBeCloseTo(0.1 / (2 * Math.PI), 12);
  });

  it("refuses a non-finite position or origin", () => {
    expect(() =>
      cloudVolumeMapUv(Number.NaN, 0, {
        latRad: 0,
        lonRad: 0,
        lonOffsetRad: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      cloudVolumeMapUv(0, 0, {
        latRad: Number.NaN,
        lonRad: 0,
        lonOffsetRad: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("CLOUD_VOLUME_COVERAGE_GLSL", () => {
  // The chunk is the CPU twin's formula, reading the globe's own map.
  it("defines the slab's coverage function from the globe's map and the share", () => {
    const g = CLOUD_VOLUME_COVERAGE_GLSL;
    expect(g).toMatch(/float\s+atmSlabCoverageAt\s*\(\s*vec2\s+xz\s*\)/);
    for (const name of [
      "uVolumeClouds",
      "uVolumeOrigin",
      "uVolumeLonOffset",
      "uVolumeOpacity",
      "uVolumeShare",
      "uVolumeGain",
    ]) {
      expect(g).toContain(name);
    }
    expect(g).toContain("0.15915494309189535"); // 1 / 2 pi, as the surface
    expect(g).toContain("0.3183098861837907"); // 1 / pi
  });
});
