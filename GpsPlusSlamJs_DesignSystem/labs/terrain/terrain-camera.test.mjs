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
  createSettleTracker,
  dragTurnDeg,
  flyInPose,
  flyInPoseAtAltitude,
  orbitPosition,
  poseFromPosition,
  poseHashValues,
  poseSettled,
  settleFrameBound,
} from "./terrain-camera.js";

const DEG = Math.PI / 180;

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

// Why these matter: the drag smoke used to bound the damping's settle in
// wall-clock seconds, but OrbitControls damps per UPDATE, so the wait is a
// number of frames and its time is that number times a frame's cost. When
// the lab's frames grew about fourfold the 120 s wait failed on the slower
// CI runner while nothing about the damping had changed (findings
// 2026-10-03-2254 #3). The smoke now asserts frames against this bound, so
// the bound itself must be right: these pin its arithmetic, and
// terrain-camera-damping.test.mjs checks it against three's real controls.
describe("settleFrameBound", () => {
  const at60 = { tiltDeg: 60 };

  it("is the first comparison's frame for no turn at all", () => {
    assert.equal(
      settleFrameBound({ ...at60, headingTurnDeg: 0, tiltTurnDeg: 0 }),
      2,
    );
  });

  // 27° of heading at 5 % an update: the step f * 0.95^(i-1) * 27° first
  // falls below 0.005° after i - 1 > ln(0.05 * 27 / 0.005) / -ln(0.95) =
  // 109.1 updates, so at frame 111.
  it("follows the geometric decay of the step on the heading", () => {
    assert.equal(
      settleFrameBound({ ...at60, headingTurnDeg: 27, tiltTurnDeg: 0 }),
      111,
    );
  });

  it("is direction-agnostic", () => {
    assert.equal(
      settleFrameBound({ ...at60, headingTurnDeg: -27, tiltTurnDeg: 0 }),
      111,
    );
  });

  // The tilt's own threshold is the altitude share where that is stricter,
  // read at the steepest end of the drag's path. A drag DOWN 5° (a positive
  // turn) runs 60° -> 55°: 1e-4 / tan(60°) rad is 0.00331°. A drag up runs
  // 60° -> 65°: 1e-4 / tan(65°) rad is 0.00267°. Both below the 0.005° angle.
  it("reads the tilt against the altitude share at the path's steepest end", () => {
    const expectedAt = (steepDeg) => {
      const threshold = 1e-4 / Math.tan(steepDeg * DEG) / DEG;
      return Math.floor(Math.log((0.05 * 5) / threshold) / -Math.log(0.95)) + 2;
    };
    const down = settleFrameBound({
      ...at60,
      headingTurnDeg: 0,
      tiltTurnDeg: 5,
    });
    const up = settleFrameBound({
      ...at60,
      headingTurnDeg: 0,
      tiltTurnDeg: -5,
    });
    assert.equal(down, expectedAt(60));
    assert.equal(up, expectedAt(65));
    assert.ok(up > down, `${up} vs ${down}`);
    assert.ok(
      down > settleFrameBound({ ...at60, headingTurnDeg: 5, tiltTurnDeg: 0 }),
      "the stricter tilt threshold takes more frames than the same heading",
    );
  });

  it("caps the steepest tilt at the controls' limit", () => {
    assert.equal(
      settleFrameBound({ tiltDeg: 85, headingTurnDeg: 0, tiltTurnDeg: -30 }),
      settleFrameBound({ tiltDeg: 89, headingTurnDeg: 0, tiltTurnDeg: -30 }),
    );
  });

  it("is the slower of the two axes", () => {
    const heading = settleFrameBound({
      ...at60,
      headingTurnDeg: 27,
      tiltTurnDeg: 0,
    });
    const tilt = settleFrameBound({
      ...at60,
      headingTurnDeg: 0,
      tiltTurnDeg: 5,
    });
    assert.equal(
      settleFrameBound({ ...at60, headingTurnDeg: 27, tiltTurnDeg: 5 }),
      Math.max(heading, tilt),
    );
  });

  // The sweep (owner rule 2026-09-13): the bound's direction must hold over
  // the inputs' plausible ranges, not at one value. It grows with the turn
  // at every damping. It grows as the damping slows only while f X / T > e
  // (N is about ln(f X / T) / f, whose slope in f is (1 - ln(f X / T)) / f²):
  // a slower damping's first step on a tiny turn is already below SETTLE.
  // So the damping half of the sweep starts at 5°, where even f = 0.01
  // gives f X / T = 10.
  it("grows with the turn, and as the damping slows, over a sweep", () => {
    const turns = [0.1, 1, 5, 27, 90, 180];
    const dampings = [0.2, 0.1, 0.05, 0.02, 0.01];
    for (const tiltDeg of [20, 60, 85]) {
      for (const sign of [1, -1]) {
        for (const dampingFactor of dampings) {
          let previous = 0;
          for (const t of turns) {
            const n = settleFrameBound({
              tiltDeg,
              headingTurnDeg: sign * t,
              tiltTurnDeg: (sign * t) / 5,
              dampingFactor,
            });
            assert.ok(n >= previous, `turn ${sign * t} at f ${dampingFactor}`);
            previous = n;
          }
        }
      }
      for (const t of turns.filter((x) => x >= 5)) {
        let previous = 0;
        for (const dampingFactor of dampings) {
          const n = settleFrameBound({
            tiltDeg,
            headingTurnDeg: t,
            tiltTurnDeg: 0,
            dampingFactor,
          });
          assert.ok(n > previous, `f ${dampingFactor} at turn ${t}`);
          previous = n;
        }
      }
    }
  });

  // A 2.5x slower damping (0.05 -> 0.02) takes about 2.1x the frames, not
  // 2.5x: N is about ln(f X / T) / f, and the log shrinks with f
  // (2.5 x ln(108) / ln(270) = 2.09). Either way far above the smoke's
  // bound, which is what its frame assertion is there to notice.
  it("takes about 2.1x the frames at a 0.02 damping", () => {
    const base = settleFrameBound({
      ...at60,
      headingTurnDeg: 27,
      tiltTurnDeg: 5,
    });
    const slow = settleFrameBound({
      ...at60,
      headingTurnDeg: 27,
      tiltTurnDeg: 5,
      dampingFactor: 0.02,
    });
    assert.equal(base, 111);
    assert.equal(slow, 233);
  });

  for (const [what, input] of [
    ["a damping of 0", { dampingFactor: 0 }],
    ["a damping of 1", { dampingFactor: 1 }],
    ["a NaN turn", { headingTurnDeg: Number.NaN }],
    ["an infinite turn", { tiltTurnDeg: Infinity }],
    ["a tilt beyond 90°", { tiltDeg: 91 }],
  ]) {
    it(`refuses ${what}`, () => {
      assert.throws(
        () =>
          settleFrameBound({
            tiltDeg: 60,
            headingTurnDeg: 1,
            tiltTurnDeg: 1,
            ...input,
          }),
        RangeError,
      );
    });
  }
});

describe("dragTurnDeg", () => {
  // three's rotate handler: 2 pi per canvas HEIGHT, on both axes.
  it("turns 360° per canvas height on both axes", () => {
    assert.deepEqual(dragTurnDeg(60, 12, 800), {
      headingTurnDeg: 27,
      tiltTurnDeg: 5.4,
    });
  });

  it("refuses a canvas without height", () => {
    assert.throws(() => dragTurnDeg(60, 12, 0), RangeError);
  });
});

// Why this matters: the tracker IS the lab's settle logic (the page only
// feeds it a pose per frame), so its frame count is what the smoke asserts.
describe("createSettleTracker", () => {
  const still = { altitudeM: 170_000, tiltDeg: 60, headingDeg: 340 };
  const turned = (deg) => ({ ...still, headingDeg: 340 + deg });

  it("counts nothing before a gesture ends", () => {
    const t = createSettleTracker();
    assert.equal(t.frame(still), false);
    assert.equal(t.frame(still), false);
    assert.equal(t.active, false);
    assert.equal(t.frames, 0);
  });

  it("settles on the second frame at the earliest", () => {
    const t = createSettleTracker();
    t.end();
    assert.equal(t.active, true);
    assert.equal(
      t.frame(still),
      false,
      "the first frame has nothing to compare",
    );
    assert.equal(t.frame(still), true);
    assert.equal(t.frames, 2);
    assert.equal(t.active, false);
    assert.equal(t.frame(still), false, "and only once");
    assert.equal(t.frames, 2);
  });

  it("counts every frame from the release to the first quiet one", () => {
    const t = createSettleTracker();
    t.end();
    const headings = [0, 1, 1.5, 1.6, 1.603];
    const settledAt = headings.findIndex((h) => t.frame(turned(h)));
    assert.equal(settledAt, 4);
    assert.equal(t.frames, 5);
  });

  it("drops a pending settle when a new gesture starts, and recounts", () => {
    const t = createSettleTracker();
    t.end();
    t.frame(turned(0));
    t.frame(turned(1));
    t.start();
    assert.equal(t.frame(turned(1)), false);
    assert.equal(t.active, false);
    t.end();
    assert.equal(t.frames, 0);
    t.frame(turned(1));
    assert.equal(t.frame(turned(1)), true);
    assert.equal(t.frames, 2);
  });
});
