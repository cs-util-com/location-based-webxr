/**
 * The depth capture pipeline — one grid, explicit framework settings.
 *
 * Why these tests matter: the framework's `OccupancyGrid` constructor default
 * (0.15 m, no carve threshold) is LAXER than the framework-recommended
 * production settings, and passing nothing silently gets the lax ones — a
 * grid that looks right and measures wrong. The floor estimator's corpus
 * constants were measured on the 0.16 m / ≥2-observation grid, so drifting
 * the construction drifts every downstream confidence number with it.
 */

import { describe, it, expect } from "vitest";

import {
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from "gps-plus-slam-app-framework/ar/occupancy-grid";
import {
  DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
  type DepthSample,
} from "gps-plus-slam-app-framework/ar/depth-sampler";
import {
  makeWorldPointSample,
  surfacePatch,
} from "gps-plus-slam-app-framework/test-utils/synthetic-depth-samples";

import {
  AR_DEPTH_SAMPLER_CONFIG,
  createArDepthPipeline,
} from "./ar-depth-pipeline.js";

describe("the grid's construction settings", () => {
  it("uses the framework's recommended cell size and carve threshold EXPLICITLY", () => {
    // Both values exist as framework exports precisely so consumers do not
    // fall back to the constructor's laxer defaults (plan §1.3/§2.6). Asserted
    // against the exports rather than literals, so a framework re-tuning flows
    // through instead of silently diverging.
    const pipeline = createArDepthPipeline();

    expect(pipeline.grid.cellSizeM).toBe(DEFAULT_OCCUPANCY_CELL_SIZE_M);
    expect(pipeline.grid.carveConfidenceThreshold).toBe(
      DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
    );
  });

  it("captures at the reconstruction cadence, without the RGB blit", () => {
    // The recorder-measured reconstruction cadence (many small samples), NOT
    // the conservative library fallback (16² @ 1 Hz — 8× fewer points/s,
    // visibly slower floor build-up). `rgb: false` because nothing in this
    // demo reads voxel colours, and the RGB path costs a GPU-stall blit per
    // sample.
    expect(AR_DEPTH_SAMPLER_CONFIG).toEqual({
      intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
      gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
      rgb: false,
    });
  });
});

describe("fold and clear", () => {
  it("folds a depth sample into the grid", () => {
    const pipeline = createArDepthPipeline();
    const sample = makeWorldPointSample(
      [0, 1.6, 0],
      surfacePatch(() => 0, 1, 0.2),
    );

    pipeline.fold(sample);

    expect(pipeline.grid.size).toBeGreaterThan(0);
  });

  it("clears the grid — the tracking-reset hygiene hook", () => {
    // After `odometryTrackingRestarted` the odometry frame the cells were
    // measured in NO LONGER EXISTS; stale cells would produce a
    // plausible-looking, wrong floor inside the acceptance band (plan §2.4).
    const pipeline = createArDepthPipeline();
    pipeline.fold(
      makeWorldPointSample(
        [0, 1.6, 0],
        surfacePatch(() => 0, 1, 0.2),
      ),
    );
    expect(pipeline.grid.size).toBeGreaterThan(0);

    pipeline.clear();

    expect(pipeline.grid.size).toBe(0);
  });

  it("drops a malformed sample instead of throwing into the frame loop", () => {
    // `fold` runs inside the XR frame callback via the framework's depth
    // sampler; a throw there would take the session's render down with it.
    const pipeline = createArDepthPipeline();

    expect(() => {
      pipeline.fold({} as DepthSample);
    }).not.toThrow();
    expect(pipeline.grid.size).toBe(0);
  });
});
