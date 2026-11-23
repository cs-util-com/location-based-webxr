/**
 * Per-frame logic of the WebXR anchors check page: detects camera jumps
 * between consecutive frames, the jump transform `D`, the pose step across
 * tracking losses and long frame gaps, and the verdict per jump (does the
 * anchor follow `D`, or keep its coordinates).
 *
 * No DOM, no WebXR objects, no three.js: the page hands in one plain sample
 * per XR frame. Poses are raw WebXR poses (the `local` reference space).
 *
 * Sidecar: `anchor-jump-tracker.ts.md`.
 */

import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  composeRigid,
  jumpTransform,
  type RelocalizationJump,
} from 'gps-plus-slam-app-framework/ar/ar-space-correction';
import {
  nueQuaternionToWebXR,
  nueToWebXR,
} from 'gps-plus-slam-app-framework/ar/nue-webxr-conversions';
import { geodesicAngleRad } from 'gps-plus-slam-app-framework/utils/geodesic-angle';

/** A camera translation above this between two frames is logged as a jump. */
export const JUMP_TRANSLATION_M = 0.25;
/** A camera rotation above this between two frames is logged as a jump. */
export const JUMP_ROTATION_DEG = 5;
/** A frame interval above this is a "cannot judge" gap, never a jump. */
export const FRAME_GAP_MS = 500;
/** Frames after a jump frame before its settled anchor pose is judged. */
export const SETTLE_FRAMES = 10;
/** Lower edge of the reported band below the relocalization rule. */
export const BAND_LOWER_M = 0.3;
/**
 * The relocalization rule the deferred anchors use (`FRAME_JUMP_THRESHOLD_M`
 * in the framework). Restated here so this module stays free of three.js; a
 * test pins the two equal.
 */
export const RELOCALIZATION_RULE_M = 1;

export interface Tolerance {
  readonly positionM: number;
  readonly rotationDeg: number;
}

/**
 * How close the anchor must come to a prediction for the verdict to name
 * it. `main` drives the on-screen verdict; the log prints all three so a
 * verdict that holds only at one tolerance is visible as such.
 */
export const VERDICT_TOLERANCES: {
  readonly tight: Tolerance;
  readonly main: Tolerance;
  readonly loose: Tolerance;
} = Object.freeze({
  tight: Object.freeze({ positionM: 0.05, rotationDeg: 1.5 }),
  main: Object.freeze({ positionM: 0.1, rotationDeg: 3 }),
  loose: Object.freeze({ positionM: 0.25, rotationDeg: 6 }),
});

export type Verdict = 'frame switch' | 'drift correction' | 'unclear';
export type StepClass =
  'rotation only' | 'under 0.3 m' | '0.3-1 m' | 'at least 1 m';

export interface PoseStep {
  readonly translationM: number;
  readonly rotationDeg: number;
}

/** One XR frame as the page sees it. `null` camera: tracking lost. */
export interface FrameSample {
  readonly t: number;
  readonly camera: Pose | null;
  /** The anchor's pose this frame; `null` when none exists or untracked. */
  readonly anchor: Pose | null;
  /** The non-anchored marker; constant once placed. */
  readonly marker: Pose | null;
}

export interface AnchorComparison {
  readonly anchorAfter: Pose;
  /** anchorAfter against `D * anchorBefore`. */
  readonly toPredicted: PoseStep;
  /** anchorAfter against anchorBefore. */
  readonly toBefore: PoseStep;
  readonly verdicts: {
    readonly tight: Verdict;
    readonly main: Verdict;
    readonly loose: Verdict;
  };
}

export interface JumpEvent {
  readonly kind: 'jump';
  readonly index: number;
  readonly t: number;
  readonly dtMs: number;
  readonly cameraBefore: Pose;
  readonly cameraAfter: Pose;
  readonly cameraStep: PoseStep;
  readonly stepClass: StepClass;
  /** The jump transform in the raw WebXR frame (motion-compensated). */
  readonly d: Pose;
  readonly anchorBefore: Pose | null;
  /** `D * anchorBefore`. */
  readonly predicted: Pose | null;
  readonly marker: Pose | null;
  /** The anchor in the jump frame; `null` when it was not tracked. */
  readonly atJump: AnchorComparison | null;
  /** The anchor `settledFrames` frames later. */
  readonly settled: AnchorComparison | null;
  readonly settledFrames: number;
}

interface TrackingLossEvent {
  readonly kind: 'tracking-loss';
  readonly tLost: number;
  readonly tRecovered: number;
  readonly durationMs: number;
  readonly cameraStep: PoseStep;
  readonly anchorBefore: Pose | null;
  readonly anchorAfter: Pose | null;
  readonly anchorStep: PoseStep | null;
}

interface FrameGapEvent {
  readonly kind: 'frame-gap';
  readonly t: number;
  readonly dtMs: number;
  readonly cameraStep: PoseStep;
  readonly anchorBefore: Pose | null;
  readonly anchorAfter: Pose | null;
  readonly anchorStep: PoseStep | null;
}

interface PlacedEvent {
  readonly kind: 'placed';
  readonly t: number;
  readonly pose: Pose;
}

export type TrackerEvent =
  JumpEvent | TrackingLossEvent | FrameGapEvent | PlacedEvent;

/** Per-frame distributions over every judged frame pair. */
export interface FrameStats {
  readonly frames: number;
  readonly lostFrames: number;
  readonly dtMs: readonly number[];
  readonly translationM: readonly number[];
  readonly rotationDeg: readonly number[];
}

export interface AnchorJumpTracker {
  /** Feed one frame; returns the events that closed in it. */
  onFrame(sample: FrameSample): readonly TrackerEvent[];
  /** A new anchor and marker were placed at `pose`. */
  notePlaced(t: number, pose: Pose): readonly TrackerEvent[];
  /** Close a pending jump with what is known (session end). */
  flush(): readonly TrackerEvent[];
  /** Closed events, in order. */
  events(): readonly TrackerEvent[];
  /** Closed events plus a still-settling jump, without closing it. */
  snapshot(): readonly TrackerEvent[];
  stats(): FrameStats;
}

const RAD_TO_DEG = 180 / Math.PI;

function isFinitePose(p: Pose | null): p is Pose {
  return (
    p !== null &&
    p.position.length === 3 &&
    p.rotation.length === 4 &&
    p.position.every(Number.isFinite) &&
    p.rotation.every(Number.isFinite) &&
    Math.hypot(...p.rotation) > 1e-9
  );
}

function unitRotation(q: Pose['rotation']): Pose['rotation'] {
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Translation and geodesic rotation between two poses. */
export function poseStep(a: Pose, b: Pose): PoseStep {
  return {
    translationM: Math.hypot(
      b.position[0] - a.position[0],
      b.position[1] - a.position[1],
      b.position[2] - a.position[2]
    ),
    rotationDeg:
      geodesicAngleRad(unitRotation(a.rotation), unitRotation(b.rotation)) *
      RAD_TO_DEG,
  };
}

function isClose(step: PoseStep, tol: Tolerance): boolean {
  return (
    step.translationM <= tol.positionM && step.rotationDeg <= tol.rotationDeg
  );
}

/** The size band of a logged camera step. */
export function classifyStep(step: PoseStep): StepClass {
  if (step.translationM >= RELOCALIZATION_RULE_M) return 'at least 1 m';
  if (step.translationM >= BAND_LOWER_M) return '0.3-1 m';
  if (step.translationM <= JUMP_TRANSLATION_M) return 'rotation only';
  return 'under 0.3 m';
}

/**
 * Frame switch when the anchor is close to `D * anchorBefore` only; drift
 * correction when it is close to `anchorBefore` only; otherwise unclear
 * (near neither, or the two predictions too close to tell apart).
 */
export function classifyAnchor(
  anchorBefore: Pose,
  anchorAfter: Pose,
  predicted: Pose,
  tol: Tolerance
): Verdict {
  const followsD = isClose(poseStep(anchorAfter, predicted), tol);
  const stays = isClose(poseStep(anchorAfter, anchorBefore), tol);
  if (followsD && !stays) return 'frame switch';
  if (stays && !followsD) return 'drift correction';
  return 'unclear';
}

function compare(
  before: Pose | null,
  after: Pose | null,
  predicted: Pose | null
): AnchorComparison | null {
  if (before === null || after === null || predicted === null) return null;
  return {
    anchorAfter: after,
    toPredicted: poseStep(after, predicted),
    toBefore: poseStep(after, before),
    verdicts: {
      tight: classifyAnchor(before, after, predicted, VERDICT_TOLERANCES.tight),
      main: classifyAnchor(before, after, predicted, VERDICT_TOLERANCES.main),
      loose: classifyAnchor(before, after, predicted, VERDICT_TOLERANCES.loose),
    },
  };
}

function maybeStep(a: Pose | null, b: Pose | null): PoseStep | null {
  return a !== null && b !== null ? poseStep(a, b) : null;
}

/** The jump transform in the raw WebXR frame (the framework computes it in NUE). */
function jumpInWebXr(jump: RelocalizationJump): Pose {
  const d = jumpTransform(jump);
  return {
    position: nueToWebXR(d.position),
    rotation: nueQuaternionToWebXR(d.rotation),
  };
}

interface Timed {
  readonly t: number;
  readonly camera: Pose;
}

interface Pending {
  readonly event: JumpEvent;
  framesSeen: number;
}

export function createAnchorJumpTracker(): AnchorJumpTracker {
  const closed: TrackerEvent[] = [];
  const dtMs: number[] = [];
  const translationM: number[] = [];
  const rotationDeg: number[] = [];
  let frames = 0;
  let lostFrames = 0;
  let jumpCount = 0;
  let prev: Timed | null = null;
  let last: Timed | null = null;
  let lastAnchor: Pose | null = null;
  let lost: { t: number; camera: Pose; anchor: Pose | null } | null = null;
  let pending: Pending | null = null;

  function close(p: Pending, anchor: Pose | null): JumpEvent {
    return {
      ...p.event,
      settled: compare(p.event.anchorBefore, anchor, p.event.predicted),
      settledFrames: p.framesSeen,
    };
  }

  /** Close the pending jump on the anchor of the latest judged frame. */
  function closePending(out: TrackerEvent[]): void {
    if (pending === null) return;
    out.push(close(pending, lastAnchor));
    pending = null;
  }

  /** Make `sample` the latest judged frame; `keepPrev` false forgets the rate. */
  function advance(
    t: number,
    camera: Pose,
    anchor: Pose | null,
    keepPrev: boolean
  ): void {
    prev = keepPrev ? last : null;
    last = { t, camera };
    lastAnchor = anchor;
  }

  function onLost(out: TrackerEvent[]): void {
    lostFrames++;
    if (lost !== null || last === null) return;
    closePending(out);
    lost = { t: last.t, camera: last.camera, anchor: lastAnchor };
  }

  function onRecovered(
    t: number,
    camera: Pose,
    anchor: Pose | null,
    from: { t: number; camera: Pose; anchor: Pose | null },
    out: TrackerEvent[]
  ): void {
    out.push({
      kind: 'tracking-loss',
      tLost: from.t,
      tRecovered: t,
      durationMs: t - from.t,
      cameraStep: poseStep(from.camera, camera),
      anchorBefore: from.anchor,
      anchorAfter: anchor,
      anchorStep: maybeStep(from.anchor, anchor),
    });
    lost = null;
    advance(t, camera, anchor, false);
  }

  function onGap(
    t: number,
    dt: number,
    camera: Pose,
    step: PoseStep,
    anchor: Pose | null,
    out: TrackerEvent[]
  ): void {
    closePending(out);
    out.push({
      kind: 'frame-gap',
      t,
      dtMs: dt,
      cameraStep: step,
      anchorBefore: lastAnchor,
      anchorAfter: anchor,
      anchorStep: maybeStep(lastAnchor, anchor),
    });
    advance(t, camera, anchor, false);
  }

  /** Count a quiet frame towards the pending jump's settle window. */
  function settle(anchor: Pose | null, out: TrackerEvent[]): void {
    if (pending === null) return;
    pending.framesSeen++;
    if (pending.framesSeen < SETTLE_FRAMES) return;
    out.push(close(pending, anchor));
    pending = null;
  }

  function openJump(
    sample: FrameSample,
    from: Timed,
    camera: Pose,
    dt: number,
    step: PoseStep,
    anchor: Pose | null
  ): void {
    const d = jumpInWebXr({
      t: sample.t,
      tLast: from.t,
      lastPose: from.camera,
      tPrev: prev?.t ?? null,
      prevPose: prev?.camera ?? null,
      newPose: camera,
    });
    const predicted = lastAnchor === null ? null : composeRigid(d, lastAnchor);
    jumpCount++;
    pending = {
      framesSeen: 0,
      event: {
        kind: 'jump',
        index: jumpCount,
        t: sample.t,
        dtMs: dt,
        cameraBefore: from.camera,
        cameraAfter: camera,
        cameraStep: step,
        stepClass: classifyStep(step),
        d,
        anchorBefore: lastAnchor,
        predicted,
        marker: sample.marker,
        atJump: compare(lastAnchor, anchor, predicted),
        settled: null,
        settledFrames: 0,
      },
    };
  }

  function onTracked(
    sample: FrameSample,
    camera: Pose,
    anchor: Pose | null,
    out: TrackerEvent[]
  ): void {
    if (lost !== null) return onRecovered(sample.t, camera, anchor, lost, out);
    if (last === null) return advance(sample.t, camera, anchor, false);
    const from = last;
    const dt = sample.t - from.t;
    if (!(dt > 0)) {
      frames--;
      return;
    }
    const step = poseStep(from.camera, camera);
    if (dt > FRAME_GAP_MS)
      return onGap(sample.t, dt, camera, step, anchor, out);
    dtMs.push(dt);
    translationM.push(step.translationM);
    rotationDeg.push(step.rotationDeg);
    if (
      step.translationM > JUMP_TRANSLATION_M ||
      step.rotationDeg > JUMP_ROTATION_DEG
    ) {
      closePending(out);
      openJump(sample, from, camera, dt, step, anchor);
    } else {
      settle(anchor, out);
    }
    advance(sample.t, camera, anchor, true);
  }

  function onFrame(sample: FrameSample): readonly TrackerEvent[] {
    const out: TrackerEvent[] = [];
    frames++;
    const anchor = isFinitePose(sample.anchor) ? sample.anchor : null;
    if (isFinitePose(sample.camera))
      onTracked(sample, sample.camera, anchor, out);
    else onLost(out);
    closed.push(...out);
    return out;
  }

  return {
    onFrame,
    notePlaced(t, pose) {
      const out: TrackerEvent[] = [];
      closePending(out);
      out.push({ kind: 'placed', t, pose });
      closed.push(...out);
      return out;
    },
    flush() {
      const out: TrackerEvent[] = [];
      closePending(out);
      closed.push(...out);
      return out;
    },
    events: () => [...closed],
    snapshot: () =>
      pending === null ? [...closed] : [...closed, close(pending, lastAnchor)],
    stats: () => ({
      frames,
      lostFrames,
      dtMs: [...dtMs],
      translationM: [...translationM],
      rotationDeg: [...rotationDeg],
    }),
  };
}
