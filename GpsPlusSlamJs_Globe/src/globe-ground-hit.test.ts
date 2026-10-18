/**
 * Why these tests matter: the 3D editor drags items over the ground under
 * the cursor, and the relief's own raycast cannot serve it (the stencil
 * fill blocks it, and it hits the DRAWN mesh, which a stalled cache can
 * leave kilometres off; G0 spikes 2026-10-17, Q2). The spike's answer was
 * a march along the ray over the SAMPLED heights, then bisection: 0 misses
 * in 40 drags, 10-20 times cheaper. These tests pin that it lands on the
 * ground (flat, sloped, across a tile seam and while the sampled level of
 * detail changes under it), skips what is not loaded, and refuses what it
 * cannot answer instead of inventing a hit.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import {
  GROUND_HIT,
  groundHit,
  marchToGround,
  terrainAboveGround,
} from "./globe-ground-hit.js";

const DEG = Math.PI / 180;
const MUNICH = { lat: 48.137393 * DEG, lon: 11.575493 * DEG };

/** A fake terrain: the real ellipsoid, a group at `matrix`, `ground(lat, lon)` (radians). */
function fakeTerrain(
  ground: (lat: number, lon: number) => number | null,
  matrix = new THREE.Matrix4(),
) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.matrix.copy(matrix);
  group.updateMatrixWorld(true);
  let calls = 0;
  return {
    tiles: { group, ellipsoid: WGS84_ELLIPSOID },
    plugin: {
      sampleCartographicElevation(lat: number, lon: number) {
        calls++;
        return ground(lat, lon);
      },
    },
    calls: () => calls,
  };
}

/** The ENU basis at a place (east, north, up), ECEF. */
function enuAt(lat: number, lon: number) {
  const m = WGS84_ELLIPSOID.getEastNorthUpFrame(
    lat,
    lon,
    0,
    new THREE.Matrix4(),
  );
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  m.extractBasis(east, north, up);
  return { east, north, up };
}

/** A ray from `aboveM` over the ellipsoidal height `baseM` at MUNICH, heading north, pitched `pitchDeg`. */
function rayFrom(baseM: number, aboveM: number, pitchDeg: number) {
  const origin = WGS84_ELLIPSOID.getCartographicToPosition(
    MUNICH.lat,
    MUNICH.lon,
    baseM + aboveM,
    new THREE.Vector3(),
  );
  const { north, up } = enuAt(MUNICH.lat, MUNICH.lon);
  const dir = north
    .clone()
    .multiplyScalar(Math.cos(pitchDeg * DEG))
    .addScaledVector(up, Math.sin(pitchDeg * DEG))
    .normalize();
  return new THREE.Ray(origin, dir);
}

const heightOf = (p: THREE.Vector3) =>
  WGS84_ELLIPSOID.getPositionToCartographic(p, {
    lat: 0,
    lon: 0,
    height: 0,
  }).height;

describe("groundHit", () => {
  // Why: the eye-height case the spike measured, 1.7 m over flat ground
  // looking 10 degrees down: the ground about 9.8 m ahead, and the point
  // ON the sampled ground, not near it.
  it("lands on flat ground at eye height", () => {
    const terrain = fakeTerrain(() => 516);
    const hit = groundHit(terrain, rayFrom(516, 1.7, -10));
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(1.7 / Math.sin(10 * DEG), 1);
    expect(heightOf(hit!.point)).toBeCloseTo(516, 4);
    // About the spike's cost: a march of a few steps, then the bisections.
    expect(hit!.samples).toBeLessThan(60);
    expect(hit!.nulls).toBe(0);
  });

  // Why: on a slope the hit must follow the ground, not a plane through
  // the camera's foot.
  it("follows a slope rising ahead", () => {
    const { north } = enuAt(MUNICH.lat, MUNICH.lon);
    const foot = WGS84_ELLIPSOID.getCartographicToPosition(
      MUNICH.lat,
      MUNICH.lon,
      0,
      new THREE.Vector3(),
    );
    // 20 % rising to the north.
    const ground = (lat: number, lon: number) => {
      const p = WGS84_ELLIPSOID.getCartographicToPosition(
        lat,
        lon,
        0,
        new THREE.Vector3(),
      );
      return 500 + 0.2 * p.sub(foot).dot(north);
    };
    const terrain = fakeTerrain(ground);
    const hit = groundHit(terrain, rayFrom(500, 10, -5));
    expect(hit).not.toBeNull();
    const c = WGS84_ELLIPSOID.getPositionToCartographic(hit!.point, {
      lat: 0,
      lon: 0,
      height: 0,
    });
    expect(c.height - ground(c.lat, c.lon)).toBeCloseTo(0, 4);
    // Flat ground would be 10 / tan(5 deg) = 114 m away; the slope is nearer.
    expect(hit!.t).toBeLessThan(114);
  });

  // Why (the spike's seam profile): two tiles' heights meet at a seam with
  // a few millimetres between them; a hit across the seam lands on one of
  // them, never in a gap.
  it("lands across a tile seam", () => {
    const seamLat = MUNICH.lat + 30 / 6_371_000;
    const ground = (lat: number) => (lat < seamLat ? 516 : 516.004);
    const terrain = fakeTerrain((lat) => ground(lat));
    for (const pitch of [-2, -3, -4, -5, -8]) {
      const hit = groundHit(terrain, rayFrom(516, 1.7, pitch));
      expect(hit, `pitch ${pitch}`).not.toBeNull();
      const c = WGS84_ELLIPSOID.getPositionToCartographic(hit!.point, {
        lat: 0,
        lon: 0,
        height: 0,
      });
      expect(Math.abs(c.height - ground(c.lat))).toBeLessThan(1e-3);
    }
  });

  // Why (the spike's LOD check): the sampler answers from the finest
  // LOADED level, which can change while the editor drags. A coarser level
  // a few centimetres off must still give a hit on the ground it reports.
  it("lands on the ground while the sampled level changes under it", () => {
    let fine = false;
    const terrain = fakeTerrain(() => {
      const h = fine ? 516.02 : 516.0;
      fine = !fine;
      return h;
    });
    const hit = groundHit(terrain, rayFrom(516, 1.7, -10));
    expect(hit).not.toBeNull();
    const h = heightOf(hit!.point);
    expect(h).toBeGreaterThan(515.99);
    expect(h).toBeLessThan(516.03);
  });

  // Why: an area whose heights are not loaded yet must not be read as
  // ground (the spike counted these "nulls"): the march steps over it and
  // finds the ground beyond.
  it("steps over heights that are not loaded and counts them", () => {
    const { north } = enuAt(MUNICH.lat, MUNICH.lon);
    const foot = WGS84_ELLIPSOID.getCartographicToPosition(
      MUNICH.lat,
      MUNICH.lon,
      0,
      new THREE.Vector3(),
    );
    const terrain = fakeTerrain((lat, lon) => {
      const d = WGS84_ELLIPSOID.getCartographicToPosition(
        lat,
        lon,
        0,
        new THREE.Vector3(),
      )
        .sub(foot)
        .dot(north);
      return d > 2 && d < 8 ? null : 516;
    });
    const hit = groundHit(terrain, rayFrom(516, 1.7, -10));
    expect(hit).not.toBeNull();
    expect(heightOf(hit!.point)).toBeCloseTo(516, 3);
    expect(hit!.nulls).toBeGreaterThan(0);
  });

  // Why: a ray that never meets the ground (up into the sky, or one under
  // the ground from its start, or nothing loaded) has no hit; the editor
  // then leaves the item where it is.
  it("is null for a ray up, a ray starting underground, or no heights", () => {
    expect(
      groundHit(
        fakeTerrain(() => 516),
        rayFrom(516, 1.7, 10),
      ),
    ).toBeNull();
    expect(
      groundHit(
        fakeTerrain(() => 516),
        rayFrom(516, -1, -10),
      ),
    ).toBeNull();
    expect(
      groundHit(
        fakeTerrain(() => null),
        rayFrom(516, 1.7, -10),
      ),
    ).toBeNull();
  });

  // Why: the globe lab draws the relief in a frame centred at the target
  // (globe-frame.ts), so the ray arrives in WORLD coordinates and the
  // sampler must undo the group's matrix.
  it("reads the ground through the terrain group's world matrix", () => {
    const frame = WGS84_ELLIPSOID.getEastNorthUpFrame(
      MUNICH.lat,
      MUNICH.lon,
      0,
      new THREE.Matrix4(),
    ).invert();
    const terrain = fakeTerrain(() => 516, frame);
    const ecefRay = rayFrom(516, 1.7, -10);
    const worldRay = ecefRay.clone().applyMatrix4(frame);
    const hit = groundHit(terrain, worldRay);
    expect(hit).not.toBeNull();
    const ecef = hit!.point.clone().applyMatrix4(frame.clone().invert());
    expect(heightOf(ecef)).toBeCloseTo(516, 3);
    expect(hit!.t).toBeCloseTo(1.7 / Math.sin(10 * DEG), 1);
  });

  it("stops at its maximum distance", () => {
    const terrain = fakeTerrain(() => 516);
    // 50 m up, 0.4 degrees down: over the curved Earth (it drops d^2 / 2R)
    // the ray meets the ground about 7.8 km out, past the 5 km default.
    // (1.7 m up at 0.01 degrees down never meets it: the ground falls away
    // faster than the ray.)
    expect(groundHit(terrain, rayFrom(516, 50, -0.4))).toBeNull();
    const far = groundHit(terrain, rayFrom(516, 50, -0.4), {
      maxDistanceM: 20_000,
    });
    expect(far).not.toBeNull();
    expect(far!.t).toBeGreaterThan(7_000);
    expect(far!.t).toBeLessThan(8_500);
    expect(heightOf(far!.point)).toBeCloseTo(516, 3);
    expect(
      groundHit(terrain, rayFrom(516, 1.7, -0.01), { maxDistanceM: 20_000 }),
    ).toBeNull();
    expect(GROUND_HIT.maxDistanceM).toBe(5_000);
  });
});

describe("terrainAboveGround", () => {
  // Why: the march's one question, answered from the SAMPLED ground: a
  // point's height over it, through the ellipsoid; null where nothing is
  // loaded (never 0, which would read as ground).
  it("gives a point's height over the sampled ground, null where none is loaded", () => {
    const above = terrainAboveGround(fakeTerrain(() => 516));
    const p = WGS84_ELLIPSOID.getCartographicToPosition(
      MUNICH.lat,
      MUNICH.lon,
      517.7,
      new THREE.Vector3(),
    );
    expect(above(p)).toBeCloseTo(1.7, 6);
    expect(terrainAboveGround(fakeTerrain(() => null))(p)).toBeNull();
  });
});

describe("marchToGround", () => {
  // Why (defensive): a zero direction or a nonsensical option would loop
  // forever or answer garbage; both are refused at the boundary.
  it("refuses a zero direction and options out of range", () => {
    const above = () => 1;
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 0));
    expect(() => marchToGround(ray, above)).toThrow(RangeError);
    const ok = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    expect(() => marchToGround(ok, above, { minStepM: 0 })).toThrow(RangeError);
    expect(() => marchToGround(ok, above, { stepFraction: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      marchToGround(ok, above, { maxDistanceM: Number.NaN }),
    ).toThrow(RangeError);
    expect(() => marchToGround(ok, above, { bisections: 100 })).toThrow(
      RangeError,
    );
    expect(() => marchToGround(ok, above, { startM: -1 })).toThrow(RangeError);
  });

  // Why: a plain y-up world with ground at y = 0 shows the march's own
  // contract without the ellipsoid: the hit is where the sign changes.
  it("finds the sign change of the height above ground", () => {
    const ray = new THREE.Ray(
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(1, -1, 0).normalize(),
    );
    const hit = marchToGround(ray, (p) => p.y);
    expect(hit!.point.y).toBeCloseTo(0, 5);
    expect(hit!.t).toBeCloseTo(2 * Math.SQRT2, 5);
  });

  it("does not count the start's own sample as a crossing when it starts on the ground", () => {
    const ray = new THREE.Ray(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, -1, 0).normalize(),
    );
    expect(marchToGround(ray, (p) => p.y)).toBeNull();
  });

  // Why: a camera under the ground (a cave of the relief's mesh, a bad
  // height) must not pick a far slope it can only see from behind: a ray
  // that starts below the ground is null even where it comes out and goes
  // under again further on.
  it("is null for a ray that starts underground, even where it re-enters the ground later", () => {
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
    const ridge = (p: THREE.Vector3) => (p.x > 5 && p.x < 10 ? 1 : -1);
    expect(marchToGround(ray, ridge)).toBeNull();
    // From inside the open stretch the same ground is found at 10 m.
    expect(marchToGround(ray, ridge, { startM: 6 })!.t).toBeCloseTo(10, 5);
  });
});
