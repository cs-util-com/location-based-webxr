import { describe, expect, it } from "vitest";

import { createWalkSimulator } from "./walk-simulator.js";

describe("walk simulator", () => {
  it("walks forward along the heading at the configured speed", () => {
    const walk = createWalkSimulator({ walkSpeedMps: 1.4 });

    const pose = walk.step(2, { forward: 1, strafe: 0, turn: 0 });

    // Heading 0 faces north, which is +X in the GPS-world NUE frame.
    expect(pose.x).toBeCloseTo(2.8, 5);
    expect(pose.z).toBeCloseTo(0, 5);
  });

  it("turns right toward east and then walks in the new direction", () => {
    const walk = createWalkSimulator({
      walkSpeedMps: 1,
      turnRateRadPerSec: Math.PI / 2,
    });

    walk.step(1, { forward: 0, strafe: 0, turn: 1 });
    expect(walk.pose().headingRad).toBeCloseTo(Math.PI / 2, 5);

    const pose = walk.step(1, { forward: 1, strafe: 0, turn: 0 });
    expect(pose.x).toBeCloseTo(0, 5);
    expect(pose.z).toBeCloseTo(1, 5);
  });

  it("strafes to the walker's right, square to the heading", () => {
    const walk = createWalkSimulator({ walkSpeedMps: 1 });

    const pose = walk.step(1, { forward: 0, strafe: 1, turn: 0 });

    expect(pose.x).toBeCloseTo(0, 5);
    expect(pose.z).toBeCloseTo(1, 5);
  });

  it("never lets diagonal input outrun a straight walk", () => {
    const walk = createWalkSimulator({ walkSpeedMps: 1 });

    const pose = walk.step(1, { forward: 1, strafe: 1, turn: 0 });

    expect(Math.hypot(pose.x, pose.z)).toBeCloseTo(1, 5);
  });

  it("turns by a mouse-look delta without moving the walker", () => {
    const walk = createWalkSimulator({ walkSpeedMps: 1 });

    walk.turnBy(Math.PI / 4);

    expect(walk.pose()).toEqual({ x: 0, z: 0, headingRad: Math.PI / 4 });
  });

  it("teleports to a pose so autopilot and manual walking stay in sync", () => {
    const walk = createWalkSimulator({ walkSpeedMps: 1 });

    walk.teleport({ x: 5, z: -2, headingRad: 1 });

    expect(walk.step(1, { forward: 0, strafe: 0, turn: 0 })).toEqual({
      x: 5,
      z: -2,
      headingRad: 1,
    });
  });

  it("runs faster while the run modifier is held", () => {
    const walk = createWalkSimulator({ walkSpeedMps: 1, runMultiplier: 3 });

    const pose = walk.step(1, { forward: 1, strafe: 0, turn: 0, run: true });

    expect(pose.x).toBeCloseTo(3, 5);
  });
});
