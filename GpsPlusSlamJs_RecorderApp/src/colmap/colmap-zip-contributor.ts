/**
 * COLMAP ZIP Export Contributor
 *
 * Recorder-side {@link ZipExportContributor} that derives a COLMAP `sparse/0/`
 * model from the LIVE recording state and writes it into the exported ZIP
 * (export plan Iter 3,
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md).
 *
 * It owns the `sparse/` subdir and writes `0/cameras.txt`, `0/images.txt`,
 * `0/points3D.txt`. The images themselves already sit in the ZIP's `images/`
 * dir (Iter 0 rename), so the contributor writes ONLY the model text and
 * `images.txt` NAME is the bare `frame-NNNNNN.jpg` (the user points COLMAP's
 * `image_path` at the ZIP's `images/`).
 *
 * Data source — injected accessors over maintained in-memory state, NOT a
 * from-scratch re-parse of `actions/` (Q2). Because the recorder regenerates
 * the whole ZIP on every crash-safety sync, re-parsing would be O(session²)
 * over a recording; reading live state keeps per-sync cost ∝ output size:
 *  - poses: `selectFrameTilesInWebXR(state)` (WebXR camera poses + image dims);
 *  - intrinsics: `latestDepthSample.projectionMatrix` (session-constant);
 *  - points: the live `OccupancyGrid` via the shared provider (Iter 2.5).
 *
 * Q4: when no `projectionMatrix` is available (depth sampling off / pre-
 * intrinsics recording) or no frame carries pixel dimensions, the contributor
 * emits 0 files — a `cameras.txt`-less tree would be a broken half-dataset — and
 * the rest of the ZIP is unaffected.
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type {
  ZipExportContributor,
  ZipContributorAddFile,
} from 'gps-plus-slam-app-framework/storage/zip-export';
import type { ArImageCapture, Matrix4 } from 'gps-plus-slam-app-framework/core';
import type { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { pinholeFromProjection } from 'gps-plus-slam-app-framework/utils/pinhole-from-projection';
import {
  webxrToColmapPose,
  webxrToColmapWorldPoint,
} from './colmap-conversions';
import {
  serializeCamerasTxt,
  serializeImagesTxt,
  serializePoints3DTxt,
  type ColmapImageRecord,
  type ColmapPoint3DRecord,
} from './colmap-serializers';

const log = createLogger('ColmapZipContributor');

/** Constant reprojection-error placeholder (we have no real tracks). */
const POINT_ERROR = 1;

/**
 * Color for occupancy cells that were never observed with RGB (rgb option off
 * or pre-Iter-8 recordings — `getCellColor` returns null). Mid-gray keeps such
 * points neutral in a 3DGS init cloud instead of black.
 */
const FALLBACK_RGB: readonly [number, number, number] = [128, 128, 128];

export interface ColmapZipContributorDeps {
  /**
   * Per-frame camera poses in raw WebXR space (e.g.
   * `selectFrameTilesInWebXR(store.getState())`). `width`/`height` are the JPEG
   * pixel dims used for intrinsics.
   */
  getFrames: () => readonly ArImageCapture[];
  /**
   * The session-constant projection matrix (column-major) from
   * `state.recording.latestDepthSample?.projectionMatrix`, or `undefined` when
   * depth sampling was off / pre-intrinsics.
   */
  getProjectionMatrix: () => Matrix4 | undefined;
  /** The live occupancy grid via the shared provider, or `null`. */
  getOccupancyGrid: () => OccupancyGrid | null;
  /**
   * Minimum observation count for a voxel to be exported — the recording's
   * `occupancy.minConfidence` (the SAME floor the voxel view applies, so the
   * export and the live cubes never silently diverge). Filters single-frame
   * depth noise, in particular the **behind-surface** phantoms free-space
   * carving can never clear (no ray traverses occluded space). Omitted →
   * floor 1 (unfiltered/legacy) so callers that predate the setting are
   * unchanged. See
   * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-22-2146-occupancy-grid-behind-surface-noise-plan.md.
   */
  getMinConfidence?: () => number;
}

/**
 * Build the COLMAP `sparse/` contributor. The returned contributor reads the
 * injected accessors each time it runs (every crash-safety sync + the final
 * export), so its output always reflects the latest live state.
 */
export function createColmapZipContributor(
  deps: ColmapZipContributorDeps
): ZipExportContributor {
  return {
    subdir: 'sparse',
    async contribute(addFile: ZipContributorAddFile): Promise<number> {
      const matrix = deps.getProjectionMatrix();
      if (!matrix) {
        // Q4: no intrinsics → skip COLMAP entirely (rest of ZIP unaffected).
        return 0;
      }

      const frames = deps.getFrames();
      const dims = firstPixelDimensions(frames);
      if (!dims) {
        log.debug(
          'No frame carries pixel dimensions; skipping COLMAP sparse/0'
        );
        return 0;
      }

      let intrinsics;
      try {
        intrinsics = pinholeFromProjection(matrix, dims.width, dims.height);
      } catch (err) {
        // A degenerate / non-perspective matrix: skip rather than emit a
        // broken camera the downstream loader would silently mis-read.
        log.warn(
          'Projection matrix is not a usable perspective; skipping',
          err
        );
        return 0;
      }

      const images: ColmapImageRecord[] = frames.map((f, i) => ({
        imageId: i + 1,
        pose: webxrToColmapPose(f.position, f.rotation),
        name: bareFilename(f.imageFile),
      }));

      const points = collectPoints(
        deps.getOccupancyGrid(),
        deps.getMinConfidence?.() ?? 1
      );

      await addFile(
        '0/cameras.txt',
        textBlob(serializeCamerasTxt(dims.width, dims.height, intrinsics))
      );
      await addFile('0/images.txt', textBlob(serializeImagesTxt(images)));
      await addFile('0/points3D.txt', textBlob(serializePoints3DTxt(points)));
      return 3;
    },
  };
}

/** First frame's pixel dimensions, or null if none carry both (legacy frames). */
function firstPixelDimensions(
  frames: readonly ArImageCapture[]
): { width: number; height: number } | null {
  for (const f of frames) {
    if (isPositive(f.width) && isPositive(f.height)) {
      return { width: f.width, height: f.height };
    }
  }
  return null;
}

/**
 * Map occupancy-grid cells to COLMAP point records. The exact per-cell surface
 * point (raw WebXR) is flipped into the COLMAP world frame with the SAME basis
 * change the camera extrinsics use, so points and cameras stay registered and
 * the reconstruction loads upright (follow-up Items A + B).
 */
function collectPoints(
  grid: OccupancyGrid | null,
  minConfidence: number
): ColmapPoint3DRecord[] {
  if (!grid) return [];
  const cells = grid.getOccupiedCells(minConfidence);
  return cells.map((cell, i) => ({
    pointId: i + 1,
    // The exact per-cell surface point (follow-up Item A) — hugs the real
    // surface instead of snapping to the 15 cm lattice; falls back to the
    // cell center defensively — then flipped into the COLMAP world (Item B).
    xyz: webxrToColmapWorldPoint(
      grid.getCellPoint(cell) ?? grid.getCellCenter(cell)
    ),
    rgb: grid.getCellColor(cell) ?? FALLBACK_RGB,
    error: POINT_ERROR,
  }));
}

/** Strip any directory prefix: `images/frame-000001.jpg` → `frame-000001.jpg`. */
function bareFilename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function textBlob(text: string): Blob {
  return new Blob([text], { type: 'text/plain' });
}

function isPositive(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
