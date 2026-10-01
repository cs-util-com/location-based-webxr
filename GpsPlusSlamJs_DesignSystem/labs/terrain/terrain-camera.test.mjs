/**
 * Tests for the terrain lab's camera poses, presets and fly-in (terrain plan
 * 2026-09-27-0605 §4 "Camera presets", §9 finding 10).
 *
 * Why this file matters: the auto exaggeration reads the camera's ALTITUDE
 * (W = 0.43 x altitude), and the hash stores the pose as altitude, tilt and
 * heading. If the pose and its inverse disagree, a pasted link opens a
 * different view with a different exaggeration than the one it was copied
 * from. The fly-in must also really run from 600 km to 20 km, monotonically,
 * or the "flying through a 3D scene" the owner asked for jumps.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  CAMERA_PRESETS,
  FLY_IN,
  flyInPose,
  flyInPoseAtAltitude,
  orbitPosition,
  poseFromPosition,
  poseHashValues,
  poseSettled,
} from "./terrain-camera.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

describe("orbitPosition", () => {
  it("puts a top-down camera straight above the target at its altitude", () => {
    const [x, y, z] = orbitPosition({
      altitudeM: 580_000,
      tiltDeg: 0,
      headingDeg: 0,
    });
    close(x, 0, 1e-6, "x");
    close(y, 580_000, 1e-6, "y");
    close(z, 0, 1e-6, "z");
  });

  // Three's frame: x east, y up, z SOUTH (north is -z). A camera heading
  // north stands south of its target.
  it("stands south of the target when heading north", () => {
    const [x, y, z] = orbitPosition({
      altitudeM: 10_000,
      tiltDeg: 45,
      headingDeg: 0,
    });
    close(x, 0, 1e-6, "x");
    close(y, 10_000, 1e-6, "altitude kept at any tilt");
    close(z, 10_000, 1e-6, "south by altitude x tan(45°)");
  });

  it("stands east of the target when heading west", () => {
    const [x, , z] = orbitPosition({
      altitudeM: 10_000,
      tiltDeg: 60,
      headingDeg: 270,
    });
    assert.ok(x > 0, `x ${x}`);
    close(z, 0, 1e-6, "z");
  });
});

describe("poseFromPosition", () => {
  // The hash round trip: every preset, and an arbitrary pose.
  for (const [name, pose] of [
    ...Object.entries(CAMERA_PRESETS),
    ["arbitrary", { altitudeM: 42_000, tiltDeg: 33, headingDeg: 123 }],
  ]) {
    it(`inverts orbitPosition for ${name}`, () => {
      const back = poseFromPosition(orbitPosition(pose));
      close(back.altitudeM, pose.altitudeM, 1e-6, "altitude");
      close(back.tiltDeg, pose.tiltDeg, 1e-9, "tilt");
      if (pose.tiltDeg > 0)
        close(back.headingDeg, pose.headingDeg, 1e-9, "heading");
    });
  }
});

describe("CAMERA_PRESETS", () => {
  // Plan §4: top-down at the screenshots' width (about 250 km), the diorama
  // oblique at 55-65°, and a low oblique at 20 km.
  it("frames 250 km top-down, a 55-65° oblique and a low 20 km oblique", () => {
    close(0.43 * CAMERA_PRESETS.top.altitudeM, 250_000, 2_000, "top W");
    assert.equal(CAMERA_PRESETS.top.tiltDeg, 0);
    assert.ok(
      CAMERA_PRESETS.oblique.tiltDeg >= 55 &&
        CAMERA_PRESETS.oblique.tiltDeg <= 65,
    );
    assert.equal(CAMERA_PRESETS.low.altitudeM, 20_000);
  });
});

describe("flyInPose", () => {
  // Plan §9 finding 10: a scripted fly-in, 600 km oblique down to 20 km.
  it("starts at 600 km and ends at 20 km", () => {
    close(flyInPose(0).altitudeM, 600_000, 1e-6, "start");
    close(flyInPose(1).altitudeM, 20_000, 1e-6, "end");
    assert.ok(flyInPose(0).tiltDeg > 0, "oblique from the start");
    assert.deepEqual(flyInPose(1), FLY_IN.to);
  });

  it("descends monotonically and holds its ends outside 0-1", () => {
    let previous = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const alt = flyInPose(t).altitudeM;
      assert.ok(alt <= previous, `t ${t}`);
      previous = alt;
    }
    assert.deepEqual(flyInPose(-1), flyInPose(0));
    assert.deepEqual(flyInPose(2), flyInPose(1));
  });

  // Geometric in altitude: halfway in time is the geometric mean (after the
  // ease), so the view does not spend the whole flight near the ground.
  it("interpolates the altitude geometrically", () => {
    close(flyInPose(0.5).altitudeM, Math.sqrt(600_000 * 20_000), 1, "midpoint");
  });
});

// Globe round-5 §3.3: the comparison captures the fly-in at fixed
// altitudes (300, 100, 30, 10 km), so it needs the fly-in's pose AT an
// altitude, on the same path, and the path continued below its 20 km end.
describe("flyInPoseAtAltitude", () => {
  it("is the fly-in's own pose wherever the fly-in passes that altitude", () => {
    for (const t of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
      const pose = flyInPose(t);
      const at = flyInPoseAtAltitude(pose.altitudeM);
      close(at.altitudeM, pose.altitudeM, 1e-6, `alt ${t}`);
      close(at.tiltDeg, pose.tiltDeg, 1e-6, `tilt ${t}`);
      close(at.headingDeg, pose.headingDeg, 1e-6, `heading ${t}`);
    }
  });
  it("holds the end's tilt and heading below the end, and the start's above", () => {
    const low = flyInPoseAtAltitude(10_000);
    assert.equal(low.altitudeM, 10_000);
    assert.equal(low.tiltDeg, FLY_IN.to.tiltDeg);
    assert.equal(low.headingDeg, FLY_IN.to.headingDeg);
    const high = flyInPoseAtAltitude(900_000);
    assert.equal(high.tiltDeg, FLY_IN.from.tiltDeg);
  });
  it("refuses a non-positive altitude", () => {
    assert.throws(() => flyInPoseAtAltitude(0), RangeError);
    assert.throws(() => flyInPoseAtAltitude(Number.NaN), RangeError);
  });
});

// T0/T1 review finding 12: with damping on, a drag's `end` comes while the
// camera still turns, so a pose written then is not where the view stops.
// The page waits until one frame moves the camera by less than a
// perceptible step (0.005° of angle, a 1e-4 share of the altitude, which is
// what that angle moves the altitude by in an oblique view), then finishes
// the damping at once and writes the pose it lands on.
describe("poseHashValues", () => {
  it("rounds to the hash's resolution: 1 m, 0.01°", () => {
    assert.deepEqual(
      poseHashValues({
        altitudeM: 12_345.6,
        tiltDeg: 33.3333,
        headingDeg: 359.996,
      }),
      { alt: 12_346, tilt: 33.33, head: 0 },
    );
  });
});

describe("poseSettled", () => {
  const a = { altitudeM: 170_000, tiltDeg: 60, headingDeg: 340 };
  it("is settled when every step is below its threshold", () => {
    assert.equal(
      poseSettled(a, {
        altitudeM: 170_010,
        tiltDeg: 60.004,
        headingDeg: 340.004,
      }),
      true,
    );
  });

  // Each axis alone, just above its threshold, is still moving (17 m is
  // 1e-4 of 170 km).
  for (const [what, b] of [
    ["altitude", { ...a, altitudeM: 170_020 }],
    ["tilt", { ...a, tiltDeg: 60.006 }],
    ["heading", { ...a, headingDeg: 340.006 }],
  ]) {
    it(`is still moving when the ${what} steps more`, () => {
      assert.equal(poseSettled(a, b), false);
    });
  }

  it("scales the altitude threshold with the altitude", () => {
    const low = { altitudeM: 2_000, tiltDeg: 60, headingDeg: 0 };
    assert.equal(poseSettled(low, { ...low, altitudeM: 2_000.1 }), true);
    assert.equal(poseSettled(low, { ...low, altitudeM: 2_000.3 }), false);
  });

  it("compares the heading across north", () => {
    assert.equal(
      poseSettled({ ...a, headingDeg: 359.998 }, { ...a, headingDeg: 0.001 }),
      true,
    );
  });
});
