/**
 * The surroundings as a mesh, for the creator's cursor (polish round M5,
 * B3: the ring should follow the surface, like the RecorderApp and the
 * physics demo; behind ?mesh=1, Q-Mesh).
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

  it("measures the frame times between picks for the ?mesh=1 readout", () => {
    const s = setup(null);
    for (const gap of [0, 16, 17, 16, 50, 16]) {
      s.advance(gap);
      s.surface.pick();
    }
    const stats = s.surface.stats();
    expect(stats.frame).toMatchObject({ p50: 16, max: 50, count: 5 });
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
    surface.dispose();
  });
});
