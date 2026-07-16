/**
 * Tests for the occupancy view — the demo's single reconstructed mesh.
 *
 * Why this test matters:
 * This is the one building block used for BOTH occlusion and physics. It must fold
 * each depth sample into the grid and re-mesh the occluder (else neither the
 * collider nor the occlusion would grow); switch the visible shader live; and
 * switch the mesher MODE by recreating the occluder while re-meshing from the
 * persisted grid — with `getMesh()` a stable handle across that recreation (the
 * physics runtime reads it every frame). Real framework objects + a fake store.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OccupancyGrid,
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from "gps-plus-slam-app-framework/ar/occupancy-grid";
import { OcclusionMesh } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import { createOccupancyView } from "./occupancy-view";
import type { DepthSampleStore } from "gps-plus-slam-app-framework/state/replay-occupancy-subscriber";
import type { DepthSample } from "gps-plus-slam-app-framework/types/ar-types";
import * as THREE from "three";

function makeFakeStore(): DepthSampleStore & {
  push(sample: DepthSample): void;
} {
  let latest: DepthSample | null = null;
  const listeners = new Set<() => void>();
  return {
    getState: () => ({ recording: { latestDepthSample: latest } }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(sample) {
      latest = sample;
      for (const l of [...listeners]) l();
    },
  };
}

const sample: DepthSample = {
  timestamp: 1,
  cameraPos: [0, 1.5, 0],
  cameraRot: [0, 0, 0, 1],
  points: [],
};

afterEach(() => vi.restoreAllMocks());

describe("createOccupancyView", () => {
  it("folds each depth sample into the grid and re-meshes the occluder", () => {
    const addSample = vi.spyOn(OccupancyGrid.prototype, "addSample");
    const meshUpdate = vi.spyOn(OcclusionMesh.prototype, "update");

    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    store.push(sample);

    expect(addSample).toHaveBeenCalledTimes(1);
    // The occluder re-meshes — it feeds BOTH occlusion and the physics collider.
    expect(meshUpdate).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it("inherits the framework voxel size + noise floor for the mesh (FAST reconstruction)", () => {
    // The demo must use the same framework defaults as the recorder — 16 cm
    // voxels (the speed lever) + a noise floor of 3 (keeps floaters/phantom
    // colliders low; 2026-07-16 sweep). The mesher is fed the cell size and the
    // grid is queried at the noise floor, so spy on both to prove the demo reads
    // the constants (asserted against the constants, not hardcoded numbers).
    const getOccupied = vi.spyOn(OccupancyGrid.prototype, "getOccupiedCells");
    const meshUpdate = vi.spyOn(OcclusionMesh.prototype, "update");
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    store.push(sample);

    // Noise floor: getOccupiedCells is queried at the framework default (3).
    expect(getOccupied).toHaveBeenLastCalledWith(
      DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
    );
    // Voxel size: the mesher receives the framework default cell size (0.16 m).
    expect(meshUpdate).toHaveBeenLastCalledWith(
      expect.anything(),
      DEFAULT_OCCUPANCY_CELL_SIZE_M,
      expect.anything(),
    );
    view.dispose();
  });

  it("defaults to Surface nets + the combined shader", () => {
    const setDebugStyle = vi.spyOn(OcclusionMesh.prototype, "setDebugStyle");
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    // Default debug style is applied at construction.
    expect(setDebugStyle).toHaveBeenLastCalledWith("depth-shaded-wireframe");
    view.dispose();
  });

  it("changes the visible shader live via setDebugStyle", () => {
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    const setDebugStyle = vi.spyOn(OcclusionMesh.prototype, "setDebugStyle");
    view.setDebugStyle("wireframe");
    expect(setDebugStyle).toHaveBeenLastCalledWith("wireframe");
    view.dispose();
  });

  it("setMeshMode recreates the occluder (new mesh handle) and re-meshes", () => {
    const store = makeFakeStore();
    const parent = new THREE.Group();
    const view = createOccupancyView(parent, store, { meshMode: "smooth" });
    const before = view.getMesh();

    const meshUpdate = vi.spyOn(OcclusionMesh.prototype, "update");
    view.setMeshMode("greedy");

    // A brand-new occluder mesh (the collider source getMesh() must follow it).
    expect(view.getMesh()).not.toBe(before);
    // Re-meshed from the persisted grid immediately.
    expect(meshUpdate).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it("guards established cells against deeper readings (confidence-guarded carve)", () => {
    // Why this matters: the 2026-07-16 synthetic-scene ground-truth
    // investigation showed legacy carving continuously deletes established
    // silhouette cells (churn) and, under sensor noise, destroys occluded
    // background. The demo — whose collider IS the reconstruction — wires
    // carveConfidenceThreshold = its noise floor. The guard DECAYS on
    // contradiction (2026-07-16-1547 fossilization fix): a single deeper
    // reading costs one observation instead of deleting the cell, so a
    // well-observed cell stays meshed while persistent contradictions can
    // still un-build it.
    //
    // Identity-projection closed form: with identity rotation + identity
    // projectionMatrix, a center-screen point at depth d unprojects to
    // cameraPos + [0, 0, −d].
    const identityProjection = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ] as unknown as NonNullable<DepthSample["projectionMatrix"]>;
    let nextTimestamp = 1;
    const ray = (depthM: number): DepthSample => ({
      // Distinct timestamps — the replay subscriber skips a sample it has
      // already folded (same-timestamp dedupe).
      timestamp: nextTimestamp++,
      cameraPos: [0, 0, 0.9],
      cameraRot: [0, 0, 0, 1],
      points: [{ screenX: 0.5, screenY: 0.5, depthM }],
      projectionMatrix: identityProjection,
    });

    // Fake timers: the replay subscriber throttles refreshes (leading +
    // 250 ms trailing), so synchronous pushes need the trailing refresh
    // flushed before the mesh reflects the latest grid state.
    vi.useFakeTimers();
    const meshUpdate = vi.spyOn(OcclusionMesh.prototype, "update");
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);

    // Establish the cell at world (0,0,0) ONE observation above the noise
    // floor (a decay must not un-mesh it)…
    for (let i = 0; i < DEFAULT_OCCUPANCY_MIN_OBSERVATIONS + 1; i++) {
      store.push(ray(0.9));
      vi.advanceTimersByTime(300);
    }
    const established = meshUpdate.mock.lastCall![0] as ReadonlyArray<
      readonly [number, number, number]
    >;
    expect(established).toContainEqual([0, 0, 0]);

    // …then a deeper reading straight through it. Legacy carving would DELETE
    // the cell outright (the meshed set would go empty); the decay guard
    // costs one observation and keeps it meshed.
    store.push(ray(2.7));
    vi.advanceTimersByTime(300);
    const afterDeeper = meshUpdate.mock.lastCall![0] as ReadonlyArray<
      readonly [number, number, number]
    >;
    expect(afterDeeper).toContainEqual([0, 0, 0]);

    // Persistent contradictions drain it below the floor — the mesh un-builds
    // (the fossilization fix: noise can never become immortal).
    for (let i = 0; i < 2; i++) {
      store.push(ray(2.7));
      vi.advanceTimersByTime(300);
    }
    const afterPersistentContradiction = meshUpdate.mock
      .lastCall![0] as ReadonlyArray<readonly [number, number, number]>;
    expect(afterPersistentContradiction).not.toContainEqual([0, 0, 0]);
    view.dispose();
    vi.useRealTimers();
  });

  it("detaches the subscription on dispose", () => {
    const addSample = vi.spyOn(OccupancyGrid.prototype, "addSample");
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    view.dispose();
    store.push(sample);
    expect(addSample).not.toHaveBeenCalled();
  });
});
