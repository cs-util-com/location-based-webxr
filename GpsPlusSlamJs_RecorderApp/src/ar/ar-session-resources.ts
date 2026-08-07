/**
 * The live resources an AR session owns, as one named record.
 *
 * These seven slots share a single lifecycle: they are filled while an AR
 * session is being wired up and nulled again by the disposers registered in
 * `utils/ar-session-scope.ts`. They used to be seven module-level `let`s in
 * `main.ts`, which forced every consumer to be a `main.ts` closure — that is
 * what kept `handleEnterAR` from being split apart.
 *
 * The contract they encode, which was previously only prose in `main.ts`:
 * **readers hold the record and read a slot at FIRE time, not at wiring
 * time.** A per-frame callback built before `initAR` therefore picks up a
 * visualizer created after it, and a slot nulled at teardown reads back as
 * `null` instead of stranding a disposed object. Anything that captured
 * `resources.statsOverlay` into its own variable would break that contract.
 *
 * Deliberately NOT in here: `activeImageQualityAnalyzer`. It is scoped to a
 * *recording*, not to the AR session (recordings start and stop within one
 * session), so it has a different lifecycle and stays where its owner is.
 */

import type { LoopClosureHandler } from 'gps-plus-slam-app-framework/core';
import type { LeafletMapOverlay } from 'gps-plus-slam-app-framework/visualization/leaflet-map-overlay';
import type { CameraFollower } from 'gps-plus-slam-app-framework/visualization/camera-follower';
import type { AlignmentLerper } from 'gps-plus-slam-app-framework/visualization/alignment-lerper';
import type { PerfStatsOverlayHandle } from 'gps-plus-slam-app-framework/visualization/perf-stats-overlay';
import type { QrDetectionController } from 'gps-plus-slam-app-framework/ar';
import type { RefPointViewWiring } from '../ui/ref-point-view-wiring';

export interface ArSessionResources {
  /**
   * Leaflet CSS3D overlay. Created lazily on the first map toggle rather
   * than at Enter-AR, so this slot can stay null for a whole session.
   */
  mapOverlay: LeafletMapOverlay | null;
  /** GPS-aligned anchor the map and compass cubes parent into. */
  cameraFollower: CameraFollower | null;
  /** Smooths alignment-matrix transitions on `arWorldGroup`. */
  alignmentLerper: AlignmentLerper | null;
  /** FPS/ms/MB panels, advanced once per rendered XR frame. */
  statsOverlay: PerfStatsOverlayHandle | null;
  /**
   * Rebound to the CURRENT store inside the per-frame callback, because
   * stores swap per recording session and a rebind also resets the
   * handler's last-pose memory.
   */
  loopClosureHandler: LoopClosureHandler | null;
  /** Thin RAW QR producer fed by the framework's camera-frame callback. */
  qrProducer: QrDetectionController | null;
  /** 3D ref-point spheres + live-map markers, following store swaps. */
  refPointViews: RefPointViewWiring | null;
}

/** A record with every slot empty — one per app, reused across sessions. */
export function createArSessionResources(): ArSessionResources {
  return {
    mapOverlay: null,
    cameraFollower: null,
    alignmentLerper: null,
    statsOverlay: null,
    loopClosureHandler: null,
    qrProducer: null,
    refPointViews: null,
  };
}
