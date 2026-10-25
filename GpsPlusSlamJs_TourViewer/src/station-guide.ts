/**
 * The visitor's stations in AR (tour kit plan K4, §4.2, K-D6, K-D9): runs
 * the station run (`station-run.ts`) from the visitor's position, points the
 * wayfinding HUD at the offered stations, writes the station line, offers
 * the labelled "skip, I can't get there" (§8 D5), and hands a found station
 * to its story. The visitor stays in AR the whole tour (K-D9): nothing here
 * ends the session.
 *
 * - **Where a station is (D19, §8 D8; tour editor plan D9):** its own geo
 *   pose, as a pin's. Its pose was fixed when it was authored (D33's
 *   settle, K6a); the viewer only reads it. Since version 3 every station
 *   has one (D9: no code-only station).
 * - **Reached by its radius alone (D16):** the phone's current best
 *   position - the alignment's, fed by GPS and codes alike, while it is
 *   ready (`alignmentReady`, re-read each tick); while it is not (it
 *   starts as the identity at the first fix, with no heading, and a
 *   GPS-only session whose tracking quality drops is not ready any more)
 *   or there is no alignment at all, the latest device fix if it is fresh
 *   (`FIX_MAX_AGE_MS`) - inside the station's found radius. Only while the
 *   session stays ready (a code lined it up) is a dropped camera pose no
 *   position at all (M5a review M3). What needs a heading - the HUD's
 *   arrows, the breadcrumbs, the figure's pose and its turn - waits for the
 *   first readiness of each AR entry and keeps a heading tracking earned
 *   through a dip (r881 re-review L-B, M-B); a heading only a code gave
 *   goes with the code (third review L2), and tracking ready while a code
 *   is lined up does not latch, since the code's votes feed that report.
 *   A code lock is no arrival: it only improves that position, and the
 *   guide re-judges at once. With no position nothing is reached. A moved
 *   poster can pull the position onto a station until the moved-code
 *   check has judged it (its evidence window); from then on the check
 *   ignores its code and takes its votes back (`isIgnored` of the
 *   viewer pipeline, `qr-viewer-mode.ts`, D20), the one guard left since
 *   the lock-hold went (review 2 #5). Inside that window a visitor who
 *   scans a moved poster near another station may find it early.
 * - **Judged by the framework's one precision rule** (`position-precision`,
 *   the same in every app): an aligned position a code holds is `'code'`,
 *   trusted whatever the fixes say (M5c review #1); any other is `'gps'`
 *   by the device fixes' median, and for a lone fix standing in for the
 *   position the worse of that and the fix's own (r881 re-review M-A).
 *   Above the ceiling the line says the GPS is too weak and nothing is
 *   found (PR #640 review). Being aligned alone earns no trust: the
 *   library aligns a session from its first fix, at any accuracy. With no
 *   code and no accuracy to judge by (`'none'`: without location once a
 *   code's trust ended, or the next AR entry before a code locks in it)
 *   nothing is found, presence holds (a station a code made present ends
 *   with the code, as below), nothing points or measures by that
 *   alignment (no HUD target, no approach, no trail, no "nearest"), and
 *   the line asks for a code.
 * - **The HUD's arrival is the found radius** (`station-bands.ts`, §8 D9):
 *   each target's `distanceMin`/`distanceMax` are the station's found band at
 *   the measured accuracy, and the target sits at the visitor's own height so
 *   the HUD's distance is the horizontal one the run judges.
 * - **One gate for found and presence** (visitor plan 2026-10-18-2349 §3):
 *   the same judged position, its precision (`tooWeak`) and readiness
 *   decide the story's arrival and the station whose content
 *   shows (`station-presence.ts`), in one function (`judged`), so the two
 *   never disagree. Presence reads every station, not the offer (V-D5); it
 *   lives in the page's store (`visitor-guide-slice.ts`), dispatched only
 *   when it changes and after the tick's own work, holds with no position
 *   (a tracking drop, a stale fix), clears at the session's end and resets
 *   with another tour. Not a hold (PR review S1): a fix too weak to guide
 *   by still ends it past the exit by its accuracy, and a station a code
 *   made present ends when the code goes and nothing else can judge (a
 *   moved poster's veto).
 * - **The wait for a heading is said** (D34 of the tour editor plan): while
 *   the guide has stations to point at and no heading yet this AR entry,
 *   the store's `headingPending` is true and the visitor's status line
 *   asks for a few steps (`visitor-status.ts`); the figure keeps waiting.
 * - **Progress lives as long as the tour stays open** (several AR entries;
 *   saving it across page lives is K3). A different tour starts a new run.
 * - **What the radar and the precision chip read**:
 *   the precision kind (`pending | code | gps | weak | none`, the line's
 *   own rules, published to the store only on a change), the camera's
 *   heading whenever there is an alignment - the frame the tour's content
 *   is placed in, so the radar agrees with it from its first frame (its
 *   forward through the alignment; the last bearing kept while the camera
 *   points near straight down, `camera-heading.ts`) - with whether it is
 *   confirmed (the latch above holds, or a compass contributed this AR
 *   entry: `compassHeading`, latched until it is distrusted; a
 *   provisional heading can be far off, and the radar draws it so), every
 *   station's bearing, and the last judged
 *   snapshot of that geometry - kept while a code or GPS within the
 *   ceiling speaks for the position and tracking is not lost, so a frozen
 *   radar (`'none'`, tracking lost) never draws from a position nobody
 *   vouches for, nor from a too-weak fix. Cleared at the session's end.
 * - **The walk lives in the page's store**: the run's statuses, the last skip, the note and
 *   the skip's arm are `visitorWalk` (`visitor-walk-slice.ts`), whose
 *   reducer applies the run's rules. One call of the guide (a tick, a tap,
 *   a story's end) reads the store's walk with its own pending changes
 *   over it, and dispatches them as ONE batch at its very end, after the
 *   tick's reads and its other dispatches: a store subscriber that
 *   re-enters the guide (`ar-entry.ts` ticks it on every dispatch) sees one
 *   consistent walk. A walk another writer resets is no run: the guide
 *   starts none again for the same tour.
 * - **The walk's rules**: the station the walk is
 *   about is the store's one selector (`walkFocus`, the focus rule); while the guide
 *   shows no distance an any-order tour with several stations to find
 *   guesses none (the no-guess rule: `noGuess`, entered at once, left after the hold of
 *   `walk-no-guess.ts`), and nothing on the screen then shows a station's
 *   distance (the no-distance rule: no HUD targets); "Can't get there?" opens the list with
 *   the focus's row armed, or to choose without one; a skipped station
 *   comes back at any time; the visitor may choose a target;
 *   "End this story?" is the story card's whenever a story plays.
 *   Each control carries the action its label shows (`data-action`,
 *   `data-station`), and a tap does that, for that station (R14).
 */

import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";
import { formatDistance } from "gps-plus-slam-app-framework/utils/format-distance";
import { nueBearingDeg } from "gps-plus-slam-app-framework/utils/nue-bearing";
import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { Vector3 } from "three";

import { cameraHeadingDeg } from "./camera-heading.js";
import type { WalkFocusCue } from "./walk-focus-cues.js";
import {
  NO_GUESS_START,
  noGuessStep,
  WALK_NO_GUESS_HOLD_MS,
} from "./walk-no-guess.js";
import { objectPoseNue } from "./content-placement.js";
import type { StagePose } from "./scene-stage.js";
import {
  positionPrecision,
  type PositionPrecision,
} from "gps-plus-slam-app-framework/state/position-precision";

import { judgedStationBands, type StationBands } from "./station-bands.js";
import {
  applyWalkStep,
  stationRunOver,
  stationTitle,
  walkRoute,
  type StationEvent,
  type StationRun,
} from "./station-run.js";
import { presenceCandidates } from "./station-presence.js";
import {
  guideTourChanged,
  headingPendingSet,
  presenceAfter,
  presenceCleared,
  precisionKindSet,
  presenceJudged,
  type PresenceJudgement,
  type VisitorGuideStore,
  type WalkPrecisionKind,
} from "./visitor-guide-slice.js";
import type { VisitorPosition } from "./visitor-position.js";
import type { CompassHeadingVerdict } from "./tour-flow.js";
import type { WalkRadarGeometry } from "./walk-radar-model.js";
import {
  listOpened,
  noGuessSet,
  noteCleared,
  quickArmed,
  rowArmed,
  selectNote,
  selectUndoableSkip,
  SKIP_UNDO_MS,
  skipSettled,
  skipTaken,
  skipUndone,
  targetChosen,
  visitorWalkReducer,
  walkBatched,
  walkChoiceOffered,
  walkCleared,
  walkFocus,
  walkNoGuess,
  walkStarted,
  walkStepped,
  type VisitorWalkState,
  type VisitorWalkStore,
} from "./visitor-walk-slice.js";
import { createLogger } from "gps-plus-slam-app-framework/utils/logger";

const log = createLogger("StationGuide");

/** The run was read with no walk: `liveRun` hands the run out only while
 *  its walk exists, so this is a read held across a reset. A guide call
 *  catches it (`inCall`) and reads as no run. */
class RunReadWithoutWalk extends Error {
  constructor() {
    super("station-guide: the run was read with no walk");
  }
}

/** A control the guide labels: its label, and the action it carries
 *  (`data-action`, `data-station`), which its tap does (R14). */
type GuideControl = Pick<HTMLElement, "textContent" | "hidden" | "dataset">;

/** The station line and the skip button, inside `#ar-root`. */
export interface StationGuideDom {
  readonly line: Pick<HTMLElement, "textContent" | "hidden">;
  readonly skip: GuideControl;
  /** The story card's end control: when
   *  given, "End this story?" and its confirm are written here whenever a
   *  story's station is found; absent, the skip button carries them while
   *  no station is in focus. */
  readonly end?: GuideControl;
}

/** What a tap on the skip button (or the story card's end control) does;
 *  its label says which. "Can't get there?" names no station while none
 *  is guessed (the no-guess rule: it opens the list to choose). "Finish
 *  the tour" names the station a complete tour waits on. */
export type SkipAction =
  | { readonly kind: "ask-skip"; readonly id: string | null }
  | {
      readonly kind: "skip" | "ask-end" | "end" | "undo" | "finish-tour";
      readonly id: string;
    };

/** What a tap on a row of the list does: its
 *  Skip, the Skip's confirm or Cancel, "Bring back" (and the undo), or
 *  "Guide me here" on its title. */
export type WalkRowTap = "skip" | "confirm" | "cancel" | "bring" | "choose";

/** The action a control carries (`data-action`, `data-station`, written
 *  with its label), or null for none or one that is not an action. */
export function skipActionOf(
  control: { readonly dataset: DOMStringMap } | null | undefined,
): SkipAction | null {
  const kind = control?.dataset["action"];
  const id = control?.dataset["station"];
  const station = id === undefined || id === "" ? null : id;
  switch (kind) {
    case "ask-skip":
      return { kind, id: station };
    case "skip":
    case "ask-end":
    case "end":
    case "undo":
    case "finish-tour":
      return station === null ? null : { kind, id: station };
    default:
      return null;
  }
}

/**
 * The position the line speaks of (`lineText`), for the sheet's peek and
 * rows: no position yet (`pending`), GPS too weak to
 * guide by (`weak`, with its accuracy), nothing vouching for it (`none`),
 * or a distance.
 */
type GuidePositionKind = "pending" | "weak" | "none" | "distance";

/** What the sheet reads of the guide: the station the
 *  line is about, the position's kind, every station's distance and the
 *  quick action shown. */
export interface GuideView {
  /** The station the walk is about (`walkFocus`, the focus rule): the order's, the
   *  chosen one, else the nearest; null when none is (a story plays, the
   *  tour is complete, or the no-guess rule guesses none). */
  readonly focusId: string | null;
  readonly position: GuidePositionKind;
  /** The position's precision: the chip's and
   *  the radar's kind, published to the store on a change. */
  readonly precision: WalkPrecisionKind;
  /** The fixes' accuracy behind `gps` and `weak`, m; null otherwise. */
  readonly accuracyM: number | null;
  /** Every placeable station's horizontal distance, m (the measurement's). */
  readonly distances: ReadonlyMap<string, number>;
  /** Every placeable station's bearing from the visitor, degrees from
   *  north (the measurement's). */
  readonly bearings: ReadonlyMap<string, number>;
  /** The camera's bearing, degrees from north, once this AR entry earned
   *  a heading; null before. The HUD's arrows and the direction words
   *  read this one. */
  readonly headingDeg: number | null;
  /** The radar's heading: the camera's bearing whenever there is an
   *  alignment (the frame the content is placed in), confirmed or not;
   *  null without one. */
  readonly radarHeadingDeg: number | null;
  /** Whether that heading is confirmed: the heading latch holds, or a
   *  compass contributed this AR entry and was not distrusted since. */
  readonly headingConfirmed: boolean;
  /** The last judged geometry, for a frozen radar (M3, §1.2); null before
   *  the first this AR entry. */
  readonly snapshot: WalkRadarGeometry | null;
  /** What the peek's quick action shows now (the skip button). */
  readonly quick: SkipAction | null;
  /** What the story card's end control shows now; null without a
   *  found station. */
  readonly end: SkipAction | null;
  /** The visitor's chosen target, while it is waiting and offered. */
  readonly chosenId: string | null;
  /** Whether a target may be chosen now: any order, two or more
   *  stations to find. */
  readonly canChoose: boolean;
  /** The row whose Skip asked for its confirm. */
  readonly rowArmedId: string | null;
  /** The no-guess rule holds: no station is guessed (the list's hint). */
  readonly noGuess: boolean;
  /** The no-guess rule holds and "Can't get there?" opened the list: the hint asks which
   *  station, and a row's Skip acts on one tap. */
  readonly chooser: boolean;
  /** The last skip while it can be undone: its station and the time left,
   *  ms (the row's bar). */
  readonly undo: { readonly id: string; readonly leftMs: number } | null;
  /** What just happened ("Skipped The well."), while its moment lasts
   *  (`selectNote`); null otherwise. The prototype says it in a toast. */
  readonly note: string | null;
  /** Tracking is lost (the store's `trackingLost`): no skip is
   *  offered - the quick action shows only an undo, the rows no Skip and
   *  no confirm - while the undo and Bring back stay. */
  readonly trackingLost: boolean;
  /** The visitor is there: at a done station (its presence holds, no story
   *  plays), or a complete tour waits on its last one. The peek reads "At
   *  station N - take your time" with `tail` second (the next station, or
   *  that every station is done); null otherwise and once finished. */
  readonly there: { readonly id: string; readonly tail: string } | null;
}

/** The open tour's stations, as the guide reads them each tick. */
export interface StationTour {
  readonly stations: readonly TourStation[];
  readonly order: TourOrder;
}

export interface StationGuideDeps {
  readonly dom: StationGuideDom;
  /** The open tour's stations, or null (no tour, no stations, not read). */
  tour(): StationTour | null;
  /** Whether the tour's content may be placed now (a visitor's session
   *  with the scan gate passed or not required). */
  placementAllowed(): boolean;
  zero(): LatLong | null;
  visitor(): VisitorPosition;
  /** Whether a code lined the alignment up (`tour-flow.ts` `codeLinedUp`):
   *  the guide's statement that a code holds it (`codeHold` of the
   *  framework's precision rule), so its position is trusted whatever the
   *  raw fixes' accuracy says. It ends only on events (a veto, an
   *  odometry-frame change, leaving AR, another tour), never by the clock. */
  codeLinedUp(): boolean;
  /** Whether the alignment may be judged on now (`tour-flow.ts`
   *  `alignmentReady`: tracking ready, or a code lined it up; re-read each
   *  tick). While it is not, the fresh device fix stands in, as before any
   *  alignment, judged by the worse of the median and its own accuracy.
   *  What needs a heading (the arrows, the breadcrumbs, the figure) waits
   *  for its first `true` of each AR entry and keeps it through a dip. */
  alignmentReady(): boolean;
  /** Whether the tracking report reads ready (`tour-flow.ts`
   *  `isPlacementReady`; re-read each tick). It latches a heading for the
   *  AR entry only while no code is lined up: a lined-up code's votes feed
   *  the report, so a heading only a code gave goes with the code. */
  trackingReady(): boolean;
  /** What the compass diagnostics say about the heading now
   *  (`tour-flow.ts` `compassHeadingVerdict`; re-read each tick). A
   *  confirm latches the radar's heading as confirmed for the AR entry, a
   *  distrust drops that latch; absent: always silent. Never the HUD's
   *  latch: the arrows keep waiting for tracking or a code. */
  compassHeading?(): CompassHeadingVerdict;
  /** Start the HUD for this AR session; null while it cannot (no camera
   *  yet). The guide retries on the next tick. `getTargets` and `focusId`
   *  are polled per frame: the targets, and the station the walk is about
   *  now (the view's `focusId`; the page marks it in its own look,
   *  `walk-hud.ts`). */
  startHud(
    getTargets: () => WayfindingTarget[],
    focusId: () => string | null,
  ): { dispose(): void } | null;
  now(): number;
  /** The oldest a device fix may be to stand in for the position (no
   *  alignment, or one not ready; ms, on `now`'s clock); default
   *  `FIX_MAX_AGE_MS`. */
  readonly fixMaxAgeMs?: number;
  /** The page's store, where the visitor's present station lives
   *  (`visitor-guide-slice.ts`): the guide dispatches a judged position
   *  only when it changes the answer. Absent: no presence is judged. */
  readonly guideStore?: VisitorGuideStore;
  /** The page's store, where the visitor's walk lives
   *  (`visitor-walk-slice.ts`): the run's statuses, the last skip, the note
   *  and the skip's arm. Absent: the guide keeps an internal store of that
   *  slice alone, so it works the same without the page. */
  readonly walkStore?: VisitorWalkStore;
  /** A station was found: play its story. */
  onFound(station: TourStation): void;
  /** Each tick, for each offered station with a distance: how far it is,
   *  and its activation radius (the prefetch starts its lead beyond it). */
  onApproach?(station: TourStation, distanceM: number, activateM: number): void;
  /** A station is done (its story ended, or it was skipped). */
  onDone?(stationId: string): void;
  /** A station told done (`onDone`) was brought back: the prefetch
   *  keeps it again. */
  onUndone?(stationId: string): void;
  /** The station whose story plays now (the story panel's), for the end
   *  control's station; absent or null: the first found offered one. */
  storyPlaying?(): string | null;
  /** End a found station's story now (the visitor asked, K4 review R9):
   *  the story panel stops it and reports its end (`storyEnded`). Absent:
   *  the guide marks the station done itself. */
  onEndStory?(stationId: string): void;
  /** Every render while the current station's story plays under a fixed
   *  or branch order: the station that comes next (the prefetch reads it
   *  ahead, K4 review R5). */
  onUpcoming?(station: TourStation): void;
  /** Every tick with a camera position, once this AR entry's alignment was
   *  ready (a heading): the stage turns its figure to the visitor. */
  onVisitor?(nue: readonly [number, number, number]): void;
  /** The breadcrumbs: from the visitor towards the station in focus,
   *  stopping at its arrival band; a null target (or visitor) clears them.
   *  The visitor is null until this AR entry's alignment was ready. */
  onGuide?(
    visitor: readonly [number, number, number] | null,
    target: {
      readonly id: string;
      readonly to: readonly [number, number, number];
      readonly stopM: number;
    } | null,
  ): void;
  /** The focus in the scene (its beacon and ring, `walk-focus-cues.ts`):
   *  at every render while a station is in focus, a heading was earned
   *  and a distance is shown (a code's, or GPS within the ceiling); null
   *  otherwise, and when the guide stops or the session ends. */
  onFocusCue?(cue: WalkFocusCue | null): void;
}

export interface StationGuide {
  /** Re-judge: a GPS fix, a store change or a camera frame. Cheap. */
  tick(): void;
  /** A printed code locked in AR: no arrival of its own (D16), only a
   *  re-judge now, since the lock improved the position. */
  codeLocked(): void;
  /** A station's story played to its end. */
  storyEnded(stationId: string): void;
  /** The skip button or the story card's end control (`control`,
   *  default the skip button): does the action it carries, for the
   *  station it names (R14). */
  skipTapped(control?: { readonly dataset: DOMStringMap }): void;
  /** A tap on a row of the list. */
  rowTapped(stationId: string, tap: WalkRowTap): void;
  /** "Keep listening": the ask to end the story is taken back. */
  cancelAsk(): void;
  /** What the sheet reads; null while the guide does
   *  not run (no run, or the scan gate shut). */
  view(): GuideView | null;
  /** The AR session ended: the HUD goes; the progress stays. */
  endSession(): void;
  /** A station's pose at the scene root, or null (no zero yet). */
  poseOf(stationId: string): StagePose | null;
  /** Where the stage stands a story's figure: the station's pose once
   *  this AR entry's alignment was ready, null before (no heading yet:
   *  the figure would stand up to 180° off, then jump; the stage waits,
   *  r881 re-review M-B). */
  figurePoseOf(stationId: string): StagePose | null;
}

/** How long a skip can be undone, and its note shows (K4 review R14):
 *  the walk slice's window, named here too for the guide's readers. */
export { SKIP_UNDO_MS } from "./visitor-walk-slice.js";

/**
 * The oldest a device fix may be to stand in for the visitor's position
 * (no alignment, or one not ready; M5a review M3), against the fix's own Geolocation
 * time. Argued, not measured: Android delivers about one fix a second, so
 * 5 s tolerates four missed fixes, and a visitor walking 1.4 m/s has moved
 * about 7 m since - about a typical fix's own accuracy, and more than a
 * small station's found radius, so an older fix says where the visitor WAS.
 * 2-10 s are swept in the tests: below 2 s an ordinary gap between fixes
 * would blank the position; above 10 s the drift (14 m) exceeds most found
 * radii. Reversed by field data showing fix gaps over 5 s in normal walking.
 */
export const FIX_MAX_AGE_MS = 5_000;

/** The line's ask when nothing speaks for the position's precision
 *  (`'none'`: no code holds it and no fix states an accuracy, as without
 *  location once a code's trust ended): only a code can place the visitor
 *  again. */
const NO_PRECISION_HINT =
  "scan one of the tour's codes so the guide knows where you are.";

/**
 * How many stations the HUD marks at once: the nearest unfound offered
 * ones (visitor plan 2026-10-18-2349, the owner's "where the closest five
 * stations are"). Under the `any` order a town walk offers every station,
 * and a marker for each would crowd the view; the sweep in
 * `station-guide.hud.test.ts` counts the markers inside the field of view
 * for 3-10. No distance cap: a cap would leave a visitor far from every
 * station with no marker at all.
 */
export const HUD_NEAREST_STATIONS = 5;

/** One measurement of the visitor, taken once per tick (K4 review R13). */
interface Measurement {
  /** The visitor; while the alignment is not ready (`alignmentReady`)
   *  it counts as unaligned: no camera position, the fresh fix stands in. */
  readonly visitor: VisitorPosition;
  /** The best position this measurement judged by (`bestPosition`). */
  readonly best: readonly [number, number, number] | null;
  /** How precise `best` is (`precisionOf`): `'code'` while a code holds
   *  the aligned position, through a tracking drop too (r881 review L1:
   *  the line must not call it too weak then), never for a lone raw fix
   *  (re-review L-A); otherwise the device fixes', for a lone fix the
   *  worse of their median and its own (re-review M-A: one ±40 m fix after
   *  a ±5 m run hid behind the median). */
  readonly precision: PositionPrecision;
  /** The camera position for what needs a heading (the HUD's arrows, the
   *  breadcrumbs, the figure's turn): once this AR entry's alignment was
   *  ready, null before (r881 re-review L-B: no flicker in a dip). */
  readonly headingNue: readonly [number, number, number] | null;
  /** Every placeable station's horizontal distance from `best`. */
  readonly distances: Map<string, number>;
  /** Every placeable station's bearing from `best`, degrees from north. */
  readonly bearings: Map<string, number>;
  /** The camera's bearing (its forward through the alignment), degrees
   *  from north, while `headingNue` is set; the last one is kept while
   *  the forward has too little of a horizontal part (near straight down,
   *  `camera-heading.ts`) or there is no pose. */
  readonly headingDeg: number | null;
  /** The same bearing whenever there is an alignment (or the latch
   *  holds): the radar's, confirmed or not. */
  readonly radarHeadingDeg: number | null;
  /** The latch holds, or a compass confirmed the heading this AR entry. */
  readonly headingConfirmed: boolean;
}

/** What one tick may judge (`judged`): the arrival and presence alike. */
interface Judgement {
  readonly distances: ReadonlyMap<string, number>;
  /** The judged position's precision: never too weak here. */
  readonly precision: PositionPrecision;
}

/**
 * The `count` items nearest by `distanceOf` (undefined: farthest), kept
 * in their own order; ties go to the earlier item. An item `always`
 * accepts (the walk's focus) is kept however far, ahead of the others,
 * and the nearest others fill the rest of the count. Exported for the
 * HUD's tests.
 */
export function nearestOf<T>(
  items: readonly T[],
  count: number,
  distanceOf: (item: T) => number | undefined,
  always: (item: T) => boolean = () => false,
): T[] {
  if (items.length <= count) return [...items];
  const keep = new Set(
    items
      .map((item, index) => ({
        index,
        first: always(item) ? 0 : 1,
        d: distanceOf(item) ?? Infinity,
      }))
      .sort((a, b) => a.first - b.first || a.d - b.d || a.index - b.index)
      .slice(0, Math.max(0, count))
      .map((e) => e.index),
  );
  return items.filter((_, index) => keep.has(index));
}

/**
 * The line once the tour is complete (the sheet's completion card names it
 * too). A branch tour ends with its path; the other
 * branches' stations were never offered, so "every station" would be false
 * (R16).
 */
export function completionLine(order: TourOrder, skipped: number): string {
  if (order === "branch") {
    return skipped === 0
      ? "Tour complete - you reached the end of your path."
      : `Tour complete - you reached the end of your path, ${String(skipped)} skipped.`;
  }
  return skipped === 0
    ? "Tour complete - every station visited."
    : `Tour complete - ${String(skipped)} skipped.`;
}

const NO_DISTANCES: ReadonlyMap<string, number> = new Map();

/** Whole metres: GPS-guided distances are not more precise than that. */
function distanceText(m: number): string {
  return formatDistance(m, { metreDecimals: 0 });
}

export function wireStationGuide(deps: StationGuideDeps): StationGuide {
  const { dom } = deps;
  const fixMaxAgeMs = deps.fixMaxAgeMs ?? FIX_MAX_AGE_MS;
  /** Where the walk lives: the page's store, else one of its own. */
  const walkStore: VisitorWalkStore =
    deps.walkStore ??
    configureStore({ reducer: { visitorWalk: visitorWalkReducer } });
  /** The changes this call made to the walk and has not dispatched yet:
   *  they reach the store as one batch when the outermost call ends. A
   *  nested call (a store subscriber's tick inside one, a story ended from
   *  a tap) adds to them. */
  const pendingWalk: UnknownAction[] = [];
  let callDepth = 0;
  /** A run read without a walk was logged (once per guide). */
  let runReadLogged = false;
  /** The run's calls over the walk for the open tour's stations: a view
   *  (it holds the stations for the found radius), no state of its own;
   *  read through `liveRun`, which hands it out only while its walk
   *  exists. */
  let runView: StationRun | null = null;
  /** The open tour's stations the walk is for: the identity that tells
   *  another tour (D29-D32: the guide's own bookkeeping). */
  let runStations: readonly TourStation[] | null = null;
  /** The HUD for this AR session: a resource. */
  let hud: { dispose(): void } | null = null;
  /** The session ended: a found station's story was cut short and plays
   *  again on the next session's first tick (the guide's own bookkeeping
   *  of a rule only it applies). */
  let replayFound = false;
  /** When the distance came back while no station is guessed (the no-guess rule's
   *  hold, `walk-no-guess.ts`): the guide's own bookkeeping; the store
   *  holds `noGuess`. */
  let noGuessBackAtMs: number | null = NO_GUESS_START.backAtMs;
  /** The last measurement: the visitor, and every placeable station's
   *  horizontal distance from the best position (all stations, so an offer
   *  that changes between ticks has its distances already). Taken once per
   *  tick (K4 review R13). */
  let last: Measurement | null = null;
  /** Station poses at the last measurement's zero, computed once each per
   *  measurement (R13: the geodesy ran several times per station a tick). */
  const poseCache = new Map<string, StagePose | null>();
  let measuredZero: LatLong | null | undefined;
  /** Tracking was ready once this AR entry with no code lined up
   *  (`trackingReady` while not `codeLinedUp`): it earned a heading, kept
   *  through a dip of the tracking quality, as the walk's photos latch
   *  their trigger. Reset at the session's end. */
  let trackedHeading = false;
  /** The alignment has a heading now: tracking earned one this AR entry,
   *  or it is ready now (a code lined it up). A heading only a code gave
   *  goes with the code's votes (a veto) while tracking is not ready
   *  (r881 third review L2). */
  let headingReady = false;
  /** A compass confirmed the heading this AR entry (`compassHeading`),
   *  and no distrust followed. Only the radar's word reads it. */
  let compassConfirmed = false;
  /** The run was replaced or dropped (another tour, or none; never the
   *  first run): the store's presence and its "show all" reset at the end
   *  of the tick. */
  let tourChangePending = false;
  /** The present station was last judged on a position a code held:
   *  once the code goes (a veto) and nothing else can judge, it ends. */
  let presentByCode = false;
  /** The camera's last bearing this AR entry (`Measurement.headingDeg`). */
  let lastHeadingDeg: number | null = null;
  /** The last judged geometry, for a frozen radar: a
   *  derived cache, rebuilt from the measurement, never the store's. */
  let snapshot: WalkRadarGeometry | null = null;

  /** The walk now, as this call sees it: the store's as it is now, with
   *  this call's pending changes applied over it - what the store will
   *  hold once they are dispatched. Read anew each time, so a change
   *  another writer makes mid-call is part of it at once. */
  function walk(): VisitorWalkState {
    return pendingWalk.reduce(
      visitorWalkReducer,
      walkStore.getState().visitorWalk,
    );
  }

  /** One change to this call's walk; it reaches the store at the call's
   *  end. */
  function change(action: UnknownAction): void {
    pendingWalk.push(action);
  }

  /** The run, while its walk exists; null with no walk - no tour, none
   *  placed yet, or one another writer reset. The guide starts no walk
   *  again for the same tour (a restart would drop the visitor's
   *  progress), and every reader fetches the run anew rather than across
   *  a callback, so the run's view never reads a walk that is gone. */
  function liveRun(): StationRun | null {
    return walk().progress === null ? null : runView;
  }

  /** One call of the guide's: its walk changes are dispatched together
   *  when the outermost call ends, after everything it read and
   *  dispatched (a subscriber woken by the batch ticks a fresh call). */
  function inCall(body: () => void): void {
    callDepth += 1;
    try {
      body();
    } catch (error) {
      // The frame loop must never stop on it: the outermost call reads
      // as no run (its changes dropped, nothing shown), logged once.
      if (callDepth > 1 || !(error instanceof RunReadWithoutWalk)) throw error;
      pendingWalk.length = 0;
      hideAll();
      if (!runReadLogged) {
        runReadLogged = true;
        log.error("the run was read with no walk", error);
      }
    } finally {
      callDepth -= 1;
      if (callDepth === 0) commitWalk();
    }
  }

  function commitWalk(): void {
    if (pendingWalk.length === 0) return;
    walkStore.dispatch(walkBatched(pendingWalk.splice(0)));
  }

  /** The run's calls over this call's walk (`station-run.ts`): a step the
   *  rule allows becomes one change; one it does not, nothing. */
  function runOver(stations: readonly TourStation[]): StationRun {
    return stationRunOver(stations, {
      read() {
        const progress = walk().progress;
        // `liveRun` hands the view out only while its walk exists.
        if (progress === null) throw new RunReadWithoutWalk();
        return progress;
      },
      perform(step) {
        const before = walk().progress;
        if (before === null) return [];
        const { progress, events } = applyWalkStep(before, step);
        if (progress !== before) change(walkStepped(step));
        return events;
      },
    });
  }

  /** The last skip not settled yet (R14): its "done" reaches the prefetch
   *  only when it settles - its moment passed, or the tour moved on. What
   *  the button offers is `selectUndoableSkip`, its window; this is what
   *  the settle and a tap on the undo the button showed act on. */
  function unsettledSkip(): { id: string; atMs: number } | null {
    const skip = walk().lastSkip;
    return skip === null || skip.settled ? null : skip;
  }

  /** The note of what just happened ("Skipped the well."), while its
   *  moment lasts (R14, `selectNote`): read over the page's time. */
  function noteText(): string | null {
    const note = selectNote({ visitorWalk: walk() }, deps.now());
    if (note === null) return null;
    const title = stationTitle(stationById(note.id) ?? {});
    return note.kind === "skipped"
      ? `Skipped ${title}.`
      : `Brought back ${title}.`;
  }

  /** The quick action asks for no station any more. */
  function disarm(): void {
    if (walk().quickArmedId !== null) change(quickArmed(null));
  }

  function stationById(id: string): TourStation | undefined {
    return runStations?.find((s) => s.id === id);
  }

  function poseOf(stationId: string): StagePose | null {
    const cached = poseCache.get(stationId);
    if (cached !== undefined) return cached;
    const pose = computePose(stationId);
    poseCache.set(stationId, pose);
    return pose;
  }

  function computePose(stationId: string): StagePose | null {
    const zero = measuredZero === undefined ? deps.zero() : measuredZero;
    const station = stationById(stationId);
    if (zero === null || station === undefined) return null;
    return objectPoseNue(station.geo, zero);
  }

  /** Whether the alignment has a heading this tick (`headingReady`):
   *  tracking earned one this AR entry, or it is ready now. Tracking ready
   *  while a code is lined up does not latch: the code's votes feed the
   *  tracking report, so that `ok` can be the code's own work. Once the
   *  votes are gone, a report still `ok` latches on that tick. */
  function noteHeading(
    ready: boolean,
    tracking: boolean,
    lined: boolean,
  ): void {
    if (tracking && !lined) trackedHeading = true;
    headingReady = trackedHeading || ready;
  }

  /** Measure once: the visitor, the zero, every station's pose and
   *  horizontal distance. An alignment that is not ready now counts as
   *  none (`alignmentReady`): the fresh device fix stands in, judged by
   *  the worse of the median and its own accuracy (r881 review H1:
   *  readiness needs a walk with turns, and a visitor standing at a
   *  station had no guidance at all; re-review M-A). Only an aligned
   *  position a code holds is trusted (`precisionOf`). */
  function measure(): void {
    poseCache.clear();
    measuredZero = deps.zero();
    const seen = deps.visitor();
    const ready = deps.alignmentReady();
    const lined = deps.codeLinedUp();
    noteHeading(ready, deps.trackingReady(), lined);
    const compass = deps.compassHeading?.() ?? "silent";
    if (compass === "confirms") compassConfirmed = true;
    else if (compass === "distrusts") compassConfirmed = false;
    // The content's frame has a heading as soon as there is an alignment;
    // what needs it confirmed (the arrows) waits for the latch.
    const radarHeadingDeg =
      seen.aligned || headingReady
        ? cameraHeading(seen.forwardNue ?? null)
        : null;
    const visitor =
      seen.aligned && !ready ? { ...seen, nue: null, aligned: false } : seen;
    const position = bestPosition(visitor);
    const best = position?.nue ?? null;
    const geometry = stationGeometry(best);
    last = {
      visitor,
      best,
      precision: precisionOf(visitor, position?.loneFix === true, lined),
      headingNue: headingReady ? seen.nue : null,
      distances: geometry.distances,
      bearings: geometry.bearings,
      headingDeg: headingReady ? radarHeadingDeg : null,
      radarHeadingDeg,
      headingConfirmed: headingReady || compassConfirmed,
    };
  }

  /** The run for the open tour, created once the tour may be placed. */
  function currentRun(): StationRun | null {
    const tour = deps.tour();
    if (tour === null || tour.stations.length === 0) {
      if (runView !== null) tourChangePending = true;
      if (walk().progress !== null) change(walkCleared());
      runView = null;
      runStations = null;
      return null;
    }
    if (tour.stations !== runStations) {
      if (!deps.placementAllowed()) return null;
      // The page's first tour is no change: a "show all" set before the
      // first tick stays (PR review S5).
      if (runStations !== null) tourChangePending = true;
      runStations = tour.stations;
      // A new walk: its last skip, note and arm start anew with it.
      change(
        walkStarted({ order: tour.order, route: walkRoute(tour.stations) }),
      );
      runView = runOver(tour.stations);
      noGuessBackAtMs = null;
    }
    return liveRun();
  }

  /** The phone's current best position (D16): the alignment's, else -
   *  only while the visitor counts as unaligned (no alignment, or one not
   *  ready, `measure`) - the latest device fix, if it is fresh, as a
   *  lone fix; null otherwise. A session still ready whose camera pose
   *  dropped has no position until it is back: the raw fix would bypass
   *  the trust that keeps it ready and could latch "found" (M5a review
   *  M3). */
  function bestPosition(
    visitor: VisitorPosition,
  ): { nue: readonly [number, number, number]; loneFix: boolean } | null {
    if (visitor.nue !== null) return { nue: visitor.nue, loneFix: false };
    if (visitor.aligned || visitor.fixNue === null) return null;
    const at = visitor.fixAtMs;
    if (at === null || !Number.isFinite(at)) return null;
    return deps.now() - at <= fixMaxAgeMs
      ? { nue: visitor.fixNue, loneFix: true }
      : null;
  }

  /** A station's bands at the position judged by, by the same rule
   *  (`judgedStationBands`, PR #642 review). Read by the prefetch, the
   *  HUD's targets and the breadcrumbs' stop alike. */
  function bandsOf(station: TourStation, m: Measurement): StationBands {
    return judgedStationBands(station, m.precision);
  }

  /** The one gate (visitor plan §3): what this tick may judge, for the
   *  run's arrival and the present station alike; null when nothing may
   *  be judged - no position, no GPS zero yet (no distance), or a
   *  position too weak to guide by (`PositionPrecision.tooWeak`: GPS above
   *  the ceiling, or nothing to judge by). */
  function judged(m: Measurement): Judgement | null {
    if (m.best === null || m.distances.size === 0) return null;
    if (m.precision.tooWeak) return null;
    return { distances: m.distances, precision: m.precision };
  }

  /** Whether the guide waits for a heading (D34), in the store; only a
   *  change is dispatched. */
  function publishHeadingPending(pending: boolean): void {
    const store = deps.guideStore;
    if (store === undefined) return;
    if (store.getState().visitorGuide.headingPending !== pending) {
      store.dispatch(headingPendingSet(pending));
    }
  }

  /** The precision kind in the store; only a change is
   *  dispatched. */
  function publishPrecision(kind: WalkPrecisionKind): void {
    const store = deps.guideStore;
    if (store === undefined) return;
    if (store.getState().visitorGuide.precisionKind !== kind) {
      store.dispatch(precisionKindSet(kind));
    }
  }

  /** The snapshot follows the measurement while a judged position (a
   *  code's, or GPS within the ceiling) speaks for it and the tracking is
   *  not lost (the store's `trackingLost`); otherwise it holds the last
   *  such geometry - never one a too-weak fix put there. */
  function keepSnapshot(m: Measurement, kind: WalkPrecisionKind): void {
    if (trackingLost() || (kind !== "code" && kind !== "gps")) return;
    snapshot = {
      distances: m.distances,
      bearings: m.bearings,
      headingDeg: m.radarHeadingDeg,
      headingConfirmed: m.headingConfirmed,
    };
  }

  /** What presence may read this tick: the gate's judgement, else a GPS
   *  fix too weak to guide by - which can only end presence
   *  (`presenceAfter`, PR review S1) - else nothing (null: hold; also for
   *  `'none'`, which is no verdict on GPS). */
  function presenceJudgement(
    m: Measurement,
    j: Judgement | null,
  ): PresenceJudgement | null {
    if (runStations === null) return null;
    const weakGps =
      m.best !== null &&
      m.distances.size > 0 &&
      m.precision.source === "gps" &&
      m.precision.tooWeak;
    if (j === null && !weakGps) return null;
    return {
      candidates: presenceCandidates(runStations, m.distances, (station) =>
        bandsOf(station, m),
      ),
      precision: m.precision,
    };
  }

  /** The store's presence after this tick: a tour change resets it, a
   *  station a code made present ends once the code goes and nothing can
   *  judge, and a judgement is dispatched only when it changes the answer.
   *  Called at the END of a tick: a dispatch re-enters the tick through the
   *  store's subscriber, which then finds nothing to change. */
  function publishPresence(
    m: Measurement | null,
    j: Judgement | null,
  ): boolean {
    const store = deps.guideStore;
    if (store === undefined) return false;
    if (tourChangePending) {
      tourChangePending = false;
      presentByCode = false;
      const s = store.getState().visitorGuide;
      if (s.presentStationId !== null || s.showAllContent) {
        store.dispatch(guideTourChanged());
      }
    }
    if (m === null) return false;
    const state = store.getState().visitorGuide;
    if (j === null && presentByCode && m.precision.source !== "code") {
      presentByCode = false;
      if (state.presentStationId !== null) store.dispatch(presenceCleared());
      return false;
    }
    const judgement = presenceJudgement(m, j);
    if (judgement === null) return false;
    if (j !== null) presentByCode = m.precision.source === "code";
    if (presenceAfter(state, judgement) !== state.presentStationId) {
      store.dispatch(presenceJudged(judgement));
    }
    return true;
  }

  /** The station whose content shows now (the store's presence); null
   *  without one or without a store. */
  function presentId(): string | null {
    return deps.guideStore?.getState().visitorGuide.presentStationId ?? null;
  }

  /** A complete tour waits on its last station: once a judged presence is
   *  not that station, the visitor left it and the tour finishes. A tick
   *  that judged nothing (no position, a hold) finishes nothing. */
  function finishOnLeaving(wasJudged: boolean): boolean {
    const run = liveRun();
    const wait = run?.finishWait() ?? null;
    if (!wasJudged || run === null || wait === null) return false;
    if (presentId() === wait) return false;
    handle(run.left(wait));
    return true;
  }

  /** Where the visitor is there (`GuideView.there`): the present station
   *  if it is done and not skipped, else the station a complete tour waits
   *  on; none while a story plays and once finished. */
  function thereOf(): { id: string; tail: string } | null {
    const run = liveRun();
    if (run === null || run.isFinished() || storyTarget() !== null) {
      return null;
    }
    const present = presentId();
    const status = present === null ? undefined : run.status(present);
    const id =
      present !== null && status?.state === "done" && !status.skipped
        ? present
        : run.finishWait();
    return id === null ? null : { id, tail: thereTail(run) };
  }

  /** The being-there peek's second line: the next station with what the
   *  position says of it (its distance, or the walking line's own hint: a
   *  wait, GPS too weak, a code to scan), or that every station is done. */
  function thereTail(run: StationRun): string {
    if (run.isComplete()) return "Every station is done.";
    const focus = focusStation();
    const station = focus === null ? undefined : stationById(focus);
    if (focus === null || station === undefined) {
      const n = unfoundOffered(run).length;
      return `${String(n)} ${n === 1 ? "station" : "stations"} still to find - ${noGuessTail()}`;
    }
    const d = last?.distances.get(focus);
    return `Next: ${stationTitle(station)}${positionTail(positionKind(last, d), d)}`;
  }

  /** The line while the visitor is there: "At station N - take your
   *  time: <title>. <tail>", as the peek splits it. */
  function thereLine(there: { id: string; tail: string }): string {
    const stations = deps.tour()?.stations ?? [];
    const n = stations.findIndex((st) => st.id === there.id) + 1;
    const title = stationTitle(stationById(there.id) ?? {});
    return `At station ${String(n)} - take your time: ${title}. ${there.tail}`;
  }

  /** Every placeable station's horizontal distance and bearing from
   *  `nue`. */
  function stationGeometry(nue: readonly [number, number, number] | null): {
    distances: Map<string, number>;
    bearings: Map<string, number>;
  } {
    const distances = new Map<string, number>();
    const bearings = new Map<string, number>();
    if (nue === null || runStations === null) return { distances, bearings };
    for (const { id } of runStations) {
      const pose = poseOf(id);
      if (pose === null) continue;
      const dn = pose.positionNue[0] - nue[0];
      const de = pose.positionNue[2] - nue[2];
      distances.set(id, Math.hypot(dn, de));
      // Standing on the station's spot: no bearing (the radar draws it at
      // the centre either way).
      bearings.set(id, nueBearingDeg(dn, de) ?? 0);
    }
    return { distances, bearings };
  }

  /** The camera's bearing from its forward; the last one this AR entry
   *  while the forward has too little of a horizontal part (near straight
   *  down, `camera-heading.ts`) or there is no pose. */
  function cameraHeading(
    forward: readonly [number, number, number] | null,
  ): number | null {
    lastHeadingDeg = cameraHeadingDeg(forward, lastHeadingDeg);
    return lastHeadingDeg;
  }

  function handle(events: readonly StationEvent[]): void {
    for (const event of events) {
      if (event.kind === "found") {
        // Another station moved on: the last skip stays as it is.
        settleUndo();
        const station = stationById(event.id);
        if (station !== undefined) deps.onFound(station);
      } else if (event.kind === "done") {
        // A skip that can still be undone reaches the prefetch later.
        if (event.skipped && unsettledSkip()?.id === event.id) continue;
        settleUndo();
        deps.onDone?.(event.id);
      }
    }
  }

  /** The last skip can no longer be undone: tell the prefetch it is done. */
  function settleUndo(): void {
    const skip = unsettledSkip();
    if (skip === null) return;
    change(skipSettled());
    deps.onDone?.(skip.id);
  }

  /** Nothing vouches for this measurement's alignment (`'none'`): nothing
   *  points or measures by it - no HUD target, no approach, no trail from
   *  the visitor, no "nearest" in the line. */
  function unjudged(m: Measurement): boolean {
    return m.precision.source === "none";
  }

  /** The prefetch's view of the offer: each offered station's distance;
   *  none while the position is `unjudged`. */
  function approach(m: Measurement): void {
    const { distances } = m;
    const run = liveRun();
    if (deps.onApproach === undefined || run === null || unjudged(m)) return;
    for (const id of run.offered()) {
      const d = distances.get(id);
      const station = stationById(id);
      if (d === undefined || station === undefined) continue;
      deps.onApproach(station, d, bandsOf(station, m).activateM);
    }
  }

  /** The station the walk is about (`walkFocus`, the focus rule) over this tick's
   *  distances. */
  function focusStation(): string | null {
    if (liveRun() === null) return null;
    return walkFocus(walk(), last?.distances ?? NO_DISTANCES);
  }

  /** The offered stations not yet found. */
  function unfoundOffered(run: StationRun): string[] {
    return run.offered().filter((id) => run.status(id)?.state !== "found");
  }

  /** Whether the guide shows a distance now (a code's, or GPS within the
   *  ceiling, with a station measured): the no-distance rule and the no-guess rule key on it. */
  function distanceShown(m: Measurement | null): boolean {
    const kind = precisionKind(m);
    return kind === "code" || kind === "gps";
  }

  /** The no-guess rule: enter at once without a distance, leave after the hold, or at
   *  once when the distance is a code's (`walk-no-guess.ts`); the store
   *  hears only a change. */
  function updateNoGuess(m: Measurement): void {
    const before = walk().noGuess;
    const next = noGuessStep(
      { noGuess: before, backAtMs: noGuessBackAtMs },
      distanceShown(m),
      deps.now(),
      WALK_NO_GUESS_HOLD_MS,
      precisionKind(m) === "code",
    );
    noGuessBackAtMs = next.backAtMs;
    if (next.noGuess !== before) change(noGuessSet(next.noGuess));
  }

  /** The HUD's markers: the `HUD_NEAREST_STATIONS` nearest offered
   *  stations not yet found (a station with no distance yet counts as
   *  farthest), the focus among them however far, in the offer's
   *  order. A present station that is offered is found already, so these
   *  are the stations whose content is hidden.
   *  None while the guide shows no distance (the no-distance rule: each marker carries a
   *  distance label) - `'none'`, too weak, pending. */
  function hudTargets(): WayfindingTarget[] {
    const run = liveRun();
    if (run === null || last === null || last.headingNue === null) return [];
    if (!distanceShown(last)) return [];
    const eyeHeight = last.headingNue[1];
    const distances = last.distances;
    const targets: WayfindingTarget[] = [];
    for (const id of run.offered()) {
      const status = run.status(id);
      const station = stationById(id);
      const pose = poseOf(id);
      if (status?.state === "found" || station === undefined || pose === null) {
        continue;
      }
      const bands = bandsOf(station, last);
      targets.push({
        id,
        position: new Vector3(
          pose.positionNue[0],
          eyeHeight,
          pose.positionNue[2],
        ),
        distanceMin: bands.foundM,
        distanceMax: bands.foundExitM,
      });
    }
    // The focus always has its marker, also a chosen target farther than
    // the nearest few; the nearest others fill the rest.
    const focus = focusStation();
    return nearestOf(
      targets,
      HUD_NEAREST_STATIONS,
      (t) => distances.get(t.id ?? ""),
      (t) => focus !== null && t.id === focus,
    );
  }

  function lineText(): string {
    const run = liveRun();
    if (run === null) return "";
    if (run.isFinished()) {
      const skipped = run.statuses().filter((s) => s.skipped).length;
      return completionLine(deps.tour()?.order ?? "any", skipped);
    }
    const note = noteText();
    const lead = note === null ? "" : `${note} `;
    const there = thereOf();
    if (there !== null) return `${lead}${thereLine(there)}`;
    const focus = focusStation();
    const offered = run.offered().length;
    const which = offered > 1 ? `${String(offered)} stations to find` : null;
    if (focus === null) {
      if (unfoundOffered(run).length === 0) {
        return `${lead}Station found - its story is playing.`;
      }
      // The no-guess rule: no station named, the position's state alone.
      return `${lead}${which ?? "Stations to find"} - ${noGuessTail()}`;
    }
    const station = stationById(focus)!;
    const title = stationTitle(station);
    const d = last?.distances.get(focus);
    const kind = positionKind(last, d);
    const chosen = walk().chosenId === focus;
    // "nearest" is a distance's ranking: without one the focus is named
    // as the one left (with two or more to find no station is guessed).
    const waiting =
      which === null || (!chosen && kind !== "distance")
        ? `Next: ${title}`
        : `${which} - ${chosen ? "your choice" : "nearest"}: ${title}`;
    return `${lead}${waiting}${positionTail(kind, d)}`;
  }

  /** What the line says of a named station's position, by its kind; `d`
   *  its distance. On `none` the focus has no distance (a chosen target,
   *  or the one station left to find; the no-guess rule covers the rest):
   *  named, as the peek names it. */
  function positionTail(
    kind: GuidePositionKind,
    d: number | undefined,
  ): string {
    switch (kind) {
      case "pending":
        return " - waiting for your position…";
      case "weak":
        return ` - GPS too weak to guide you (±${distanceText(last!.precision.accuracyM!)}); step into the open.`;
      case "none":
        return ` - ${NO_PRECISION_HINT}`;
      case "distance":
        return `, ${distanceText(d!)}`;
    }
  }

  /** The line's tail while the no-guess rule guesses no station: what the position is
   *  doing, by its kind. */
  function noGuessTail(): string {
    switch (precisionKind(last)) {
      case "pending":
        return "waiting for your position…";
      case "weak":
        return `GPS too weak to guide you (±${distanceText(last!.precision.accuracyM!)}); step into the open.`;
      case "none":
        return NO_PRECISION_HINT;
      default:
        // The distance is back, inside the no-guess hold.
        return "waiting for a steady position…";
    }
  }

  /**
   * What the line says of the position, `d` being the focus's distance
   * (the one rule of `lineText` and `view`):
   * - no measurement yet: pending;
   * - before the position, a fix too weak to guide by, which the visitor
   *   can act on (step into the open), with a position or still without;
   * - no position, or no distance yet (every station has a spot of its
   *   own, version 3, D9: no distance means no session zero to measure it
   *   in yet): pending;
   * - no code and no accuracy speaks for the position (without location
   *   once a code's trust ended): none - no distance that looks measured,
   *   no "nearest" by that position, and the one thing that helps;
   * - otherwise the distance.
   */
  function positionKind(
    m: Measurement | null,
    d: number | undefined,
  ): GuidePositionKind {
    if (m === null) return "pending";
    const { precision } = m;
    if (
      precision.source === "gps" &&
      precision.tooWeak &&
      precision.accuracyM !== null
    ) {
      return "weak";
    }
    if (m.best === null || d === undefined) return "pending";
    if (unjudged(m)) return "none";
    return "distance";
  }

  /**
   * The position's precision for the chip and the radar (§1.3), by the
   * line's rules (`positionKind`) over any station's distance: a fix too
   * weak to guide by; no position or no distance yet (pending); nothing
   * vouching for it (`'none'`); else a code's or GPS.
   */
  function precisionKind(m: Measurement | null): WalkPrecisionKind {
    const kind = positionKind(
      m,
      m !== null && m.distances.size > 0 ? 0 : undefined,
    );
    if (kind !== "distance") return kind;
    return m!.precision.source === "code" ? "code" : "gps";
  }

  /** Tracking is lost (the store's `trackingLost`, published from the
   *  readiness phase); false without a guide store. */
  function trackingLost(): boolean {
    return deps.guideStore?.getState().visitorGuide.trackingLost === true;
  }

  /** Whether the guide runs now: a run, and the scan gate open. */
  function running(): boolean {
    return liveRun() !== null && deps.placementAllowed();
  }

  /** Nothing to show: the line, the button and the card's end control go,
   *  and a tap that still arrives does nothing (they carry no action). */
  function hideAll(): void {
    deps.onFocusCue?.(null);
    show(dom.line, "");
    showControl(dom.skip, null);
    if (dom.end !== undefined) showControl(dom.end, null);
  }

  /** A control's label and the action it carries (a tap does that). */
  function showControl(el: GuideControl, action: SkipAction | null): void {
    show(el, action === null ? "" : skipLabel(action));
    setData(el, "action", action?.kind ?? null);
    setData(el, "station", action?.id ?? null);
  }

  function setData(el: GuideControl, key: string, value: string | null): void {
    if (value === null) {
      if (el.dataset[key] !== undefined) delete el.dataset[key];
    } else if (el.dataset[key] !== value) {
      el.dataset[key] = value;
    }
  }

  /** Write a text only when it changed (R13: the line is a polite live
   *  region, and a rewrite is announced again). */
  function show(
    el: Pick<HTMLElement, "textContent" | "hidden">,
    text: string,
  ): void {
    if (el.textContent !== text) el.textContent = text;
    const hidden = text === "";
    if (el.hidden !== hidden) el.hidden = hidden;
  }

  function render(): void {
    // A tap or a story's end while the scan gate is shut (a later AR
    // entry waiting behind its own scan) writes nothing (the stale line): the next frame would only hide it again.
    if (!running()) {
      hideAll();
      return;
    }
    // A code lock can find a station before the guide has ticked at all.
    if (last === null) measure();
    // An unjudged position lays no trail: with no visitor there is none.
    deps.onGuide?.(unjudged(last!) ? null : last!.headingNue, guideTarget());
    deps.onFocusCue?.(focusCue());
    const upcoming = liveRun()?.upcoming() ?? null;
    const next = upcoming === null ? undefined : stationById(upcoming);
    if (next !== undefined) deps.onUpcoming?.(next);
    if (liveRun()?.isComplete() === true) {
      // Nothing left to point at, whichever action completed the tour.
      hud?.dispose();
      hud = null;
    } else {
      // Whichever action brought the run here (a tick, a code lock).
      ensureHud();
    }
    // The settle is an event: once, when the undo's moment has passed.
    const skip = unsettledSkip();
    if (skip !== null && deps.now() >= skip.atMs + SKIP_UNDO_MS) settleUndo();
    startFocusClock();
    // The end's ask follows the story it was asked for.
    const story = storyTarget();
    if (walk().quickArmedId !== null && walk().quickArmedId !== story) {
      disarm();
    }
    show(dom.line, lineText());
    const quick = quickAction();
    if (dom.end === undefined) {
      // No story card: the button ends the story while nothing is in
      // focus, so one that never ends cannot hold the tour (K4 review R9).
      showControl(dom.skip, quick ?? endAction());
    } else {
      showControl(dom.skip, quick);
      showControl(dom.end, endAction());
    }
  }

  /** The station in focus starts its skip clock when it becomes the focus
   *  (K4 review R14), with its first distance, sized by it (r881 review
   *  M2: started without one, it suggested the skip after the bare
   *  allowance to a visitor still waiting for a position). */
  function startFocusClock(): void {
    const run = liveRun();
    const focus = focusStation();
    const d = focus === null ? undefined : last?.distances.get(focus);
    if (run !== null && focus !== null && d !== undefined) {
      run.focus(focus, deps.now(), d);
    }
  }

  /** What the peek's quick action offers now: the last skip's undo; for
   *  the focus "Can't get there?", or its skip once its row is armed or
   *  its clock suggests it; with no station guessed "Can't get
   *  there?" naming none. Pure: the render starts the clock. */
  function quickAction(): SkipAction | null {
    const run = liveRun();
    if (run === null) return null;
    const skip = selectUndoableSkip({ visitorWalk: walk() }, deps.now());
    if (skip !== null) return { kind: "undo", id: skip.id };
    // A complete tour waits on its last station: the visitor may finish.
    const wait = run.finishWait();
    if (wait !== null) return { kind: "finish-tour", id: wait };
    // Tracking lost: no skip is offered, only its undo.
    if (trackingLost()) return null;
    const focus = focusStation();
    if (focus === null) {
      return walkNoGuess(walk()) ? { kind: "ask-skip", id: null } : null;
    }
    const ripe =
      walk().rowArmedId === focus || run.skipSuggested(focus, deps.now());
    return { kind: ripe ? "skip" : "ask-skip", id: focus };
  }

  /** The story card's end: "End this story?", its confirm once
   *  asked; null without a found station. */
  function endAction(): SkipAction | null {
    const story = storyTarget();
    if (story === null) return null;
    return {
      kind: walk().quickArmedId === story ? "end" : "ask-end",
      id: story,
    };
  }

  function skipLabel(action: SkipAction): string {
    if (action.kind === "ask-skip") return "Can't get there?";
    const title = stationTitle(stationById(action.id) ?? {});
    switch (action.kind) {
      case "skip":
        return `Skip ${title} - I can't get there`;
      case "ask-end":
        return "End this story?";
      case "end":
        return `End the story of ${title} now`;
      case "undo":
        return `Undo: bring back ${title}`;
      case "finish-tour":
        return "Finish the tour";
    }
  }

  /** The found station whose story the visitor may end: the one playing
   *  (`storyPlaying`), else the first found offered one in list order;
   *  null without one. */
  function storyTarget(): string | null {
    const run = liveRun();
    if (run === null) return null;
    const playing = deps.storyPlaying?.() ?? null;
    if (playing !== null && run.status(playing)?.state === "found") {
      return playing;
    }
    return (
      run.offered().find((id) => run.status(id)?.state === "found") ?? null
    );
  }

  /** The breadcrumbs' target: the station in focus, by its spot. */
  function guideTarget(): {
    id: string;
    to: readonly [number, number, number];
    stopM: number;
  } | null {
    const focus = focusStation();
    if (focus === null || last === null) return null;
    const pose = poseOf(focus);
    const station = stationById(focus);
    if (pose === null || station === undefined) return null;
    return {
      id: focus,
      to: pose.positionNue,
      stopM: bandsOf(station, last).foundExitM,
    };
  }

  /** The focus's beacon and ring (`onFocusCue`): a focus, a heading,
   *  and a distance shown - the scene claims no place to walk to that the
   *  guide does not show a distance for. */
  function focusCue(): WalkFocusCue | null {
    const focus = focusStation();
    if (focus === null || last === null || last.headingNue === null) {
      return null;
    }
    if (!distanceShown(last)) return null;
    const pose = poseOf(focus);
    const station = stationById(focus);
    const distanceM = last.distances.get(focus);
    if (pose === null || station === undefined || distanceM === undefined) {
      return null;
    }
    return {
      id: focus,
      at: pose.positionNue,
      eye: last.headingNue,
      foundM: bandsOf(station, last).foundM,
      distanceM,
    };
  }

  function ensureHud(): void {
    const run = liveRun();
    if (hud !== null || run === null || run.isComplete()) return;
    hud = deps.startHud(hudTargets, focusStation);
  }

  /** One tick (`tick`), inside its call. */
  function tick(): void {
    const current = currentRun();
    // The scan gate is checked every tick, not only when the run was
    // created (K4 review R8): a later AR session waits behind its own.
    // The run is fetched anew after each callback below (`liveRun`).
    if (current === null || !deps.placementAllowed()) {
      hideAll();
      deps.onGuide?.(null, null);
      publishPresence(null, null);
      publishHeadingPending(false);
      publishPrecision("pending");
      return;
    }
    measure();
    const m = last!;
    const kind = precisionKind(m);
    keepSnapshot(m, kind);
    updateNoGuess(m);
    // A story cut short by the session's end plays again on the same
    // terms as its first play: a position and the GPS zero (R8: before
    // them its figure had no pose; r881 re-review M-C: a camera position
    // was required, which a session never ready never has). Its figure
    // waits for the heading as on a first play (`figurePoseOf`).
    if (replayFound && measuredZero !== null && m.best !== null) {
      replayFound = false;
      for (const status of current.statuses()) {
        const station = stationById(status.id);
        if (status.state === "found" && station !== undefined) {
          deps.onFound(station);
        }
      }
    }
    // A figure holds its turn while no station is guessed: the
    // position nobody vouches for is no one to face.
    if (m.headingNue !== null && !walkNoGuess(walk())) {
      deps.onVisitor?.(m.headingNue);
    }
    approach(m);
    const judgement = judged(m);
    const run = liveRun();
    if (judgement !== null && run !== null) {
      handle(
        run.observe({
          distances: judgement.distances,
          nowMs: deps.now(),
          precision: judgement.precision,
        }),
      );
    }
    render();
    const presentBefore = presentId();
    const judgedPresence = publishPresence(m, judgement);
    // Leaving the last station finishes a complete tour; the line follows
    // a presence that changed this tick (being there, or not any more).
    if (finishOnLeaving(judgedPresence) || presentId() !== presentBefore) {
      render();
    }
    // Stations still to point at, and no heading to point with (D34).
    publishHeadingPending(!headingReady && liveRun()?.isComplete() === false);
    publishPrecision(kind);
  }

  /** A skip, from any of its paths: an offered station not yet done. A
   *  skip not settled yet settles first (the bring-back rule: a second skip inside the
   *  first's window must not drop the first's "done"). */
  function skipStation(run: StationRun, id: string): void {
    // Only a station still to find: a found one's story is ended on its
    // card, and a skip would let a bring back undo its find.
    if (run.status(id)?.state !== "waiting") return;
    if (!run.offered().includes(id)) return;
    settleUndo();
    // Recorded before the skip's own "done", which it holds back.
    change(skipTaken({ id, atMs: deps.now() }));
    handle(run.skip(id, deps.now()));
  }

  /** Bring a skipped station back, at any time: inside the
   *  undo's window the skip is simply taken back; after it settled, the
   *  prefetch hears it (`onUndone`). */
  function bringBack(run: StationRun, id: string): void {
    if (run.status(id)?.skipped !== true) return;
    const undoing = unsettledSkip()?.id === id;
    change(skipUndone({ id, atMs: deps.now() }));
    handle(run.unskip(id, deps.now()));
    if (!undoing) deps.onUndone?.(id);
  }

  /** "Can't get there?": the list opens with the focus's row
   *  armed, or, with no station guessed, to choose which. */
  function openToSkip(): void {
    const focus = focusStation();
    if (focus !== null) {
      change(listOpened({ armedId: focus, chooser: false }));
    } else if (walkNoGuess(walk())) {
      change(listOpened({ armedId: null, chooser: true }));
    }
  }

  /** The skip button's or the end control's tap (`skipTapped`), inside
   *  its call: the action the control carries, for the station it names
   *  (R14) - a clock that ran out since, or a focus that moved, changes
   *  nothing. */
  function skipTapped(action: SkipAction | null): void {
    const run = liveRun();
    if (run === null || action === null) return;
    // A tap that arrives while tracking is lost skips nothing.
    if (
      (action.kind === "ask-skip" || action.kind === "skip") &&
      trackingLost()
    ) {
      return;
    }
    switch (action.kind) {
      case "ask-skip":
        openToSkip();
        break;
      case "skip":
        skipStation(run, action.id);
        break;
      case "ask-end":
        // On demand: the first tap asks, the second acts.
        if (run.status(action.id)?.state === "found") {
          change(quickArmed(action.id));
        }
        break;
      case "end":
        disarm();
        if (run.status(action.id)?.state !== "found") break;
        if (deps.onEndStory !== undefined) {
          // The story panel ends it and reports back (`storyEnded`).
          deps.onEndStory(action.id);
          return;
        }
        handle(run.finish(action.id, deps.now()));
        break;
      case "undo":
        bringBack(run, action.id);
        break;
      case "finish-tour":
        handle(run.finishTour());
        break;
    }
    render();
  }

  /** A row's tap (`rowTapped`), inside its call. */
  function rowTapped(id: string, tap: WalkRowTap): void {
    const run = liveRun();
    if (run === null) return;
    // While tracking is lost a row offers no Skip and no confirm;
    // a tap that still arrives changes nothing.
    if ((tap === "skip" || tap === "confirm") && trackingLost()) return;
    const w = walk();
    switch (tap) {
      case "skip":
        // In chooser mode one tap skips (the undo covers a mistake);
        // otherwise the row asks for its confirm.
        if (w.chooser && walkNoGuess(w)) skipStation(run, id);
        else change(rowArmed(id));
        break;
      case "confirm":
        if (w.rowArmedId === id) skipStation(run, id);
        break;
      case "cancel":
        if (w.rowArmedId === id) change(rowArmed(null));
        break;
      case "bring":
        bringBack(run, id);
        break;
      case "choose":
        change(targetChosen(w.chosenId === id ? null : id));
        break;
    }
    render();
  }

  const guide: StationGuide = {
    tick() {
      inCall(tick);
    },
    codeLocked() {
      guide.tick();
    },
    storyEnded(stationId) {
      inCall(() => {
        const run = liveRun();
        if (run === null) return;
        handle(run.finish(stationId, deps.now()));
        if (walk().note !== null) change(noteCleared());
        render();
      });
    },
    skipTapped(control) {
      const action = skipActionOf(control ?? dom.skip);
      inCall(() => {
        skipTapped(action);
      });
    },
    rowTapped(stationId, tap) {
      inCall(() => {
        rowTapped(stationId, tap);
      });
    },
    cancelAsk() {
      inCall(() => {
        if (liveRun() === null) return;
        disarm();
        render();
      });
    },
    view() {
      if (!running()) return null;
      const focusId = focusStation();
      const distances = last?.distances ?? new Map<string, number>();
      // Without a focus (a story plays, the tour is complete) any
      // distance speaks for the position.
      const d =
        focusId !== null
          ? distances.get(focusId)
          : distances.size > 0
            ? 0
            : undefined;
      const position = positionKind(last, d);
      const precision = precisionKind(last);
      const w = walk();
      const noGuess = walkNoGuess(w);
      const undoable = selectUndoableSkip({ visitorWalk: w }, deps.now());
      return {
        focusId,
        position,
        precision,
        accuracyM:
          precision === "weak" || precision === "gps"
            ? last!.precision.accuracyM
            : null,
        distances,
        bearings: last?.bearings ?? new Map<string, number>(),
        headingDeg: last?.headingDeg ?? null,
        radarHeadingDeg: last?.radarHeadingDeg ?? null,
        headingConfirmed: last?.headingConfirmed ?? false,
        snapshot,
        quick: quickAction(),
        end: endAction(),
        chosenId: focusId !== null && w.chosenId === focusId ? focusId : null,
        canChoose: walkChoiceOffered(w),
        rowArmedId: w.rowArmedId,
        noGuess,
        chooser: noGuess && w.chooser,
        undo:
          undoable === null
            ? null
            : {
                id: undoable.id,
                leftMs: Math.max(0, undoable.atMs + SKIP_UNDO_MS - deps.now()),
              },
        note: noteText(),
        trackingLost: trackingLost(),
        there: thereOf(),
      };
    },

    endSession() {
      hud?.dispose();
      hud = null;
      replayFound = true;
      // The next AR entry earns its own heading (a new session's odometry).
      trackedHeading = false;
      headingReady = false;
      compassConfirmed = false;
      lastHeadingDeg = null;
      // The next AR entry's first tick without a distance enters the no-guess rule anew.
      noGuessBackAtMs = null;
      // The next AR entry starts with no judged geometry of its own.
      snapshot = null;
      // Nothing is present outside an AR session (visitor plan §3).
      presentByCode = false;
      if (deps.guideStore?.getState().visitorGuide.presentStationId != null) {
        deps.guideStore.dispatch(presenceCleared());
      }
      publishHeadingPending(false);
      publishPrecision("pending");
      deps.onGuide?.(null, null);
      deps.onFocusCue?.(null);
      dom.line.hidden = true;
      dom.skip.hidden = true;
      delete dom.skip.dataset["action"];
      delete dom.skip.dataset["station"];
      if (dom.end !== undefined) {
        dom.end.hidden = true;
        delete dom.end.dataset["action"];
        delete dom.end.dataset["station"];
      }
    },
    poseOf,
    figurePoseOf: (stationId) => (headingReady ? poseOf(stationId) : null),
  };
  return guide;
}

/**
 * How precise the position judged by is, by the framework's one rule
 * (`position-precision`). A lone fix is judged as one (the worse of the
 * device fixes' median and its own accuracy); every other measurement as
 * the session's alignment, a code holding it only while the visitor counts
 * as aligned (`measure`: a lone fix never borrows a code's trust). With no
 * position this tick (a tracking drop, a stale fix) the line and the HUD's
 * bands still speak of that alignment's precision - GPS too weak to guide
 * by is what the visitor can act on, with a position or still without -
 * while the gate judges nothing (`judged`).
 */
function precisionOf(
  visitor: VisitorPosition,
  loneFix: boolean,
  lined: boolean,
): PositionPrecision {
  return positionPrecision({
    position: loneFix ? "lone-fix" : "aligned",
    codeHold: visitor.aligned && lined,
    gpsPoints: visitor.gpsPoints,
    loneFixAccuracyM: visitor.fixAccuracyM,
  });
}
