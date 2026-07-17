/**
 * Tests for `shootBallFromCamera`.
 *
 * Why this test matters:
 * This is the demo's spawn action after the user feedback ("shoot from the camera,
 * don't drop at the surface"). The two things that must be right: the ball starts
 * just IN FRONT of the camera (not at it), and its velocity points along the aim
 * direction at the shoot speed. Both are pinned here against a spy runtime.
 */

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { shootBallFromCamera, SHOOT_SPEED } from "./shoot-ball";
import type { PhysicsRuntime } from "./physics-runtime";

function spyRuntime() {
  return { spawnBallWithVelocity: vi.fn() } as unknown as PhysicsRuntime & {
    spawnBallWithVelocity: ReturnType<typeof vi.fn>;
  };
}

describe("shootBallFromCamera", () => {
  it("spawns in front of the camera with velocity along the aim at SHOOT_SPEED", () => {
    const runtime = spyRuntime();
    const camPos = new THREE.Vector3(1, 2, 3);
    // Aim straight down −Z, deliberately un-normalized to prove normalization.
    shootBallFromCamera(runtime, camPos, new THREE.Vector3(0, 0, -5));

    const [origin, velocity] = runtime.spawnBallWithVelocity.mock.calls[0] as [
      THREE.Vector3,
      THREE.Vector3,
    ];
    // Origin is 0.3 m in front of the camera along −Z.
    expect(origin.x).toBeCloseTo(1, 5);
    expect(origin.y).toBeCloseTo(2, 5);
    expect(origin.z).toBeCloseTo(3 - 0.3, 5);
    // Velocity points along −Z at exactly SHOOT_SPEED.
    expect(velocity.length()).toBeCloseTo(SHOOT_SPEED, 5);
    expect(velocity.z).toBeCloseTo(-SHOOT_SPEED, 5);
    expect(velocity.x).toBeCloseTo(0, 5);
  });

  it("does not mutate the caller-provided direction/position vectors", () => {
    const runtime = spyRuntime();
    const camPos = new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3(1, 0, 0);
    shootBallFromCamera(runtime, camPos, dir);
    expect(camPos.equals(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(dir.equals(new THREE.Vector3(1, 0, 0))).toBe(true);
  });
});
