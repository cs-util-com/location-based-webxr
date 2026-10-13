/**
 * The surroundings as a mesh, for the creator's cursor (polish round M5,
 * B3, behind `?mesh=1` - Q-Mesh): depth samples fold into an occupancy
 * grid, a mesher turns it into the framework's occluder mesh - kept as a
 * HIDDEN pick target, it occludes nothing - under the world group, and
 * `pick()` casts the screen centre against it: the point the reticle then
 * sits on (`startHitTestReticle`'s `surfacePick`). The pieces are the
 * framework's (`OccupancyGrid`, `createOccluderSink`,
 * `createOccluderMeshWorker`, `subscribeReplayOccupancy`, `raycastPointer`,
 * `createFrameTimes`); this composes them for one AR session.
 *
 * @see mesh-surface.ts.md
 */

import {
  Raycaster,
  type Camera,
  type Intersection,
  type Object3D,
} from "three";
import {
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
  OccupancyGrid,
} from "gps-plus-slam-app-framework/ar/occupancy-grid";
import {
  DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
  type DepthSamplerConfig,
} from "gps-plus-slam-app-framework/ar/depth-sampler";
import {
  subscribeReplayOccupancy,
  type DepthSampleStore,
} from "gps-plus-slam-app-framework/state/replay-occupancy-subscriber";
import { raycastPointer } from "gps-plus-slam-app-framework/visualization/pointer-picking";
import {
  createOccluderSink,
  type OccluderSinkHandle,
} from "gps-plus-slam-app-framework/visualization/occluder-sink";
import { createOccluderMeshWorker } from "gps-plus-slam-app-framework/visualization/occluder-mesh-worker-client";
import type { SurfacePoint } from "gps-plus-slam-app-framework/ar/hit-test-reticle-driver";
import {
  createFrameTimes,
  type FrameTimesSummary,
} from "gps-plus-slam-app-framework/utils/frame-times";
import { createLogger } from "gps-plus-slam-app-framework/utils/logger";

const log = createLogger("MeshSurface");

/** Depth at the reconstruction density (the framework's, as the
 *  RecorderApp and the physics demo use it): 16 x 16 at 1 Hz, the
 *  troubleshooting recording's, is too sparse for a mesh (polish round M5). */
export const MESH_DEPTH: Partial<DepthSamplerConfig> = {
  intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
  gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  rgb: false,
};

/** Mesh only around the creator - a cursor needs the surfaces near the
 *  screen centre, and a brute-force raycast runs every frame against
 *  whatever is meshed (M5 review #4: 12 m outdoors was tens of thousands
 *  of triangles). Farther away, the hit-test drives the ring. */
const MESH_RADIUS_M = 6;
/** Re-mesh at most once a second: depth arrives at 5 Hz, a cursor surface
 *  does not need its mesh rebuilt as often (M5 review #4). */
const REFRESH_INTERVAL_MS = 1000;
/** How many frame gaps the readout keeps (about two seconds at 60 Hz). */
const FRAME_GAPS_KEPT = 120;

/** The screen centre, as normalised device coordinates. */
const SCREEN_CENTRE = { x: 0, y: 0 };

/** The world point and the world normal of a raycast hit, or null. */
export function surfacePointFromHit(
  hit: Intersection | null,
): SurfacePoint | null {
  if (hit === null || hit.face === null || hit.face === undefined) return null;
  const normal = hit.face.normal
    .clone()
    .transformDirection(hit.object.matrixWorld);
  return { position: hit.point.clone(), normal };
}

export interface MeshSurfaceStats {
  /** Frame gaps measured between picks (one pick per frame). */
  frame: FrameTimesSummary | null;
  /** Triangles in the current mesh. */
  triangles: number;
}

export interface MeshSurface {
  /** The surface point under the screen centre, or null (no mesh there). */
  pick(): SurfacePoint | null;
  stats(): MeshSurfaceStats;
  /** Stop feeding, free the mesh and the worker (idempotent). */
  dispose(): void;
}

/** The framework's occluder, set up as the cursor's surface: smooth (the
 *  vertices on the measured points - corner-fit kept the cube's thickness
 *  and sat half a cell above the surface, M5 review #3), hidden. */
function createCursorSink(
  parent: Object3D,
  createWorker: (() => Worker) | undefined,
): OccluderSinkHandle {
  return createOccluderSink(
    parent,
    {
      meshMode: "smooth",
      debugStyle: "off",
      radiusM: MESH_RADIUS_M,
      minConfidence: DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
      occlude: false,
    },
    {
      createWorker: () =>
        createOccluderMeshWorker(
          createWorker ??
            (() => {
              throw new Error("no mesh worker: meshing on the main thread");
            }),
        ),
    },
  );
}

export function createMeshSurface(deps: {
  /** The world group the mesh hangs under (it rides the alignment). */
  parent: Object3D;
  /** The store whose `recording.latestDepthSample` is folded in. */
  store: DepthSampleStore;
  getCamera: () => Camera | null;
  /** The app's mesh worker (`new Worker(new URL(...))`); absent: the
   *  mesher runs on the main thread (the driver's fallback). */
  createWorker?: () => Worker;
  /** Injectable for tests. */
  createSink?: (parent: Object3D) => OccluderSinkHandle;
  subscribe?: typeof subscribeReplayOccupancy;
  now?: () => number;
}): MeshSurface {
  const now = deps.now ?? (() => performance.now());
  // The framework's defaults, with carving guarded at the same floor the
  // mesh needs - as every other app builds it (M5 review #1: unguarded
  // carving left floating fragments for the ring to snap to).
  const grid = new OccupancyGrid({
    cellSizeM: DEFAULT_OCCUPANCY_CELL_SIZE_M,
    carveConfidenceThreshold: DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
  });
  const handle = (
    deps.createSink ??
    ((parent: Object3D) => createCursorSink(parent, deps.createWorker))
  )(deps.parent);
  const unsubscribe = (deps.subscribe ?? subscribeReplayOccupancy)({
    store: deps.store,
    grid,
    onRefresh: (pose) => {
      handle.sink.refresh(grid, pose);
    },
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    onError: (err) => {
      log.warn("Mesh cursor: a depth sample could not be meshed", err);
    },
  });
  let disposed = false;
  let lastPickAt: number | null = null;
  const frames = createFrameTimes(FRAME_GAPS_KEPT);
  // One raycaster for every frame's pick (no per-frame allocation).
  const raycaster = new Raycaster();

  function noteFrame(): void {
    const at = now();
    if (lastPickAt !== null) frames.push(at - lastPickAt);
    lastPickAt = at;
  }

  return {
    pick() {
      if (disposed) return null;
      noteFrame();
      const camera = deps.getCamera();
      if (camera === null) return null;
      return surfacePointFromHit(
        raycastPointer(camera, SCREEN_CENTRE, [handle.mesh()], raycaster),
      );
    },
    stats() {
      const geometry = (
        handle.mesh() as { geometry?: { index?: { count: number } | null } }
      ).geometry;
      return {
        frame: frames.summary(),
        triangles: Math.floor((geometry?.index?.count ?? 0) / 3),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      handle.dispose();
    },
  };
}

/** A readout line for `?mesh=1`: the triangles and the frame gaps (p50 /
 *  p95 / max) between picks - the frame as a whole, not the mesh's share
 *  of it (the owner compares it with and without the flag). */
export function meshSurfaceLine(stats: MeshSurfaceStats): string {
  const frame =
    stats.frame === null
      ? "frame -"
      : `frame ${[stats.frame.p50, stats.frame.p95, stats.frame.max]
          .map((ms) => String(Math.round(ms)))
          .join("/")} ms`;
  return `mesh: ${String(stats.triangles)} triangles · ${frame}`;
}
