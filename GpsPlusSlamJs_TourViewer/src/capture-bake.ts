/**
 * The capture join, baked (scan-pass plan S1, S-D11): when a creator's
 * page opens a recording, replay it ONCE, place each recorded photo
 * through the first settled alignment after it was taken
 * (`createCapturePickTracker`), and return the spots `tour.json` carries
 * as `captureSpots`. A visitor then places those and never downloads or
 * replays the walk. The spots come back in the world (geo poses); the
 * open puts them into stations (`walkAtOpen`, `withWalkPhotos` of
 * `tour-content.ts`, tour editor plan W3).
 *
 * Every decline is the live join's own (`preflightCaptureJoin`,
 * `assessReplayedJoin`), plus two more: no photo file left to show, and no
 * recorded photo that could be placed. A declined bake writes nothing, so
 * the tour keeps the live join, exactly as before S1. A walk that names no
 * photo the tour carries places nothing at all, live or baked: its decline
 * says so (`placesNothing`), and a lean Finish may then leave the walk out
 * (the M4b milestone review #3).
 *
 * @see capture-bake.ts.md
 */

import { replayActions } from "gps-plus-slam-app-framework/state";

import {
  assessReplayedJoin,
  CAPTURE_ACTION,
  computeCaptureGeoJoin,
  createCapturePickTracker,
  type CaptureWorldPose,
  NEWEST_KNOWN_ODOM_COORD_VERSION,
  preflightCaptureJoin,
  type PickTrackerState,
  type ReplayedJoinState,
} from "./capture-geo-join.js";
import type { CaptureSpotsInWorld } from "./tour-content.js";
import type { TourSession } from "./tour-session.js";

export type CaptureBake =
  | { kind: "baked"; spots: CaptureSpotsInWorld }
  | {
      kind: "declined";
      reason: string;
      /** The walk names no recorded photo this tour carries: it places
       *  nothing, whatever its GPS came to. Absent when that is not
       *  known (a decline before the replay) or not so. */
      placesNothing?: true;
    };

/** What the bake reads of a tour session. */
export type CaptureBakeSource = Pick<
  TourSession,
  "loadSessionMeta" | "loadRecordingActions"
> & {
  readonly entries: readonly { filename: string; isImage: boolean }[];
};

export interface CaptureBakeOptions {
  /** Asked before each replay chunk; false stops the bake ("stopped"). */
  readonly shouldContinue?: () => boolean;
  /** The replay's progress, for the Finish's busy line. */
  readonly onChunk?: (done: number, total: number) => void;
  /** The pick tracker's GPS-extent measure (its own option); production
   *  leaves it to the framework's tracker. */
  readonly extentOf?: (state: PickTrackerState) => number;
}

/** Replay the recording and bake its photos' spots, or say why not. */
export async function bakeCaptureSpots(
  source: CaptureBakeSource,
  options: CaptureBakeOptions = {},
): Promise<CaptureBake> {
  const [meta, actions] = await Promise.all([
    source.loadSessionMeta(),
    source.loadRecordingActions(),
  ]);
  if (actions === null) {
    return { kind: "declined", reason: "no recording in this tour" };
  }
  const pre = preflightCaptureJoin(
    meta,
    actions.map((a) => a.type),
  );
  if (!pre.ok) return { kind: "declined", reason: pre.reason };
  const tracker = createCapturePickTracker(
    options.extentOf === undefined ? undefined : { extentOf: options.extentOf },
  );
  let stopped = false;
  const state = (await replayActions(actions, {
    onAction: (action, replayed) => {
      tracker.observe(action, replayed);
    },
    shouldContinue: () => {
      stopped = options.shouldContinue?.() === false;
      return !stopped;
    },
    ...(options.onChunk === undefined ? {} : { onChunk: options.onChunk }),
  })) as unknown as ReplayedJoinState;
  // A stopped replay's state is partial by construction; assessing it
  // would name a wrong reason.
  if (stopped) return { kind: "declined", reason: "stopped" };
  // Only photos the zip carries as images: the live join's decode skips a
  // missing frame, and a spot naming no file would show nothing.
  const images = new Set(
    source.entries.filter((e) => e.isImage).map((e) => e.filename),
  );
  // A walk that names no photo the tour carries places nothing, live or
  // baked - decided before the GPS verdict, which does not change that.
  // "Places nothing" lets a lean Finish drop the walk for good, so only
  // a recording of a known era may say it, and only when it took no photo
  // at all or none of its placed photos is a file of the tour. Photos the
  // replay turned into no spot (a newer era, or captures before the GPS
  // zero) are a decline that keeps the walk (PR #638 review).
  const taken = state.gpsData?.odometryPath.points;
  if (taken !== undefined && !taken.some((p) => images.has(p.imageFile))) {
    // Narrowed, never cast (PR #640 review): a hand-edited string version
    // compares as a number in JavaScript ("3" <= 5).
    const knownEra =
      typeof meta?.odomCoordVersion === "number" &&
      meta.odomCoordVersion <= NEWEST_KNOWN_ODOM_COORD_VERSION;
    const tookPhotos = actions.some((a) => a.type === CAPTURE_ACTION);
    if (!knownEra || (taken.length === 0 && tookPhotos)) {
      return {
        kind: "declined",
        reason: "none of the recorded photos could be placed",
      };
    }
    return {
      kind: "declined",
      reason:
        taken.length === 0
          ? "the recording contains no captured photos"
          : "no recorded photo file in this tour",
      placesNothing: true,
    };
  }
  const verdict = assessReplayedJoin(state);
  if (!verdict.ok) return { kind: "declined", reason: verdict.reason };
  const poses = computeCaptureGeoJoin(state, (file) =>
    tracker.alignmentFor(file),
  ).filter((pose) => images.has(pose.imageFile));
  // One spot per file (tour.json refuses a photo named twice): a file
  // captured again keeps its LAST pose, as the zip keeps its last write.
  const lastPoseOf = new Map(poses.map((pose) => [pose.imageFile, pose]));
  const captures = [...lastPoseOf.values()].map((pose) => ({
    image: pose.imageFile,
    geo: {
      lat: pose.geo.lat,
      lon: pose.geo.lon,
      alt: pose.geo.altitude,
      rotation: pose.rotationNue,
    },
  }));
  if (captures.length === 0) {
    // Photo files the tour carries, none of which the solve could place:
    // the walk names them, so it is not one that places nothing.
    return {
      kind: "declined",
      reason: "none of the recorded photos could be placed",
    };
  }
  return {
    kind: "baked",
    spots: {
      fixes: verdict.quality.pairCount,
      // Null when the fixes reported no accuracy: the visitor's line then
      // omits it, as the live join's does.
      gpsAccuracyMedianM: verdict.quality.gpsAccuracyMedianM,
      captures,
    },
  };
}

/** The baked spots as the join's poses, for the viewer's one placing path.
 *  A spot without a rotation is left out; the bake and a tour's own spots
 *  (`worldCaptureSpots`, minted poses) never yield one. */
export function posesOfCaptureSpots(
  spots: CaptureSpotsInWorld,
): CaptureWorldPose[] {
  return spots.captures.flatMap(({ image, geo }) =>
    geo.rotation === undefined
      ? []
      : [
          {
            imageFile: image,
            geo: { lat: geo.lat, lon: geo.lon, altitude: geo.alt },
            rotationNue: geo.rotation,
          },
        ],
  );
}
