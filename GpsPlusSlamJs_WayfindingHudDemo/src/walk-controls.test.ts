/**
 * Unit tests for the walk controls.
 *
 * Why these tests matter: this is the desktop simulator's whole movement
 * model. The e2e walk-flow spec holds "w" and asserts distance shrinks in
 * the status line — that only means anything if forward is truly the camera
 * heading projected onto the ground, dt-scaled (frame-rate independent),
 * and diagonals are not faster than straight lines.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  computeMoveStep,
  createKeyState,
  directionForKey,
  WALK_SPEED_MPS,
} from "./walk-controls";

const IDENTITY = new THREE.Quaternion();

describe("directionForKey / createKeyState", () => {
  it("maps wasd, uppercase, and arrow keys; ignores others", () => {
    expect(directionForKey("w")).toBe("forward");
    expect(directionForKey("W")).toBe("forward");
    expect(directionForKey("ArrowDown")).toBe("back");
    expect(directionForKey("q")).toBeNull();
  });

  it("tracks held directions and clears on demand", () => {
    const keys = createKeyState();
    keys.keyDown("w");
    keys.keyDown("d");
    keys.keyDown("x"); // unrelated — ignored
    expect([...keys.active].sort()).toEqual(["forward", "right"]);
    keys.keyUp("w");
    expect([...keys.active]).toEqual(["right"]);
    keys.clear();
    expect(keys.active.size).toBe(0);
  });
});

describe("computeMoveStep", () => {
  it("moves along the camera's -z (forward) scaled by speed and dt", () => {
    const step = computeMoveStep(
      new Set(["forward"]),
      IDENTITY,
      0.5,
      4, // 4 m/s for 0.5 s → 2 m
    );
    expect(step.x).toBeCloseTo(0, 10);
    expect(step.y).toBeCloseTo(0, 10);
    expect(step.z).toBeCloseTo(-2, 10);
  });

  it("is frame-rate independent: N small steps equal one big step", () => {
    const one = computeMoveStep(new Set(["forward"]), IDENTITY, 0.3);
    const many = new THREE.Vector3();
    for (let i = 0; i < 3; i += 1) {
      many.add(computeMoveStep(new Set(["forward"]), IDENTITY, 0.1));
    }
    expect(many.z).toBeCloseTo(one.z, 10);
  });

  it("normalizes diagonals (forward+right is not faster than forward)", () => {
    const straight = computeMoveStep(new Set(["forward"]), IDENTITY, 1);
    const diagonal = computeMoveStep(
      new Set(["forward", "right"]),
      IDENTITY,
      1,
    );
    expect(diagonal.length()).toBeCloseTo(straight.length(), 10);
  });

  it("projects movement onto the ground plane while looking down", () => {
    const lookDown = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 4, 0, 0), // pitch 45° down
    );
    const step = computeMoveStep(new Set(["forward"]), lookDown, 1, 4);
    expect(step.y).toBeCloseTo(0, 10);
    expect(step.length()).toBeCloseTo(4, 10); // full speed, not cos(45°)
  });

  it("returns zero for no keys, opposing keys, and a degenerate straight-down view", () => {
    expect(computeMoveStep(new Set(), IDENTITY, 1).length()).toBe(0);
    expect(
      computeMoveStep(new Set(["forward", "back"]), IDENTITY, 1).length(),
    ).toBe(0);
    const straightDown = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    expect(
      computeMoveStep(new Set(["forward"]), straightDown, 1).length(),
    ).toBe(0);
  });

  it("uses the exported default speed when none is given", () => {
    const step = computeMoveStep(new Set(["forward"]), IDENTITY, 1);
    expect(step.length()).toBeCloseTo(WALK_SPEED_MPS, 10);
  });
});
