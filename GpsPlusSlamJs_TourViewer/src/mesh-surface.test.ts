/**
 * The surroundings as a mesh, for the creator's cursor (polish round M5,
 * B3: the ring should follow the surface, like the RecorderApp and the
 * physics demo; Q-Mesh: a creator's default since 2026-10-15).
 *
 * Why these tests matter: the cursor lies flat on whatever the screen
 * centre hits, so a hit must give the WORLD point and the surface's WORLD
 * normal (a mesh under a moved and turned group), and no hit must leave
 * the hit-test in charge. The readout the owner judges it by on the phone
 * (frame times and triangles) must say what it measured.
 */
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from "three";

import { makeWorldPointSample } from "gps-plus-slam-app-framework/test-utils/synthetic-depth-samples";
import {
  createMeshSurface,
  MESH_DEPTH,
  surfacePointFromHit,
} from "./mesh-surface.js";

/** A 4 x 4 m floor at y = 0 (two triangles), facing up. */
function floor(): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-2, 0, -2, -2, 0, 2, 2, 0, 2, 2, 0, -2], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return new Mesh(geometry, new MeshBasicMaterial());
}

/** A camera at eye height looking straight down. */
function downCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(0.5, 1.6, -0.5);
  camera.lookAt(0.5, 0, -0.5);
  camera.updateMatrixWorld(true);
  return camera;
}

describe("surfacePointFromHit", () => {
  it("gives the world point and the world normal of the face", () => {
    const group = new Group();
    group.rotation.set(0, 0, Math.PI / 2); // the floor becomes a wall
    group.position.set(3, 0, 0);
    const mesh = floor();
    group.add(mesh);
    group.updateMatrixWorld(true);
    const point = surfacePointFromHit({
      point: new Vector3(3, 1, 0),
      face: { normal: new Vector3(0, 1, 0) },
      object: mesh,
    } as never);
    expect(point?.position.toArray()).toEqual([3, 1, 0]);
    // +Y turned by 90 degrees about Z is -X.
    expect(point!.normal.distanceTo(new Vector3(-1, 0, 0))).toBeLessThan(1e-9);
  });

  // A turned group never changes where the hit is, and the normal stays a
  // unit vector the reticle can lie flat to.
  it("keeps the hit point and a unit normal under any turn (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        (x, y, z) => {
          const group = new Group();
          group.rotation.set(x, y, z);
          const mesh = floor();
          group.add(mesh);
          group.updateMatrixWorld(true);
          const at = new Vector3(0.3, -1.2, 4);
          const point = surfacePointFromHit({
            point: at,
            face: { normal: new Vector3(0, 1, 0) },
            object: mesh,
          } as never);
          expect(point!.position.equals(at)).toBe(true);
          expect(Math.abs(point!.normal.length() - 1)).toBeLessThan(1e-9);
        },
      ),
    );
  });

  it("is null without a hit or a face", () => {
    expect(surfacePointFromHit(null)).toBeNull();
    expect(
      surfacePointFromHit({
        point: new Vector3(),
        face: null,
        object: floor(),
      } as never),
    ).toBeNull();
  });
});

describe("createMeshSurface", () => {
  function setup(mesh: Mesh | null) {
    const sink = {
      sink: { refresh: vi.fn(), clear: vi.fn() },
      mesh: () => mesh ?? new Group(),
      triangleCount: () => 12,
      dispose: vi.fn(),
    };
    const unsubscribe = vi.fn();
    let now = 0;
    const camera = downCamera();
    const surface = createMeshSurface({
      parent: new Group(),
      store: {
        getState: () => ({ recording: { latestDepthSample: null } }),
        subscribe: () => () => undefined,
      },
      getCamera: () => camera,
      createSink: () => sink,
      subscribe: vi.fn(() => unsubscribe),
      now: () => now,
    });
    return {
      surface,
      sink,
      unsubscribe,
      advance(ms: number) {
        now += ms;
      },
    };
  }

  it("picks the mesh under the screen centre", () => {
    const mesh = floor();
    mesh.updateMatrixWorld(true);
    const s = setup(mesh);
    const point = s.surface.pick();
    expect(point).not.toBeNull();
    // Within a millimetre: the raycaster starts at the near plane, so the
    // hit carries float error of a fraction of a millimetre.
    expect(point!.position.distanceTo(new Vector3(0.5, 0, -0.5))).toBeLessThan(
      1e-3,
    );
    expect(point!.normal.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });

  it("picks nothing where the mesh has nothing (the hit-test stays in charge)", () => {
    const s = setup(null);
    expect(s.surface.pick()).toBeNull();
  });

  it("measures the frame times between picks for the ?debug=1 readout", () => {
    const s = setup(null);
    for (const gap of [0, 16, 17, 16, 50, 16]) {
      s.advance(gap);
      s.surface.pick();
    }
    const stats = s.surface.stats();
    expect(stats.frame).toMatchObject({ p50: 16, max: 50, count: 5 });
    // The triangles are the sink's own count (PR #599 review, F17), not a
    // structural read of the mesh's geometry: the fake mesh has none.
    expect(stats.triangles).toBe(12);
  });

  it("disposes the sink and the subscription once", () => {
    const s = setup(null);
    s.surface.dispose();
    s.surface.dispose();
    expect(s.sink.dispose).toHaveBeenCalledTimes(1);
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(s.surface.pick()).toBeNull();
  });
});

describe("MESH_DEPTH", () => {
  it("asks for depth at the reconstruction density (24 x 24 at 5 Hz)", () => {
    // Why: 16 x 16 at 1 Hz (the troubleshooting recording's) is too sparse
    // for a mesh (polish round M5); this is the RecorderApp's and the
    // physics demo's density.
    expect(MESH_DEPTH).toMatchObject({ intervalMs: 200, gridSize: 24 });
  });
});

describe("createMeshSurface, composed for real (M5 review #1, #2, #3, #6)", () => {
  // Why: the unit tests above inject the sink and the subscription, so
  // they could not see the grid's settings, the mesh mode, the hidden mesh
  // or the feed itself. This runs the framework's real grid, sink, mesher
  // (on the main thread - no worker) and subscriber on a floor observed
  // twice, and casts the screen centre at it: the ring must land ON the
  // floor (a corner-fit mesh sat half a cell above it), face up, and the
  // mesh must hide nothing.
  it("meshes a floor fed through the store and picks it at its height", () => {
    // Fake timers throughout: the re-mesh throttle (1 s) leaves a trailing
    // refresh pending, and only a fake one can be advanced past.
    expect.hasAssertions();
    vi.useFakeTimers();
    try {
      meshFloorAndReset();
    } finally {
      vi.useRealTimers();
    }
  });

  // Why (mesh-cursor smoothing plan 2026-10-15-0944): the averaging is
  // claimed against the framework mesh as it is really built - vertices on
  // the measured points of noisy depth - not only against a hand-made
  // grid. Over a spread of cursor positions the ring must tilt less than
  // the triangle it hits - across depth spacing 5 - 15 cm and noise
  // 2 - 5 cm, the range the sidecar's numbers were measured over (r867
  // review #7: the test had pinned one point of it).
  it("lies flatter than the hit triangle on a floor meshed from noisy depth", () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    try {
      for (const spacingM of [0.05, 0.1, 0.15]) {
        for (const noiseM of [0.02, 0.05]) {
          const { face, ring, count } = realMeshTilts(spacingM, noiseM);
          const label = `spacing ${String(spacingM)}, noise ${String(noiseM)}`;
          expect(count, label).toBeGreaterThan(50);
          // Measured 3.0 - 3.8 times flatter across the range.
          expect(ring, label).toBeLessThan(face / 2.5);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  /** The mean tilts (radians) of the hit triangle and of the ring over a
   *  spread of cursor positions, on a floor fed three times through the
   *  store as depth points `spacingM` apart with `noiseM` of height noise,
   *  meshed by the framework's real grid and mesher. Needs fake timers. */
  function realMeshTilts(
    spacingM: number,
    noiseM: number,
  ): { face: number; ring: number; count: number } {
    const listeners = new Set<() => void>();
    let latest: ReturnType<typeof makeWorldPointSample> | null = null;
    const store = {
      getState: () => ({ recording: { latestDepthSample: latest } }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const parent = new Group();
    const camera = downCamera();
    let now = 0;
    const surface = createMeshSurface({
      parent,
      store,
      getCamera: () => camera,
      now: () => now,
    });
    let state = 12345;
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state / 0xffffffff) * 2 - 1;
    };
    const steps = Math.round(2 / spacingM);
    for (let i = 0; i < 3; i += 1) {
      const points: [number, number, number][] = [];
      for (let a = 0; a <= steps; a += 1) {
        for (let b = 0; b <= steps; b += 1) {
          points.push([-1 + a * spacingM, noiseM * rand(), -1 + b * spacingM]);
        }
      }
      latest = makeWorldPointSample([0, 1.6, 0], points);
      for (const listener of listeners) listener();
    }
    vi.advanceTimersByTime(1000);
    parent.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    parent.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh === true) meshes.push(o as Mesh);
    });
    const raycaster = new Raycaster();
    const up = new Vector3(0, 1, 0);
    let face = 0;
    let ring = 0;
    let count = 0;
    for (let x = -0.5; x <= 0.5; x += 0.11) {
      for (let z = -0.5; z <= 0.5; z += 0.13) {
        camera.position.set(x, 1.6, z);
        camera.lookAt(x, 0, z);
        camera.updateMatrixWorld(true);
        // Ten seconds between picks: each is its own, unsmoothed in time.
        now += 10_000;
        raycaster.setFromCamera(new Vector2(0, 0), camera);
        const [hit] = raycaster.intersectObjects(meshes, false);
        const point = surface.pick();
        if (hit?.face == null || point === null) continue;
        const faceNormal = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld);
        face += faceNormal.angleTo(up);
        ring += point.normal.angleTo(up);
        count += 1;
      }
    }
    surface.dispose();
    return { face: face / count, ring: ring / count, count };
  }

  function meshFloorAndReset(): void {
    const listeners = new Set<() => void>();
    let latest: ReturnType<typeof makeWorldPointSample> | null = null;
    const store = {
      getState: () => ({ recording: { latestDepthSample: latest } }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const parent = new Group();
    const camera = downCamera();
    const surface = createMeshSurface({
      parent,
      store,
      getCamera: () => camera,
    });
    const floorPoints: [number, number, number][] = [];
    for (let x = -1; x <= 1; x += 0.05) {
      for (let z = -1; z <= 1; z += 0.05) floorPoints.push([x, 0, z]);
    }
    for (let i = 0; i < 2; i += 1) {
      latest = makeWorldPointSample([0, 1.6, 0], floorPoints);
      for (const listener of listeners) listener();
    }
    parent.updateMatrixWorld(true);
    const point = surface.pick();
    expect(point).not.toBeNull();
    expect(Math.abs(point!.position.y)).toBeLessThan(0.03);
    expect(point!.normal.y).toBeGreaterThan(0.9);
    const meshes: { visible: boolean }[] = [];
    parent.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh === true) meshes.push(o);
    });
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => !m.visible)).toBe(true);
    // An origin reset (F11): the cells are in a frame that no longer
    // exists, so the mesh starts again from nothing - no ghost to pick.
    surface.reset();
    expect(surface.pick()).toBeNull();
    // ...and builds again from the next samples, once the re-mesh
    // throttle (1 s) lets the next refresh through.
    // The new frame's floor sits half a metre lower: a ghost of the old
    // one at y = 0 would be hit first from above. Observed twice, the
    // mesh's floor of two observations a cell.
    const lower = floorPoints.map(
      ([x, , z]) => [x, -0.5, z] as [number, number, number],
    );
    for (let i = 0; i < 2; i += 1) {
      latest = makeWorldPointSample([0, 1.6, 0], lower);
      for (const listener of listeners) listener();
    }
    vi.advanceTimersByTime(1000);
    parent.updateMatrixWorld(true);
    const rebuilt = surface.pick();
    expect(rebuilt).not.toBeNull();
    expect(Math.abs(rebuilt!.position.y + 0.5)).toBeLessThan(0.03);
    surface.dispose();
  }
});

describe("createMeshSurface smooths the ring (mesh-cursor smoothing plan 2026-10-15-0944)", () => {
  // Why: the owner's phone test - "a little bit more lerping ... average
  // it a little bit stronger on the rotation part". The pick must ease
  // toward a moved surface point instead of jumping each frame, jump
  // straight onto a different surface (no glide through the air), lie
  // flat to the neighbourhood rather than to one triangle, and start
  // afresh after an origin reset.

  /** A flat 2.4 x 2.4 m floor of 0.15 m cells at height `y`, facing up,
   *  one vertex near (0.45, -0.45) lifted by `bumpM` (a noisy depth read). */
  function cellFloor(y = 0, bumpM = 0): Mesh {
    const n = 16;
    const cell = 0.15;
    const positions: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= n; i += 1) {
      for (let j = 0; j <= n; j += 1) {
        const x = -1.2 + i * cell;
        const z = -1.2 + j * cell;
        const bump = i === 11 && j === 5 ? bumpM : 0;
        positions.push(x, y + bump, z);
      }
    }
    const at = (i: number, j: number) => i * (n + 1) + j;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        index.push(at(i, j), at(i, j + 1), at(i + 1, j));
        index.push(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  function setupMoving(initial: Mesh) {
    let mesh: Mesh | Group = initial;
    let now = 0;
    const camera = downCamera();
    const surface = createMeshSurface({
      parent: new Group(),
      store: {
        getState: () => ({ recording: { latestDepthSample: null } }),
        subscribe: () => () => undefined,
      },
      getCamera: () => camera,
      createSink: () => ({
        sink: { refresh: vi.fn(), clear: vi.fn() },
        mesh: () => mesh,
        triangleCount: () => 0,
        dispose: vi.fn(),
      }),
      subscribe: vi.fn(() => () => undefined),
      now: () => now,
    });
    return {
      surface,
      camera,
      setMesh(next: Mesh | Group) {
        mesh = next;
      },
      /** Move the camera to look straight down at (x, z) and let `ms` pass. */
      lookAt(x: number, z: number, ms = 16) {
        camera.position.set(x, 1.6, z);
        camera.lookAt(x, 0, z);
        camera.updateMatrixWorld(true);
        now += ms;
      },
    };
  }

  it("eases toward a moved point, then settles on it", () => {
    const s = setupMoving(cellFloor());
    s.lookAt(0.5, -0.5);
    expect(s.surface.pick()!.position.x).toBeCloseTo(0.5, 3);
    s.lookAt(0.6, -0.5);
    const eased = s.surface.pick()!.position.x;
    expect(eased).toBeGreaterThan(0.5);
    expect(eased).toBeLessThan(0.55);
    for (let i = 0; i < 60; i += 1) {
      s.lookAt(0.6, -0.5);
      s.surface.pick();
    }
    s.lookAt(0.6, -0.5);
    expect(s.surface.pick()!.position.x).toBeCloseTo(0.6, 3);
  });

  it("jumps straight onto a different surface", () => {
    const s = setupMoving(cellFloor());
    s.lookAt(0.5, -0.5);
    s.surface.pick();
    // A table top 1 m higher: 1 m of lag against 0.3 x its 0.6 m distance.
    s.setMesh(cellFloor(1));
    s.lookAt(0.5, -0.5);
    expect(s.surface.pick()!.position.y).toBeCloseTo(1, 3);
  });

  it("lies flat to the neighbourhood, not to one bumped triangle", () => {
    const bumped = cellFloor(0, 0.03);
    const s = setupMoving(bumped);
    s.lookAt(0.43, -0.46);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0, 0), s.camera);
    const [hit] = raycaster.intersectObject(bumped, false);
    const faceTilt = hit!.face!.normal.angleTo(new Vector3(0, 1, 0));
    expect((faceTilt * 180) / Math.PI).toBeGreaterThan(5);
    const tilt = s.surface.pick()!.normal.angleTo(new Vector3(0, 1, 0));
    expect(tilt).toBeLessThan(faceTilt / 2);
  });

  it("re-enters on its raw point after a hole, one frame or many (no backward flicker)", () => {
    // Why (r867 review #4): during a hole the framework driver draws the
    // RAW hit-test pose; a smoother resuming from where the mesh last had
    // the ring would jump it back there for a frame and glide forward
    // again. So a null pick forgets the ring, and the mesh takes over on
    // its own raw point - then smooths again from there.
    const floorMesh = cellFloor();
    const s = setupMoving(floorMesh);
    s.lookAt(0.5, -0.5);
    s.surface.pick();
    s.setMesh(new Group()); // no mesh under the cursor: the hit-test rules
    s.lookAt(0.5, -0.5);
    expect(s.surface.pick()).toBeNull();
    s.setMesh(floorMesh);
    s.lookAt(0.6, -0.5);
    expect(s.surface.pick()!.position.x).toBeCloseTo(0.6, 3);
    s.lookAt(0.65, -0.5);
    const eased = s.surface.pick()!.position.x;
    expect(eased).toBeGreaterThan(0.6);
    expect(eased).toBeLessThan(0.625);
    s.setMesh(new Group());
    for (let i = 0; i < 30; i += 1) {
      s.lookAt(0.6, -0.5);
      s.surface.pick();
    }
    s.setMesh(floorMesh);
    s.lookAt(0.7, -0.5);
    expect(s.surface.pick()!.position.x).toBeCloseTo(0.7, 3);
  });

  it("rides the world group: a moved and turned parent between picks makes no lag", () => {
    // Why (r867 review #2): the mesh, the reticle AND the camera hang under
    // the world group, which the alignment lerper eases every frame. A
    // ring smoothed in WORLD coordinates lags every such step and slides
    // over a still surface (about 35 cm at 50 m from the pivot). Smoothed
    // in the parent's own frame, a still surface under a still phone is a
    // still target, so the ring is exactly where the ray hits.
    const parent = new Group();
    const floorMesh = cellFloor();
    parent.add(floorMesh);
    const camera = downCamera();
    parent.add(camera);
    parent.updateMatrixWorld(true);
    let now = 0;
    const surface = createMeshSurface({
      parent,
      store: {
        getState: () => ({ recording: { latestDepthSample: null } }),
        subscribe: () => () => undefined,
      },
      getCamera: () => camera,
      createSink: () => ({
        sink: { refresh: vi.fn(), clear: vi.fn() },
        mesh: () => floorMesh,
        triangleCount: () => 0,
        dispose: vi.fn(),
      }),
      subscribe: vi.fn(() => () => undefined),
      now: () => now,
    });
    surface.pick();
    const raycaster = new Raycaster();
    // Alignment steps: each a move of 10-20 cm and a turn of a few degrees,
    // all within the snap ratio (0.3 x 1.6 m), so a world-frame smoother
    // would glide behind every one of them.
    const steps: [number, number, number, number, number, number][] = [
      [0.2, 0, 0.1, 0, 0.05, 0],
      [0.1, 0.05, -0.1, 0.04, 0.1, -0.03],
      [-0.15, 0, 0.05, -0.02, -0.08, 0.05],
    ];
    for (const [dx, dy, dz, rx, ry, rz] of steps) {
      parent.position.add(new Vector3(dx, dy, dz));
      parent.rotation.set(
        parent.rotation.x + rx,
        parent.rotation.y + ry,
        parent.rotation.z + rz,
      );
      parent.updateMatrixWorld(true);
      now += 16;
      raycaster.setFromCamera(new Vector2(0, 0), camera);
      const [hit] = raycaster.intersectObject(floorMesh, false);
      const ring = surface.pick()!;
      expect(ring.position.distanceTo(hit!.point)).toBeLessThan(1e-3);
      const up = new Vector3(0, 1, 0).transformDirection(parent.matrixWorld);
      expect(ring.normal.angleTo(up)).toBeLessThan(1e-6);
    }
    surface.dispose();
  });

  it("starts afresh after reset(): the next pick is where the surface is", () => {
    const s = setupMoving(cellFloor());
    s.lookAt(0.5, -0.5);
    s.surface.pick();
    s.surface.reset();
    // 0.4 m lower: within the snap ratio, so without the smoother's own
    // reset the ring would glide down from the old frame's floor.
    s.setMesh(cellFloor(-0.4));
    s.lookAt(0.5, -0.5);
    expect(s.surface.pick()!.position.y).toBeCloseTo(-0.4, 3);
  });
});
