/**
 * Why these tests matter: the OSM raster tiles are someone else's servers
 * under a usage policy (no heavy use, no bulk downloading). The 3D editor
 * may ask for them only when the camera is low and slow, only for tiles
 * within the fade distance, and at most about 150 a minute. These tests
 * pin each of those limits on its own; `globe-osm-overlay.test.ts` pins
 * them through the library's overlay class.
 */
import fc from "fast-check";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import {
  GLOBE_OSM,
  createRequestCeiling,
  osmGateLimits,
  osmOverlayActive,
  rampOsmOn,
  regionNearCamera,
} from "./globe-osm-gate.js";

const DEG = Math.PI / 180;

describe("GLOBE_OSM", () => {
  // Why: the numbers the 3D editor plan (§13) sets; a change is a decision.
  it("holds the plan's limits", () => {
    expect(GLOBE_OSM).toMatchObject({
      fadeM: 300,
      minZoom: 15,
      requestsPerMinute: 150,
      maxAboveGroundM: 200,
      maxSpeedMps: 50,
    });
  });
});

describe("osmOverlayActive", () => {
  // Why (G1 review L2): one threshold for on and off made a camera at
  // about 200 m, or about 50 m/s, switch the map (and its requests) on and
  // off every frame. Off stays at 200 m / 50 m/s; on needs the camera
  // below 180 m and slower than 45 m/s; in between, it stays as it was.
  it("switches on below 180 m and 45 m/s, off above 200 m or 50 m/s, and holds between", () => {
    const on = (aboveGroundM: number, speedMps: number, was: boolean) =>
      osmOverlayActive({ aboveGroundM, speedMps }, was);
    // Low and slow: on, whatever it was.
    expect(on(1.7, 1.5, false)).toBe(true);
    expect(on(180, 45, false)).toBe(true);
    // The band: holds.
    expect(on(190, 10, false)).toBe(false);
    expect(on(190, 10, true)).toBe(true);
    expect(on(10, 48, false)).toBe(false);
    expect(on(10, 48, true)).toBe(true);
    expect(on(200, 50, true)).toBe(true);
    // Beyond: off, whatever it was.
    expect(on(200.1, 0, true)).toBe(false);
    expect(on(10, 50.1, true)).toBe(false);
    // Without the last state, the stricter rule (switching on).
    expect(osmOverlayActive({ aboveGroundM: 190, speedMps: 0 })).toBe(false);
  });

  // Why: a camera crossing the threshold back and forth must not toggle
  // the map: along any path, it switches only on a crossing of the whole
  // band (below 180 m and 45 m/s to switch on, above 200 m or 50 m/s to
  // switch off), never inside it.
  it("never switches inside the band, along any path", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            h: fc.double({ min: 0, max: 400, noNaN: true }),
            v: fc.double({ min: 0, max: 100, noNaN: true }),
          }),
          { minLength: 1, maxLength: 60 },
        ),
        (path) => {
          let was = false;
          for (const { h, v } of path) {
            const now = osmOverlayActive({ aboveGroundM: h, speedMps: v }, was);
            // Switched on only below the band, off only above it.
            expect(!(now && !was) || (h <= 180 && v <= 45)).toBe(true);
            expect(!(!now && was) || h > 200 || v > 50).toBe(true);
            was = now;
          }
        },
      ),
    );
  });

  // Why: an unknown height (no ground loaded) or speed must not open the
  // gate: the default is no requests.
  it("is off for an unknown height or speed", () => {
    expect(osmOverlayActive({ aboveGroundM: Number.NaN, speedMps: 0 })).toBe(
      false,
    );
    expect(osmOverlayActive({ aboveGroundM: 1, speedMps: Number.NaN })).toBe(
      false,
    );
    expect(
      osmOverlayActive({
        aboveGroundM: null as unknown as number,
        speedMps: 0,
      }),
    ).toBe(false);
  });

  // Why: an editor that looks at the ground from above wants the map
  // much higher than a flight does (it is the map of the place being
  // edited, not a texture under a passing camera), and its camera jumps
  // across the place, so speed is no sign of flying there. The limits are
  // the caller's, with the same band rule; open speed limits never turn
  // the map off, but an unknown speed still does.
  it("takes the caller's limits, open speed limits included", () => {
    const limits = {
      maxAboveGroundM: 1250,
      onBelowAboveGroundM: 1125,
      maxSpeedMps: Number.POSITIVE_INFINITY,
      onBelowSpeedMps: Number.POSITIVE_INFINITY,
    };
    const on = (aboveGroundM: number, speedMps: number, was: boolean) =>
      osmOverlayActive({ aboveGroundM, speedMps }, was, limits);
    expect(on(1100, 5_000, false)).toBe(true);
    expect(on(1200, 0, false)).toBe(false);
    expect(on(1200, 0, true)).toBe(true);
    expect(on(1250.1, 0, true)).toBe(false);
    expect(on(10, Number.NaN, true)).toBe(false);
  });
});

describe("osmGateLimits", () => {
  // Why: the defaults are the flight's limits; a caller replaces any of
  // them, and a set that would switch the map on above where it switches
  // off (a band upside down), or a limit that is no height or speed at
  // all, is refused where it is made rather than silently never drawing.
  it("fills the defaults and keeps the caller's", () => {
    expect(osmGateLimits({}, 19)).toEqual({
      minZoom: 15,
      maxAboveGroundM: 200,
      onBelowAboveGroundM: 180,
      maxSpeedMps: 50,
      onBelowSpeedMps: 45,
    });
    expect(
      osmGateLimits(
        {
          minZoom: 14,
          maxAboveGroundM: 1250,
          onBelowAboveGroundM: 1125,
          maxSpeedMps: Number.POSITIVE_INFINITY,
          onBelowSpeedMps: Number.POSITIVE_INFINITY,
        },
        19,
      ),
    ).toMatchObject({ minZoom: 14, maxAboveGroundM: 1250 });
  });

  it("refuses a band upside down, a limit that is not > 0, or a zoom out of range", () => {
    const bad = [
      { onBelowAboveGroundM: 250 },
      { maxSpeedMps: 40 },
      { maxAboveGroundM: 0 },
      { onBelowSpeedMps: Number.NaN },
      { maxAboveGroundM: "200" as unknown as number },
      { minZoom: 14.5 },
      { minZoom: -1 },
      { minZoom: 20 },
    ];
    for (const limits of bad) {
      expect(() => osmGateLimits(limits, 19), JSON.stringify(limits)).toThrow(
        RangeError,
      );
    }
  });
});

describe("rampOsmOn", () => {
  // Why (G1 review L2): the map's switch was a hard 0/1 on the shader's
  // `uOsmOn`, so the map popped in and out. It now moves toward its
  // target by the frame's share of `rampMs` (0.3 s), and lands exactly.
  it("moves toward the target by the frame's share of the ramp, and lands", () => {
    expect(GLOBE_OSM.rampMs).toBe(300);
    expect(rampOsmOn(0, 1, 30)).toBeCloseTo(0.1, 10);
    expect(rampOsmOn(0.5, 0, 75)).toBeCloseTo(0.25, 10);
    expect(rampOsmOn(0.95, 1, 30)).toBe(1);
    expect(rampOsmOn(0.05, 0, 30)).toBe(0);
    expect(rampOsmOn(1, 1, 16)).toBe(1);
    // A stall (a tab in the background) lands at once; a clock that went
    // back, or no time, does not move it.
    expect(rampOsmOn(0, 1, 10_000)).toBe(1);
    expect(rampOsmOn(0.4, 1, -5)).toBe(0.4);
    expect(rampOsmOn(0.4, 1, Number.NaN)).toBe(0.4);
  });

  it("stays in [0, 1] and never passes its target", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(0, 1),
        fc.double({ min: 0, max: 2_000, noNaN: true }),
        (from, to, dt) => {
          const next = rampOsmOn(from, to, dt);
          expect(next).toBeGreaterThanOrEqual(Math.min(from, to));
          expect(next).toBeLessThanOrEqual(Math.max(from, to));
        },
      ),
    );
  });
});

describe("createRequestCeiling", () => {
  // Why: the ceiling is a sliding minute, not a fixed bucket: 150 at the
  // end of one minute and 150 at the start of the next would be 300 in a
  // minute.
  it("allows the ceiling within any minute and waits for the oldest to age out", () => {
    let t = 0;
    const ceiling = createRequestCeiling(3, () => t);
    expect(ceiling.waitMs()).toBe(0);
    ceiling.take();
    t = 10_000;
    ceiling.take();
    ceiling.take();
    expect(ceiling.inLastMinute()).toBe(3);
    t = 30_000;
    expect(ceiling.waitMs()).toBe(30_000);
    t = 60_000;
    expect(ceiling.waitMs()).toBe(0);
    expect(ceiling.inLastMinute()).toBe(2);
    expect(ceiling.total()).toBe(3);
  });

  it("refuses a ceiling that is not a positive integer", () => {
    for (const n of [0, -1, 1.5, Number.NaN]) {
      expect(() => createRequestCeiling(n)).toThrow(RangeError);
    }
  });
});

/** A camera `aboveM` over the ellipsoid at a place (tiles frame). */
const cameraAt = (lat: number, lon: number, aboveM: number) =>
  WGS84_ELLIPSOID.getCartographicToPosition(
    lat * DEG,
    lon * DEG,
    aboveM,
    new THREE.Vector3(),
  );

/** A z-level square region around a place (radians, [w, s, e, n]). */
function regionAround(lat: number, lon: number, halfDeg: number) {
  return [
    (lon - halfDeg) * DEG,
    (lat - halfDeg) * DEG,
    (lon + halfDeg) * DEG,
    (lat + halfDeg) * DEG,
  ];
}

describe("regionNearCamera", () => {
  const flat = () => 0;

  it("takes a region under the camera and refuses one beyond the distance", () => {
    const camera = cameraAt(48.137, 11.575, 1.7);
    // About 120 m across, under the camera.
    expect(
      regionNearCamera(regionAround(48.137, 11.575, 0.0005), camera, {
        ellipsoid: WGS84_ELLIPSOID,
        groundAtM: flat,
        withinM: 300,
      }),
    ).toBe(true);
    // The same size about 1.1 km north.
    expect(
      regionNearCamera(regionAround(48.147, 11.575, 0.0005), camera, {
        ellipsoid: WGS84_ELLIPSOID,
        groundAtM: flat,
        withinM: 300,
      }),
    ).toBe(false);
  });

  // Why: the test is against the region's nearest part, not its centre: a
  // big region whose centre is far but whose edge is under the camera is
  // in reach.
  it("counts a large region by its extent, not its centre", () => {
    const camera = cameraAt(48.137, 11.575, 1.7);
    const big = regionAround(48.142, 11.575, 0.006); // edge 0.001 deg south of the camera's
    expect(
      regionNearCamera(big, camera, {
        ellipsoid: WGS84_ELLIPSOID,
        groundAtM: flat,
        withinM: 300,
      }),
    ).toBe(true);
  });

  // Why: the region sits on the drawn ground; a camera 1.7 m over a
  // plateau at 2,000 m is near it, not 2 km above it.
  it("puts the region on the ground the sampler reads", () => {
    const camera = cameraAt(46.5, 9, 2_001.7);
    const opts = { ellipsoid: WGS84_ELLIPSOID, withinM: 300 };
    const r = regionAround(46.5, 9, 0.0005);
    expect(
      regionNearCamera(r, camera, { ...opts, groundAtM: () => 2_000 }),
    ).toBe(true);
    expect(
      regionNearCamera(r, camera, { ...opts, groundAtM: () => null }),
    ).toBe(false);
  });

  it("refuses a malformed region or distance", () => {
    const camera = cameraAt(0, 0, 1);
    const opts = { ellipsoid: WGS84_ELLIPSOID, groundAtM: () => 0 };
    expect(() =>
      regionNearCamera([0, 0, 1], camera, { ...opts, withinM: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      regionNearCamera([0, 0.1, 0.1, 0], camera, { ...opts, withinM: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      regionNearCamera([0, 0, 0.1, 0.1], camera, { ...opts, withinM: -1 }),
    ).toThrow(RangeError);
  });
});
