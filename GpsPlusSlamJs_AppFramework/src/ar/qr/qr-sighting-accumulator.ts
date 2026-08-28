/**
 * Folds a stream of QR detections into per-code SIGHTINGS — the bursts of
 * detections that happen each time someone walks up to a printed code.
 *
 * WHY THIS EXISTS. Minting a code's world pose from a whole recording needs
 * every time the code was seen, minutes apart. It cannot read that back from
 * the detection slice: the recorder's ring holds the last 100 entries, which
 * at the default cadence is about twelve seconds, so a three-minute walk with
 * ten sightings has lost every early one by the time the session stops. So
 * the fold happens as detections arrive, and memory stays O(sightings)
 * rather than O(detections).
 *
 * WHAT A SIGHTING IS. A run of detections of the SAME code with no gap longer
 * than `gapMs`. Standing at a poster for a minute is one sighting; walking a
 * loop and coming back is two.
 *
 * THE ODOMETRY FRAME IS PART OF THE MODEL. A tracking restart or a loop
 * closure changes the odometry frame while stored QR poses stay in the old
 * one, so sightings on either side describe different frames. Comparing them
 * would read as a moved poster — or worse, average two frames into a
 * plausible-looking anchor. `noteFrameChange()` closes the open burst and
 * starts a new SEGMENT, and `spansFrameChange()` lets the mint decline.
 *
 * SEE `GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
 * §3 M-B (DEC-3, DEC-4; cold-review blocker 4 and finding 11).
 */

import { aggregateQrPose } from './qr-pose-aggregation.js';
import { interpolatingMedian } from '../../utils/median.js';
import type { Pose } from './qr-pose.js';
import type { LatLong, Matrix4 as AlignmentMatrix } from '../../core/index.js';

/**
 * Longest pause inside one sighting (ms).
 *
 * A guess until the field recordings measure the real distribution of
 * inter-sighting gaps — that measurement is the probe's job. It only has to
 * separate "still looking at it" from "walked a loop and came back", and the
 * planned walks leave ~30 s between visits, so anything from a few seconds
 * upward would do.
 */
export const DEFAULT_SIGHTING_GAP_MS = 4000;

/** Poses kept per burst for the robust aggregate. */
const DEFAULT_MAX_POSES_PER_SIGHTING = 32;

/** One detection, already solved and derived by the caller. */
export interface QrSightingObservation {
  /** The decoded text — the code's identity. */
  readonly text: string;
  /** Epoch ms. */
  readonly timestamp: number;
  /** The solved pose in RAW WebXR/odometry space. */
  readonly odomPose: Pose;
  /** The derived physical side length (m) at this moment. */
  readonly sizeM: number;
  /** The alignment TARGET matrix as it stands NOW (DEC-3). */
  readonly alignmentMatrix: AlignmentMatrix | null;
  /** The session's GPS zero as it stands now. */
  readonly zero: LatLong | null;
  /** GPS fixes solved into the alignment so far. */
  readonly alignmentSampleCount: number;
  /** Median GPS accuracy (m) now, when known. */
  readonly gpsAccuracyM?: number;
}

/** One closed burst. */
export interface QrSighting {
  readonly text: string;
  readonly firstTimestamp: number;
  readonly lastTimestamp: number;
  /** Every detection in the burst, including those beyond the pose cap. */
  readonly detectionCount: number;
  /** How many poses the aggregate actually used. */
  readonly posesUsed: number;
  /** Robust aggregate over the burst, in odometry space. */
  readonly odomPose: Pose;
  readonly translationSpreadM: number;
  readonly rotationSpreadDeg: number;
  readonly sizeM: number;
  readonly sizeSpreadM: number;
  /** Contemporaneous state, as of the burst's LAST detection (DEC-3). */
  readonly alignmentMatrix: AlignmentMatrix | null;
  readonly zero: LatLong | null;
  readonly alignmentSampleCount: number;
  readonly gpsAccuracyM?: number;
  /** Odometry-frame segment; sightings with different segments are not
   *  comparable. */
  readonly segment: number;
}

export interface QrSightingAccumulatorOptions {
  gapMs?: number;
  maxPosesPerSighting?: number;
}

export interface QrSightingAccumulator {
  /** Fold one detection in. Non-finite poses are ignored. */
  observe(observation: QrSightingObservation): void;
  /** The odometry frame changed — close open bursts, start a new segment. */
  noteFrameChange(): void;
  /**
   * Every sighting INCLUDING the visit in progress, without closing it.
   *
   * This is what a mint should read. `flush()` mutates: it ends the open
   * burst, so the next detection starts a new one — and since the mint runs
   * on every 60-second crash-safety sync, a sync landing mid-visit would
   * split one visit into two. Under recency weighting both halves would then
   * carry near-maximum weight, double-counting a single viewpoint.
   */
  sightingsIncludingOpen(text: string): readonly QrSighting[];
  /** Close every open burst. Idempotent. Prefer
   *  {@link QrSightingAccumulator.sightingsIncludingOpen} for reading. */
  flush(): void;
  /** Closed sightings for one code, oldest first. */
  sightings(text: string): readonly QrSighting[];
  /** Every code seen so far. */
  codes(): readonly string[];
  /** Whether this code's sightings straddle a frame change. */
  spansFrameChange(text: string): boolean;
  /** Is a visit to this code in progress right now? */
  hasOpenBurst(text: string): boolean;
  reset(): void;
}

interface OpenBurst {
  first: number;
  last: number;
  detectionCount: number;
  poses: Pose[];
  sizes: number[];
  segment: number;
  tail: QrSightingObservation;
}

function isFinitePose(pose: Pose): boolean {
  return (
    pose.position.every((v) => Number.isFinite(v)) &&
    pose.rotation.every((v) => Number.isFinite(v))
  );
}

export function createQrSightingAccumulator(
  options: QrSightingAccumulatorOptions = {}
): QrSightingAccumulator {
  const gapMs = options.gapMs ?? DEFAULT_SIGHTING_GAP_MS;
  const maxPoses =
    options.maxPosesPerSighting ?? DEFAULT_MAX_POSES_PER_SIGHTING;

  const open = new Map<string, OpenBurst>();
  const closed = new Map<string, QrSighting[]>();
  let segment = 0;

  /** Build the closed sighting a burst would become, without ending it. */
  function summarize(text: string, burst: OpenBurst): QrSighting | null {
    const aggregate = aggregateQrPose(burst.poses);
    if (aggregate === null) return null;
    const sizes = [...burst.sizes].sort((a, b) => a - b);
    return {
      text,
      firstTimestamp: burst.first,
      lastTimestamp: burst.last,
      detectionCount: burst.detectionCount,
      posesUsed: burst.poses.length,
      odomPose: aggregate.pose,
      translationSpreadM: aggregate.translationSpreadM,
      rotationSpreadDeg: aggregate.rotationSpreadDeg,
      sizeM: interpolatingMedian(sizes),
      sizeSpreadM:
        sizes.length === 0 ? 0 : (sizes.at(-1) ?? 0) - (sizes[0] ?? 0),
      alignmentMatrix: burst.tail.alignmentMatrix,
      zero: burst.tail.zero,
      alignmentSampleCount: burst.tail.alignmentSampleCount,
      ...(burst.tail.gpsAccuracyM !== undefined
        ? { gpsAccuracyM: burst.tail.gpsAccuracyM }
        : {}),
      segment: burst.segment,
    };
  }

  function close(text: string): void {
    const burst = open.get(text);
    open.delete(text);
    if (burst === undefined) return;
    const sighting = summarize(text, burst);
    if (sighting === null) return; // no usable pose in the burst
    const list = closed.get(text) ?? [];
    list.push(sighting);
    closed.set(text, list);
  }

  return {
    observe(observation) {
      if (
        !Number.isFinite(observation.timestamp) ||
        !Number.isFinite(observation.sizeM) ||
        !isFinitePose(observation.odomPose)
      ) {
        return;
      }
      const current = open.get(observation.text);
      if (
        current !== undefined &&
        observation.timestamp - current.last > gapMs
      ) {
        close(observation.text);
      }
      const burst = open.get(observation.text);
      if (burst === undefined) {
        open.set(observation.text, {
          first: observation.timestamp,
          last: observation.timestamp,
          detectionCount: 1,
          poses: [observation.odomPose],
          sizes: [observation.sizeM],
          segment,
          tail: observation,
        });
        return;
      }
      burst.last = observation.timestamp;
      burst.detectionCount += 1;
      burst.tail = observation;
      // Keep the most RECENT poses: within one burst the later frames are
      // taken from more viewpoints, and the size estimate has converged
      // further by then.
      burst.poses.push(observation.odomPose);
      if (burst.poses.length > maxPoses) burst.poses.shift();
      burst.sizes.push(observation.sizeM);
      if (burst.sizes.length > maxPoses) burst.sizes.shift();
    },

    noteFrameChange() {
      for (const text of [...open.keys()]) close(text);
      segment += 1;
    },

    flush() {
      for (const text of [...open.keys()]) close(text);
    },

    sightings: (text) => closed.get(text) ?? [],

    sightingsIncludingOpen(text) {
      const list = closed.get(text) ?? [];
      const burst = open.get(text);
      if (burst === undefined) return list;
      const pending = summarize(text, burst);
      return pending === null ? list : [...list, pending];
    },

    codes: () => [...new Set([...closed.keys(), ...open.keys()])],

    hasOpenBurst: (text) => open.has(text),

    spansFrameChange(text) {
      const list = closed.get(text) ?? [];
      const openSegment = open.get(text)?.segment;
      const segments = new Set(list.map((s) => s.segment));
      if (openSegment !== undefined) segments.add(openSegment);
      return segments.size > 1;
    },

    reset() {
      open.clear();
      closed.clear();
      segment = 0;
    },
  };
}
