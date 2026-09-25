import { describe, expect, it } from "vitest";
import { Object3D, Vector3 } from "three";

import { computeBillboardYaw } from "./billboard-math.js";

/**
 * Why these tests matter: this is the whole correctness claim of a *cylindrical*
 * billboard — the textured plane's front (+Z) face must point at the camera in
 * the horizontal plane while pitch/roll stay exactly 0, no matter how high or
 * low the camera is. We don't assert on the raw yaw number (that would just
 * re-derive the formula); instead we apply `(0, yaw, 0)` to a real Object3D and
 * check the *transformed +Z normal* actually faces the camera horizontally and
 * has no vertical tilt. That pins the behaviour, not the implementation.
 */

/** Apply yaw to a fresh Object3D at `billboard` and return its world +Z axis. */
function frontFaceDirAfterYaw(
  billboard: { x: number; z: number },
  yaw: number,
): Vector3 {
  const obj = new Object3D();
  obj.position.set(billboard.x, 0, billboard.z);
  obj.rotation.set(0, yaw, 0);
  obj.updateMatrixWorld(true);
  // Local +Z is the plane's front (image) face; transform it to world space.
  return new Vector3(0, 0, 1).applyQuaternion(obj.quaternion).normalize();
}

function horizontalDirTo(
  from: { x: number; z: number },
  to: { x: number; z: number },
): Vector3 {
  return new Vector3(to.x - from.x, 0, to.z - from.z).normalize();
}

describe("computeBillboardYaw", () => {
  it("turns the +Z face to point at the camera in the XZ plane", () => {
    const billboard = { x: 0, z: 0 };
    const camera = { x: 10, z: 10 };

    const yaw = computeBillboardYaw(billboard, camera);
    const front = frontFaceDirAfterYaw(billboard, yaw);

    expect(front.dot(horizontalDirTo(billboard, camera))).toBeCloseTo(1, 6);
  });

  it("leaves pitch/roll at zero regardless of camera elevation (stays upright)", () => {
    const billboard = { x: 0, z: 0 };
    // Camera high above with a horizontal offset: height must not tilt the face.
    const camera = { x: 3, z: 4 };

    const yaw = computeBillboardYaw(billboard, camera);
    const front = frontFaceDirAfterYaw(billboard, yaw);

    // No vertical component — the face never pitches toward an elevated camera.
    expect(front.y).toBeCloseTo(0, 12);
    expect(front.dot(horizontalDirTo(billboard, camera))).toBeCloseTo(1, 6);
  });

  it.each([
    { name: "+Z (north)", camera: { x: 0, z: 5 }, expected: { x: 0, z: 1 } },
    { name: "+X (east)", camera: { x: 5, z: 0 }, expected: { x: 1, z: 0 } },
    { name: "-Z (south)", camera: { x: 0, z: -5 }, expected: { x: 0, z: -1 } },
    { name: "-X (west)", camera: { x: -5, z: 0 }, expected: { x: -1, z: 0 } },
  ])("faces the cardinal direction $name", ({ camera, expected }) => {
    const yaw = computeBillboardYaw({ x: 0, z: 0 }, camera);
    const front = frontFaceDirAfterYaw({ x: 0, z: 0 }, yaw);

    expect(front.x).toBeCloseTo(expected.x, 6);
    expect(front.z).toBeCloseTo(expected.z, 6);
  });

  it("returns the fallback when the camera is directly overhead (degenerate)", () => {
    // Same x/z as the billboard: there is no horizontal direction to face.
    expect(computeBillboardYaw({ x: 2, z: -3 }, { x: 2, z: -3 })).toBe(0);
    expect(computeBillboardYaw({ x: 2, z: -3 }, { x: 2, z: -3 }, 1.23)).toBe(
      1.23,
    );
  });
});
