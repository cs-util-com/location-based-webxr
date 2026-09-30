/**
 * `tourAuthoring/*` - actions the creator setup dispatches to be RECORDED,
 * and for nothing else (authoring recording plan 2026-09-28-0953, M1a).
 *
 * The creator's work (placed objects, the measured code, the finish) lives
 * in the page's session object, not in Redux, so a troubleshooting recording
 * could not see it. These actions put each of those moments into the action
 * stream WITH the raw inputs it was computed from - the reticle in odometry,
 * the alignment used, the code's fused pose - so a recording can answer "why
 * did this note end up there?" afterwards.
 *
 * NO REDUCER, on purpose, like the framework's `diagnostics/note`: no slice
 * reads them, so dispatching one changes no state, and the recording is the
 * only place they exist. A reducer added later would make them ambiguous (is
 * the recording the record, or is the state?).
 *
 * Built without RTK's `createAction` only because this package does not
 * depend on `@reduxjs/toolkit` directly; the creators carry `type` the same
 * way, so the persisted prefix is derived from them (`slicePrefixOf`), never
 * typed a second time.
 *
 * @see tour-authoring-actions.ts.md
 */

import type { selectAlignmentMatrix } from "gps-plus-slam-app-framework/state";
import type { MintAlignmentInfo } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { CorrectionRefusal, SettleBasis } from "./visit-settle.js";

/** The store's alignment matrix (the library's tuple), or null. */
export type AlignmentMatrix = ReturnType<typeof selectAlignmentMatrix>;

/** An action creator that also names its type, as RTK's do. */
export interface LogActionCreator<T extends string, P> {
  (payload: P): { type: T; payload: P };
  readonly type: T;
}

export function logAction<P>() {
  return <T extends string>(type: T): LogActionCreator<T, P> =>
    Object.assign((payload: P) => ({ type, payload }), { type });
}

/** The code the camera saw last, as its fused pose evaluation stood. */
interface CodeInViewLog {
  readonly text: string;
  readonly status: "unknown" | "measuring" | "stable";
  /** Raw WebXR odometry; null until the evaluation produced one. */
  readonly pose: Pose | null;
}

interface ObjectPlacedLog {
  /** The record exactly as the manifest will carry it. */
  readonly object: TourObject;
  /** AR sessions ended before this one (0 = the page's first AR visit). */
  readonly arVisitIndex: number;
  /** Epoch ms of the tap that placed it. */
  readonly atMs: number;
  /** A pin: the reticle in the world group's local frame (NUE odometry). */
  readonly reticleOdomNue: readonly [number, number, number] | null;
  /** A photo: the pose the frame was captured at (raw WebXR odometry). */
  readonly cameraOdomPose: Pose | null;
  /** The store's alignment at the tap (the solve's target). */
  readonly alignmentMatrix: AlignmentMatrix;
  /** A pin: the world group's matrix its world position was actually read
   *  through - the lerped one, which can trail the target. */
  readonly arWorldGroupMatrix: readonly number[] | null;
  readonly code: CodeInViewLog | null;
  /** The anchor code's printed size (m) the setup worked with - what a
   *  code's solved pose, and so any anchoring to it, scales with. Known
   *  even when no code is in view. */
  readonly codeSizeM: number;
}

interface CodeMeasuredLog {
  readonly levelId: string;
  readonly text: string;
  /** The stable fused pose the level was minted from (raw WebXR odometry). */
  readonly fusedOdomPose: Pose;
  readonly sizeM: number;
  readonly alignmentMatrix: AlignmentMatrix;
  readonly alignment: MintAlignmentInfo;
  /** The level as it will be written into the zip. */
  readonly levelJson: string;
  readonly arVisitIndex: number;
  readonly atMs: number;
  /** What the measurement became (D10b, `measurementRole`): the code's
   *  reference (`measurement`), or a sighting that kept the stored pose in
   *  hand (`level-in-hand`) or the hosted zip's (`hosted-level`). The
   *  setup always sets it; absent in recordings made before it existed. */
  readonly kept?: "measurement" | "level-in-hand" | "hosted-level";
  /** The stored pose this measurement deliberately REPLACED, when the
   *  creator confirmed "Re-measure the code (replace its saved position)"
   *  (authoring plan 2026-09-28-0953 §3.4, M4; M2c review #5). Absent for
   *  every other measurement - those never replace a stored pose. */
  readonly replaced?: { readonly id: string; readonly json: string };
}

/** Where an edit came from: the list on the page, or in AR (a tapped
 *  selection or the overlay's list). */
type EditSurface = "page" | "ar";

/** An object's text changed (plan §3.4, M4). */
interface ObjectEditedLog {
  readonly before: TourObject;
  readonly after: TourObject;
  /** `arSessionGeneration` at the tap (AR visits ended before it). */
  readonly arVisitIndex: number;
  readonly atMs: number;
  readonly surface: EditSurface;
}

/**
 * A pin moved to the reticle (plan §3.4, M4), with the raw inputs its new
 * geo was computed from - the same set a settle records - so a replay can
 * recompute it: the reticle in odometry, the visit's alignment, the
 * alignment actually used (corrected through the code when the visit saw
 * it, D10b) and the sighting behind a correction.
 */
interface ObjectMovedLog {
  readonly before: TourObject;
  readonly after: TourObject;
  readonly arVisitIndex: number;
  readonly atMs: number;
  /** The reticle in the world group's local frame (odometry-NUE). */
  readonly reticleOdomNue: readonly [number, number, number];
  readonly basis: SettleBasis;
  readonly visitAlignment: AlignmentMatrix;
  readonly usedAlignment: readonly number[];
  readonly sighting: {
    readonly text: string;
    readonly levelId: string;
    readonly odomPose: Pose;
  } | null;
  readonly refusedCorrection: CorrectionRefusal | null;
  readonly zero: LatLong;
}

/** An object deleted (plan §3.4, M4). */
interface ObjectDeletedLog {
  readonly object: TourObject;
  /** The open tour's zip (or the last Finish) carried it, so the delete is
   *  a tombstone the Finish applies; otherwise it was only on this device. */
  readonly hosted: boolean;
  readonly arVisitIndex: number;
  readonly atMs: number;
  readonly surface: EditSurface;
}

/**
 * An AR visit's settle (authoring plan 2026-09-28-0953 §3.2, M2c): the geo
 * its objects and its code were recomputed to, and the alignment used. The
 * tap-time geo of `objectPlaced`/`codeMeasured` is what a killed tab keeps;
 * THIS is what the zip carries.
 */
interface VisitSettledLog {
  /** The visit settled (`arSessionGeneration`). */
  readonly arVisitIndex: number;
  readonly atMs: number;
  /** At the session's end, at a Finish while the visit still ran, or a
   *  photo of an already settled visit that landed afterwards. */
  readonly trigger: "visit-end" | "finish" | "late-arrival";
  readonly basis: SettleBasis;
  /** The store's alignment when the settle ran - before the teardown. */
  readonly visitAlignment: AlignmentMatrix;
  /** The alignment the geo was recomputed through: `visitAlignment`, or
   *  it corrected through the code (`basis: "code-corrected"`). */
  readonly usedAlignment: readonly number[];
  /** The code sighting a correction used: this visit's stable fused pose
   *  (raw WebXR odometry) of the level in hand. Null otherwise. */
  readonly sighting: {
    readonly text: string;
    readonly levelId: string;
    readonly odomPose: Pose;
  } | null;
  /** Each settled object's new geo. */
  readonly objects: readonly { readonly id: string; readonly geo: QrGeoPose }[];
  /** The code re-minted through `usedAlignment` when this visit measured
   *  it; null otherwise. */
  readonly level: { readonly id: string; readonly json: string } | null;
  /** The level in hand when the settle ran, before any re-mint: the stored
   *  pose a code correction mapped this visit onto. With `zero`,
   *  `visitAlignment` and `sighting` a replay recomputes a corrected
   *  `usedAlignment` (`correctedAlignment`, `visit-anchoring.ts`). */
  readonly referenceLevel: {
    readonly id: string;
    readonly json: string;
  } | null;
  /** The zero the geo was minted against. */
  readonly zero: LatLong;
  /** A code correction this visit had that the plausibility bound refused
   *  (its size and the bounds; M2c review #2) - the visit then settled
   *  through its plain alignment. Null otherwise. */
  readonly refusedCorrection: CorrectionRefusal | null;
}

interface FinishedLog {
  readonly levelId: string;
  /** The manifest the rebuilt zip carries. */
  readonly manifest: TourManifest;
  readonly atMs: number;
}

export const objectPlaced = logAction<ObjectPlacedLog>()(
  "tourAuthoring/objectPlaced",
);
export const codeMeasured = logAction<CodeMeasuredLog>()(
  "tourAuthoring/codeMeasured",
);
export const visitSettled = logAction<VisitSettledLog>()(
  "tourAuthoring/settled",
);
export const authoringFinished = logAction<FinishedLog>()(
  "tourAuthoring/finished",
);
export const objectEdited = logAction<ObjectEditedLog>()(
  "tourAuthoring/objectEdited",
);
export const objectMoved = logAction<ObjectMovedLog>()(
  "tourAuthoring/objectMoved",
);
export const objectDeleted = logAction<ObjectDeletedLog>()(
  "tourAuthoring/objectDeleted",
);
