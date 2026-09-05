/**
 * Everything the recorder hangs into a live AR scene, in one place.
 *
 * This is the second half of Enter-AR: `main.ts` negotiates the session and
 * hands over the scene objects `initAR` produced, and this module attaches
 * the recorder's visualizers, grids and subscribers to them. Each block
 * registers its own teardown with the injected `ArSessionScope`, so entering
 * AR again unwinds all of it without a single line here knowing about that.
 *
 * Read-once semantics: every `recordingOptions` value below is read at
 * Enter-AR, not per frame. Toggling a setting mid-session therefore applies
 * on the NEXT Enter-AR, which is the documented behaviour for the
 * `visualization` group (replay is never gated).
 *
 * The deps are all data — scene handles, options, and the two shared records.
 * There are deliberately no UI callbacks in here: anything that needs to talk
 * to the user belongs on the `main.ts` side of the seam.
 */

import type * as THREE from 'three';

import { DepthOccluder } from 'gps-plus-slam-app-framework/ar/depth-occluder';
import { registerXrFrameUpdate } from 'gps-plus-slam-app-framework/ar/xr-frame-loop';
import {
  getArWorldGroup,
  getDepthInfoFromFrame,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import type { QrLevelLookupState } from '../qr/qr-level-source';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectZeroReference,
} from 'gps-plus-slam-app-framework/state/app-selectors';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { createCameraFollower } from 'gps-plus-slam-app-framework/visualization/camera-follower';
import { createAlignmentLerper } from 'gps-plus-slam-app-framework/visualization/alignment-lerper';
import { createGpsCompassCubes } from 'gps-plus-slam-app-framework/visualization/gps-compass-cubes';
import { createPerfStatsOverlay } from 'gps-plus-slam-app-framework/visualization/perf-stats-overlay';

import type { ArSessionScope } from '../utils/ar-session-scope';
import type { ArSessionResources } from './ar-session-resources';
import type { StoreRef } from '../state/store-ref';
import type { RecorderStore } from '../state/recorder-store';
import type { RecordingOptions } from '../state/recording-options';
import { wireRefPointViews } from '../ui/ref-point-view-wiring';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';
import type { FrameBlobCache } from '../visualization/frame-blob-cache';
import { wireFrameTileStack } from '../visualization/frame-tile-stack';
import { wireOccupancyStack } from '../visualization/occupancy-stack';
import { setOccupancyGrid } from '../state/occupancy-grid-provider';
import { wireQrRecording } from '../qr/wire-qr-recording';

export interface WireArSceneDeps {
  /** Alignment-following group; raw-WebXR content parents here. */
  readonly arWorldGroup: THREE.Group;
  /** Scene root; only GPS-aligned, non-rotating content parents here. */
  readonly arScene: THREE.Scene;
  /** The `#app` dom-overlay root the stats overlay composites into. */
  readonly appContainer: HTMLElement;
  readonly options: RecordingOptions;
  /** Teardown registry — every block below registers into it. */
  readonly scope: ArSessionScope;
  /** Slots the blocks below fill and their disposers null out again. */
  readonly resources: ArSessionResources;
  /** Store handle that follows per-recording store swaps. */
  readonly storeRef: StoreRef<RecorderStore>;
  /** In-memory blobs of captured frames, for the live frame tiles. */
  readonly liveFrameBlobs: FrameBlobCache;
  /** What a scanned code's level lookup did — routed to the HUD, so a code
   *  the session cannot use says so instead of being silent. */
  readonly onQrLevelState?: (text: string, state: QrLevelLookupState) => void;
}

export function wireArScene({
  arWorldGroup,
  arScene,
  appContainer,
  options,
  scope,
  resources,
  storeRef,
  liveFrameBlobs,
  onQrLevelState,
}: WireArSceneDeps): void {
  // Issue 4: Create alignment lerper for smooth alignment transitions
  resources.alignmentLerper = createAlignmentLerper(arWorldGroup);
  scope.add('Alignment lerper', () => {
    resources.alignmentLerper?.dispose();
    resources.alignmentLerper = null;
  });

  // Issue 8: CameraFollower sits at scene root (not arWorldGroup) — it tracks
  // the camera position but stays GPS-aligned (identity rotation), so the map
  // and compass cubes don't rotate with the camera or alignment matrix.
  resources.cameraFollower = createCameraFollower(arScene);
  scope.add('Camera follower', () => {
    resources.cameraFollower?.dispose();
    resources.cameraFollower = null;
  });

  // Live debug-overlay visibility (recording-options `visualization`, read
  // ONCE here at Enter-AR — toggling mid-session applies on the next
  // Enter-AR, not retroactively; replay is never gated). Finding B / DB-2 of
  // GpsPlusSlamJs_Docs/docs/2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md.
  const viz = options.visualization;

  // Perf stats overlay (Step 0 of the 2026-07-03 long-session fps plan).
  // Mounted into the #app dom-overlay root so it composites over the AR
  // view; advanced once per XR frame in the `callbacks.onFrame` tick.
  scope.wire('Stats overlay', viz.statsOverlay, () => {
    resources.statsOverlay = createPerfStatsOverlay(appContainer);
    return () => {
      resources.statsOverlay?.dispose();
      resources.statsOverlay = null;
    };
  });

  // Compass cubes — recorder-side skip. Nothing non-visual depends on
  // them. The follower must exist first (the cubes parent into its
  // object3D); registering their disposal closes the old reset-gap where
  // the cubes were only freed transitively via the follower.
  const follower = resources.cameraFollower;
  scope.wire('Compass cubes', viz.compassCubes, () => {
    const cubes = createGpsCompassCubes(follower.object3D);
    return () => cubes.dispose();
  });

  // GPS+VIO alignment spheres — NOT skipped (their snapshot positions feed
  // the session-summary map at stop), only hidden via the framework
  // visibility API. Live only; replay keeps them visible because clearAll
  // resets the shared singleton's visibility on each store swap.
  gpsEventVisualizer.setVisible(viz.gpsAlignmentMarkers);

  // Ref-point views (3D spheres + live-map markers) — AR-scoped and
  // store-swap-following via storeRef (round-3 feedback 2026-07-05:
  // previously session-scoped, so imports finishing before the first
  // recording filled the store with no view subscribed).
  resources.refPointViews = wireRefPointViews(storeRef, {
    visualizer: refPointVisualizer,
    getMap: () => resources.mapOverlay?.getLeafletMap() ?? null,
  });
  scope.add('Ref-point views', () => {
    resources.refPointViews?.unsubscribe();
    resources.refPointViews = null;
  });

  // F3.5d — frame tiles in the live AR scene, the same stack as replay
  // (visualization/frame-tile-stack.ts). The live frame-blob cache is
  // populated in handleImageCaptured, independent of this wiring, so
  // skipping it never affects capture. maxTiles is the LIVE-ONLY FIFO cap
  // (Step 4, 2026-07-03 fps plan); the divisor is read once at Enter-AR
  // with the other viz settings (D7-resolution).
  scope.wire('Frame tile visualizer', viz.frameTiles, () =>
    wireFrameTileStack({
      arWorldGroup,
      storeRef,
      blobSource: (imageFile) =>
        Promise.resolve(liveFrameBlobs.get(imageFile) ?? null),
      divisor: options.frameTileDisplay.divisor,
      maxTiles: options.frameTileDisplay.maxTiles,
    })
  );

  // Occupancy stack (visualization/occupancy-stack.ts — the same stack as
  // replay). Always wired: the occupancyCubes toggle gates only the rendered
  // debug cubes; the grid itself is always built and fed, because COLMAP
  // export and other non-visualizer consumers read it via getOccupancyGrid().
  // Settings are read at construction so a changed value applies on the next
  // Enter-AR (same source main.ts uses for arCrashIsolation).
  scope.wire('Occupancy grid', true, () => {
    const stack = wireOccupancyStack({
      arWorldGroup,
      storeRef,
      occupancy: options.occupancy,
      depthIntervalMs: options.depth.intervalMs,
      showCubes: viz.occupancyCubes,
    });
    // Publish the single live grid so non-visualizer consumers (the COLMAP
    // ZIP contributor, future floor/nav-mesh builders) can read it without a
    // one-off reference — the provider is the ONLY cross-module handle to
    // the grid; the teardown clears it back to null LAST (COLMAP plan Q2).
    setOccupancyGrid(stack.grid);
    return () => {
      stack.dispose();
      setOccupancyGrid(null);
    };
  });

  // Live CPU-depth occluder (opt-in — occupancy.liveOcclusion). The
  // full-screen depth-write path (v1): each frame we read the full depth and
  // feed it to the occluder, whose clip-space mesh writes gl_FragDepth so the
  // real surface hides ALL virtual content behind it — like the persistent
  // mesh, but for the surface the camera sees *this* frame. A per-frame
  // throw is tolerated too (the frame registry is try/catch-safe per
  // callback). The on-device occlusion render is still being brought up,
  // so the checkbox stays experimental.
  scope.wire('Live depth occluder', options.occupancy.liveOcclusion, () => {
    const occluder = new DepthOccluder();
    // The mesh's vertex shader ignores transforms, but parenting under
    // arWorldGroup keeps it in the AR render pass alongside the content.
    arWorldGroup.add(occluder.getOcclusionMesh());
    const unregisterFrame = registerXrFrameUpdate(
      ({ frame, referenceSpace }) => {
        const pose = frame.getViewerPose(referenceSpace);
        const depthInfo = getDepthInfoFromFrame(frame, pose);
        if (depthInfo) occluder.update(depthInfo);
      }
    );
    return () => {
      unregisterFrame();
      occluder.dispose();
    };
  });

  // Live QR RAW recording + WS-5 debug viz (opt-in). Gated on the operator
  // setting; the camera-frame callback was registered before initAR.
  scope.wire('QR recording', options.qr.enabled, () => {
    const unsubscribeQrRecording = wireQrRecording({
      storeRef,
      getArWorldGroup,
      qr: options.qr,
      setProducer: (producer) => {
        resources.qrProducer = producer;
      },
      // Read live, never recorded: the mint wants the alignment as it was at
      // each sighting, and an alignment matrix is a DERIVED value that must
      // not enter the action stream (decision D-A).
      readAlignment: () => {
        const state = storeRef.get().getState();
        return {
          alignmentMatrix: selectAlignmentMatrix(state),
          zero: selectZeroReference(state),
          alignmentSampleCount: selectGpsPositions(state).length,
        };
      },
      // A code whose level is missing, unreachable or not ours must SAY so
      // on the HUD. Without this the level-consuming mode is silent for
      // exactly the codes it cannot use, which is the failure the QR row was
      // added to end.
      onLevelState: (text, state) => {
        onQrLevelState?.(text, state);
      },
      setSightingFeeder: (feeder) => {
        resources.qrSightingFeeder = feeder;
      },
    });
    return () => {
      unsubscribeQrRecording();
      resources.qrProducer = null;
      resources.qrSightingFeeder = null;
    };
  });
}
