/**
 * Depth capture for AR mode: one occupancy grid, fed directly.
 *
 * **DIRECT WIRING, NO STORE HOP.** The Recorder routes depth samples through
 * `recording/recordDepthSample` because it PERSISTS them; this demo records
 * nothing (`NullStorageBackend`, by design), so the framework sampler's
 * callback folds each sample straight into the grid. That also avoids the
 * dev-mode serializable/immutable store checks on a 576-point payload at
 * ~5 Hz that the store route would have had to measure and exempt.
 *
 * **THE GRID SETTINGS ARE EXPLICIT, AND THAT IS THE POINT OF THIS FILE.** The
 * `OccupancyGrid` constructor default is 0.15 m with NO carve threshold —
 * laxer than the framework-recommended production settings the floor
 * estimator's corpus constants were measured on (0.16 m cells, ≥2
 * observations). Passing nothing would silently get the lax grid and shift
 * every downstream confidence number. The carve threshold is tied to the
 * SAME ≥2 noise floor the queries use, mirroring the Recorder: a voxel solid
 * enough to count cannot be erased again by one deeper reading.
 *
 * **`clear()` is the tracking-reset hygiene hook.** `ar-mode.ts` calls it in
 * the same callback that dispatches `odometryTrackingRestarted`: after a
 * reset the odometry frame the cells were measured in no longer exists, and
 * stale cells would produce a plausible-looking, WRONG floor inside the
 * estimator's acceptance band.
 *
 * @see ar-depth-pipeline.ts.md
 */

// DEEP SUBPATHS, NOT THE `/ar` BARREL, and not only for the Leaflet reason
// `ar-mode.ts` records: `ar-mode.test.ts` mocks the barrel wholesale, and this
// module must keep the REAL grid in those tests.
import {
  OccupancyGrid,
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from "gps-plus-slam-app-framework/ar/occupancy-grid";
import {
  DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
  type DepthSample,
  type DepthSamplerConfig,
} from "gps-plus-slam-app-framework/ar/depth-sampler";

/**
 * What `startDepthCapture` is called with: the framework's RECONSTRUCTION
 * cadence (many small samples — the recorder-measured framerate/mesh
 * trade-off), not the conservative library fallback (16² @ 1 Hz, 8× fewer
 * points/s, visibly slower build-up). `rgb: false` because nothing here reads
 * voxel colours and the RGB path costs a GPU-stall blit per sample.
 */
export const AR_DEPTH_SAMPLER_CONFIG: Partial<DepthSamplerConfig> = {
  intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
  gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  rgb: false,
};

export interface ArDepthPipeline {
  /** The one grid of the session, raw-WebXR frame. Read by the floor path. */
  readonly grid: OccupancyGrid;
  /**
   * Fold one captured sample. Never throws — see the module header. A
   * PROPERTY (closure), not a method, so it can be passed as the framework's
   * `depth.onCaptured` callback directly without an unbound-`this` hazard.
   */
  readonly fold: (sample: DepthSample) => void;
  /** Empty the grid (tracking-reset hygiene). */
  readonly clear: () => void;
}

/**
 * Create the session's depth pipeline. One per AR session, dropped with it —
 * the grid is session state, never shared across sessions.
 */
export function createArDepthPipeline(): ArDepthPipeline {
  const grid = new OccupancyGrid({
    cellSizeM: DEFAULT_OCCUPANCY_CELL_SIZE_M,
    carveConfidenceThreshold: DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
  });
  return {
    grid,
    fold(sample: DepthSample): void {
      // `fold` runs inside the XR frame callback via the framework's depth
      // sampler, and a throw there would take the session's render down with
      // it. A malformed sample is dropped: the stream is ~5 Hz, so losing one
      // costs nothing, while surfacing it would cost the frame.
      try {
        grid.addSample(sample);
      } catch {
        // Dropped deliberately; the next sample arrives in ~200 ms.
      }
    },
    clear(): void {
      grid.clear();
    },
  };
}
