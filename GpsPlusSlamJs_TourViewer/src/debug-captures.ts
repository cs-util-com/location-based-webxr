/**
 * The walk's debug camera captures in the world: replay a tour's
 * recording ONCE, place each camera capture through the first settled
 * alignment after it was taken (`createCapturePickTracker`), and return
 * where each one stands (a geo pose). They are debug data: no station
 * holds them, a visitor never sees them, and no page writes them into
 * the tour. The desktop editor draws them as its debug layer, once the
 * tour has opened (`editor/debug-capture-layer.ts`).
 *
 * Every decline is the join's own (`preflightCaptureJoin`,
 * `assessReplayedJoin`), plus two more: no capture file the tour carries,
 * and none of them could be placed.
 *
 * @see debug-captures.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { replayActions } from "gps-plus-slam-app-framework/state";

import {
  assessReplayedJoin,
  CAPTURE_ACTION,
  computeCaptureGeoJoin,
  createCapturePickTracker,
  NEWEST_KNOWN_ODOM_COORD_VERSION,
  preflightCaptureJoin,
  type PickTrackerState,
  type ReplayedJoinState,
} from "./capture-geo-join.js";
import type { TourSession } from "./tour-session.js";

/** One debug camera capture: its picture's entry and where it stands. */
export interface DebugCapture {
  /** The picture's archive entry name (`loadEntry`), under the folder
   *  the recording sits in (`mytour/images/frame-...` in a re-zipped
   *  tour, where the recording names `images/frame-...`). */
  readonly image: string;
  readonly geo: QrGeoPose;
}

/** The walk's debug camera captures, with what their places rest on. */
export interface DebugCaptures {
  /** The GPS fixes the walk's alignment paired. */
  readonly fixes: number;
  /** Their median accuracy (m); null when the fixes reported none. */
  readonly gpsAccuracyMedianM: number | null;
  /** In capture order, one per file. */
  readonly captures: readonly DebugCapture[];
}

/** The captures placed, or why not. */
export type DebugCapturesRead =
  | { readonly kind: "placed"; readonly captures: DebugCaptures }
  | { readonly kind: "declined"; readonly reason: string };

/** What the join reads of a tour session. */
export type DebugCaptureSource = Pick<
  TourSession,
  "loadSessionMeta" | "loadRecordingActions"
> & {
  readonly entries: readonly { filename: string; isImage: boolean }[];
};

export interface DebugCaptureOptions {
  /** Asked before each replay chunk; false stops the join ("stopped"). */
  readonly shouldContinue?: () => boolean;
  /** The replay's progress, for the page's progress line. */
  readonly onChunk?: (done: number, total: number) => void;
  /** The pick tracker's GPS-extent measure (its own option); production
   *  leaves it to the framework's tracker. */
  readonly extentOf?: (state: PickTrackerState) => number;
}

/**
 * The folder the recording's action stream sits under, with its trailing
 * slash (`""` for a flat zip, `"mytour/"` for a re-zipped folder). A
 * capture's `imageFile` is relative to the recording, so its entry is
 * this folder plus that name. The action entries are found by the
 * framework parser's own rule (an `actions/` path ending `.json`), so this
 * reads the folder of exactly the stream that parser replays.
 */
function recordingFolderOf(entries: DebugCaptureSource["entries"]): string {
  const stream = entries
    .map((e) => e.filename)
    .filter((name) => name.includes("actions/") && name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))[0];
  return stream === undefined
    ? ""
    : stream.slice(0, stream.indexOf("actions/"));
}

/** Replay the recording and place its camera captures, or say why not. */
export async function debugCapturesOf(
  source: DebugCaptureSource,
  options: DebugCaptureOptions = {},
): Promise<DebugCapturesRead> {
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
  // Only captures the zip carries as images: one naming no file would
  // show nothing. Each is looked up under the recording's own folder.
  const folder = recordingFolderOf(source.entries);
  const images = new Set(
    source.entries.filter((e) => e.isImage).map((e) => e.filename),
  );
  const entryOf = (imageFile: string): string => `${folder}${imageFile}`;
  // Decided before the GPS verdict, which does not change it: a walk that
  // names no capture file of the tour shows none, and the reason says
  // which way. "Contains none" only for a recording of a known era that
  // took none: a newer era's replay may show this build none of its
  // captures (PR #638 review), and captures the replay turned into no
  // place (taken before the GPS zero) were taken all the same. The era
  // is NARROWED, never cast (PR #640 review): a hand-edited string
  // version compares as a number in JavaScript ("3" <= 5).
  const taken = state.gpsData?.odometryPath.points;
  if (
    taken !== undefined &&
    !taken.some((p) => images.has(entryOf(p.imageFile)))
  ) {
    const knownEra =
      typeof meta?.odomCoordVersion === "number" &&
      meta.odomCoordVersion <= NEWEST_KNOWN_ODOM_COORD_VERSION;
    const tookAny = actions.some((a) => a.type === CAPTURE_ACTION);
    return {
      kind: "declined",
      reason:
        !knownEra || (taken.length === 0 && tookAny)
          ? "none of the camera captures could be placed"
          : taken.length === 0
            ? "the recording contains no camera captures"
            : "no camera capture file in this tour",
    };
  }
  const verdict = assessReplayedJoin(state);
  if (!verdict.ok) return { kind: "declined", reason: verdict.reason };
  const poses = computeCaptureGeoJoin(state, (file) =>
    tracker.alignmentFor(file),
  ).filter((pose) => images.has(entryOf(pose.imageFile)));
  // One per file: a file captured again keeps its LAST pose, as the zip
  // keeps its last write.
  const lastPoseOf = new Map(poses.map((pose) => [pose.imageFile, pose]));
  const captures = [...lastPoseOf.values()].map((pose) => ({
    image: entryOf(pose.imageFile),
    geo: {
      lat: pose.geo.lat,
      lon: pose.geo.lon,
      alt: pose.geo.altitude,
      rotation: pose.rotationNue,
    },
  }));
  if (captures.length === 0) {
    return {
      kind: "declined",
      reason: "none of the camera captures could be placed",
    };
  }
  return {
    kind: "placed",
    captures: {
      fixes: verdict.quality.pairCount,
      gpsAccuracyMedianM: verdict.quality.gpsAccuracyMedianM,
      captures,
    },
  };
}
