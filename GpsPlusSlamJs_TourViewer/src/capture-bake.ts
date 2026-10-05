/**
 * The capture join, baked (scan-pass plan S1, S-D11): at the creator's
 * Finish, replay the tour's recording ONCE, place each recorded photo
 * through the first settled alignment after it was taken
 * (`createCapturePickTracker`), and return the spots `tour.json` carries
 * as `captureSpots`. A visitor then places those and never downloads or
 * replays the walk.
 *
 * Every decline is the live join's own (`preflightCaptureJoin`,
 * `assessReplayedJoin`), plus one more: no photo file left to show. A
 * declined bake writes nothing, so the tour keeps the live join, exactly
 * as before S1.
 *
 * @see capture-bake.ts.md
 */

import type { TourCaptureSpots } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { replayActions } from "gps-plus-slam-app-framework/state";

import {
  assessReplayedJoin,
  computeCaptureGeoJoin,
  createCapturePickTracker,
  type CaptureWorldPose,
  preflightCaptureJoin,
  type PickTrackerState,
  type ReplayedJoinState,
} from "./capture-geo-join.js";
import type { TourSession } from "./tour-session.js";

export type CaptureBake =
  | { kind: "baked"; spots: TourCaptureSpots }
  | { kind: "declined"; reason: string };

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
  const verdict = assessReplayedJoin(state);
  if (!verdict.ok) return { kind: "declined", reason: verdict.reason };
  // Only photos the zip carries as images: the live join's decode skips a
  // missing frame, and a spot naming no file would show nothing.
  const images = new Set(
    source.entries.filter((e) => e.isImage).map((e) => e.filename),
  );
  const captures = computeCaptureGeoJoin(state, (file) =>
    tracker.alignmentFor(file),
  )
    .filter((pose) => images.has(pose.imageFile))
    .map((pose) => ({
      image: pose.imageFile,
      geo: {
        lat: pose.geo.lat,
        lon: pose.geo.lon,
        alt: pose.geo.altitude,
        rotation: pose.rotationNue,
      },
    }));
  if (captures.length === 0) {
    return { kind: "declined", reason: "no recorded photo file in this tour" };
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
 *  A spot without a rotation is left out; the reader never yields one. */
export function posesOfCaptureSpots(
  spots: TourCaptureSpots,
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
