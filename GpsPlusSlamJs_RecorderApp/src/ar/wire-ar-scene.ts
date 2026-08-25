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
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { createCameraFollower } from 'gps-plus-slam-app-framework/visualization/camera-follower';
import { createAlignmentLerper } from 'gps-plus-slam-app-framework/visualization/alignment-lerper';
import { createGpsCompassCubes } from 'gps-plus-slam-app-framework/visualization/gps-compass-cubes';
import { createPerfStatsOverlay } from 'gps-plus-slam-app-framework/visualization/perf-stats-overlay';
import { OccupancyCubesVisualizer } from 'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

import type { ArSessionScope } from '../utils/ar-session-scope';
import type { ArSessionResources } from './ar-session-resources';
import type { StoreRef } from '../state/store-ref';
import type { RecorderStore } from '../state/recorder-store';
import type { RecordingOptions } from '../state/recording-options';
import { wireRefPointViews } from '../ui/ref-point-view-wiring';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';
import { FrameTileVisualizer } from '../visualization/frame-tile-visualizer';
import { decodeFrameTexture } from 'gps-plus-slam-app-framework/visualization/frame-texture-decoder';
import { wireFrameTileSubscribers } from '../visualization/wire-frame-tile-subscribers';
import type { FrameBlobCache } from '../visualization/frame-blob-cache';
import {
  createOccluderSink,
  type OccluderSink,
  type OccluderSinkHandle,
} from '../visualization/occluder-sink';
import { wireOccupancyGridSubscribers } from '../visualization/wire-occupancy-grid-subscribers';
import { setOccupancyGrid } from '../state/occupancy-grid-provider';
import { wireQrRecording } from '../qr/wire-qr-recording';

const log = createLogger('Recorder');

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

  // F3.5d — wire the frame-tile visualizer into the live AR scene so
  // captured frames appear as textured planes during recording, using
  // the same listener+visualizer stack as replay. The live frame-blob
  // cache is populated in handleImageCaptured, independent of this
  // wiring, so skipping it never affects capture.
  scope.wire('Frame tile visualizer', viz.frameTiles, () => {
    // Parent under arWorldGroup (NOT the scene root): the selector
    // emits raw-WebXR poses, so tiles must ride the camera's
    // alignment × WEBXR_TO_NUE chain. See the followup frame-check doc.
    // maxTiles: LIVE-ONLY FIFO cap (Step 4, 2026-07-03 fps plan) — the
    // replay wiring deliberately omits it so coverage auditing sees the
    // full recorded path.
    const frameTileVisualizer = new FrameTileVisualizer(arWorldGroup, {
      maxTiles: options.frameTileDisplay.maxTiles,
    });
    // D7-resolution: downscale the live display texture by the
    // configured frameTileDisplay divisor (default ÷2) to cut per-tile
    // GPU memory. Read once here at Enter-AR alongside the other viz
    // settings; capture quality (images.resolutionDivisor) is untouched.
    const frameTileDivisor = options.frameTileDisplay.divisor;
    const unsubscribeFrameTiles = wireFrameTileSubscribers({
      storeRef,
      visualizer: frameTileVisualizer,
      blobSource: (imageFile) =>
        Promise.resolve(liveFrameBlobs.get(imageFile) ?? null),
      decodeTexture: (blob) => decodeFrameTexture(blob, frameTileDivisor),
      onError: (err, imageFile) => {
        log.warn(`Frame tile decode failed for "${imageFile}"`, err);
      },
    });
    return () => {
      unsubscribeFrameTiles();
      frameTileVisualizer.dispose();
    };
  });

  // Occupancy-grid cubes — voxelized depth geometry in the live AR
  // scene (port plan Iter 5). The cells are raw-WebXR coordinates, so
  // the visualizer hangs off arWorldGroup (NOT the scene root) and
  // rides the alignment like the camera does (Iter 7 reparenting fix).
  // Always wired (enabled: true): the occupancyCubes toggle gates only
  // the rendered debug cubes — the grid itself is always built and fed,
  // because COLMAP export and other non-visualizer consumers read it via
  // getOccupancyGrid().
  scope.wire('Occupancy grid', true, () => {
    // Voxel size is a user setting (recording-options `occupancy.cellSizeM`,
    // clamped 1–20 cm); read it at construction so a changed value applies
    // on the next Enter-AR. Same source main.ts uses for arCrashIsolation.
    // Confidence-guarded carving is tied to the SAME noise floor the
    // renderers use (occupancy.minConfidence, clamped 1–10): any voxel
    // solid enough to be shown can no longer be erased by one deeper
    // reading (2026-07-16 synthetic-scene investigation — eliminates
    // silhouette churn and occluded-background destruction).
    const occupancyGrid = new OccupancyGrid({
      cellSizeM: options.occupancy.cellSizeM,
      carveConfidenceThreshold: options.occupancy.minConfidence,
    });
    // Publish the single live grid so non-visualizer consumers (the COLMAP
    // ZIP contributor, future floor/nav-mesh builders) can read it without a
    // one-off reference — the provider is the ONLY cross-module handle to
    // the grid; the teardown below clears it back to null (COLMAP export
    // plan Q2).
    setOccupancyGrid(occupancyGrid);

    // The occupancyCubes toggle gates ONLY the rendered debug cubes — the
    // grid itself is always built and fed, because COLMAP export and other
    // non-visualizer consumers read it via getOccupancyGrid(). When the
    // overlay is off we wire a no-op sink so the grid still folds in every
    // depth sample without allocating the cube InstancedMesh.
    let occupancyVisualizerSink: {
      refresh(grid: OccupancyGrid): void;
      clear(): void;
    };
    let occupancyCubesVisualizer: OccupancyCubesVisualizer | null = null;
    if (viz.occupancyCubes) {
      occupancyCubesVisualizer = new OccupancyCubesVisualizer(
        arWorldGroup,
        // Noise filter: only render voxels seen ≥ minConfidence times
        // (recording-options `occupancy.minConfidence`, default 3). Read
        // here so a changed value applies on the next Enter-AR, same as
        // cellSizeM above.
        { minObservations: options.occupancy.minConfidence }
      );
      occupancyVisualizerSink = occupancyCubesVisualizer;
    } else {
      occupancyVisualizerSink = { refresh: () => {}, clear: () => {} };
    }

    // Persistent depth-only occluder (ON by default). When on, it
    // re-meshes the grid on the same throttle as the cubes and writes depth
    // (no color) under arWorldGroup so real geometry hides virtual content
    // placed behind it. The shared factory (occluder-sink.ts — one wiring
    // for live AND replay) snapshots the SAME minConfidence floor the
    // cubes/COLMAP use, so the three consumers can't silently diverge; its
    // handle owns mesh + worker teardown (endARSession disposes it).
    let occluderSinkHandle: OccluderSinkHandle | null = null;
    let occluderSink: OccluderSink | undefined;
    if (options.occupancy.persistentOcclusion) {
      occluderSinkHandle = createOccluderSink(arWorldGroup, options.occupancy);
      occluderSink = occluderSinkHandle.sink;
    }
    // With any camera-relative window active (the cubes window by
    // default; the occluder when occluderRadiusM > 0), a settled grid
    // must still re-render when the camera moves — ε = one chunk edge
    // (16 cells; 2.4 m at the 0.15 m default). See the wirer's
    // revision-guard docs (Step 2 correctness detail).
    const anyWindowedConsumer =
      viz.occupancyCubes ||
      (options.occupancy.persistentOcclusion &&
        options.occupancy.occluderRadiusM > 0);
    const unsubscribeOccupancyGrid = wireOccupancyGridSubscribers({
      storeRef,
      grid: occupancyGrid,
      visualizer: occupancyVisualizerSink,
      occluder: occluderSink,
      refreshOnCameraMoveM: anyWindowedConsumer
        ? 16 * options.occupancy.cellSizeM
        : undefined,
      // Tie the cube-refresh throttle to the depth-sample cadence so a
      // faster `depth.intervalMs` (e.g. 500 ms) isn't capped at the old
      // hardcoded 1 Hz. At the default 1000 ms this equals the previous
      // DEFAULT_REFRESH_INTERVAL_MS, so default recordings are unchanged
      // (2026-06-22 cube cadence/locality plan §2).
      refreshIntervalMs: options.depth.intervalMs,
      onError: (err) => {
        log.warn('Occupancy grid update failed', err);
      },
      // Cells-over-time telemetry (Step 0 of the 2026-07-03 long-session
      // fps plan): one line per ~30 s so a log export correlates grid
      // growth with the stats overlay's fps trend.
      onGridSize: (cells) => {
        log.info(`[OccupancyGrid] ${cells} cells`);
      },
    });
    return () => {
      // Stop feeding the grid before releasing the visualizer/occluder it
      // feeds; clear the published grid reference last (COLMAP plan Q2).
      unsubscribeOccupancyGrid();
      occupancyCubesVisualizer?.dispose();
      occluderSinkHandle?.dispose();
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
    });
    return () => {
      unsubscribeQrRecording();
      resources.qrProducer = null;
    };
  });
}
