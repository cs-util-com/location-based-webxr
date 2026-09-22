/**
 * The contributors every session ZIP is assembled from.
 *
 * ITS OWN MODULE BECAUSE IT HAS TWO CALLERS, and they are far apart in the
 * lifecycle: the crash-safety sync armed in `handleStartRecording`, and the
 * final export in `performStop`. Living in either one would have made the
 * other import it for a reason that reads like an accident.
 *
 * @see zip-contributors.ts.md
 */

import { createColmapZipContributor } from '../colmap/colmap-zip-contributor';
import { QR_LAUNCH_HOSTS } from '../qr/qr-launch-hosts';
import { createQrLevelZipContributor } from '../qr/qr-level-zip-contributor';
import { getOccupancyGrid } from '../state/occupancy-grid-provider';
import { createRefPointsZipContributor } from '../storage/ref-points-zip-contributor';
import { getCurrentScenarioHandle } from '../storage/scenario-storage';
import { selectFrameTilesInWebXR } from 'gps-plus-slam-app-framework/state';
import type { ZipExportContributor } from 'gps-plus-slam-app-framework/storage/zip-export';
import type { RecorderStore } from '../state/recorder-store';
import type { RecordingOptions } from '../state/recording-options';
import type { QrSightingFeeder } from '../qr/qr-sighting-feeder';
import type { SessionRuntime } from './session-runtime';

/**
 * The slice of `RecordingSessionDeps` this needs.
 *
 * A NARROW INTERFACE RATHER THAN THE WHOLE BAG, for two reasons. It says what
 * building the contributors actually depends on — three of that interface's
 * sixteen members — which the full type cannot. And it keeps this module from
 * importing `recording-session-handlers.ts`, which imports this one; a
 * type-only cycle would survive `check:cycles` (dpdm runs with `-T`, so type
 * imports are erased first) and still be a real tangle. `RecordingSessionDeps`
 * satisfies this structurally, so the caller passes `deps` unchanged.
 */
export interface ZipContributorDeps {
  getStore: () => RecorderStore;
  getQrSightingFeeder: () => QrSightingFeeder | null;
  getRecordingOptions: () => RecordingOptions;
}

/**
 * Build the ZIP export contributors for the current session. Used by BOTH
 * the periodic crash-safety sync and the final export so the on-disk backup
 * is continuously up to date (a contributor added here therefore runs on
 * every sync — COLMAP export plan Q2).
 *
 * The COLMAP contributor reads the maintained live state directly (poses via
 * `selectFrameTilesInWebXR`, the session-constant `projectionMatrix` from the
 * latest depth sample, and the shared occupancy grid) — never a from-scratch
 * re-parse of `actions/`, which would be O(session²) over a recording.
 */
export function buildZipContributors(
  runtime: SessionRuntime,
  deps: ZipContributorDeps
): ZipExportContributor[] {
  return [
    createRefPointsZipContributor(
      getCurrentScenarioHandle(),
      runtime.currentSessionName
    ),
    createQrLevelZipContributor({
      // Reads the maintained sighting fold, never a re-parse of `actions/`
      // — this runs on every crash-safety sync, not only at save.
      getFeeder: () => deps.getQrSightingFeeder(),
      allowedHosts: QR_LAUNCH_HOSTS,
      nowIso: () => new Date().toISOString(),
      onOutcomes: (outcomes) => {
        runtime.latestQrAnchorOutcomes = outcomes;
      },
    }),
    createColmapZipContributor({
      getFrames: () => selectFrameTilesInWebXR(deps.getStore().getState()),
      getProjectionMatrix: () =>
        deps.getStore().getState().recording.latestDepthSample
          ?.projectionMatrix,
      getOccupancyGrid,
      // Same noise floor the voxel view uses (`occupancy.minConfidence`), read
      // live so a changed value applies to the next crash-safety sync / export
      // — keeps phantom behind-surface points out of the reconstruction.
      getMinConfidence: () =>
        deps.getRecordingOptions().occupancy.minConfidence,
    }),
  ];
}
