/**
 * Why this test matters: the owner asked to land about 150 m above the
 * GROUND, not above sea level (round-4 plan 2026-10-11-0122 DEC-R4-1). The
 * flight treated its target as a point on the ellipsoid, so with the
 * ground at g a landing "g + 150 above the ellipsoid" looked at sea level
 * under the ground: at beta 30 over Lucerne's 435 m the view met the
 * ground about 750 m short, and above about 840 m of ground the target
 * left the frame (the cold review, §6 item 2). The target is now lifted to
 * its ground (radius rs + g): the look-back, the law's landing and the
 * log-altitude law measure the 150 m from there. Swept over the ground
 * (0, 435, 1,000, 2,000 m) and the entry angle (20, 30, 45), the owner's
 * rule: a verdict from one value is provisional.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { surfaceRadiusAlong } from "./globe-dive.js";
import { flightAt, flightCamera, liftedEllipsoid } from "./flight-path.js";
import { flightCameraAt } from "./flight-replan.js";
import {
  meteorLinkStart,
  pinFix,
  pinFrame,
  pinGround,
  pressPin,
  type PinFlight,
} from "./pin-flight.js";

const KM = 1_000;
const DEG = Math.PI / 180;
const LUCERNE = { lat: 47.0502, lng: 8.3093 };
const TARGET = orbitPose(WGS84_ELLIPSOID, LUCERNE);
const LANDING_M = 150;
const GROUNDS = [0, 435, 1_000, 2_000];
const BETAS = [20, 30, 45];
const DT = 1000 / 60;

const forward = (q: THREE.Quaternion) =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(q);

/** The target's point at its ground, ECEF. */
const groundPoint = (groundM: number) =>
  TARGET.direction
    .clone()
    .normalize()
    .multiplyScalar(
      surfaceRadiusAlong(WGS84_ELLIPSOID, TARGET.direction) + groundM,
    );

/** How far (m) a ray from `origin` along `direction` passes from `point`. */
function missM(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  point: THREE.Vector3,
): number {
  const to = point.clone().sub(origin);
  return to.clone().cross(direction.clone().normalize()).length();
}

/** A meteor link to Lucerne from 30 degrees south, 65,000 km up. */
function link(beta: number, groundM: number): PinFlight {
  const from = orbitPose(WGS84_ELLIPSOID, {
    lat: LUCERNE.lat - 30,
    lng: LUCERNE.lng,
  }).direction;
  const start = meteorLinkStart(
    WGS84_ELLIPSOID,
    TARGET,
    from,
    65_000 * KM,
    LANDING_M,
    beta,
    groundM,
  );
  return pressPin(WGS84_ELLIPSOID, 0, start, {
    target: TARGET,
    landingM: LANDING_M,
    groundM,
    progress: 1,
    meteorDeg: beta,
  });
}

describe("liftedEllipsoid", () => {
  it("puts the surface along the direction exactly the ground higher, and keeps the shape", () => {
    for (const g of GROUNDS) {
      const lifted = liftedEllipsoid(WGS84_ELLIPSOID, TARGET.direction, g);
      expect(
        surfaceRadiusAlong(lifted, TARGET.direction) -
          surfaceRadiusAlong(WGS84_ELLIPSOID, TARGET.direction),
      ).toBeCloseTo(g, 6);
      // 260 m away (the landing's look-back) the lift is still the ground
      // within a millimetre: the uniform scale's error is g x 2e-8 per m.
      const near = TARGET.direction
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), 260 / 6.37e6);
      expect(
        Math.abs(
          surfaceRadiusAlong(lifted, near) -
            surfaceRadiusAlong(WGS84_ELLIPSOID, near) -
            g,
        ),
      ).toBeLessThan(1e-3);
    }
    expect(liftedEllipsoid(WGS84_ELLIPSOID, TARGET.direction, 0)).toBe(
      WGS84_ELLIPSOID,
    );
    expect(() =>
      liftedEllipsoid(WGS84_ELLIPSOID, TARGET.direction, Number.NaN),
    ).toThrow(RangeError);
    expect(() =>
      liftedEllipsoid(WGS84_ELLIPSOID, TARGET.direction, -1),
    ).toThrow(RangeError);
  });
});

describe("a link lands 150 m above its ground (DEC-R4-1)", () => {
  for (const g of GROUNDS) {
    for (const beta of BETAS) {
      it(`ground ${g} m, beta ${beta}: lands at g + 150 within a metre, looking at the target`, () => {
        const pin = link(beta, g);
        const path = pin.flight?.path;
        expect(path).toBeDefined();
        if (!path) return;
        expect(path.groundM).toBe(g);
        const end = flightCamera(path, path.durationMs);
        // 150 m over the target's ground, as the flight measures it (the
        // camera's distance from the centre over the target's ground
        // radius)...
        expect(
          Math.abs(end.position.length() - groundPoint(g).length() - LANDING_M),
        ).toBeLessThan(0.01);
        // ...and over the ellipsoid under the camera within a metre and a
        // half: the camera stands 150 / tan(beta) back (412 m at 20), where
        // WGS84 lies up to 1.4 m off the target's radius at 47 N on a
        // north-south course (measured: 1.39 m at 20, under 1 m from 30).
        const height = WGS84_ELLIPSOID.getPositionElevation(end.position);
        console.log(
          `ground ${g} m, beta ${beta}: over the ellipsoid under the camera ${(height - g).toFixed(2)} m, the end view misses the target by ${missM(end.position, forward(end.quaternion), groundPoint(g)).toFixed(3)} m`,
        );
        expect(Math.abs(height - (g + LANDING_M))).toBeLessThan(
          beta >= 30 ? 1 : 1.5,
        );
        // The view's ray meets the target at its ground (the review's
        // failure: 750 m short at 435 m and beta 30).
        expect(
          missM(end.position, forward(end.quaternion), groundPoint(g)),
        ).toBeLessThan(1);
        // And it looks at the asked angle there.
        expect(path.endPitchDeg).toBeCloseTo(beta, 6);
        // Over the last 10 km of the descent the view's ray stays on the
        // target within 1 % of the camera's height above it (the line is
        // straight; it lands exactly).
        for (let t = 0; t <= path.durationMs; t += path.durationMs / 400) {
          const f = flightAt(path, t);
          if (f.altitudeM > 10 * KM) continue;
          const cam = flightCamera(path, t);
          const miss = missM(
            cam.position,
            forward(cam.quaternion),
            groundPoint(g),
          );
          expect(miss).toBeLessThan(0.01 * f.altitudeM + 1);
        }
      });
    }
  }

  // WHY: the F1b continuity, extended over the ground: along the meteor
  // line the view's direction in space does not turn (one straight line
  // looked along), whatever the ground's height.
  for (const g of GROUNDS) {
    for (const beta of BETAS) {
      it(`ground ${g} m, beta ${beta}: keeps its view's direction along the line`, () => {
        const pin = link(beta, g);
        const path = pin.flight?.path;
        expect(path?.meteorDeg).toBeCloseTo(beta, 3);
        if (!path) return;
        const first = forward(flightCamera(path, 0).quaternion);
        let worst = 0;
        for (let i = 0; i <= 400; i++) {
          const cam = flightCamera(path, (path.durationMs * i) / 400);
          worst = Math.max(worst, forward(cam.quaternion).angleTo(first));
        }
        expect(worst / DEG).toBeLessThan(0.1);
      });
    }
  }

  // WHY: before the lift the same link aimed at sea level: the positive
  // control that the tests above can see the failure the review measured.
  it("aimed under the ground without the lift (the positive control)", () => {
    const start = meteorLinkStart(
      WGS84_ELLIPSOID,
      TARGET,
      orbitPose(WGS84_ELLIPSOID, { lat: LUCERNE.lat - 30, lng: LUCERNE.lng })
        .direction,
      65_000 * KM,
      435 + LANDING_M,
      30,
    );
    const pin = pressPin(WGS84_ELLIPSOID, 0, start, {
      target: TARGET,
      landingM: 435 + LANDING_M,
      progress: 1,
      meteorDeg: 30,
    });
    const path = pin.flight?.path;
    if (!path) throw new Error("no path");
    const end = flightCamera(path, path.durationMs);
    expect(
      missM(end.position, forward(end.quaternion), groundPoint(435)),
    ).toBeGreaterThan(300);
  });
});

describe("a press over its own place lands 150 m above the ground at the asked angle", () => {
  for (const g of GROUNDS) {
    it(`ground ${g} m`, () => {
      const pose = orbitPose(WGS84_ELLIPSOID, LUCERNE);
      const over = WGS84_ELLIPSOID.getCartographicToPosition(
        LUCERNE.lat * DEG,
        LUCERNE.lng * DEG,
        2_000 * KM,
        new THREE.Vector3(),
      );
      let pin = pressPin(
        WGS84_ELLIPSOID,
        0,
        { pose, distanceM: over.length() },
        { target: null, landingM: LANDING_M, progress: 1, meteorDeg: 30 },
      );
      pin = pinFix(pin, 2_000, TARGET);
      pin = pinGround(pin, 2_000, g);
      const path = pin.flight?.path;
      if (!path) throw new Error("no path");
      expect(path.endPitchDeg).toBeCloseTo(30, 6);
      const end = flightCameraAt(
        pin.flight as NonNullable<PinFlight["flight"]>,
        Number.POSITIVE_INFINITY,
      );
      const height = WGS84_ELLIPSOID.getPositionElevation(end.position);
      expect(Math.abs(height - (g + LANDING_M))).toBeLessThan(1);
      expect(
        missM(end.position, forward(end.quaternion), groundPoint(g)),
      ).toBeLessThan(1);
    });
  }
});

type Shot = { position: THREE.Vector3; quaternion: THREE.Quaternion };

/**
 * The cameras of a link flown at 60 Hz with the ground first `fromM`,
 * revised to `toM` once the camera is below `atM`, and the frame of the
 * revision.
 */
function flyRevised(
  beta: number,
  fromM: number,
  toM: number,
  atM: number,
): { shots: Shot[]; revisedAt: number } {
  let pin = link(beta, fromM);
  const shots: Shot[] = [];
  let revisedAt = -1;
  for (let t = DT; shots.length < 60 * 600 && pin.phase !== "landed"; t += DT) {
    const last = shots.at(-1);
    const below =
      last !== undefined &&
      WGS84_ELLIPSOID.getPositionElevation(last.position) < atM;
    if (revisedAt < 0 && below) {
      pin = pinGround(pin, t, toM);
      revisedAt = shots.length;
    }
    const out = pinFrame(pin, t);
    pin = out.pin;
    if (!out.camera) break;
    shots.push(out.camera);
  }
  return { shots, revisedAt };
}

/**
 * The largest turn of the view between two frames (degrees), the largest
 * ratio of a frame's step to the one before it over the 30 frames after
 * the revision, and the end (its height and its view's miss of the target
 * at `toM`).
 */
function revised(
  beta: number,
  fromM: number,
  toM: number,
  atM: number,
): {
  turnDeg: number;
  totalDeg: number;
  stepRatio: number;
  endHeightM: number;
  missM: number;
} {
  const { shots, revisedAt } = flyRevised(beta, fromM, toM, atM);
  // The whole turn the revision causes: the meteor's view is constant, so
  // the largest angle from the view just before it.
  const before = shots[revisedAt - 1];
  let totalDeg = 0;
  for (let i = revisedAt; before && i < shots.length; i++) {
    const b = shots[i] as Shot;
    totalDeg = Math.max(
      totalDeg,
      forward(b.quaternion).angleTo(forward(before.quaternion)) / DEG,
    );
  }
  let turnDeg = 0;
  let stepRatio = 0;
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1] as Shot;
    const b = shots[i] as Shot;
    turnDeg = Math.max(
      turnDeg,
      forward(b.quaternion).angleTo(forward(a.quaternion)) / DEG,
    );
    const before =
      i >= 2 ? a.position.distanceTo((shots[i - 2] as Shot).position) : 0;
    const near = revisedAt >= 0 && i >= revisedAt && i - revisedAt < 30;
    if (near && before > 1e-6) {
      stepRatio = Math.max(
        stepRatio,
        b.position.distanceTo(a.position) / before,
      );
    }
  }
  const last = shots.at(-1);
  if (!last) throw new Error("no camera");
  return {
    turnDeg,
    totalDeg,
    stepRatio,
    endHeightM: WGS84_ELLIPSOID.getPositionElevation(last.position),
    missM: missM(last.position, forward(last.quaternion), groundPoint(toM)),
  };
}

// WHY (the cold review, §6 item 3): a late raise turns the view; the ground
// is read early so a revision is rare, and when the relief's own height
// differs by more than the margin it goes through the replan path, never a
// jump. Raise and lower (by 435, 165, 30 and 35 m), at four altitudes, two
// entry angles: the view turns by less than half a degree between two
// 60 Hz frames, the camera's step never jumps (at most 1.5 x the frame
// before), and it lands at the revised ground + 150, looking at the
// target. The whole turn is measured too: a raise turns nothing, a
// lowering turns the view about 30-50 x (drop / height) degrees.
describe("a revised ground replans, raise or lower, without a jump", () => {
  for (const beta of [30, 45]) {
    for (const [fromM, toM] of [
      [0, 435],
      [600, 435],
      [465, 435],
      [400, 435],
    ] as const) {
      for (const atKm of [20_000, 20, 5, 2]) {
        it(`beta ${beta}, ${fromM} to ${toM} m below ${atKm} km`, () => {
          const r = revised(beta, fromM, toM, atKm * KM);
          console.log(
            `revised ground beta ${beta}, ${fromM} to ${toM} m below ${atKm} km: view turn at most ${r.turnDeg.toFixed(3)} deg a frame and ${r.totalDeg.toFixed(2)} deg in all, step ratio at most ${r.stepRatio.toFixed(3)}, end ${(r.endHeightM - toM).toFixed(2)} m above the ground, miss ${r.missM.toFixed(2)} m`,
          );
          expect(Math.abs(r.endHeightM - (toM + LANDING_M))).toBeLessThan(1);
          expect(r.missM).toBeLessThan(1);
          expect(r.turnDeg).toBeLessThan(0.5);
          expect(r.stepRatio).toBeLessThan(1.5);
          // The whole turn: none for a raise; for a lowering about 30-50 x
          // (drop / height) degrees, the law LANDING_GROUND.lowerPerHeight
          // rests on (1.0 for 165 m at 5 km, 3.5 at 2 km: past the brief's
          // one-degree wall, which is why the lab lowers only early).
          const drop = fromM - toM;
          expect(r.totalDeg).toBeLessThan(
            drop > 0 ? (50 * drop) / (atKm * KM) + 0.01 : 0.05,
          );
        });
      }
    }
  }
});
