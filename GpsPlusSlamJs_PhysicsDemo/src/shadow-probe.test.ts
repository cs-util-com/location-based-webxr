/**
 * Why this test matters: the shadow pixel probe (round-2 plan M1) is what
 * finally measures a VISIBLE shadow, so its own geometry must be right, or
 * a green probe would prove nothing: the ball has to land on the FLOOR (not
 * a wall or a table top), the probe has to wait until it truly rests, and it
 * has to look at the ball the way a standing phone user does, from any side
 * (the replay's own camera hangs 200 m over the room, where an 8 cm ball is
 * sub-pixel and the shadow square, which follows the camera, misses the
 * floor entirely). The pixel read itself runs only in a browser (the
 * e2e `replay-shadows.spec.js`).
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  REST_MS,
  createShadowProbe,
  installShadowProbe,
  restTracker,
  type ShadowProbeDeps,
} from "./shadow-probe";

function probeDeps(over: Partial<ShadowProbeDeps> = {}) {
  const spawned: THREE.Vector3[] = [];
  const balls: { position: THREE.Vector3; radius: number }[] = [];
  const deps: ShadowProbeDeps = {
    pause: () => {},
    renderer: {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 600),
    } as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    runtime: {
      spawnBallWithVelocity: (origin) => {
        spawned.push(origin.clone());
      },
      balls: () => balls,
    },
    getFloorMesh: () => null,
    shadows: null,
    remesh: () => {},
    now: () => 0,
    ...over,
  };
  return { deps, spawned, balls };
}

/** A 10 m plane facing up (a floor) or facing +z (a wall). */
function plane(facing: "up" | "wall"): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial(),
  );
  if (facing === "up") mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe("restTracker", () => {
  it("rests only after the ball stayed put for the whole window", () => {
    let t = 0;
    const rest = restTracker(() => t);
    const p = new THREE.Vector3(1, 0, 0);
    expect(rest(undefined)).toBe(false);
    expect(rest(p)).toBe(false);
    t = REST_MS / 2;
    expect(rest(p)).toBe(false);
    t = REST_MS;
    expect(rest(p)).toBe(true);
    // A move restarts the wait.
    t = REST_MS + 100;
    expect(rest(new THREE.Vector3(1, 0.01, 0))).toBe(false);
  });
});

/** A floor at y 0 and a 1 m table top at y 0.8 in one room mesh. */
function room(): THREE.Object3D {
  const group = new THREE.Group();
  group.add(plane("up"));
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial(),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.set(0, 0.8, 0);
  group.add(table);
  group.updateMatrixWorld(true);
  return group;
}

describe("createShadowProbe", () => {
  it("drops the ball above the floor, below any table top, never onto a wall", () => {
    const floor = room();
    const { deps, spawned } = probeDeps({ getFloorMesh: () => floor });
    const hit = createShadowProbe(deps).dropOnFloor();
    expect(hit).not.toBeNull();
    expect(hit![1]).toBeCloseTo(0, 6);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.y).toBeCloseTo(0.3, 6);

    const wall = plane("wall");
    const onWall = probeDeps({ getFloorMesh: () => wall });
    expect(createShadowProbe(onWall.deps).dropOnFloor()).toBeNull();
    expect(onWall.spawned).toHaveLength(0);
  });

  // Measured on the replay's reconstructed room: a drop on a small floor
  // patch bounced once and rolled off into a hole. The drop needs floor all
  // around it, so a lower but narrow strip, seen through a gap in the floor,
  // loses to the broad floor.
  it("drops only where the floor extends all around, not on a narrow strip", () => {
    const group = new THREE.Group();
    const strip = (width: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, 10),
        new THREE.MeshBasicMaterial(),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, 0);
      group.add(mesh);
    };
    strip(4.95, -2.525, 0); // floor, x -5..-0.05
    strip(4.75, 2.625, 0); // floor, x 0.25..5
    strip(0.3, 0.1, -0.5); // a low strip in the gap, x -0.05..0.25
    group.updateMatrixWorld(true);
    const { deps } = probeDeps({ getFloorMesh: () => group });
    const hit = createShadowProbe(deps).dropOnFloor();
    expect(hit).not.toBeNull();
    expect(hit![1]).toBeCloseTo(0, 6);
  });

  it("stands like a phone user, 1.5 m up and 1.2 m away, from any side", () => {
    const floor = room();
    const { deps, balls } = probeDeps({ getFloorMesh: () => floor });
    const probe = createShadowProbe(deps);
    const hit = probe.dropOnFloor()!;
    balls.push({ position: new THREE.Vector3(...hit), radius: 0.08 });
    for (const azimuth of [0, 90, 180, 270]) {
      probe.standAt(azimuth);
      const eye = probe.viewCamera()!.position;
      expect(eye.y - hit[1]!).toBeCloseTo(1.5, 6);
      expect(Math.hypot(eye.x - hit[0]!, eye.z - hit[2]!)).toBeCloseTo(1.2, 6);
      // The ball sits at the centre of the standing view.
      const screen = probe.ballScreen();
      expect(screen.x).toBeCloseTo(400, 3);
      expect(screen.y).toBeCloseTo(300, 3);
      // 0.08 m at 1.92 m with a 60° vertical field over 600 px: about 21 px.
      expect(screen.r).toBeGreaterThan(19);
      expect(screen.r).toBeLessThan(24);
    }
  });

  it("stands farther off when asked, like a thrower 2-4 m away", () => {
    const floor = room();
    const { deps, balls } = probeDeps({ getFloorMesh: () => floor });
    const probe = createShadowProbe(deps);
    const hit = probe.dropOnFloor()!;
    balls.push({ position: new THREE.Vector3(...hit), radius: 0.08 });
    probe.standAt(0, 4);
    const eye = probe.viewCamera()!.position;
    expect(Math.hypot(eye.x - hit[0]!, eye.z - hit[2]!)).toBeCloseTo(4, 6);
    expect(probe.ballScreen().r).toBeLessThan(10);
  });

  it("switches the demo's shadows, re-meshes and pauses the replay through its deps", () => {
    const calls: string[] = [];
    const { deps } = probeDeps({
      pause: () => calls.push("pause"),
      shadows: { setEnabled: (on) => calls.push(`shadows ${on}`) },
      remesh: () => calls.push("remesh"),
    });
    const probe = createShadowProbe(deps);
    probe.pause();
    probe.setShadowsEnabled(false);
    probe.remesh();
    expect(calls).toEqual(["pause", "shadows false", "remesh"]);
  });
});

describe("installShadowProbe", () => {
  it("puts the probe on the window and takes only its own away", () => {
    const target: { __physicsShadowProbe?: unknown } = {};
    const probe = createShadowProbe(probeDeps().deps);
    const remove = installShadowProbe(target as never, probe);
    expect(target.__physicsShadowProbe).toBe(probe);
    remove();
    expect(target.__physicsShadowProbe).toBeUndefined();
  });
});
