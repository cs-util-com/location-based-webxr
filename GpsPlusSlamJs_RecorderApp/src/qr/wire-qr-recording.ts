/**
 * Wire live QR RAW recording + the WS-5 debug viz into a running AR session.
 *
 * Composes the two halves of the recorder live-QR feature, gated by the operator
 * (`recordingOptions.qr.enabled`):
 *  - **Producer (WS-2):** the framework's thin `createQrDetectionController` fed by
 *    the camera-frame source. On each accepted decode it dispatches a RAW
 *    `recordQrDetection` (corners + camera pose + projection + frame size +
 *    timestamp) into the CURRENT store, so the persistence middleware records it.
 *  - **Consumer (WS-5):** a `createQrDebugController` subscribed to the store
 *    (re-attaching across `Start Recording` / replay store swaps) that renders the
 *    derived axis+cube under `arWorldGroup`.
 *
 * **Clock domain (load-bearing — plan open topic A):** the producer's `now` is
 * `Date.now()` (EPOCH ms), the SAME clock the recorded depth stream uses
 * (`DepthSample.timestamp = performance.timeOrigin + frameTs`, depth-sampler.ts),
 * so the derive-on-read size as-of join (`depth.ts <= detection.ts`) pairs each
 * detection with the right depth sample. Using `performance.now()` (relative)
 * here was a bug: it never satisfies the join, so the size — and the debug cube —
 * never resolve.
 *
 * Camera POSE comes from the current XR frame (`getCurrentArPose()`, Option A) so
 * it is not stale to the 1 Hz depth cadence; PROJECTION (PnP intrinsics) still
 * comes from the latest depth sample (the only per-frame projection source today;
 * a fresher per-frame projection is open topic F). The producer's
 * `imageWidth/Height` come from the detector-frame buffer (the RGBA capture).
 *
 * The frame SOURCE is the single cadence owner (`startCameraFrameCapture({
 * intervalMs })`); the producer runs `minIntervalMs: 0` and detects every
 * delivered frame.
 *
 * @see qr-debug-controller.ts / qr-depth-resolver.ts — the consumer + as-of join.
 * @see gps-plus-slam-app-framework/ar/qr/qr-detection-controller — the thin producer.
 */

import type { Object3D } from 'three';
// Deep subpaths (NOT the `…/ar` barrel): the barrel eagerly pulls heavy
// transitive deps (e.g. sensors/permission-checker), which breaks main.ts's
// wiring tests that mock those partially. Same rationale as the demo's
// qr-debug-view. We import only the few modules we actually use.
import { createQrDetectionController } from 'gps-plus-slam-app-framework/ar/qr/qr-detection-controller';
import {
  createBarcodeDetectorFrontEnd,
  type RgbaImage,
} from 'gps-plus-slam-app-framework/ar/qr/qr-frontend';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  startCameraFrameCapture,
  stopCameraFrameCapture,
  getCurrentArPose,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import type { QrCaptureOptions } from '../state/recording-options';
import { recordQrDetection } from 'gps-plus-slam-app-framework/state';
import type { RecorderStore } from '../state/recorder-store';
import type { StoreRef } from '../state/store-ref';
import { followStore } from '../state/store-ref';
import { createQrTrackingController } from 'gps-plus-slam-app-framework/ar/qr/qr-tracking-controller';
import {
  intrinsicsFromProjection,
  solveQrPose,
} from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import { PlanarPnpSquare } from 'gps-plus-slam-app-framework/ar/qr/planar-pnp';
import { recordGpsEvent } from 'gps-plus-slam-app-framework/state';
import { createQrDebugController } from './qr-debug-controller';
import {
  createQrLevelSource,
  type QrLevelLookupState,
} from './qr-level-source';
import { QR_LAUNCH_HOSTS } from './qr-launch-hosts';
import type { QrFrameSink } from '../ar/ar-session-resources';
import {
  createQrSightingFeeder,
  type QrSightingFeeder,
  type QrSightingFeederDeps,
} from './qr-sighting-feeder';

/** Bare-name `?qr=` payloads resolve under this prefix — the convention the
 *  framework's launch builder documents. */
const DEFAULT_ASSET_PREFIX =
  'https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/';

/** The site worker's Drive CORS proxy: keyless Drive links refuse a real
 *  browser fetch, so they are rewritten through this route. */
const DRIVE_PROXY_BASE_URL = 'https://gps.csutil.com/api/drive-proxy';

/** Vote shape, carried over from the shipped viewer unchanged — the reasons
 *  those numbers are what they are live in the QR-pose plan's M4. */
const VOTE_ACCURACY_M = 5;
const VOTE_BASELINE_M = 2;
const VOTE_COUNT = 4;

export interface WireQrRecordingOptions {
  /** The active-store ref (producer + viz follow store swaps through it). */
  storeRef: StoreRef<RecorderStore>;
  /** The `arWorldGroup` the debug objects parent under (`null` until ready). */
  getArWorldGroup: () => Object3D | null;
  /** QR capture settings (`enabled` is assumed true by the caller's gate). */
  qr: QrCaptureOptions;
  /**
   * Receives the created producer so the camera-frame callback passed to
   * `initAR` (`callbacks.cameraFrame.onFrame`, wired before the source is
   * built) can forward frames to it. Called with `null` on dispose.
   */
  setProducer: (producer: QrFrameSink | null) => void;
  /**
   * Read the session's alignment as it stands NOW. Each sighting keeps the
   * value from its last detection, because the mint uses the alignment as it
   * was AT that moment and the store keeps no history (plan DEC-3).
   */
  readAlignment: QrSightingFeederDeps['readAlignment'];
  /** Receives the sighting feeder so save-time minting and the HUD can read
   *  it. Called with `null` on dispose. */
  setSightingFeeder?: (feeder: QrSightingFeeder | null) => void;
  /** What a scanned code's level lookup did, for the HUD. */
  onLevelState?: (text: string, state: QrLevelLookupState) => void;
}

/**
 * Start QR recording + debug viz. Returns a dispose that stops capture, detaches
 * the producer, tears down the debug subscriber + views, and resets the resolver.
 */
export function wireQrRecording(options: WireQrRecordingOptions): () => void {
  const { storeRef, getArWorldGroup, qr, setProducer } = options;
  /** Set only in level-consuming mode. */
  let disposeLevelSource: (() => void) | null = null;
  /** True once the tracking controller has taken over the frame stream. */
  let usingLevels = false;
  const sightings = createQrSightingFeeder({
    readAlignment: options.readAlignment,
  });
  options.setSightingFeeder?.(sightings);

  // --- Producer (WS-2) ------------------------------------------------------
  const frontEnd = createBarcodeDetectorFrontEnd();
  const detect = frontEnd
    ? (image: RgbaImage) => frontEnd.detect(image)
    : () => Promise.resolve(null);

  // Camera pose: the CURRENT XR-frame pose (Option A) — refreshed every frame,
  // so it is NOT the up-to-~1s-stale 1 Hz depth-sample pose. It rides the same
  // raw-WebXR/odom frame as the depth sample's pose, so it is coordinate-
  // compatible; we only reshape ARPose ({x,y,z}/{x,y,z,w}) into the Pose tuples.
  const getCameraPose = (): Pose | null => {
    const arPose = getCurrentArPose();
    if (!arPose) return null;
    return {
      position: [
        arPose.position.x,
        arPose.position.y,
        arPose.position.z,
      ] as Pose['position'],
      rotation: [
        arPose.orientation.x,
        arPose.orientation.y,
        arPose.orientation.z,
        arPose.orientation.w,
      ] as Pose['rotation'],
    };
  };
  // Projection (PnP intrinsics) still comes from the depth sample — the only
  // per-frame projection source today, and FOV is near-constant per session
  // (a fresher per-frame projection is open topic F).
  const getProjectionMatrix = () =>
    storeRef.get().getState().recording.latestDepthSample?.projectionMatrix ??
    null;

  // Level-consuming mode (DEC-7): the SAME frames, but through the tracking
  // controller, which fetches the code's level and votes. The raw record is
  // still written — the widened detection event carries the corners and the
  // camera pose, so ONE decode feeds both. Running the thin producer beside
  // it would decode every frame twice on the AR frame path.
  if (qr.useLevels && frontEnd) {
    const pnpSolver = new PlanarPnpSquare();
    const levelSource = createQrLevelSource({
      allowedHosts: QR_LAUNCH_HOSTS,
      assetPrefix: DEFAULT_ASSET_PREFIX,
      corsProxyBaseUrl: DRIVE_PROXY_BASE_URL,
      onState: (text, state) => {
        options.onLevelState?.(text, state);
      },
    });
    const tracking = createQrTrackingController({
      frontEnd,
      solvePose: (input) => solveQrPose({ ...input, solver: pnpSolver }),
      fetchLevel: (text) => levelSource.fetchLevel(text),
      // The source owns the retry timing; without this the controller's own
      // cache would keep the first failure for the whole session.
      shouldCacheLevel: (level) => levelSource.shouldCacheLevel(level),
      dispatchVotes: (votes) => {
        for (const vote of votes) {
          storeRef.get().dispatch(recordGpsEvent(vote));
        }
      },
      // The RAW record rides the validated DECODE, not the solved pose:
      // decision D-A says a recording stays algorithm-agnostic whatever else
      // the session is doing, and a code whose level does not exist yet -
      // which is every code on an authoring walk - never reaches a lock.
      onRawDetection: (raw) => {
        const projectionMatrix = getProjectionMatrix();
        if (projectionMatrix === null) return;
        storeRef.get().dispatch(
          recordQrDetection({
            text: raw.text,
            timestamp: raw.timestamp,
            corners: raw.corners,
            cameraPose: raw.cameraPose,
            projectionMatrix,
            imageWidth: raw.imageWidth,
            imageHeight: raw.imageHeight,
          })
        );
      },
      getCameraPose,
      getIntrinsics: (image) => {
        const projectionMatrix = getProjectionMatrix();
        return projectionMatrix === null
          ? null
          : intrinsicsFromProjection(
              projectionMatrix,
              image.width,
              image.height
            );
      },
      syntheticAccuracyM: VOTE_ACCURACY_M,
      voteBaselineM: VOTE_BASELINE_M,
      voteCount: VOTE_COUNT,
      minIntervalMs: 0,
    });
    setProducer(tracking);
    startCameraFrameCapture({
      intervalMs: qr.intervalMs,
      captureSize: qr.captureSize,
    });
    disposeLevelSource = () => {
      levelSource.dispose();
    };
    usingLevels = true;
  }

  const producer = usingLevels
    ? null
    : createQrDetectionController({
        detect,
        getCameraPose,
        getProjectionMatrix,
        recordDetection: (observation) =>
          storeRef.get().dispatch(recordQrDetection(observation)),
        // MUST share the depth stream's clock: `DepthSample.timestamp` is EPOCH ms
        // (`performance.timeOrigin + frameTs`, depth-sampler.ts), and the derive-on-
        // read size as-of join keys QR detections by the SAME timestamp. Date.now()
        // is epoch; `performance.now()` (relative) would never satisfy
        // `depth.ts <= detection.ts`, so the size — and the debug cube — never
        // resolve. (See open topic A; the original "epoch ms" intent was correct.)
        now: () => Date.now(),
        // The camera-frame source owns the cadence; detect every delivered frame.
        minIntervalMs: 0,
      });
  if (producer !== null) {
    setProducer(producer);
    // Begin delivering frames at the configured cadence + capture resolution.
    startCameraFrameCapture({
      intervalMs: qr.intervalMs,
      captureSize: qr.captureSize,
    });
  }

  // --- Consumer / debug viz (WS-5) -----------------------------------------
  const debug = createQrDebugController({
    getState: () => storeRef.get().getState(),
    getArWorldGroup,
    // One deriver, two consumers: the debug cube and the session's sighting
    // fold. A second deriver would double the PnP work and could disagree
    // with what is drawn.
    onPlacement: (text, placement, timestampMs) => {
      sightings.onPlacement(text, placement, timestampMs);
    },
  });

  // Coalesce the per-action debug updates to at most one per animation frame
  // (F3): the recorder store bursts (depth + GPS + ~8 Hz QR detections), and
  // there is no value rendering more than once per frame. The deriver already
  // makes each update O(1)/detection (F1+F2); this just caps the frequency.
  // (Mirrors the rAF coalescing main.ts uses for the frame-tile/map overlays.)
  let rafId: number | null = null;
  const scheduleUpdate = (): void => {
    if (rafId !== null) return; // an update is already queued for this frame
    rafId = requestAnimationFrame(() => {
      rafId = null;
      debug.update();
    });
  };

  // Store-swap following via the shared helper (quality-review G-11). The
  // synchronous `debug.update()` inside attach reflects pre-existing markers
  // immediately on the initial wiring AND on every store swap (Start
  // Recording / replay) — the two paths used to duplicate the call.
  const stopFollowing = followStore(storeRef, (store: RecorderStore) => {
    const detach = store.subscribe(scheduleUpdate);
    debug.update();
    return detach;
  });

  return () => {
    stopCameraFrameCapture();
    disposeLevelSource?.();
    producer?.reset();
    setProducer(null);
    options.setSightingFeeder?.(null);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    stopFollowing();
    debug.dispose();
  };
}
