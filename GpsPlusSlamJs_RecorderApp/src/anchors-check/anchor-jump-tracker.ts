/**
 * Per-frame logic of the WebXR anchors check page. It detects camera jumps
 * (a step the motion compensation cannot explain), tracking losses and long
 * frame gaps, computes the jump transform `D` of each, reads the anchor at
 * fixed delays after it and gives the verdict per reading (does the anchor
 * follow `D`, or keep its coordinates).
 *
 * The counted verdict is conservative by construction: an episode counts
 * only when its data prove a correction and leave no doubt that `D` is that
 * correction, not the camera's own motion or an extrapolation error. The
 * on-screen count may miss real episodes but must never be wrong; the full
 * log keeps every episode with its data and stays the authoritative source
 * for re-judging offline.
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
 * is counted only when the camera moved at most this fast over the
 * `STILL_WINDOW_MS` before it: otherwise its `D` is mostly the walker's own
 * motion. A speed, not a step per frame, so the rule is the same at 30 and
 * 60 Hz.
 */
export const STILL_SPEED_M_PER_S = 0.3;
/** The same for the rotation. */
export const STILL_TURN_DEG_PER_S = 20;
/** The shortest run of tracked frames the stillness is measured over. */
export const STILL_WINDOW_MS = 100;
/**
 * A compensated jump is counted only when its frame interval is at most
 * this many times the one before: over a longer frame the extrapolation
 * error of an ordinary acceleration alone can pass the jump limits.
 */
export const MAX_EXTRAPOLATION_RATIO = 1.5;
/**
 * A compensated jump is counted only when the rate frame was itself
 * extrapolated well: its own unexplained step under this fraction of the
 * jump limits. A rate that held a correction (or had no rate of its own)
 * carries that correction into the jump.
 */
export const STEADY_RATE_FRACTION = 0.5;
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

/**
 * An uncompensated episode is counted only when the camera's motion before
 * it, carried on over the episode, moves the anchor by less than this:
 * half the main tolerance, so the motion alone cannot decide the verdict.
 */
export const STILL_DISPLACEMENT_M = VERDICT_TOLERANCES.main.positionM / 2;

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

/** The camera's motion over the frames before an episode. */
export interface Stillness {
  /** From the window's first frame to `cameraBefore`. */
  readonly spanMs: number;
  /** The window's net step over its span. */
  readonly speedMPerS: number;
  readonly turnDegPerS: number;
  /** `cameraBefore` to the tracked anchor before; 0 when none. */
  readonly anchorDistanceM: number;
  /** `(speed + turn * anchorDistance) * dtMs`: that motion's shift at the anchor. */
  readonly displacementM: number;
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
 * Why a closed episode's verdict is not counted:
 * - `no correction`: uncompensated with a raw step at most
 *   `JUMP_TRANSLATION_M` (nothing shows that a correction happened);
 * - `moving`: uncompensated and the camera not shown still before it;
 * - `unsteady rate`: compensated, but the rate frame's own unexplained step
 *   is unknown or over `STEADY_RATE_FRACTION` of the jump limits;
 * - `long frame`: compensated over more than `MAX_EXTRAPOLATION_RATIO`
 *   frame intervals.
 */
export type NotCounted =
  'no correction' | 'moving' | 'unsteady rate' | 'long frame';

/** A jump, a tracking loss or a frame gap, with its anchor readings. */
export interface EpisodeEvent {
  readonly kind: EpisodeKind;
  /** 1-based, counted per kind. */
  readonly index: number;
  readonly t: number;
  /** Time since the last tracked frame (the loss or gap length). */
  readonly dtMs: number;
  /** The rate frame of a compensated jump; `null`: uncompensated. */
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
  /**
   * How well the rate frame was itself extrapolated (its own unexplained
   * step); `null` when it had no rate, or the episode is uncompensated.
   */
  readonly rateUnexplainedStep: PoseStep | null;
  /** The motion before the episode; `null` under `STILL_WINDOW_MS` of it. */
  readonly stillness: Stillness | null;
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

export type ErrorKind = 'frame-error' | 'anchor-read-error';

interface NoteEvent {
  readonly kind: 'anchor-failed' | ErrorKind;
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
  /**
   * The unexplained step: the noise floor, over frames with a steady rate
   * frame that are no jump themselves.
   */
  readonly unexplainedM: readonly number[];
  readonly unexplainedDeg: readonly number[];
}

export interface AnchorJumpTracker {
  /** Feed one frame; returns the events that closed in it. */
  onFrame(sample: FrameSample): readonly TrackerEvent[];
  /** A new anchor and marker were placed at `pose`. */
  notePlaced(t: number, pose: Pose): readonly TrackerEvent[];
  noteAnchorFailed(t: number, message: string): readonly TrackerEvent[];
  /** A frame, or the anchor read alone, threw. */
  noteError(
    kind: ErrorKind,
    t: number,
    message: string
  ): readonly TrackerEvent[];
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

function isSteady(step: PoseStep | null): boolean {
  return (
    step !== null &&
    step.translationM < JUMP_TRANSLATION_M * STEADY_RATE_FRACTION &&
    step.rotationDeg < JUMP_ROTATION_DEG * STEADY_RATE_FRACTION
  );
}

/**
 * The camera's motion over `window` (tracked frames ending at the frame
 * before the episode), and what it moves the anchor over `dtMs`. `null`
 * when the window spans under `STILL_WINDOW_MS`.
 */
function stillness(
  window: readonly TimedPose[],
  anchor: Pose | null,
  dtMs: number
): Stillness | null {
  const first = window[0];
  const end = window.at(-1);
  if (first === undefined || end === undefined) return null;
  const spanMs = end.t - first.t;
  if (!(spanMs >= STILL_WINDOW_MS)) return null;
  const step = poseStep(first.pose, end.pose);
  const speedMPerS = step.translationM / (spanMs / 1000);
  const turnDegPerS = step.rotationDeg / (spanMs / 1000);
  const anchorDistanceM =
    anchor === null ? 0 : poseStep(end.pose, anchor).translationM;
  return {
    spanMs,
    speedMPerS,
    turnDegPerS,
    anchorDistanceM,
    displacementM:
      (speedMPerS + (turnDegPerS / RAD_TO_DEG) * anchorDistanceM) *
      (dtMs / 1000),
  };
}

/** Within every stillness limit; unknown (or NaN): no. */
function isStill(s: Stillness | null): boolean {
  return (
    s !== null &&
    s.speedMPerS <= STILL_SPEED_M_PER_S &&
    s.turnDegPerS <= STILL_TURN_DEG_PER_S &&
    s.displacementM < STILL_DISPLACEMENT_M
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

/**
 * `D` in the raw WebXR frame (the framework computes it in NUE): motion
 * compensated from `rate` when given, else the raw step. Mode `'always'`:
 * the rate is the frame just before, one frame interval back, and the
 * counting rules here (steady rate, extrapolation ratio) judge it, not the
 * framework's guard, which needs a baseline of
 * `COMPENSATION_BASELINE_MS` and would leave every per-frame rate raw.
 */
function jumpAt(
  t: number,
  before: TimedPose,
  rate: TimedPose | null,
  camera: Pose
): Pose {
  const d = jumpTransform(
    {
      t,
      tLast: before.t,
      lastPose: before.pose,
      tPrev: rate?.t ?? null,
      prevPose: rate?.pose ?? null,
      newPose: camera,
    },
    'always'
  );
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

/** The last tracked frame before an episode, as the tracker saw it. */
interface FrameBefore {
  readonly before: TimedPose;
  readonly seen: Seen;
}

/** The episode frame's raw inputs. */
interface EpisodeInput {
  readonly kind: EpisodeKind;
  readonly at: { readonly t: number; readonly marker: Pose | null };
  readonly from: FrameBefore;
  readonly camera: Pose;
  readonly now: Seen;
  readonly d: Pose;
  /** The rate frame; `null`: uncompensated. */
  readonly rate: TimedPose | null;
  readonly rateUnexplained: PoseStep | null;
}

/** The counting rule; see `NotCounted`. */
function notCountedOf(
  input: EpisodeInput,
  cameraStep: PoseStep,
  still: Stillness | null
): NotCounted | null {
  const { rate, from, at } = input;
  if (rate === null) {
    if (!(cameraStep.translationM > JUMP_TRANSLATION_M)) return 'no correction';
    return isStill(still) ? null : 'moving';
  }
  if (!isSteady(input.rateUnexplained)) return 'unsteady rate';
  const ratio = (at.t - from.before.t) / (from.before.t - rate.t);
  return ratio > MAX_EXTRAPOLATION_RATIO ? 'long frame' : null;
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
  /** `last`'s own unexplained step; `null` when it had no rate. */
  let lastUnexplained: PoseStep | null = null;
  let lastSeen: Seen = { anchor: null, tracked: null };
  /**
   * The tracked frames up to `last` since the last loss, gap or start,
   * trimmed to just over `STILL_WINDOW_MS`: the stillness window.
   */
  let recent: TimedPose[] = [];
  let lost: FrameBefore | null = null;
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
    const { at, from, camera, d } = input;
    const { before, seen } = from;
    const dtMs = at.t - before.t;
    const cameraStep = poseStep(before.pose, camera);
    const unexplainedStep = poseStep(
      composeRigid(invertRigid(d), camera),
      camera
    );
    const usable = judged(seen.anchor, seen.tracked);
    const still = stillness(recent, usable, dtMs);
    counts[input.kind]++;
    const p: Pending = {
      base: {
        kind: input.kind,
        index: counts[input.kind],
        t: at.t,
        dtMs,
        cameraPrev: input.rate,
        cameraBefore: before,
        cameraAfter: camera,
        cameraStep,
        compensated: input.rate !== null,
        unexplainedStep,
        rateUnexplainedStep: input.rateUnexplained,
        stillness: still,
        notCounted: notCountedOf(input, cameraStep, still),
        stepClass: classifyStep(unexplainedStep),
        d,
        anchorBefore: seen.anchor,
        anchorBeforeTracked: seen.tracked,
        predicted: usable === null ? null : composeRigid(d, usable),
        marker: at.marker,
      },
      readings: [],
    };
    p.readings.push(reading(p, 0, 0, input.now));
    pending = p;
  }

  /** A loss, a gap or a jump with no rate: `D` is the raw step. */
  function openUncompensated(
    kind: EpisodeKind,
    at: FrameSample,
    from: FrameBefore,
    camera: Pose,
    now: Seen,
    out: TrackerEvent[]
  ): void {
    const d = jumpAt(at.t, from.before, null, camera);
    const input = { kind, at, from, camera, now, d };
    openEpisode({ ...input, rate: null, rateUnexplained: null }, out);
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
    rate: TimedPose | null,
    unexplained: PoseStep | null
  ) {
    prev = rate;
    last = { t, pose: camera };
    lastSeen = seen;
    lastUnexplained = unexplained;
    recent.push(last);
    while (recent.length > 1 && t - recent[1]!.t >= STILL_WINDOW_MS)
      recent.shift();
  }

  /** The first frame of a new run of tracked frames: no rate, no window. */
  function restart(t: number, camera: Pose, seen: Seen): void {
    recent = [];
    advance(t, camera, seen, null, null);
  }

  function resetFrames(): void {
    prev = null;
    last = null;
    lastUnexplained = null;
    lastSeen = { anchor: null, tracked: null };
    recent = [];
    lost = null;
  }

  function onLost(out: TrackerEvent[]): void {
    lostFrames++;
    if (lost !== null || last === null) return;
    closePending(out);
    lost = { before: last, seen: lastSeen };
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
      openUncompensated('tracking-loss', sample, from, camera, seen, out);
      return restart(sample.t, camera, seen);
    }
    if (last === null) return restart(sample.t, camera, seen);
    const from: FrameBefore = { before: last, seen: lastSeen };
    const dt = sample.t - last.t;
    if (!(dt > 0)) {
      frames--;
      return;
    }
    if (dt > FRAME_GAP_MS) {
      openUncompensated('frame-gap', sample, from, camera, seen, out);
      return restart(sample.t, camera, seen);
    }
    const step = poseStep(last.pose, camera);
    stats.dtMs.push(dt);
    stats.translationM.push(step.translationM);
    stats.rotationDeg.push(step.rotationDeg);
    // Without a rate (the first frame after a start, a loss or a gap) only
    // the raw step is known; one over the limits is logged, uncompensated.
    // Either way the frame is the next one's rate: steady motion (a quick
    // turn) is then explained, and the echo of a jump has an unsteady rate.
    if (prev === null) {
      if (isJump(step))
        openUncompensated('jump', sample, from, camera, seen, out);
      else settle(sample.t, seen, out);
      return advance(sample.t, camera, seen, last, null);
    }
    const rate = prev;
    const d = jumpAt(sample.t, last, rate, camera);
    const unexplained = poseStep(composeRigid(invertRigid(d), camera), camera);
    const steady = isSteady(lastUnexplained);
    if (!isJump(unexplained)) {
      if (steady) {
        stats.unexplainedM.push(unexplained.translationM);
        stats.unexplainedDeg.push(unexplained.rotationDeg);
      }
      settle(sample.t, seen, out);
      return advance(sample.t, camera, seen, last, unexplained);
    }
    const input = {
      kind: 'jump' as const,
      at: sample,
      from,
      camera,
      now: seen,
    };
    openEpisode({ ...input, d, rate, rateUnexplained: lastUnexplained }, out);
    // After a jump on a steady rate, the frame before it is carried into the
    // new frame by D: the next rate is the camera's own speed, not the jump.
    // An unsteady rate may itself hold a jump, so D is not trusted to carry.
    const carried = { t: last.t, pose: composeRigid(d, last.pose) };
    advance(sample.t, camera, seen, steady ? carried : last, unexplained);
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
      if (lost !== null) lost = { ...lost, seen: lastSeen };
      out.push({ kind: 'placed', t, pose });
      return record(out);
    },
    noteAnchorFailed: (t, message) =>
      record([{ kind: 'anchor-failed', t, message }]),
    noteError: (kind, t, message) => record([{ kind, t, message }]),
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
