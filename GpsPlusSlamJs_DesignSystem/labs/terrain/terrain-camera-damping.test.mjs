/**
 * The settle bound (`settleFrameBound`) against three's REAL OrbitControls,
 * the lockfile-pinned copy the lab page is served (`/vendor/three/`).
 *
 * Why this file matters: the drag smoke asserts the frames from a drag's
 * release to its hash write against `settleFrameBound` (findings
 * 2026-10-03-2254 #3: the old wall-clock wait failed as the lab's frames
 * grew). A bound derived from a wrong model of the damping would make that
 * assertion either flaky (too tight) or blind (too loose), and the smoke
 * cannot tell which: it sees one drag on one machine. Here the same drag is
 * replayed through three's own pointer handler and update, with the lab's
 * own settle tracker counting, over a sweep of damping factors, drags,
 * tilts and canvas heights:
 *   - the bound is never exceeded;
 *   - with the whole turn left at the release it is tight (exact or one
 *     frame over), so it is not a bound that would pass anything;
 *   - the turn the camera ends on is the drag's whole turn, which the smoke
 *     checks to know the drag it bounded really happened.
 *
 * The controls' private handlers (`_handleMouseDownRotate`,
 * `_handleMouseMoveRotate`, `_rotateLeft`, `_rotateUp`) are what a pointer
 * drag runs; they are used here because the controls are built without a
 * DOM. A three upgrade that renames them fails this file loudly.
 */
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  CAMERA_PRESETS,
  MAX_TILT_DEG,
  ORBIT_DAMPING,
  createSettleTracker,
  dragTurnDeg,
  orbitPosition,
  poseFromPosition,
  settleFrameBound,
} from "./terrain-camera.js";

const THREE_ROOT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "GpsPlusSlamJs_AppFramework",
  "node_modules",
  "three",
);
const THREE = await import(
  pathToFileURL(join(THREE_ROOT, "build", "three.module.js")).href
);
const { OrbitControls } = await import(
  pathToFileURL(
    join(THREE_ROOT, "examples", "jsm", "controls", "OrbitControls.js"),
  ).href
);

const DEG = Math.PI / 180;

/** Controls set up as the lab sets them, at a pose, on a canvas `height` px tall. */
function labControls(pose, height, dampingFactor) {
  const camera = new THREE.PerspectiveCamera(50, 1, 10, 1e7);
  const controls = new OrbitControls(camera);
  controls.domElement = { clientHeight: height };
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = dampingFactor;
  controls.maxPolarAngle = MAX_TILT_DEG * DEG;
  controls.minDistance = 2_000;
  controls.maxDistance = 3_000_000;
  camera.position.fromArray(orbitPosition(pose));
  controls.target.set(0, 0, 0);
  camera.lookAt(controls.target);
  controls.update();
  const pose0 = () =>
    poseFromPosition(camera.position.clone().sub(controls.target).toArray());
  return { controls, pose: pose0 };
}

/**
 * A drag of (dx, dy) px in `steps` pointer moves, as Playwright's
 * `mouse.move(..., { steps })` sends it (each move runs one update), or with
 * `steps` 0 the whole turn queued with no update at all (the worst case:
 * the whole turn still to go at the release).
 */
function drag(controls, dx, dy, steps, height) {
  if (steps === 0) {
    controls._rotateLeft((2 * Math.PI * dx) / height);
    controls._rotateUp((2 * Math.PI * dy) / height);
    return;
  }
  const x0 = 400;
  const y0 = 300;
  controls._handleMouseDownRotate({ clientX: x0, clientY: y0 });
  for (let i = 1; i <= steps; i++) {
    controls._handleMouseMoveRotate({
      clientX: x0 + (dx * i) / steps,
      clientY: y0 + (dy * i) / steps,
    });
  }
}

/** Frames from the release to the settle, as the lab's tracker counts them. */
function framesToSettle(controls, pose) {
  const tracker = createSettleTracker();
  tracker.end();
  for (let i = 0; i < 100_000; i++) {
    controls.update();
    if (tracker.frame(pose())) return tracker.frames;
  }
  throw new Error("never settled");
}

/** The lab's `finishDamping`: one undamped update applies the rest. */
function finish(controls) {
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
}

const shortWay = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

const DAMPINGS = [0.02, ORBIT_DAMPING, 0.1, 0.2];
const DRAGS = [
  [1, 0],
  [5, 1],
  [60, 12],
  [60, -12],
  [300, 0],
  [0, 60],
  [-200, -40],
];
const TILTS = [20, 60, 80];
const HEIGHTS = [600, 720, 1080];

describe("settleFrameBound against three's OrbitControls", () => {
  // Upper bound only: a move's own update, and a clamp at 89°, leave less
  // to turn than the bound assumes, so a drag may settle well under it.
  it("is never exceeded by a Playwright-style drag, over the sweep", () => {
    let cases = 0;
    for (const f of DAMPINGS) {
      for (const [dx, dy] of DRAGS) {
        for (const tiltDeg of TILTS) {
          for (const height of HEIGHTS) {
            for (const steps of [1, 4, 12]) {
              const { controls, pose } = labControls(
                { ...CAMERA_PRESETS.oblique, tiltDeg },
                height,
                f,
              );
              drag(controls, dx, dy, steps, height);
              const frames = framesToSettle(controls, pose);
              const bound = settleFrameBound({
                tiltDeg,
                ...dragTurnDeg(dx, dy, height),
                dampingFactor: f,
              });
              const what = `f ${f}, drag ${dx},${dy} px in ${steps}, tilt ${tiltDeg}, ${height} px`;
              assert.ok(frames >= 2, `${what}: ${frames}`);
              assert.ok(frames <= bound, `${what}: ${frames} > ${bound}`);
              cases++;
            }
          }
        }
      }
    }
    assert.equal(cases, DAMPINGS.length * DRAGS.length * 3 * 3 * 3);
  });

  // Tight, so that the smoke's bound could not pass a damping that settles
  // much slower than this one: with the whole turn still to go and no
  // clamp, a heading-dominated settle is exact or one frame under. A
  // tilt-dominated one may come early by the derived slack of reading the
  // tilt threshold at the path's steepest end (the bound's comment).
  it("is tight when the whole turn is still to go at the release", () => {
    let exact = 0;
    for (const f of DAMPINGS) {
      for (const [dx, dy] of DRAGS) {
        for (const tiltDeg of TILTS) {
          for (const height of HEIGHTS) {
            const turn = dragTurnDeg(dx, dy, height);
            const tiltEnd = tiltDeg - turn.tiltTurnDeg;
            if (tiltEnd <= 0 || tiltEnd >= MAX_TILT_DEG) continue;
            const { controls, pose } = labControls(
              { ...CAMERA_PRESETS.oblique, tiltDeg },
              height,
              f,
            );
            drag(controls, dx, dy, 0, height);
            const frames = framesToSettle(controls, pose);
            const bound = settleFrameBound({
              tiltDeg,
              ...turn,
              dampingFactor: f,
            });
            const byAxis = (h, t) =>
              settleFrameBound({
                tiltDeg,
                headingTurnDeg: h,
                tiltTurnDeg: t,
                dampingFactor: f,
              });
            const headingLed =
              byAxis(turn.headingTurnDeg, 0) >= byAxis(0, turn.tiltTurnDeg);
            const steep = Math.max(tiltDeg, tiltEnd) * DEG;
            const shallow = Math.min(tiltDeg, tiltEnd) * DEG;
            const slack = headingLed
              ? 1
              : Math.ceil(
                  Math.log(Math.tan(steep) / Math.tan(shallow)) /
                    -Math.log(1 - f),
                ) + 1;
            const what = `f ${f}, drag ${dx},${dy} px, tilt ${tiltDeg}, ${height} px`;
            assert.ok(frames <= bound, `${what}: ${frames} > ${bound}`);
            assert.ok(
              bound - frames <= slack,
              `${what}: ${frames}, bound ${bound}, slack ${slack}`,
            );
            if (frames === bound) exact++;
          }
        }
      }
    }
    assert.ok(exact > 0, "the bound is reached, not only approached");
  });

  it("ends on the drag's whole turn once the damping is finished", () => {
    for (const f of DAMPINGS) {
      for (const [dx, dy] of DRAGS) {
        for (const tiltDeg of TILTS) {
          const height = 720;
          const turn = dragTurnDeg(dx, dy, height);
          // The tilt clamp (89°, and 0° up top) stops a turn early; the
          // smoke's drag stays clear of both.
          const tiltEnd = tiltDeg - turn.tiltTurnDeg;
          if (tiltEnd <= 0 || tiltEnd >= MAX_TILT_DEG) continue;
          const { controls, pose } = labControls(
            { ...CAMERA_PRESETS.oblique, tiltDeg },
            height,
            f,
          );
          const before = pose();
          drag(controls, dx, dy, 4, height);
          framesToSettle(controls, pose);
          finish(controls);
          const after = pose();
          const what = `f ${f}, drag ${dx},${dy} px, tilt ${tiltDeg}`;
          // rotateLeft turns the heading up, rotateUp the tilt down.
          const dHeading = shortWay(before.headingDeg, after.headingDeg);
          const expected = shortWay(0, turn.headingTurnDeg);
          assert.ok(Math.abs(dHeading - expected) < 1e-6, `${what}: heading`);
          assert.ok(
            Math.abs(before.tiltDeg - after.tiltDeg - turn.tiltTurnDeg) < 1e-6,
            `${what}: tilt`,
          );
        }
      }
    }
  });
});
