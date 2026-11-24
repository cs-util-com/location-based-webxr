/**
 * Per-frame logic of the WebXR anchors check page. It detects camera jumps
 * (a step the motion compensation cannot explain), tracking losses and long
 * frame gaps, computes the jump transform `D` of each, reads the anchor at
 * fixed delays after it and gives the verdict per reading (does the anchor
 * follow `D`, or keep its coordinates).
 *
 * No DOM, no WebXR objects, no three.js: the page hands in one plain sample
 * per XR frame. Poses are raw WebXR poses (the `local` reference space).
 *
 * Sidecar: `anchor-jump-tracker.ts.md`.
 */

import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  composeRigid,
  invertRigid,
  jumpTransform,
  type RelocalizationJump,
} from 'gps-plus-slam-app-framework/ar/ar-space-correction';
import {
  nueQuaternionToWebXR,
  nueToWebXR,
} from 'gps-plus-slam-app-framework/ar/nue-webxr-conversions';
import { geodesicAngleRad } from 'gps-plus-slam-app-framework/utils/geodesic-angle';

/**
 * A camera step the motion compensation leaves unexplained above this
 * translation is logged as a jump.
 */
export const JUMP_TRANSLATION_M = 0.25;
/** The same for the rotation. */
export const JUMP_ROTATION_DEG = 5;
/** A frame interval above this is a frame gap, never a jump. */
export const FRAME_GAP_MS = 500;
/**
 * An uncompensated episode (a loss, a gap, a jump on a frame with no rate)
 * is counted only when the camera moved at most this fast just before it:
 * otherwise its `D` is mostly the walker's own motion. A speed, not a step
 * per frame, so the rule is the same at 30 and 60 Hz.
 */
export const STILL_SPEED_M_PER_S = 0.3;
/** The same for the rotation. */
export const STILL_TURN_DEG_PER_S = 20;
/**
 * A compensated jump is counted only when its frame interval is at most
 * this many times the one before: over a longer frame the extrapolation
 * error of an ordinary acceleration alone can pass the jump limits.
 */
export const MAX_EXTRAPOLATION_RATIO = 3;
/**
 * Delays after an episode (jump, loss, gap) at which the anchor is read and
 * judged. In ms, not frames, so the window is the same at 30 and 60 Hz. The
 * last reading gives the counted verdict.
 */
export const SETTLE_DELAYS_MS: readonly number[] = Object.freeze([
  100, 300, 1000, 2000,
]);
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
  /** The anchor's pose as `getPose` returned it; `null` when none. */
  readonly anchor: Pose | null;
  /**
   * `frame.trackedAnchors.has(anchor)`; `null` when unknown (no anchor, or
   * the browser has no `trackedAnchors`). A pose with `false` is logged but
   * never judged.
   */
  readonly anchorTracked: boolean | null;
  /** The non-anchored marker; constant once placed. */
  readonly marker: Pose | null;
}

export interface TimedPose {
  readonly t: number;
  readonly pose: Pose;
}

interface AnchorComparison {
  /** The anchor against `D * anchorBefore`. */
  readonly toPredicted: PoseStep;
  /** The anchor against anchorBefore. */
  readonly toBefore: PoseStep;
  readonly verdicts: {
    readonly tight: Verdict;
    readonly main: Verdict;
    readonly loose: Verdict;
  };
}

export interface AnchorReading {
  /** The nominal delay; 0 is the episode frame itself. */
  readonly delayMs: number;
  /** The actual time of the reading after the episode frame. */
  readonly atMs: number;
  readonly anchor: Pose | null;
  readonly tracked: boolean | null;
  /** `null` when either anchor pose is missing or not tracked. */
  readonly comparison: AnchorComparison | null;
}

export type EpisodeKind = 'jump' | 'tracking-loss' | 'frame-gap';

/**
 * Why a closed episode's verdict is not counted: `moving` (uncompensated
 * and the camera not still before it), `long frame` (extrapolated over more
 * than `MAX_EXTRAPOLATION_RATIO` frame intervals).
 */
export type NotCounted = 'moving' | 'long frame';

/** A jump, a tracking loss or a frame gap, with its anchor readings. */
export interface EpisodeEvent {
  readonly kind: EpisodeKind;
  /** 1-based, counted per kind. */
  readonly index: number;
  readonly t: number;
  /** Time since the last tracked frame (the loss or gap length). */
  readonly dtMs: number;
  /**
   * The frame before `cameraBefore`: the rate frame of a compensated jump,
   * and for every episode the step that says whether the camera was still.
   * `null`: none known.
   */
  readonly cameraPrev: TimedPose | null;
  readonly cameraBefore: TimedPose;
  readonly cameraAfter: Pose;
  /** cameraBefore to cameraAfter, raw. */
  readonly cameraStep: PoseStep;
  /**
   * `D` extrapolates the camera's motion (a jump on a frame with a rate);
   * otherwise `D` is the raw step and `unexplainedStep` equals `cameraStep`.
   */
  readonly compensated: boolean;
  /** The step the compensation leaves: extrapolated pose to cameraAfter. */
  readonly unexplainedStep: PoseStep;
  /** Why the verdict is not counted; `null`: counted when judged in full. */
  readonly notCounted: NotCounted | null;
  readonly stepClass: StepClass;
  /** The jump transform in the raw WebXR frame. */
  readonly d: Pose;
  readonly anchorBefore: Pose | null;
  readonly anchorBeforeTracked: boolean | null;
  /** `D * anchorBefore`. */
  readonly predicted: Pose | null;
  readonly marker: Pose | null;
  /** The episode frame (delay 0), then one per reached `SETTLE_DELAYS_MS`. */
  readonly readings: readonly AnchorReading[];
  /** Only in `snapshot()`: still collecting readings. */
  readonly pending: boolean;
  /** Closed before the last delay (a later episode, a placement, the end). */
  readonly truncated: boolean;
}

interface PlacedEvent {
  readonly kind: 'placed';
  readonly t: number;
  readonly pose: Pose;
}

interface NoteEvent {
  readonly kind: 'anchor-failed' | 'frame-error';
  readonly t: number;
  readonly message: string;
}

interface SessionEvent {
  readonly kind: 'session-start' | 'session-end';
  readonly t: number;
}

export type TrackerEvent =
  EpisodeEvent | PlacedEvent | NoteEvent | SessionEvent;

/** Per-frame distributions over every judged frame pair. */
export interface FrameStats {
  readonly frames: number;
  readonly lostFrames: number;
  readonly dtMs: readonly number[];
  readonly translationM: readonly number[];
  readonly rotationDeg: readonly number[];
  /** The unexplained step, for pairs with a known rate. */
  readonly unexplainedM: readonly number[];
  readonly unexplainedDeg: readonly number[];
}

export interface AnchorJumpTracker {
  /** Feed one frame; returns the events that closed in it. */
  onFrame(sample: FrameSample): readonly TrackerEvent[];
  /** A new anchor and marker were placed at `pose`. */
  notePlaced(t: number, pose: Pose): readonly TrackerEvent[];
  noteAnchorFailed(t: number, message: string): readonly TrackerEvent[];
  noteFrameError(t: number, message: string): readonly TrackerEvent[];
  /**
   * A session started or ended: closes a pending episode and resets the
   * frame continuity (the recorded events stay).
   */
  noteSession(what: 'start' | 'end', t: number): readonly TrackerEvent[];
  /** Closed events, in order. */
  events(): readonly TrackerEvent[];
  /** Closed events plus a still-settling episode flagged `pending`. */
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

function isJump(step: PoseStep): boolean {
  return (
    step.translationM > JUMP_TRANSLATION_M ||
    step.rotationDeg > JUMP_ROTATION_DEG
  );
}

export interface StepRate {
  readonly step: PoseStep;
  readonly dtMs: number;
  readonly speedMPerS: number;
  readonly turnDegPerS: number;
}

/** The camera's step from `a` to `b` and its rate; `null` when dt is not a positive finite time. */
export function stepRate(a: TimedPose | null, b: TimedPose): StepRate | null {
  if (a === null) return null;
  const dtMs = b.t - a.t;
  if (!Number.isFinite(dtMs) || !(dtMs > 0)) return null;
  const step = poseStep(a.pose, b.pose);
  return {
    step,
    dtMs,
    speedMPerS: step.translationM / (dtMs / 1000),
    turnDegPerS: step.rotationDeg / (dtMs / 1000),
  };
}

/** Did the camera move within the stillness limits? Unknown: no. */
export function isStill(rate: StepRate | null): boolean {
  return (
    rate !== null &&
    rate.speedMPerS <= STILL_SPEED_M_PER_S &&
    rate.turnDegPerS <= STILL_TURN_DEG_PER_S
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

/** The pose to judge: none when WebXR says the anchor is not tracked. */
function judged(anchor: Pose | null, tracked: boolean | null): Pose | null {
  return tracked === false ? null : anchor;
}

function compare(
  before: Pose | null,
  after: Pose | null,
  predicted: Pose | null
): AnchorComparison | null {
  if (before === null || after === null || predicted === null) return null;
  return {
    toPredicted: poseStep(after, predicted),
    toBefore: poseStep(after, before),
    verdicts: {
      tight: classifyAnchor(before, after, predicted, VERDICT_TOLERANCES.tight),
      main: classifyAnchor(before, after, predicted, VERDICT_TOLERANCES.main),
      loose: classifyAnchor(before, after, predicted, VERDICT_TOLERANCES.loose),
    },
  };
}

/** The jump transform in the raw WebXR frame (the framework computes it in NUE). */
function jumpInWebXr(jump: RelocalizationJump): Pose {
  const d = jumpTransform(jump);
  return {
    position: nueToWebXR(d.position),
    rotation: nueQuaternionToWebXR(d.rotation),
  };
}

interface Seen {
  readonly anchor: Pose | null;
  readonly tracked: boolean | null;
}

interface Pending {
  readonly base: Omit<EpisodeEvent, 'readings' | 'pending' | 'truncated'>;
  readonly readings: AnchorReading[];
}

/** The frame before an uncompensated episode, as the tracker last saw it. */
interface Unrated {
  readonly before: TimedPose;
  readonly rate: TimedPose | null;
  readonly seen: Seen;
}

/** The episode frame's raw inputs. */
interface EpisodeInput {
  readonly kind: EpisodeKind;
  readonly t: number;
  readonly before: TimedPose;
  readonly rate: TimedPose | null;
  readonly camera: Pose;
  readonly d: Pose;
  readonly compensated: boolean;
  readonly notCounted: NotCounted | null;
  readonly anchorBefore: Seen;
  readonly now: Seen;
  readonly marker: Pose | null;
}

export function createAnchorJumpTracker(): AnchorJumpTracker {
  const closed: TrackerEvent[] = [];
  const stats = {
    dtMs: [] as number[],
    translationM: [] as number[],
    rotationDeg: [] as number[],
    unexplainedM: [] as number[],
    unexplainedDeg: [] as number[],
  };
  const counts: Record<EpisodeKind, number> = {
    jump: 0,
    'tracking-loss': 0,
    'frame-gap': 0,
  };
  let frames = 0;
  let lostFrames = 0;
  /** The frame before `last`, for the rate; `null` when no rate is known. */
  let prev: TimedPose | null = null;
  let last: TimedPose | null = null;
  let lastSeen: Seen = { anchor: null, tracked: null };
  let lost: Unrated | null = null;
  /**
   * A frame with no rate whose raw step passed the jump limits: a jump, or
   * just a quick turn. The next frame tells: steady motion extrapolates
   * well from it, while after a jump the extrapolation misses by the jump
   * again.
   */
  let candidate: {
    readonly t: number;
    readonly marker: Pose | null;
    readonly from: Unrated;
    readonly camera: Pose;
    readonly seen: Seen;
  } | null = null;
  let pending: Pending | null = null;

  function finish(p: Pending, isPending: boolean): EpisodeEvent {
    return {
      ...p.base,
      readings: [...p.readings],
      pending: isPending,
      truncated: !isPending && p.readings.length <= SETTLE_DELAYS_MS.length,
    };
  }

  function closePending(out: TrackerEvent[]): void {
    if (pending === null) return;
    out.push(finish(pending, false));
    pending = null;
  }

  function reading(p: Pending, delayMs: number, atMs: number, seen: Seen) {
    const { anchorBefore, anchorBeforeTracked, predicted } = p.base;
    return {
      delayMs,
      atMs,
      anchor: seen.anchor,
      tracked: seen.tracked,
      comparison: compare(
        judged(anchorBefore, anchorBeforeTracked),
        judged(seen.anchor, seen.tracked),
        predicted
      ),
    };
  }

  function openEpisode(input: EpisodeInput, out: TrackerEvent[]): void {
    closePending(out);
    const { before, camera, d } = input;
    const unexplainedStep = poseStep(
      composeRigid(invertRigid(d), camera),
      camera
    );
    const anchorBefore = input.anchorBefore.anchor;
    const usable = judged(anchorBefore, input.anchorBefore.tracked);
    counts[input.kind]++;
    const p: Pending = {
      base: {
        kind: input.kind,
        index: counts[input.kind],
        t: input.t,
        dtMs: input.t - before.t,
        cameraPrev: input.rate,
        cameraBefore: before,
        cameraAfter: camera,
        cameraStep: poseStep(before.pose, camera),
        compensated: input.compensated,
        unexplainedStep,
        notCounted: input.notCounted,
        stepClass: classifyStep(unexplainedStep),
        d,
        anchorBefore,
        anchorBeforeTracked: input.anchorBefore.tracked,
        predicted: usable === null ? null : composeRigid(d, usable),
        marker: input.marker,
      },
      readings: [],
    };
    p.readings.push(reading(p, 0, 0, input.now));
    pending = p;
  }

  /** Take the readings this frame reaches; close the episode after the last. */
  function settle(t: number, seen: Seen, out: TrackerEvent[]): void {
    if (pending === null) return;
    const atMs = t - pending.base.t;
    let next = pending.readings.length - 1;
    while (next < SETTLE_DELAYS_MS.length && atMs >= SETTLE_DELAYS_MS[next]!) {
      pending.readings.push(
        reading(pending, SETTLE_DELAYS_MS[next]!, atMs, seen)
      );
      next++;
    }
    if (next === SETTLE_DELAYS_MS.length) closePending(out);
  }

  function advance(
    t: number,
    camera: Pose,
    seen: Seen,
    rate: TimedPose | null
  ) {
    prev = rate;
    last = { t, pose: camera };
    lastSeen = seen;
  }

  function resetFrames(): void {
    prev = null;
    last = null;
    lastSeen = { anchor: null, tracked: null };
    lost = null;
    candidate = null;
  }

  function onLost(out: TrackerEvent[]): void {
    lostFrames++;
    if (lost !== null || last === null) return;
    closePending(out);
    lost = { before: last, rate: prev, seen: lastSeen };
    candidate = null;
  }

  /**
   * An episode with no usable rate: D is the raw step, so its verdict
   * counts only when the camera was still before it.
   */
  function openUnrated(
    kind: EpisodeKind,
    at: { readonly t: number; readonly marker: Pose | null },
    from: Unrated,
    camera: Pose,
    seen: Seen,
    out: TrackerEvent[]
  ): void {
    const { before, rate } = from;
    const d = jumpInWebXr({
      t: at.t,
      tLast: before.t,
      lastPose: before.pose,
      tPrev: null,
      prevPose: null,
      newPose: camera,
    });
    openEpisode(
      {
        kind,
        t: at.t,
        before,
        rate,
        camera,
        d,
        compensated: false,
        notCounted: isStill(stepRate(rate, before)) ? null : 'moving',
        anchorBefore: from.seen,
        now: seen,
        marker: at.marker,
      },
      out
    );
  }

  function onTracked(
    sample: FrameSample,
    camera: Pose,
    seen: Seen,
    out: TrackerEvent[]
  ): void {
    if (lost !== null) {
      const from = lost;
      lost = null;
      openUnrated('tracking-loss', sample, from, camera, seen, out);
      // The episode frame never becomes a rate: the next frame starts it.
      return advance(sample.t, camera, seen, null);
    }
    if (last === null) return advance(sample.t, camera, seen, null);
    const from: TimedPose = last;
    const dt = sample.t - from.t;
    if (!(dt > 0)) {
      frames--;
      return;
    }
    const unrated: Unrated = { before: from, rate: prev, seen: lastSeen };
    const was = candidate;
    candidate = null;
    if (dt > FRAME_GAP_MS) {
      openUnrated('frame-gap', sample, unrated, camera, seen, out);
      return advance(sample.t, camera, seen, null);
    }
    const step = poseStep(from.pose, camera);
    stats.dtMs.push(dt);
    stats.translationM.push(step.translationM);
    stats.rotationDeg.push(step.rotationDeg);
    // Without a rate (the first frame after a start, a loss or a gap) only
    // the raw step is known, and a quick turn passes the limits too. The
    // frame sets the rate; one over the limits is kept as a candidate.
    if (prev === null) {
      if (isJump(step))
        candidate = {
          t: sample.t,
          marker: sample.marker,
          from: unrated,
          camera,
          seen,
        };
      settle(sample.t, seen, out);
      return advance(sample.t, camera, seen, from);
    }
    const rate: TimedPose = prev;
    const d = jumpInWebXr({
      t: sample.t,
      tLast: from.t,
      lastPose: from.pose,
      tPrev: rate.t,
      prevPose: rate.pose,
      newPose: camera,
    });
    const unexplained = poseStep(composeRigid(invertRigid(d), camera), camera);
    stats.unexplainedM.push(unexplained.translationM);
    stats.unexplainedDeg.push(unexplained.rotationDeg);
    if (!isJump(unexplained)) {
      settle(sample.t, seen, out);
      return advance(sample.t, camera, seen, from);
    }
    if (was !== null) {
      // The candidate was a jump, not motion: this frame only shows it
      // again, inverted, through the rate. It is logged at its own frame,
      // uncompensated, and this frame's step is the camera's own.
      openUnrated('jump', was, was.from, was.camera, was.seen, out);
      settle(sample.t, seen, out);
      return advance(sample.t, camera, seen, from);
    }
    openEpisode(
      {
        kind: 'jump',
        t: sample.t,
        before: from,
        rate,
        camera,
        d,
        compensated: true,
        notCounted:
          dt / (from.t - rate.t) > MAX_EXTRAPOLATION_RATIO
            ? 'long frame'
            : null,
        anchorBefore: lastSeen,
        now: seen,
        marker: sample.marker,
      },
      out
    );
    // The frame before the jump, carried into the new frame by D: the next
    // frame's rate is then the camera's own speed, not the jump.
    advance(sample.t, camera, seen, {
      t: from.t,
      pose: composeRigid(d, from.pose),
    });
  }

  function record(out: TrackerEvent[]): readonly TrackerEvent[] {
    closed.push(...out);
    return out;
  }

  return {
    onFrame(sample) {
      const out: TrackerEvent[] = [];
      frames++;
      const anchor = isFinitePose(sample.anchor) ? sample.anchor : null;
      const seen: Seen = {
        anchor,
        tracked: anchor === null ? null : sample.anchorTracked,
      };
      if (isFinitePose(sample.camera))
        onTracked(sample, sample.camera, seen, out);
      else onLost(out);
      return record(out);
    },
    notePlaced(t, pose) {
      const out: TrackerEvent[] = [];
      closePending(out);
      // The next frame's anchor is a new one: never compare it with the old.
      lastSeen = { anchor: null, tracked: null };
      candidate = null;
      if (lost !== null) lost = { ...lost, seen: lastSeen };
      out.push({ kind: 'placed', t, pose });
      return record(out);
    },
    noteAnchorFailed: (t, message) =>
      record([{ kind: 'anchor-failed', t, message }]),
    noteFrameError: (t, message) =>
      record([{ kind: 'frame-error', t, message }]),
    noteSession(what, t) {
      const out: TrackerEvent[] = [];
      closePending(out);
      resetFrames();
      out.push({ kind: what === 'start' ? 'session-start' : 'session-end', t });
      return record(out);
    },
    events: () => [...closed],
    snapshot: () =>
      pending === null ? [...closed] : [...closed, finish(pending, true)],
    stats: () => ({
      frames,
      lostFrames,
      dtMs: [...stats.dtMs],
      translationM: [...stats.translationM],
      rotationDeg: [...stats.rotationDeg],
      unexplainedM: [...stats.unexplainedM],
      unexplainedDeg: [...stats.unexplainedDeg],
    }),
  };
}
