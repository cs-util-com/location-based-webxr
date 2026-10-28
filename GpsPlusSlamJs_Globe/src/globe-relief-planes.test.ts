/**
 * Why this test matters: the relief's part of the clip planes moved out of
 * the globe lab as a pure refactor, and it decides where the near plane
 * cuts: the ground under the camera and on a ring as far out as the camera
 * stands above it, the nearest of them by `reliefClearanceM`, and the
 * highest peak times the exaggeration. A ring at the wrong distance or a
 * sample at the wrong place clips a ridge beside the camera.
 */

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { reliefClearanceM } from "./globe-camera.js";
import { RELIEF_PEAK_M, createReliefPlanes } from "./globe-relief-planes.js";

const DEG = Math.PI / 180;
const RADIUS = 6_378_137;

/** A camera `altitudeM` over (lat, lon) in degrees, in an unmoved frame. */
function cameraAt(latDeg: number, lonDeg: number, altitudeM: number) {
  const camera = new THREE.PerspectiveCamera();
  WGS84_ELLIPSOID.getCartographicToPosition(
    latDeg * DEG,
    lonDeg * DEG,
    altitudeM,
    camera.position,
  );
  return camera;
}

function planesOver(
  ground: (lat: number, lon: number) => number | null,
  { active = true, scale = 1, altitudeM = 2000 } = {},
) {
  const asked: [number, number][] = [];
  const planes = createReliefPlanes({
    ellipsoid: WGS84_ELLIPSOID,
    group: new THREE.Group(),
    camera: cameraAt(46.9, 7.4, altitudeM),
    radiusM: RADIUS,
    sampleGround: (lat, lon) => {
      asked.push([lat, lon]);
      return ground(lat, lon);
    },
    heightScale: () => scale,
    active: () => active,
  });
  return { planes, asked };
}

describe("createReliefPlanes", () => {
  it("is the ellipsoid's planes ({}) while the relief takes no part", () => {
    const { planes, asked } = planesOver(() => 500, { active: false });
    expect(planes()).toEqual({});
    expect(asked).toEqual([]);
    expect(planes.state()).toEqual({ clearanceM: null, samples: null });
  });

  it("samples below and on a ring as far out as the camera stands above the ground", () => {
    const { planes, asked } = planesOver(() => 500, { scale: 2 });
    const out = planes();
    expect(asked).toHaveLength(9);
    const [lat, lon] = asked[0]!;
    expect(lat / DEG).toBeCloseTo(46.9, 9);
    expect(lon / DEG).toBeCloseTo(7.4, 9);
    // The ring: 1,500 m out (2,000 m over a 500 m ground), north first.
    const s = planes.state().samples!;
    expect(s.ringM).toBeCloseTo(1500, 6);
    expect((asked[1]![0] - lat) * RADIUS).toBeCloseTo(1500, 6);
    expect(asked[1]![1]).toBeCloseTo(lon, 12);
    // East: the longitude step widened by the latitude's cosine.
    expect((asked[3]![1] - lon) * RADIUS * Math.cos(lat)).toBeCloseTo(1500, 6);
    const want = reliefClearanceM(s.altitude, [
      { distanceM: 0, groundM: 500 },
      ...s.ring.map((groundM) => ({ distanceM: 1500, groundM })),
    ]);
    expect(out).toEqual({ clearanceM: want, peakM: RELIEF_PEAK_M * 2 });
    expect(planes.state().clearanceM).toBe(want);
  });

  it("keeps a ring of at least 10 m, and only the peak without loaded ground", () => {
    const low = planesOver(() => 1999, { altitudeM: 2000 });
    low.planes();
    expect(low.planes.state().samples!.ringM).toBe(10);
    const none = planesOver(() => null);
    expect(none.planes()).toEqual({ peakM: RELIEF_PEAK_M });
    expect(none.planes.state().clearanceM).toBeNull();
  });

  it("refuses a radius that is not positive", () => {
    expect(() =>
      createReliefPlanes({
        ellipsoid: WGS84_ELLIPSOID,
        group: new THREE.Group(),
        camera: new THREE.PerspectiveCamera(),
        radiusM: 0,
        sampleGround: () => null,
        heightScale: () => 1,
        active: () => true,
      }),
    ).toThrow(RangeError);
  });
});
