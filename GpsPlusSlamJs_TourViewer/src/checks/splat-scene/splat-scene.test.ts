import type { Vector3 } from "gps-plus-slam-app-framework/core";
import { createDepthUnprojector } from "gps-plus-slam-app-framework/ar/depth-unprojection";
import { lookAtPose } from "gps-plus-slam-app-framework/test-utils/synthetic-qr-walk";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createOwnership,
  sees,
  type OwnershipCamera,
} from "../../splat-trainer/splat-ownership.js";
import { TRAINER_DEFAULTS } from "../../splat-trainer/trainer-defaults.js";
import { planWindows } from "../../splat-trainer/walk-windows.js";
import {
  EYE_HEIGHT_M,
  LOOP_RADIUS_M,
  OBJECT_CENTRE,
  SCENE_BOXES,
  castRay,
  distanceToScene,
  lookAt,
  sceneDepthSample,
  sceneHitAt,
  sceneProjection,
  sceneWalk,
  surfaceTexture,
  type ScenePose,
} from "./splat-scene.js";

const PROJECTION = sceneProjection(320, 240);

function forwardOf(pose: ScenePose): Vector3 {
  // The camera's -z in world space: q * (0, 0, -1) * q^-1.
  const [x, y, z, w] = pose.rotation;
  return [
    -2 * (x * z + w * y),
    -2 * (y * z - w * x),
    -(1 - 2 * (x * x + y * y)),
  ];
}

function rightOf(pose: ScenePose): Vector3 {
  const [x, y, z, w] = pose.rotation;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
}

function insideObject(p: Vector3): boolean {
  return SCENE_BOXES.some(
    (b) =>
      b.kind === "object" &&
      [0, 1, 2].every(
        (k) => p[k]! > b.min[k]! + 1e-9 && p[k]! < b.max[k]! - 1e-9,
      ),
  );
}

describe("the synthetic splat scene", () => {
  // Why: the scene is only useful as ground truth if its poses follow the
  // recorder's convention exactly; the test walks' own lookAt is the
  // reference the reader's tests already rest on.
  it("poses a camera as the recorder's test walks do", () => {
    for (const [eye, target] of [
      [
        [0, 1.5, 3.5],
        [0, 0.6, 0],
      ],
      [
        [-4, 1.5, 3.5],
        [-2, 0.6, -2],
      ],
      [
        [2, 1, -1],
        [-3, 2, 4],
      ],
    ] as [Vector3, Vector3][]) {
      const ours = lookAt(eye, target);
      const reference = lookAtPose([...eye], [...target]);
      expect(ours.position).toEqual(eye);
      // q and -q are one rotation.
      const sign = Math.sign(
        ours.rotation.reduce((s, v, i) => s + v * reference.rotation[i]!, 0),
      );
      ours.rotation.forEach((v, i) =>
        expect(v * sign).toBeCloseTo(reference.rotation[i]!, 12),
      );
    }
  });

  it("refuses a camera that cannot look at its target upright", () => {
    expect(() => lookAt([0, 1, 0], [0, 1, 0])).toThrow(RangeError);
    expect(() => lookAt([0, 1, 0], [0, 0, 0])).toThrow(RangeError);
  });

  // Why: the straight walk is the trainer's simplest case; its cameras
  // must cover the object, evenly spaced on one line, all upright.
  it("walks straight along +x, evenly, every camera upright and seeing the object", () => {
    const poses = sceneWalk("straight", 9);
    expect(poses).toHaveLength(9);
    poses.forEach((pose, i) => {
      expect(pose.position[0]).toBeCloseTo(-4 + i, 12);
      expect(pose.position[1]).toBe(EYE_HEIGHT_M);
      expect(pose.position[2]).toBe(3.5);
      expect(rightOf(pose)[1]).toBeCloseTo(0, 12);
      expect(forwardOf(pose)[2]).toBeLessThan(0);
      expect(forwardOf(pose)[1]).toBeLessThan(0);
      expect(sees(pose, PROJECTION, OBJECT_CENTRE)).toBe(true);
    });
  });

  // Why: the loop must close on itself and keep the object in the middle
  // of every photo; walked twice (`laps`) it is the revisit case of the
  // ownership rules, pinned below.
  it("walks once round the object and ends where it began", () => {
    const frames = 16;
    const poses = sceneWalk("loop", frames);
    const steps = poses.map((p, i) => {
      const next = poses[(i + 1) % frames]!;
      return Math.hypot(
        next.position[0] - p.position[0],
        next.position[2] - p.position[2],
      );
    });
    const chord = 2 * LOOP_RADIUS_M * Math.sin(Math.PI / frames);
    // Every step, the closing one from the last capture to the first too.
    steps.forEach((s) => expect(s).toBeCloseTo(chord, 12));
    for (const pose of poses) {
      const toCentre = [
        OBJECT_CENTRE[0] - pose.position[0],
        0.6 - pose.position[1],
        OBJECT_CENTRE[2] - pose.position[2],
      ];
      const n = Math.hypot(...toCentre);
      const f = forwardOf(pose);
      expect(
        f[0] * toCentre[0]! + f[1] * toCentre[1]! + f[2] * toCentre[2]!,
      ).toBeCloseTo(n, 9);
      expect(Math.hypot(pose.position[0], pose.position[2])).toBeCloseTo(
        LOOP_RADIUS_M,
        12,
      );
    }
  });

  it("walks the loop twice with the frames spread over both laps", () => {
    const poses = sceneWalk("loop", 32, 2);
    const once = sceneWalk("loop", 16);
    // The second lap passes the first lap's spots again.
    poses.slice(16).forEach((p, i) => {
      once[i]!.position.forEach((v, k) =>
        expect(p.position[k]).toBeCloseTo(v, 9),
      );
    });
    expect(() => sceneWalk("loop", 32, 0)).toThrow(RangeError);
    expect(() => sceneWalk("loop", 32, 1.5)).toThrow(RangeError);
    expect(() => sceneWalk("straight", 32, 2)).toThrow(RangeError);
  });

  it("refuses a walk of fewer than two frames or a fraction", () => {
    for (const frames of [1, 0, -2, 2.5, Number.NaN]) {
      expect(() => sceneWalk("straight", frames)).toThrow(RangeError);
      expect(() => sceneWalk("loop", frames)).toThrow(RangeError);
    }
  });

  // Why: a scene the object matches under a mirror or a half turn could
  // hide a trainer that flips or turns its cameras.
  it("has an object that no mirror or half turn maps onto itself", () => {
    const inside: Vector3[] = [];
    for (let x = -1.2; x <= 1.2; x += 0.05) {
      for (let y = 0.025; y <= 1.7; y += 0.05) {
        for (let z = -0.8; z <= 0.7; z += 0.05) {
          if (insideObject([x, y, z])) inside.push([x, y, z]);
        }
      }
    }
    expect(inside.length).toBeGreaterThan(100);
    const [cx, , cz] = OBJECT_CENTRE;
    for (const map of [
      (p: Vector3): Vector3 => [2 * cx - p[0], p[1], p[2]],
      (p: Vector3): Vector3 => [p[0], p[1], 2 * cz - p[2]],
      (p: Vector3): Vector3 => [2 * cx - p[0], p[1], 2 * cz - p[2]],
    ]) {
      const kept = inside.filter((p) => insideObject(map(p))).length;
      expect(kept / inside.length).toBeLessThan(0.8);
    }
  });

  it("projects photos with square pixels and refuses a bad size", () => {
    const m = sceneProjection(320, 240);
    expect((m[5] / m[0]) * (240 / 320)).toBeCloseTo(1, 6);
    expect(m[8]).toBe(0);
    expect(m[9]).toBe(0);
    for (const [w, h] of [
      [0, 240],
      [320, 0],
      [320.5, 240],
      [Number.NaN, 240],
    ]) {
      expect(() => sceneProjection(w!, h!)).toThrow(RangeError);
    }
  });

  // Why: the depth is the trainer's seed and its ground truth; a value
  // measured independently pins its sign, axis and z-depth convention.
  it("measures the depth straight ahead to the far wall", () => {
    const pose = lookAt([0, 1.5, 3.5], [0, 1.5, 0]);
    const sample = sceneDepthSample(pose, PROJECTION, 1, 42);
    expect(sample.points).toEqual([
      { screenX: 0.5, screenY: 0.5, depthM: Math.fround(9.5) },
    ]);
    expect(sample.timestamp).toBe(42);
    expect(sample.cameraPos).toEqual(pose.position);
    expect(sample.cameraRot).toEqual(pose.rotation);
    expect(sample.projectionMatrix).toBe(PROJECTION);
  });

  // Why: the framework's unprojection is what every consumer of a depth
  // sample uses; each point it gives back must lie on the scene.
  it("gives depths whose unprojected points lie on the scene, on both walks", () => {
    for (const kind of ["straight", "loop"] as const) {
      for (const pose of sceneWalk(kind, 8)) {
        const sample = sceneDepthSample(pose, PROJECTION, 6, 0);
        expect(sample.points).toHaveLength(36);
        const unproject = createDepthUnprojector(
          sample.cameraPos,
          sample.cameraRot,
          sample.projectionMatrix,
        );
        for (const point of sample.points) {
          const p = unproject?.unproject(point);
          expect(p).not.toBeNull();
          expect(distanceToScene(p!)).toBeLessThan(1e-5 * point.depthM + 1e-6);
        }
      }
    }
  });

  // Why: depth is only ground truth if a box behind another along the ray
  // is hidden by it, as a camera would see it.
  it("hits the nearest box along a ray, never one hidden behind it", () => {
    // From the straight walk's line straight at the block: the block's
    // +z face (z = 0) hides the far wall (z = -6) behind it.
    const hit = castRay([0, 0.3, 3.5], [0, 0, -1]);
    expect(hit?.box.name).toBe("block");
    expect(hit?.point[2]).toBeCloseTo(0, 9);
    // Just above the block the ray reaches the far wall.
    expect(castRay([0, 0.7, 3.5], [0, 0, -1])?.box.name).toBe("wall -z");
    // Out of the room, away from every box: nothing.
    expect(castRay([0, 10, 0], [0, 1, 0])).toBeNull();
  });

  // Why: the browser check compares each photo's colour at the depth
  // grid with the surface this names, so it must agree with the depth
  // sample: the same pixel ray, the same first box.
  it("names the surface a pixel sees, where the depth sample measures it", () => {
    const pose = sceneWalk("loop", 6)[0]!;
    const projection = sceneProjection(320, 240);
    expect(sceneHitAt(pose, projection, 0.5, 0.5)?.box.kind).toBe("object");
    expect(sceneHitAt(pose, projection, 0.5, 0.98)?.box.kind).toBe("floor");
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      new THREE.Quaternion(...pose.rotation),
    );
    const sample = sceneDepthSample(pose, projection, 5, 0);
    expect(sample.points.length).toBe(25);
    for (const p of sample.points) {
      const hit = sceneHitAt(pose, projection, p.screenX, p.screenY)!;
      const depth = new THREE.Vector3(...hit.point)
        .sub(new THREE.Vector3(...pose.position))
        .dot(forward);
      expect(Math.fround(depth)).toBe(p.depthM);
    }
  });

  it("measures the distance to the scene: 0 on a surface, positive off it", () => {
    expect(distanceToScene([0, 0, 0])).toBe(0);
    expect(distanceToScene([0, 1.5, 3.5])).toBeCloseTo(1.5, 9);
    expect(distanceToScene([2, 1.5, 2])).toBeCloseTo(1.5, 9);
  });

  it("refuses a depth grid that is not a positive integer", () => {
    const pose = sceneWalk("straight", 2)[0]!;
    for (const grid of [0, -1, 1.5, Number.NaN]) {
      expect(() => sceneDepthSample(pose, PROJECTION, grid, 0)).toThrow(
        RangeError,
      );
    }
  });

  it("textures each box with its own seed, the same bytes every time", () => {
    const a = surfaceTexture("wall", 2, 64);
    expect(a).toHaveLength(64 * 64 * 4);
    expect(surfaceTexture("wall", 2, 64)).toEqual(a);
    expect(surfaceTexture("wall", 3, 64)).not.toEqual(a);
    expect(surfaceTexture("object", 2, 64)).not.toEqual(a);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    expect(new Set(SCENE_BOXES.map((b) => b.seed)).size).toBe(
      SCENE_BOXES.length,
    );
  });
});

describe("the twice-walked loop and the ownership rules", () => {
  const FRAMES = 67;
  const LAPS = 2;
  const perLap = FRAMES / LAPS;
  const poses = sceneWalk("loop", FRAMES, LAPS);
  const plan = planWindows(
    poses.map((p, i) => ({ position: p.position, capturedAt: i * 500 })),
    { ...TRAINER_DEFAULTS, windowM: 5, minFrames: 4, minHoldouts: 2 },
  );
  const held = new Set(plan.holdouts);
  const cameras: OwnershipCamera[] = plan.windows.flatMap((w, window) =>
    w.core
      .filter((i) => !held.has(i))
      .map((i) => ({
        position: poses[i]!.position,
        rotation: poses[i]!.rotation,
        window,
        along: plan.along[i]!,
      })),
  );
  const lap2Only = new Set(
    plan.windows.flatMap((w, window) =>
      w.core.every((i) => i >= perLap) ? [window] : [],
    ),
  );
  /** Spots of the scene the first lap saw, at its depth grid. */
  const spots: Vector3[] = poses
    .slice(0, Math.floor(perLap))
    .flatMap((pose) => {
      const sample = sceneDepthSample(pose, PROJECTION, 6, 0);
      const u = createDepthUnprojector(
        sample.cameraPos,
        sample.cameraRot,
        sample.projectionMatrix,
      );
      return sample.points.flatMap((pt) => {
        const p = u?.unproject(pt);
        return p === null || p === undefined ? [] : [p];
      });
    });
  const onObject = (p: Vector3): boolean =>
    SCENE_BOXES.some(
      (b) =>
        b.kind === "object" &&
        [0, 1, 2].every(
          (k) => p[k]! >= b.min[k]! - 1e-4 && p[k]! <= b.max[k]! + 1e-4,
        ),
    );
  const objectSpots = spots.filter(onObject);
  /** How many of the object's spots a window of the second lap alone owns. */
  const ownedBySecondLap = (range: number): number => {
    const own = createOwnership(cameras, plan.windows, PROJECTION, range);
    return objectSpots.filter((p) => lap2Only.has(own.ownerOf(p))).length;
  };

  // Why: a revisit is decided by distance along the walk against twice
  // the range. At a range of 4 or 8 m (16 m of walk at most) the second
  // lap, 22 m of walk later, is a revisit: the first lap keeps every spot
  // of the object, so one surface is never kept twice. At 20 or 40 m the
  // whole 44 m walk counts as one pass and the nearest camera wins, so
  // the second lap owns some spots. At 2 m the object is out of range and
  // the nearest seeing camera keeps the spot, revisit or not.
  it("keeps the object with the first lap when the range makes the second a revisit", () => {
    expect(lap2Only.size).toBeGreaterThan(0);
    expect(objectSpots.length).toBeGreaterThan(50);
    for (const range of [4, 8]) expect(ownedBySecondLap(range)).toBe(0);
    for (const range of [20, 40])
      expect(ownedBySecondLap(range)).toBeGreaterThan(0);
  });
});
