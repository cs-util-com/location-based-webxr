/**
 * The relocalization feed: watches the raw viewer pose of every XR frame and
 * turns a platform frame switch (an ARCore relocalization) into one raw
 * `relocalizationObserved` observation in the current store.
 *
 * It judges consecutive render-frame camera positions with the jump rule
 * below: a step over 1 m between two frames at most 500 ms apart is a jump;
 * a longer gap cannot be judged and forgets the earlier poses, as do a
 * missing or emulated pose and the host's tracking hooks (`forget`). The
 * observation carries the jump frame's own pose and time and the two frames
 * before it (raw, epoch-ms XR clock), so the correction is derived from raw
 * data only and a replay re-derives it.
 *
 * Never in the way of a recording: every fault inside a frame is caught,
 * logged once and switches the feed off for the rest of the session.
 *
 * Sidecar: `relocalization-feed.ts.md`.
 */
import { compensationVerdict, jumpTransform } from './ar-space-correction';
import { registerXrFrameUpdate } from './xr-frame-loop';
import type { Pose } from './qr/qr-pose';
import {
  relocalizationObserved,
  type RelocalizationObservation,
} from '../state/ar-space-correction-slice';
import { createLogger } from '../utils/logger';

const log = createLogger('ArSpaceCorrection');

/** A position step strictly over this between two frames is a jump, metres. */
export const RELOCALIZATION_JUMP_M = 1;

/** The longest frame interval the jump rule judges, ms. */
export const RELOCALIZATION_MAX_GAP_MS = 500;

/** The jump rule's answer; `cannot-judge` forgets the earlier poses. */
export type RelocalizationJumpVerdict = 'jump' | 'no-jump' | 'cannot-judge';

/**
 * Whether two consecutive RAW render-frame camera positions are a platform
 * jump: `jump` on a 3D distance strictly over `maxStepM`, `cannot-judge`
 * when they are more than {@link RELOCALIZATION_MAX_GAP_MS} apart (at
 * 1.5 m/s walking, 0.5 s is 0.75 m, below the bound; a longer stall could
 * read as a jump), else `no-jump`. `prev` null (the first pose) is `no-jump`.
 *
 * The same rule as the library's `rawPoseJumpVerdict`, kept here until the
 * library exports it.
 *
 * @throws RangeError on a position that is not three finite numbers, a bound
 * that is not positive and finite, or (with `prev`) an interval that is
 * negative or not finite.
 */
export function relocalizationJumpVerdict(
  prev: readonly number[] | null,
  next: readonly number[],
  dtMs: number,
  maxStepM: number = RELOCALIZATION_JUMP_M
): RelocalizationJumpVerdict {
  checkJumpInputs(prev, next, dtMs, maxStepM);
  if (prev === null) return 'no-jump';
  if (dtMs > RELOCALIZATION_MAX_GAP_MS) return 'cannot-judge';
  return Math.hypot(
    next[0]! - prev[0]!,
    next[1]! - prev[1]!,
    next[2]! - prev[2]!
  ) > maxStepM
    ? 'jump'
    : 'no-jump';
}

/** The jump rule's input checks; see {@link relocalizationJumpVerdict}. */
function checkJumpInputs(
  prev: readonly number[] | null,
  next: readonly number[],
  dtMs: number,
  maxStepM: number
): void {
  if (!(maxStepM > 0) || !Number.isFinite(maxStepM)) {
    throw new RangeError(`relocalizationJumpVerdict: bad bound ${maxStepM}`);
  }
  if (prev !== null && !(dtMs >= 0 && Number.isFinite(dtMs))) {
    throw new RangeError(
      `relocalizationJumpVerdict: poses ${dtMs} ms apart; the interval must be finite and not negative`
    );
  }
  const isPosition = (p: readonly number[]) =>
    p.length === 3 && p.every(Number.isFinite);
  if (!isPosition(next) || (prev !== null && !isPosition(prev))) {
    throw new RangeError(
      'relocalizationJumpVerdict: a position is not three finite numbers'
    );
  }
}

/** The store surface the feed dispatches into. */
interface DispatchingStore {
  dispatch(action: ReturnType<typeof relocalizationObserved>): unknown;
}

export interface RelocalizationFeedOptions {
  /**
   * The store to dispatch into, read at each jump, so a store swap (a new
   * recording) needs no call. `null`: the observation is dropped.
   */
  readonly getStore: () => DispatchingStore | null;
  /**
   * Called right before the dispatch: the odometry frame just switched (the
   * QR sighting fold closes its open burst here).
   */
  readonly beforeDispatch?: () => void;
  /** Called after the dispatch, with the observation (a readout). */
  readonly onObserved?: (observation: RelocalizationObservation) => void;
}

export interface RelocalizationFeed {
  /**
   * One render frame: its time (epoch-ms XR clock) and raw camera pose, or
   * `null` when the frame has none (tracking lost, an emulated pose).
   * Never throws.
   */
  frame(t: number, pose: Pose | null): void;
  /** Forget the earlier poses (a tracking loss, recovery or origin reset). */
  forget(): void;
  /** Whether a fault switched the feed off, or it was disposed. */
  isStopped(): boolean;
  /** Stop: later frames are ignored. */
  dispose(): void;
}

interface Stamped {
  readonly t: number;
  readonly pose: Pose;
}

const isFinitePose = (p: Pose): boolean =>
  p.position.length === 3 &&
  p.rotation.length === 4 &&
  p.position.every(Number.isFinite) &&
  p.rotation.every(Number.isFinite);

const copyPose = (p: Pose): Pose => ({
  position: [p.position[0], p.position[1], p.position[2]],
  rotation: [p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]],
});

/** The readout line of one observation: what the jump was and which `D`. */
function describeObservation(o: RelocalizationObservation): string {
  const d = jumpTransform(o);
  const meters = Math.hypot(...d.position);
  const w = Math.min(1, Math.abs(d.rotation[3]));
  const deg = (2 * Math.acos(w) * 180) / Math.PI;
  const v = compensationVerdict(o);
  const motion =
    v.stepM === null || v.turnDeg === null
      ? 'no earlier frame'
      : `camera step ${(v.stepM * 1000).toFixed(1)} mm, turn ${v.turnDeg.toFixed(2)} deg`;
  return (
    `relocalization observed: |D| ${meters.toFixed(3)} m, ${deg.toFixed(2)} deg; ` +
    `compensation ${v.compensated ? 'on' : 'off'} (${v.reason}; ${motion}); ` +
    `frame gap ${(o.t - o.tLast).toFixed(0)} ms`
  );
}

/** A feed fed by the caller; see {@link startRelocalizationFeed} for XR. */
export function createRelocalizationFeed(
  options: RelocalizationFeedOptions
): RelocalizationFeed {
  if (typeof options?.getStore !== 'function') {
    throw new TypeError(
      'createRelocalizationFeed: getStore must be a function'
    );
  }
  let prev: Stamped | null = null;
  let last: Stamped | null = null;
  let stopped = false;

  function forget(): void {
    prev = null;
    last = null;
  }

  function observe(current: Stamped, before: Stamped): void {
    const observation: RelocalizationObservation = {
      t: current.t,
      tLast: before.t,
      lastPose: before.pose,
      tPrev: prev?.t ?? null,
      prevPose: prev?.pose ?? null,
      newPose: current.pose,
    };
    const store = options.getStore();
    if (store === null) {
      log.warn('relocalization observed with no store; not recorded');
      return;
    }
    options.beforeDispatch?.();
    store.dispatch(relocalizationObserved(observation));
    log.info(describeObservation(observation));
    options.onObserved?.(observation);
  }

  function step(t: number, pose: Pose | null): void {
    if (pose === null || !Number.isFinite(t) || !isFinitePose(pose)) {
      forget();
      return;
    }
    const current: Stamped = { t, pose: copyPose(pose) };
    const before = last;
    if (before === null || !(t > before.t)) {
      // The first pose, or a clock that did not advance: start over here.
      prev = null;
      last = current;
      return;
    }
    const verdict = relocalizationJumpVerdict(
      before.pose.position,
      current.pose.position,
      t - before.t
    );
    if (verdict === 'jump') {
      observe(current, before);
      // The earlier frames are in the old frame; the next jump's
      // compensation must not mix the two.
      prev = null;
    } else if (verdict === 'cannot-judge') {
      prev = null;
    } else {
      prev = before;
    }
    last = current;
  }

  return {
    frame(t, pose) {
      if (stopped) return;
      try {
        step(t, pose);
      } catch (error) {
        stopped = true;
        forget();
        log.error(
          `relocalization feed failed and is off for this session: ${String(error)}`
        );
      }
    },
    forget,
    isStopped: () => stopped,
    dispose() {
      stopped = true;
      forget();
    },
  };
}

/** The pose surface of a viewer pose the feed reads. */
interface ViewerPoseLike {
  readonly emulatedPosition?: boolean;
  readonly views: readonly {
    readonly transform: {
      readonly position: { x: number; y: number; z: number };
      readonly orientation: { x: number; y: number; z: number; w: number };
    };
  }[];
}

/** The raw camera pose of a viewer pose; `null` when absent or emulated. */
export function rawCameraPose(viewer: ViewerPoseLike | null): Pose | null {
  if (viewer === null || viewer.emulatedPosition === true) return null;
  const view = viewer.views[0];
  if (view === undefined) return null;
  const { position: p, orientation: q } = view.transform;
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

/**
 * Feed every XR frame's raw viewer pose into a new feed, read with
 * `frame.getViewerPose(referenceSpace)` inside the XR callback, which runs
 * before the frame's image capture and depth sampler. The frame's time is
 * `timeOriginMs + elapsed * 1000`, the clock of the captures' `capturedAt`.
 * The returned feed's `dispose` also unregisters the frame callback.
 */
export function startRelocalizationFeed(
  options: RelocalizationFeedOptions & {
    /** `performance.timeOrigin`; injectable for tests. */
    readonly timeOriginMs?: number;
  }
): RelocalizationFeed {
  const feed = createRelocalizationFeed(options);
  const timeOrigin = options.timeOriginMs ?? performance.timeOrigin;
  const unregister = registerXrFrameUpdate(
    ({ frame, referenceSpace, elapsed }) => {
      if (feed.isStopped()) return;
      let pose: Pose | null;
      try {
        pose = rawCameraPose(frame.getViewerPose(referenceSpace) ?? null);
      } catch (error) {
        log.warn(`viewer pose unreadable; frame skipped: ${String(error)}`);
        pose = null;
      }
      feed.frame(timeOrigin + elapsed * 1000, pose);
    }
  );
  return {
    ...feed,
    dispose() {
      unregister();
      feed.dispose();
    },
  };
}
