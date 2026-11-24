/**
 * WebXR wiring of the anchors check page: requests the AR session with the
 * `anchors` feature, keeps a hit-test reticle, creates one anchor plus a
 * non-anchored marker on a tap, and feeds every frame to the jump tracker.
 *
 * The WebXR objects arrive through small structural interfaces so the
 * wiring is testable with fakes; the three.js scene arrives as `scene`.
 *
 * Sidecar: `anchors-check-session.ts.md`.
 */

import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  createAnchorJumpTracker,
  type TrackerEvent,
} from './anchor-jump-tracker';
import { buildLog } from './anchor-jump-report';

/** `XRRigidTransform`, structurally. */
export interface XrTransformLike {
  readonly position: { x: number; y: number; z: number };
  readonly orientation: { x: number; y: number; z: number; w: number };
}

export interface XrAnchorLike {
  readonly anchorSpace: unknown;
  delete(): void;
}

export interface XrFrameLike {
  getViewerPose(
    space: unknown
  ):
    | { transform: XrTransformLike; emulatedPosition: boolean }
    | null
    | undefined;
  getPose(
    space: unknown,
    base: unknown
  ): { transform: XrTransformLike } | null | undefined;
  getHitTestResults(source: unknown): ArrayLike<{
    getPose(base: unknown): { transform: XrTransformLike } | null | undefined;
  }>;
  // Method syntax on purpose: its parameters are checked bivariantly, so
  // the real XRFrame (typed XRRigidTransform, XRSpace) fits this shape.
  createAnchor?(pose: unknown, space: unknown): Promise<XrAnchorLike>;
  /** The anchors WebXR still tracks this frame (`XRAnchorSet`). */
  readonly trackedAnchors?: { has(anchor: XrAnchorLike): boolean };
}

export interface XrSessionLike {
  readonly enabledFeatures?: readonly string[];
  requestReferenceSpace(type: 'viewer'): Promise<unknown>;
  requestHitTestSource?: (options: {
    space: unknown;
  }) => Promise<unknown> | undefined;
  addEventListener(
    type: 'select',
    listener: (event: { frame: XrFrameLike }) => void
  ): void;
  addEventListener(type: 'end', listener: () => void): void;
  end(): Promise<void>;
}

export interface XrSystemLike {
  isSessionSupported(mode: 'immersive-ar'): Promise<boolean>;
  requestSession(mode: 'immersive-ar', init: object): Promise<XrSessionLike>;
}

/** The three.js side: renders the session and shows the three objects. */
export interface AnchorsCheckScene {
  /** Render `session`; call `onFrame` every XR frame with the local space. */
  start(
    session: XrSessionLike,
    onFrame: (t: number, frame: XrFrameLike, space: unknown) => void
  ): Promise<void>;
  showReticle(pose: Pose | null): void;
  showAnchor(pose: Pose | null): void;
  showMarker(pose: Pose | null): void;
}

export type StartState =
  'checking' | 'unavailable' | 'idle' | 'starting' | 'running';

/** The page side: what the session tells the DOM. */
export interface AnchorsCheckView {
  status(text: string, tone: 'info' | 'error'): void;
  setStartState(state: StartState): void;
  showEvents(events: readonly TrackerEvent[]): void;
}

export interface AnchorsCheckDeps {
  readonly xr: XrSystemLike | undefined;
  readonly overlayRoot: unknown;
  readonly scene: AnchorsCheckScene;
  readonly view: AnchorsCheckView;
  /** `new XRRigidTransform(position, orientation)` for `pose`. */
  readonly makeTransform: (pose: Pose) => unknown;
  readonly environment: Readonly<Record<string, string>>;
  readonly nowIso: () => string;
}

export interface AnchorsCheckController {
  /** Says whether AR can start here, and sets the start button. */
  checkSupport(): Promise<boolean>;
  /** Start AR, or end it when it runs. Call from the click handler. */
  toggle(): Promise<void>;
  /** The full log text, at any time. */
  log(): string;
}

export const MESSAGES = Object.freeze({
  noWebXr:
    'This browser has no WebXR AR. Open this page in Chrome on an Android phone with ARCore.',
  ready: 'Ready. Mark a spot on the floor, then press Start AR.',
  starting: 'Starting AR...',
  aim: 'Aim at the marked spot until the white ring sits on it, then tap.',
  noAnchors:
    'This device or browser did not grant the WebXR anchors feature, so no anchor can be placed. Camera jumps are still logged.',
  placing: 'Placing the anchor...',
  placed:
    'Anchor (green box) and marker (red ring) placed. Walk the loop; jumps are listed below.',
  noHit:
    'No surface under the ring yet. Aim at the floor until the white ring shows, then tap.',
  ended: 'AR ended. The log is kept: press Copy log.',
  frameFailed: 'A frame failed; the check goes on and the log has it:',
});

function toPose(t: XrTransformLike): Pose {
  return {
    position: [t.position.x, t.position.y, t.position.z],
    rotation: [
      t.orientation.x,
      t.orientation.y,
      t.orientation.z,
      t.orientation.w,
    ],
  };
}

/** The camera pose, or `null` while tracking is lost (none, or emulated). */
function cameraPose(frame: XrFrameLike, base: unknown): Pose | null {
  const viewer = frame.getViewerPose(base);
  return viewer && !viewer.emulatedPosition ? toPose(viewer.transform) : null;
}

function hitPose(
  frame: XrFrameLike,
  source: unknown,
  base: unknown
): Pose | null {
  const hit = frame.getHitTestResults(source)[0]?.getPose(base);
  return hit ? toPose(hit.transform) : null;
}

/** Does WebXR still track `anchor`? `null`: no anchor, or not reported. */
function isTracked(frame: XrFrameLike, anchor: XrAnchorLike | null) {
  if (anchor === null || frame.trackedAnchors === undefined) return null;
  return frame.trackedAnchors.has(anchor);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAnchorsCheck(
  deps: AnchorsCheckDeps
): AnchorsCheckController {
  const { view, scene } = deps;
  const environment: Record<string, string> = { ...deps.environment };
  const tracker = createAnchorJumpTracker();
  let session: XrSessionLike | null = null;
  let space: unknown = null;
  let hitSource: unknown = null;
  let lastHit: Pose | null = null;
  let anchor: XrAnchorLike | null = null;
  let anchorPose: Pose | null = null;
  let anchorTracked: boolean | null = null;
  let frameErrors = 0;
  let firstFrameError = '';
  let marker: Pose | null = null;
  let lastT = 0;
  let anchorsUsable = false;
  let frameChecked = false;
  let placing = false;

  function report(events: readonly TrackerEvent[]): void {
    if (events.length > 0) view.showEvents(tracker.snapshot());
  }

  /**
   * The XR frame callback. An exception here would stop three.js's render
   * loop for good, so it is logged and the next frame runs.
   */
  function onFrame(t: number, frame: XrFrameLike, base: unknown): void {
    try {
      frameBody(t, frame, base);
    } catch (error) {
      onFrameError(t, errorText(error));
    }
  }

  function frameBody(t: number, frame: XrFrameLike, base: unknown): void {
    space = base;
    lastT = t;
    if (!frameChecked) {
      checkFrame(frame);
      report(tracker.noteSession('start', t));
    }
    if (hitSource !== null) {
      lastHit = hitPose(frame, hitSource, base);
      scene.showReticle(lastHit);
    }
    const seen =
      anchor === null ? null : frame.getPose(anchor.anchorSpace, base);
    anchorPose = seen ? toPose(seen.transform) : null;
    anchorTracked = anchorPose === null ? null : isTracked(frame, anchor);
    scene.showAnchor(anchorTracked === false ? null : anchorPose);
    report(
      tracker.onFrame({
        t,
        camera: cameraPose(frame, base),
        anchor: anchorPose,
        anchorTracked,
        marker,
      })
    );
  }

  function onFrameError(t: number, message: string): void {
    frameErrors++;
    if (frameErrors === 1) {
      firstFrameError = message;
      report(tracker.noteFrameError(t, message));
      view.status(`${MESSAGES.frameFailed} ${message}`, 'error');
    }
    environment['frame errors'] = `${frameErrors} (first: ${firstFrameError})`;
  }

  /** Once per session: does the frame offer `createAnchor` at all? */
  function checkFrame(frame: XrFrameLike): void {
    frameChecked = true;
    const hasCreate = typeof frame.createAnchor === 'function';
    environment['frame.createAnchor'] = hasCreate ? 'present' : 'missing';
    if (anchorsUsable && !hasCreate) {
      anchorsUsable = false;
      view.status(MESSAGES.noAnchors, 'error');
    }
  }

  function noteFeatures(features: readonly string[] | undefined): void {
    // Without the list (older browsers) the first frame decides by
    // `frame.createAnchor`.
    anchorsUsable = features === undefined || features.includes('anchors');
    environment.enabledFeatures =
      features === undefined ? 'not reported' : features.join(', ');
    environment.anchors =
      features === undefined
        ? 'not reported'
        : anchorsUsable
          ? 'granted'
          : 'not granted';
    frameChecked = false;
  }

  async function place(frame: XrFrameLike): Promise<void> {
    if (!anchorsUsable || frame.createAnchor === undefined) {
      view.status(MESSAGES.noAnchors, 'error');
      return;
    }
    if (placing) return;
    const target = lastHit;
    if (target === null) {
      view.status(MESSAGES.noHit, 'info');
      return;
    }
    placing = true;
    view.status(MESSAGES.placing, 'info');
    const placingIn = session;
    try {
      const created = await frame.createAnchor(
        deps.makeTransform(target),
        space
      );
      if (session !== placingIn) {
        // The session ended while ARCore made the anchor: it is dead.
        created.delete();
        return;
      }
      anchor?.delete();
      anchor = created;
      marker = target;
      scene.showMarker(target);
      report(tracker.notePlaced(lastT, target));
      view.status(MESSAGES.placed, 'info');
    } catch (error) {
      if (session !== placingIn) return;
      report(tracker.noteAnchorFailed(lastT, errorText(error)));
      view.status(`Could not create the anchor: ${errorText(error)}`, 'error');
    } finally {
      placing = false;
    }
  }

  function onEnd(): void {
    session = null;
    hitSource = null;
    scene.showReticle(null);
    // An anchor dies with its session; a restart begins with a new tap.
    anchor = null;
    anchorPose = null;
    anchorTracked = null;
    marker = null;
    scene.showAnchor(null);
    scene.showMarker(null);
    tracker.noteSession('end', lastT);
    view.showEvents(tracker.events());
    view.setStartState('idle');
    view.status(MESSAGES.ended, 'info');
  }

  async function start(xr: XrSystemLike): Promise<void> {
    view.setStartState('starting');
    view.status(MESSAGES.starting, 'info');
    let started: XrSessionLike;
    try {
      // First await of the click: the request must keep the user gesture.
      started = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['anchors', 'dom-overlay'],
        domOverlay: { root: deps.overlayRoot },
      });
    } catch (error) {
      view.setStartState('idle');
      view.status(`Could not start AR: ${errorText(error)}`, 'error');
      return;
    }
    session = started;
    noteFeatures(started.enabledFeatures);
    started.addEventListener('end', onEnd);
    started.addEventListener('select', (event) => void place(event.frame));
    try {
      const viewer = await started.requestReferenceSpace('viewer');
      hitSource =
        (await started.requestHitTestSource?.({ space: viewer })) ?? null;
      await scene.start(started, onFrame);
    } catch (error) {
      // End first: its 'end' handler resets the page, then the cause shows.
      await started.end().catch(() => undefined);
      view.status(`Could not start AR: ${errorText(error)}`, 'error');
      return;
    }
    view.setStartState('running');
    view.status(
      anchorsUsable ? MESSAGES.aim : MESSAGES.noAnchors,
      anchorsUsable ? 'info' : 'error'
    );
  }

  return {
    async checkSupport() {
      const supported =
        deps.xr !== undefined &&
        (await deps.xr.isSessionSupported('immersive-ar').catch(() => false));
      environment['immersive-ar'] = supported ? 'supported' : 'not supported';
      view.setStartState(supported ? 'idle' : 'unavailable');
      view.status(
        supported ? MESSAGES.ready : MESSAGES.noWebXr,
        supported ? 'info' : 'error'
      );
      return supported;
    },
    async toggle() {
      if (session !== null) {
        await session.end().catch(() => undefined);
        return;
      }
      if (deps.xr !== undefined) await start(deps.xr);
    },
    log() {
      return buildLog({
        nowIso: deps.nowIso(),
        environment,
        events: tracker.snapshot(),
        stats: tracker.stats(),
        anchorNow: anchorPose,
        anchorNowTracked: anchorTracked,
        markerNow: marker,
      });
    },
  };
}
