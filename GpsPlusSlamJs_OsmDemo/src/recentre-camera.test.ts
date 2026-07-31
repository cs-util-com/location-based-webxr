/**
 * @vitest-environment jsdom
 *
 * Opts into jsdom for the same reason `header-collapse.test.ts` does: the thing
 * worth pinning is the interaction between the camera and the controls, and a
 * "pure vector maths" extraction would test the one part that cannot be wrong.
 * `MapControls` needs a DOM element but NOT a WebGL context, so the real
 * controller can be exercised here — unlike `BuildingView`, which cannot.
 *
 * WHY THESE TESTS MATTER (W11, R4-12). The demo re-origins the world at the
 * clicked position and never touches the camera, so the clicked point lands at
 * the scene origin. That is right on screen only while the camera is still
 * LOOKING at the origin — and `MapControls` pans by moving the camera and its
 * target together, so after any pan the origin, and with it everything the user
 * just clicked, is off to one side and possibly off screen entirely. The demo
 * then looks like it ignored the click.
 *
 * The requirement is stated in the notes and is unusually precise: only the
 * camera's TRANSLATION may change, so that it ends up looking at the clicked
 * point without rotating. The assertion that proves it is therefore not "the
 * view looks right" but "the quaternion is untouched, component for component".
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

import { recentreOnOrigin } from "./recentre-camera.js";

function scene(): {
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
} {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
  camera.position.set(140, 110, 140);
  const controls = new MapControls(camera, document.createElement("div"));
  controls.target.set(0, 0, 0);
  controls.update();
  return { camera, controls };
}

/** Moves camera and target together, exactly as a `MapControls` pan does. */
function pan(
  camera: THREE.PerspectiveCamera,
  controls: MapControls,
  dx: number,
  dz: number,
): void {
  camera.position.x += dx;
  camera.position.z += dz;
  controls.target.x += dx;
  controls.target.z += dz;
  controls.update();
}

describe("recentreOnOrigin", () => {
  it("brings the target back to the origin after a pan", () => {
    const { camera, controls } = scene();
    pan(camera, controls, 300, -220);
    expect(controls.target.x).toBeCloseTo(300);

    recentreOnOrigin(camera, controls);

    // The clicked point is built AT the origin, so the whole requirement is
    // that the camera ends up looking there.
    expect(controls.target.x).toBeCloseTo(0);
    expect(controls.target.y).toBeCloseTo(0);
    expect(controls.target.z).toBeCloseTo(0);
  });

  it("does NOT rotate the camera — the invariant the note asks for", () => {
    // THE ASSERTION THIS ITEM EXISTS FOR. Translating camera and target by the
    // same vector leaves the camera→target offset unchanged, so the orientation
    // is unchanged BY CONSTRUCTION rather than by care. Anything that recomputed
    // the camera position from a distance and an angle would satisfy the target
    // assertion above and fail this one.
    const { camera, controls } = scene();
    pan(camera, controls, 300, -220);
    const before = camera.quaternion.clone();

    recentreOnOrigin(camera, controls);

    expect(camera.quaternion.x).toBeCloseTo(before.x, 12);
    expect(camera.quaternion.y).toBeCloseTo(before.y, 12);
    expect(camera.quaternion.z).toBeCloseTo(before.z, 12);
    expect(camera.quaternion.w).toBeCloseTo(before.w, 12);
  });

  it("keeps the viewing distance, so the zoom level survives a click", () => {
    const { camera, controls } = scene();
    pan(camera, controls, 300, -220);
    const distance = camera.position.distanceTo(controls.target);

    recentreOnOrigin(camera, controls);

    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(
      distance,
      6,
    );
  });

  it("moves the camera by exactly the target's offset", () => {
    const { camera, controls } = scene();
    pan(camera, controls, 300, -220);
    const before = camera.position.clone();
    const offset = controls.target.clone();

    recentreOnOrigin(camera, controls);

    expect(camera.position.x).toBeCloseTo(before.x - offset.x);
    expect(camera.position.y).toBeCloseTo(before.y - offset.y);
    expect(camera.position.z).toBeCloseTo(before.z - offset.z);
  });

  it("is a no-op when the target is already at the origin", () => {
    // The common case — the demo starts here, and a click without a preceding
    // pan must not nudge the camera at all. A recentre that always moved
    // something would be visible as a jump on every single click.
    const { camera, controls } = scene();
    const before = camera.position.clone();

    recentreOnOrigin(camera, controls);

    expect(camera.position.x).toBeCloseTo(before.x, 12);
    expect(camera.position.y).toBeCloseTo(before.y, 12);
    expect(camera.position.z).toBeCloseTo(before.z, 12);
  });
});
