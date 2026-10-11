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

import { GLOBE_CLOUD_FILTER_GLSL } from "./globe-cloud-filter.js";
import {
  CLOUD_VOLUME,
  CLOUD_VOLUME_COVERAGE_GLSL,
  cloudVolumeDiscCentre,
  cloudVolumeMapUv,
  cloudVolumeNoiseOffset,
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

// Why: the slab's noise is tiled in world metres, and the lab's world frame
// is centred on the target, so with a fixed offset every place on Earth put
// the SAME patch of noise under the target - a clear one: every link the
// owner zoomed into looked straight down into the same hole (2026-10-06,
// 0 % cover at 11 km over a place the map has overcast). The offset makes
// the noise belong to the ground, and drift east with the map's clouds.
describe("cloudVolumeNoiseOffset", () => {
  const TILE_M = 24_000;
  // The noise repeats at 13 tiles (the hex-tiled octave, hex-tiling plan
  // H1): wrapped at one tile, the hex field jumped there.
  const PERIOD = 13;
  const wrap = (t: number) => t - PERIOD * Math.floor(t / PERIOD);

  it("is the target's east and south distance from (0, 0) in tiles, wrapped to [0, the period)", () => {
    const [u, v] = cloudVolumeNoiseOffset(
      { latRad: 0.5, lonRad: 0.1, lonOffsetRad: 0 },
      TILE_M,
      PERIOD,
    );
    const east = (R * Math.cos(0.5) * 0.1) / TILE_M;
    const south = (-R * 0.5) / TILE_M;
    expect(u).toBeCloseTo(wrap(east), 9);
    expect(v).toBeCloseTo(wrap(south), 9);
  });

  it("moves the noise east with the map's drift", () => {
    const at = { latRad: 0.8, lonRad: 0.16, lonOffsetRad: 0 };
    const [u0] = cloudVolumeNoiseOffset(at, TILE_M, PERIOD);
    const [u1] = cloudVolumeNoiseOffset(
      { ...at, lonOffsetRad: 1e-4 },
      TILE_M,
      PERIOD,
    );
    // The map is read at (lon - drift): a feature moves east by the drift,
    // so the noise under a fixed point is the noise from further west.
    const step = (R * Math.cos(0.8) * 1e-4) / TILE_M;
    expect((((u0 - u1 - step) % 1) + 1.5) % 1).toBeCloseTo(0.5, 9);
  });

  it("refuses a non-finite position, a tile that is not positive or a period that is not a whole number of tiles", () => {
    expect(() =>
      cloudVolumeNoiseOffset(
        { latRad: Number.NaN, lonRad: 0, lonOffsetRad: 0 },
        TILE_M,
        PERIOD,
      ),
    ).toThrow(RangeError);
    expect(() =>
      cloudVolumeNoiseOffset(
        { latRad: 0, lonRad: 0, lonOffsetRad: 0 },
        0,
        PERIOD,
      ),
    ).toThrow(RangeError);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        cloudVolumeNoiseOffset(
          { latRad: 0, lonRad: 0, lonOffsetRad: 0 },
          TILE_M,
          bad,
        ),
      ).toThrow(RangeError);
    }
  });
});

describe("CLOUD_VOLUME_COVERAGE_GLSL", () => {
  // The chunk is the CPU twin's formula, reading the globe's own map.
  it("defines the slab's coverage function from the globe's map and the share", () => {
    const g = CLOUD_VOLUME_COVERAGE_GLSL;
    expect(g).toMatch(/float\s+atmCloudCoverageAt\s*\(\s*vec2\s+xz\s*\)/);
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

  // Why (round-3 plan 2026-10-08-2345 M1): the volume reads the same map as
  // the shell above it and must read it the same way, through the
  // B-spline, or the two disagree where they cross-fade. At level 0: the
  // march has no gradients.
  it("reads the map through the B-spline, as the surface and the shell do", () => {
    const g = CLOUD_VOLUME_COVERAGE_GLSL;
    expect(g).toContain(GLOBE_CLOUD_FILTER_GLSL);
    expect(g).toContain("globeCloudCubicLod( uVolumeClouds, uv )");
    expect(g).not.toMatch(/texture2D\(\s*uVolumeClouds/);
  });
});

// Why (owner's Debug export, 2026-10-06, volume-cloud plan §15): at 24 km
// looking 10 degrees down, the view's centre met the deck about 130 km
// ahead, but the volume's disc was centred on the camera, so the clouds
// the owner looked at were the shell's, not the volume's. The disc now
// centres where the view meets the deck, at most `maxAheadM` ahead.
describe("cloudVolumeDiscCentre", () => {
  const deckY = 9_000;

  it("is under the camera looking straight down", () => {
    const c = cloudVolumeDiscCentre({
      camera: [100, 20_000, -200],
      direction: [0, -1, 0],
      deckY,
      maxAheadM: 60_000,
    });
    expect(c).toEqual({ x: 100, z: -200, aheadM: 0 });
  });

  it("is where the view meets the deck, along the view's heading", () => {
    // 10 km above the deck, 45 degrees down toward +x: 10 km ahead.
    const c = cloudVolumeDiscCentre({
      camera: [0, deckY + 10_000, 0],
      direction: [Math.SQRT1_2, -Math.SQRT1_2, 0],
      deckY,
      maxAheadM: 60_000,
    });
    expect(c.x).toBeCloseTo(10_000, 6);
    expect(c.z).toBeCloseTo(0, 6);
    expect(c.aheadM).toBeCloseTo(10_000, 6);
  });

  it("is at most maxAheadM ahead, and that far when the view never meets the deck", () => {
    const shallow = cloudVolumeDiscCentre({
      camera: [0, deckY + 15_000, 0],
      direction: [0, -0.17, -0.985],
      deckY,
      maxAheadM: 60_000,
    });
    expect(shallow.aheadM).toBe(60_000);
    expect(shallow.z).toBeCloseTo(-60_000, 6);
    const up = cloudVolumeDiscCentre({
      camera: [0, deckY + 15_000, 0],
      direction: [0.6, 0.8, 0],
      deckY,
      maxAheadM: 60_000,
    });
    expect(up.aheadM).toBe(60_000);
  });

  it("refuses a non-finite input or a negative reach ahead", () => {
    expect(() =>
      cloudVolumeDiscCentre({
        camera: [0, Number.NaN, 0],
        direction: [0, -1, 0],
        deckY,
        maxAheadM: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      cloudVolumeDiscCentre({
        camera: [0, 1, 0],
        direction: [0, -1, 0],
        deckY,
        maxAheadM: -1,
      }),
    ).toThrow(RangeError);
  });
});
