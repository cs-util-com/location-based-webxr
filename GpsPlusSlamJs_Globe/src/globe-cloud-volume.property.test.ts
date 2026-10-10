/**
 * Why this test matters: the cloud volume's noise must belong to the
 * GROUND, not to wherever the lab's world frame happens to be centred.
 * With a fixed offset every place put the same patch of noise under its
 * target, a clear one, so every link the owner zoomed into looked straight
 * down into the same hole (2026-10-06). The property: a fixed point on the
 * ground reads the same noise coordinate whichever target the frame is
 * centred on (the slab reads `xz / tile + offset`, the local frame x east,
 * z south). Checked exactly where the local frame is exact: targets on one
 * parallel (east-west) and on one meridian (north-south).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import {
  type CloudNoiseAnchorKm,
  cloudVolumeAnchorDrift,
  cloudVolumeAnchorRecentre,
  cloudVolumeDiscCentre,
  cloudVolumeNoiseAnchor,
  cloudVolumeNoiseOffset,
  cloudVolumeRecentreShift,
  unwrapDriftRad,
} from "./globe-cloud-volume.js";
import { worldFromEcefAt } from "./globe-frame.js";

const DEG = Math.PI / 180;

const R = 6_371_000;
const TILE_M = 24_000;
/**
 * The noise's period in tiles (the hex-tiled octave repeats at 13 tiles,
 * hex-tiling plan H1): the offset wraps there, not at one tile. These
 * properties measure modulo the period, so a wrap at one tile fails them.
 */
const PERIOD = 13;

/** The distance between two coordinates on a circle of PERIOD (wrapped). */
const wrapped = (a: number, b: number) => {
  const d = (((a - b) % PERIOD) + PERIOD) % PERIOD;
  return Math.min(d, PERIOD - d);
};

const latRad = fc.double({ min: -1.3, max: 1.3, noNaN: true });
const lonRad = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const drift = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
/** A ground point within 30 km of the target (radians). */
const near = fc.double({ min: -0.0047, max: 0.0047, noNaN: true });

describe("cloudVolumeNoiseOffset (properties)", () => {
  it("is always in [0, the period) on both axes", () => {
    fc.assert(
      fc.property(latRad, lonRad, drift, (lat, lon, d) => {
        const [u, v] = cloudVolumeNoiseOffset(
          { latRad: lat, lonRad: lon, lonOffsetRad: d },
          TILE_M,
          PERIOD,
        );
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(PERIOD);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(PERIOD);
      }),
    );
  });

  it("gives a fixed ground point the same noise for two targets on its parallel", () => {
    fc.assert(
      fc.property(latRad, lonRad, near, near, drift, (lat, lon, d1, d2, d) => {
        const point = lon + d1;
        const read = (targetLon: number) => {
          const [u] = cloudVolumeNoiseOffset(
            { latRad: lat, lonRad: targetLon, lonOffsetRad: d },
            TILE_M,
            PERIOD,
          );
          const x = R * Math.cos(lat) * (point - targetLon);
          return x / TILE_M + u;
        };
        expect(wrapped(read(lon), read(lon + d2))).toBeLessThan(1e-6);
      }),
    );
  });

  it("gives a fixed ground point the same noise for two targets on its meridian", () => {
    fc.assert(
      fc.property(latRad, lonRad, near, near, (lat, lon, d1, d2) => {
        const point = lat + d1;
        const read = (targetLat: number) => {
          const [, v] = cloudVolumeNoiseOffset(
            { latRad: targetLat, lonRad: lon, lonOffsetRad: 0 },
            TILE_M,
            PERIOD,
          );
          const z = -R * (point - targetLat);
          return z / TILE_M + v;
        };
        expect(wrapped(read(lat), read(lat + d2))).toBeLessThan(1e-6);
      }),
    );
  });
});

describe("cloudVolumeDiscCentre (properties)", () => {
  // The disc never leaves the view's heading and never goes further ahead
  // than allowed: whatever the camera and its direction.
  it("lies on the view's heading, at most maxAheadM from the camera", () => {
    const coord = fc.double({ min: -100_000, max: 100_000, noNaN: true });
    const height = fc.double({ min: 0, max: 40_000, noNaN: true });
    const unit = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        coord,
        height,
        coord,
        unit,
        unit,
        unit,
        (x, y, z, dx, dy, dz) => {
          const len = Math.hypot(dx, dy, dz);
          fc.pre(len > 1e-3);
          const direction: [number, number, number] = [
            dx / len,
            dy / len,
            dz / len,
          ];
          const c = cloudVolumeDiscCentre({
            camera: [x, y, z],
            direction,
            deckY: 9_000,
            maxAheadM: 60_000,
          });
          const ox = c.x - x;
          const oz = c.z - z;
          expect(Math.hypot(ox, oz)).toBeLessThanOrEqual(60_000 + 1e-6);
          expect(Math.hypot(ox, oz)).toBeCloseTo(c.aheadM, 3);
          // Along the heading: no sideways part, never behind.
          expect(Math.abs(ox * direction[2] - oz * direction[0])).toBeLessThan(
            1e-3,
          );
          expect(ox * direction[0] + oz * direction[2]).toBeGreaterThanOrEqual(
            -1e-6,
          );
        },
      ),
    );
  });
});

// WHY (the owner, 2026-10-08, r805: "zooming out and back in, the clouds
// sometimes jump, as if a random seed were not persisted"): under the
// user's hand the lab recentres its frame once the camera's ground point
// drifts 20 km from the origin, in ANY direction. The offset alone is
// right only along a parallel or a meridian (above): a recentre that
// changes the latitude moved the whole noise by R dcos(lat) lon (a quarter
// tile near Bern). Carrying the shift across the recentre keeps a ground
// point's noise where it was, wherever the frame moves.
describe("a frame recentre in any direction (cloudVolumeRecentreShift)", () => {
  const ellipsoid = WGS84_ELLIPSOID;
  const xzIn = (
    target: { lat: number; lng: number },
    p: { lat: number; lng: number },
  ) => {
    const m = worldFromEcefAt(ellipsoid, target, new THREE.Matrix4());
    const v = ellipsoid
      .getCartographicToPosition(
        p.lat * DEG,
        p.lng * DEG,
        0,
        new THREE.Vector3(),
      )
      .applyMatrix4(m);
    return [v.x / TILE_M, v.z / TILE_M] as const;
  };
  const read = (
    target: { lat: number; lng: number },
    p: { lat: number; lng: number },
    driftRad: number,
    shift: readonly [number, number],
  ) => {
    const [x, z] = xzIn(target, p);
    const [u, v] = cloudVolumeNoiseOffset(
      {
        latRad: target.lat * DEG,
        lonRad: target.lng * DEG,
        lonOffsetRad: driftRad,
      },
      TILE_M,
      PERIOD,
    );
    return [x + u + shift[0], z + v + shift[1]] as const;
  };
  const latDeg = fc.double({ min: -70, max: 70, noNaN: true });
  const lngDeg = fc.double({ min: -179, max: 179, noNaN: true });
  /** Up to about 30 km, in degrees. */
  const step = fc.double({ min: -0.27, max: 0.27, noNaN: true });

  it("keeps a ground point's noise across the recentre", () => {
    fc.assert(
      fc.property(
        latDeg,
        lngDeg,
        step,
        step,
        step,
        step,
        drift,
        (lat, lng, a, b, c, d, dr) => {
          const from = { lat, lng };
          const to = { lat: lat + a, lng: lng + b };
          const point = { lat: to.lat + c / 2, lng: to.lng + d / 2 };
          const shift = cloudVolumeRecentreShift(
            ellipsoid,
            from,
            to,
            dr,
            TILE_M,
            PERIOD,
          );
          const before = read(from, point, dr, [0, 0]);
          const after = read(to, point, dr, shift);
          expect(wrapped(before[0], after[0])).toBeLessThan(0.003);
          expect(wrapped(before[1], after[1])).toBeLessThan(0.003);
        },
      ),
    );
  });

  // The bug, measured: without the shift a 20 km diagonal recentre near
  // Bern moved the noise under a ground point by a large share of a tile.
  it("moved the noise without it (the owner's jump)", () => {
    const from = { lat: 46.95, lng: 7.45 };
    const to = { lat: 47.08, lng: 7.63 };
    const point = { lat: 47.05, lng: 7.6 };
    const before = read(from, point, 0, [0, 0]);
    const after = read(to, point, 0, [0, 0]);
    expect(wrapped(before[0], after[0])).toBeGreaterThan(0.05);
  });
});

// WHY (round-3 plan review, finding 7): the map's drift wraps at 360
// degrees every 16 minutes, and the noise offset follows the drift: at the
// wrap it jumped by R cos(lat) 2 pi / tile modulo the period (1.5-5.4
// tiles). Read unwrapped, the drift moves the offset smoothly through it.
describe("the drift read unwrapped (unwrapDriftRad)", () => {
  it("continues the drift through its wrap, by the shortest way", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        (previous, step) => {
          const wrapped =
            (((previous + step) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          expect(unwrapDriftRad(previous, wrapped)).toBeCloseTo(
            previous + step,
            9,
          );
        },
      ),
    );
  });

  it("keeps the noise offset continuous where the drift wraps", () => {
    const at = (d: number) =>
      cloudVolumeNoiseOffset(
        { latRad: 46.95 * DEG, lonRad: 7.45 * DEG, lonOffsetRad: d },
        TILE_M,
        PERIOD,
      )[0];
    const before = 2 * Math.PI - 1e-4;
    const wrappedAfter = 1e-4;
    // Wrapped, the offset jumps; unwrapped, it moves by the step alone.
    expect(wrapped(at(before), at(wrappedAfter))).toBeGreaterThan(0.5);
    // Unwrapped, it moves by exactly the step's own drift: R cos(lat) dd.
    const unwrapped = unwrapDriftRad(before, wrappedAfter);
    const step = (R * Math.cos(46.95 * DEG) * (unwrapped - before)) / TILE_M;
    expect(wrapped(at(before), at(unwrapped))).toBeCloseTo(Math.abs(step), 9);
  });
});

// WHY (round-3 plan review, finding 9): the carried shift makes the noise
// depend on the path the frame took. Documented, bounded: out to 100 km
// along a line and back leaves a ground point's noise within 0.02 tile.
describe("a frame that goes out and comes back (cloudVolumeRecentreShift)", () => {
  it("returns a ground point's noise close to where it was", () => {
    const ellipsoid = WGS84_ELLIPSOID;
    const start = { lat: 46.95, lng: 7.45 };
    const path: { lat: number; lng: number }[] = [start];
    for (let i = 1; i <= 5; i++)
      path.push({ lat: start.lat + 0.13 * i, lng: start.lng + 0.18 * i });
    for (let i = 4; i >= 0; i--)
      path.push({ lat: start.lat + 0.13 * i, lng: start.lng + 0.18 * i });
    let shift: [number, number] = [0, 0];
    for (let i = 1; i < path.length; i++) {
      const [du, dv] = cloudVolumeRecentreShift(
        ellipsoid,
        path[i - 1]!,
        path[i]!,
        0,
        TILE_M,
        PERIOD,
      );
      shift = [shift[0] + du, shift[1] + dv];
    }
    expect(wrapped(shift[0], 0)).toBeLessThan(0.02);
    expect(wrapped(shift[1], 0)).toBeLessThan(0.02);
  });
});

// WHY (round-3 plan 2026-10-08-2345, N1; the second cold review, item 4):
// the live noise is anchored by ONE carried noise-plane position of the
// frame's origin (km, float64, unwrapped) and the frame's rotation, moved
// by every recentre and by the drift. The C1 carry above left a rotation
// per recentre (270-480 m at 80-140 km near Bern) and a path dependence
// (within 0.02 tile, about 480 m, out to 100 km and back). Carrying the
// rotation too, a ground point keeps its plane position across a recentre
// in any direction, and a path out and back, with the drift running
// through its wrap, returns the anchor to where it started.
describe("the live noise's anchor (cloudVolumeAnchorRecentre, cloudVolumeAnchorDrift)", () => {
  const ellipsoid = WGS84_ELLIPSOID;
  /** A ground point's horizontal place (km) in the frame at `target`. */
  const localKm = (
    target: { lat: number; lng: number },
    p: { lat: number; lng: number },
  ): [number, number] => {
    const m = worldFromEcefAt(ellipsoid, target, new THREE.Matrix4());
    const v = ellipsoid
      .getCartographicToPosition(
        p.lat * DEG,
        p.lng * DEG,
        0,
        new THREE.Vector3(),
      )
      .applyMatrix4(m);
    return [v.x / 1000, v.z / 1000];
  };
  /** Where a local point (km) lies on the plane for an anchor. */
  const onPlane = (
    anchor: CloudNoiseAnchorKm,
    [x, z]: [number, number],
  ): [number, number] => {
    const c = Math.cos(anchor.rotationRad);
    const s = Math.sin(anchor.rotationRad);
    return [
      anchor.originKm[0] + c * x - s * z,
      anchor.originKm[1] + s * x + c * z,
    ];
  };
  const latDeg = fc.double({ min: -70, max: 70, noNaN: true });
  const lngDeg = fc.double({ min: -179, max: 179, noNaN: true });
  /** Up to about 30 km, in degrees. */
  const step = fc.double({ min: -0.27, max: 0.27, noNaN: true });

  it("keeps a ground point on its plane position across a recentre in any direction", () => {
    fc.assert(
      fc.property(
        latDeg,
        lngDeg,
        step,
        step,
        step,
        step,
        drift,
        // A rotation already carried (any earlier path).
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        (lat, lng, a, b, c, d, dr, rot) => {
          const from = { lat, lng };
          const to = { lat: lat + a, lng: lng + b };
          const point = { lat: to.lat + c / 2, lng: to.lng + d / 2 };
          const before = {
            ...cloudVolumeNoiseAnchor({
              latRad: lat * DEG,
              lonRad: lng * DEG,
              lonOffsetRad: dr,
            }),
            rotationRad: rot,
          };
          const after = cloudVolumeAnchorRecentre(ellipsoid, before, from, to);
          const p0 = onPlane(before, localKm(from, point));
          const p1 = onPlane(after, localKm(to, point));
          // 5 m: the frames' curvature over a 30 km step and a point 15 km
          // past it (the C1 carry left 270-480 m at 80-140 km).
          expect(Math.hypot(p0[0] - p1[0], p0[1] - p1[1])).toBeLessThan(0.005);
        },
      ),
    );
  });

  it("returns to its start after a path out and back, the drift wrapping on the way", () => {
    const hop = fc.record({
      dLat: step,
      dLng: step,
      dDrift: fc.double({ min: -0.01, max: 0.01, noNaN: true }),
    });
    fc.assert(
      fc.property(
        latDeg,
        lngDeg,
        fc.array(hop, { minLength: 1, maxLength: 8 }),
        (lat, lng, hops) => {
          const TURN = 2 * Math.PI;
          // The raw drift starts just below its wrap, so the path crosses it.
          let raw = TURN - 0.005;
          let unwrapped = raw;
          const start = cloudVolumeNoiseAnchor({
            latRad: lat * DEG,
            lonRad: lng * DEG,
            lonOffsetRad: unwrapped,
          });
          let anchor = start;
          let at = { lat, lng };
          const path = [at];
          const driftBy = (delta: number) => {
            raw = (((raw + delta) % TURN) + TURN) % TURN;
            const next = unwrapDriftRad(unwrapped, raw);
            anchor = cloudVolumeAnchorDrift(
              anchor,
              at.lat * DEG,
              next - unwrapped,
            );
            unwrapped = next;
          };
          for (const h of hops) {
            const to = { lat: at.lat + h.dLat, lng: at.lng + h.dLng };
            anchor = cloudVolumeAnchorRecentre(ellipsoid, anchor, at, to);
            at = to;
            path.push(at);
            driftBy(h.dDrift);
          }
          for (let i = hops.length - 1; i >= 0; i--) {
            driftBy(-hops[i]!.dDrift);
            const to = path[i]!;
            anchor = cloudVolumeAnchorRecentre(ellipsoid, anchor, at, to);
            at = to;
          }
          const [x0, z0] = start.originKm;
          const [x1, z1] = anchor.originKm;
          // 1 cm over up to 8 hops of 30 km each way (the C1 carry: 480 m
          // over 100 km and back), and the rotation back to 1e-9 rad. Each
          // frame's east seen in the other alone left about 1e-5 rad a hop
          // (the frames' tilts' product): the turn is their half difference.
          expect(Math.hypot(x1 - x0, z1 - z0)).toBeLessThan(1e-5);
          expect(Math.abs(anchor.rotationRad - start.rotationRad)).toBeLessThan(
            1e-9,
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  // The drift's sign is the noise offset's (cloudVolumeNoiseOffset): the
  // clouds move east with the map, so the origin moves west on the plane.
  it("moves the origin as the noise offset moves with the drift", () => {
    const origin = { latRad: 46.95 * DEG, lonRad: 7.45 * DEG };
    const a = cloudVolumeNoiseAnchor({ ...origin, lonOffsetRad: 0.1 });
    const b = cloudVolumeAnchorDrift(a, origin.latRad, 0.05);
    const direct = cloudVolumeNoiseAnchor({ ...origin, lonOffsetRad: 0.15 });
    expect(b.originKm[0]).toBeCloseTo(direct.originKm[0], 9);
    expect(b.originKm[1]).toBeCloseTo(direct.originKm[1], 9);
  });
});

// WHY (the N1 milestone review, round-3 plan §19 item 3): the carry's hop
// was the new origin's horizontal place in the old frame, the chord's
// horizontal part (R sin(theta)), not the arc (R theta). Retracing 30 km
// hops hides that (the same error each way); an excursion out in 20 km
// recentres and back in one long hop does not: about 4 km off after
// 1,000 km and 33 km after 2,000. The hop is now the azimuthal-equidistant
// one (the arc along the first heading, the turn between the headings).
describe("a long excursion and one hop back (cloudVolumeAnchorRecentre)", () => {
  const ellipsoid = WGS84_ELLIPSOID;
  const R = 6_371;
  /** The point `km` from (lat, lng) along the bearing `az` on a sphere (degrees). */
  const along = (lat: number, lng: number, az: number, km: number) => {
    const p1 = lat * DEG;
    const d = km / R;
    const p2 = Math.asin(
      Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az),
    );
    const l2 =
      lng * DEG +
      Math.atan2(
        Math.sin(az) * Math.sin(d) * Math.cos(p1),
        Math.cos(d) - Math.sin(p1) * Math.sin(p2),
      );
    return { lat: p2 / DEG, lng: l2 / DEG };
  };
  const start = (lat: number, lng: number) =>
    cloudVolumeNoiseAnchor({
      latRad: lat * DEG,
      lonRad: lng * DEG,
      lonOffsetRad: 0,
    });

  it("returns to its start out 1,000-4,000 km in 20 km recentres and back in one hop", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 1_000, max: 4_000, noNaN: true }),
        (lat, lng, az, km) => {
          const a = start(lat, lng);
          let anchor = a;
          let at = { lat, lng };
          const hops = Math.ceil(km / 20);
          for (let i = 1; i <= hops; i++) {
            const to = along(lat, lng, az, (km * i) / hops);
            anchor = cloudVolumeAnchorRecentre(ellipsoid, anchor, at, to);
            at = to;
          }
          const back = cloudVolumeAnchorRecentre(ellipsoid, anchor, at, {
            lat,
            lng,
          });
          // Measured 2026-10-09 (60 paths each): 1.7 m at 500 km out, 13 m at
          // 1,000, 109 m at 2,000, 376 m at 3,000, 908 m at 4,000 (the chord's
          // hop: 0.51 / 4.1 / 33 / 110 / 258 km). What is left grows as the
          // distance cubed: the hops were laid on the sphere's great circle
          // in geodetic coordinates, which is not quite the ellipsoid's
          // geodesic. The bound: 20 m x (distance / 1,000 km)^3.
          expect(
            Math.hypot(
              back.originKm[0] - a.originKm[0],
              back.originKm[1] - a.originKm[1],
            ),
          ).toBeLessThan(0.02 * (km / 1000) ** 3);
          expect(Math.abs(back.rotationRad - a.rotationRad)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("returns exactly when it retraces the same long path", () => {
    const lat = 46.95;
    const lng = 7.45;
    const a = start(lat, lng);
    let anchor = a;
    const path = [{ lat, lng }];
    for (let i = 1; i <= 150; i++) path.push(along(lat, lng, 1.1, 20 * i));
    for (let i = 1; i < path.length; i++) {
      anchor = cloudVolumeAnchorRecentre(
        ellipsoid,
        anchor,
        path[i - 1]!,
        path[i]!,
      );
    }
    for (let i = path.length - 1; i > 0; i--) {
      anchor = cloudVolumeAnchorRecentre(
        ellipsoid,
        anchor,
        path[i]!,
        path[i - 1]!,
      );
    }
    expect(
      Math.hypot(
        anchor.originKm[0] - a.originKm[0],
        anchor.originKm[1] - a.originKm[1],
      ),
    ).toBeLessThan(1e-6);
    expect(Math.abs(anchor.rotationRad - a.rotationRad)).toBeLessThan(1e-12);
  });

  it("does not turn or move for a hop to the same place", () => {
    const a = { originKm: [12.5, -3] as const, rotationRad: 0.7 };
    const p = { lat: 10, lng: 20 };
    expect(cloudVolumeAnchorRecentre(ellipsoid, a, p, p)).toEqual(a);
  });
});
