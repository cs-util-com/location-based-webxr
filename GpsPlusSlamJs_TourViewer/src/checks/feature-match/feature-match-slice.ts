/**
 * The feature matching check page's state: one Redux slice for the whole
 * page session, shared by every view of the page. The reducers own the
 * rules of the photo test run (`run-plan.ts`: which pair a photo belongs
 * to, when a retake gets a new running number, one run or save at a
 * time), the run and speed test status, the options and the flat target
 * capture (its progress through `flatReducer`, the reference being
 * marked, the pose, the countdown and the prepared zip). Frames, results,
 * Blob URLs, the camera, canvases and timers live outside, in side tables
 * keyed by the ids this state holds (`feature-match-store.ts`).
 *
 * @see feature-match-slice.ts.md
 */
import {
  createSlice,
  current,
  isDraft,
  type Draft as ImmerDraft,
  type PayloadAction,
} from "@reduxjs/toolkit";

import type { TableRow } from "./bench-report";
import {
  EMPTY_PROGRESS,
  flatReducer,
  poseSummary,
  type FlatAction,
  type FlatProgress,
  type SurfaceProgress,
} from "./flat-progress";
import {
  CORNERS,
  POSES,
  type Point,
  type PoseId,
  type Size,
  type SurfaceClass,
} from "./flat-target";
import {
  EMPTY_PLAN,
  handsOffKind,
  maxSequence,
  planSlots,
  planReducer,
  type PhotoMeta,
  type PlanAction,
  type RunPlan,
} from "./run-plan";
import { doneCount, shotDue, slotStatus } from "./plan-slots";
import {
  isStill,
  readingsLost,
  stillStart,
  stillStep,
  type MotionSample,
  type StillState,
} from "./still-detector";

/** One action at a time: a run (benchmark or speed test) or a save. */
type Busy = "idle" | "running" | "saving";
/** "plan": a run on the current plan pair's photos (the guided view). */
type RunKind = "synthetic" | "speed" | "plan";
/** The page's one-line status texts. */
type StatusSlot = "run" | "synthetic" | "speed" | "copy";

/** The benchmark's options as the controls hold them (parsed at run time). */
export interface BenchOptions {
  readonly methods: {
    readonly sift: boolean;
    readonly xfeat: boolean;
    readonly aliked: boolean;
    readonly siftLightGlue: boolean;
  };
  readonly backends: readonly string[];
  readonly models: readonly string[];
  readonly sizes: readonly string[];
  readonly runs: string;
}

/** The speed test's options as the controls hold them. */
export interface SpeedOptions {
  readonly xfeat: boolean;
  readonly siftLightGlue: boolean;
  readonly dinoInt8: boolean;
  readonly dinoQ4f16: boolean;
  readonly backends: readonly string[];
  readonly edge: string;
  readonly cap: string;
  readonly runs: string;
}

/** A frame being marked or previewed; its pixels are the side table's. */
interface FrameMeta extends Size {
  readonly id: string;
}

/** A prepared surface zip waiting for its Save tap. */
interface FlatPrepared {
  /** The surface it was made for. */
  readonly surface: number;
  /** That surface's shot count when it was made. */
  readonly shots: number;
  /** Side table key of its Blob URL. */
  readonly urlId: string;
  readonly name: string;
  readonly text: string;
}

export interface FlatState {
  readonly open: boolean;
  readonly camera: boolean;
  readonly progress: FlatProgress;
  readonly pose: PoseId;
  /** The reference photo being marked, before it is accepted. */
  readonly still: FrameMeta | null;
  readonly taps: readonly Point[];
  /** The rectified preview of four good taps. */
  readonly preview: FrameMeta | null;
  /** Seconds left before the photo; null with no countdown. */
  readonly countdown: number | null;
  readonly saving: boolean;
  /** The user picked the next surface's class: no suggestion overwrites it. */
  readonly classPicked: boolean;
  /** Null, or valid for the current surface and its shot count. */
  readonly prepared: FlatPrepared | null;
  readonly status: string;
}

/** What the guided view's camera button does next, beside the plan. */
interface GuidedState {
  /** The photo of the current pair being replaced; null takes the due one. */
  readonly retake: "a" | "b" | null;
  /** A countdown before a photo; its timer is the view's. */
  readonly count: { readonly shot: "a" | "b"; readonly left: number } | null;
}

/**
 * The cockpit's hands-off photo B: "armed" after photo A until the first
 * reading (and on a move pair until the move), "waiting" for the phone to
 * rest, "taking" once it rested for the dwell (the view takes the photo),
 * then "taken", "refused" (the photo was not taken) or "failed" (the
 * readings stopped, or the capture threw). "off" with a take named means
 * that photo A is not armed again.
 */
type HandsOffPhase =
  "off" | "armed" | "waiting" | "taking" | "taken" | "refused" | "failed";

interface HandsOff {
  readonly phase: HandsOffPhase;
  /** The slot and photo A it was armed for; null arms on the next due B. */
  readonly slot: string | null;
  readonly a: string | null;
  /** The still detector's state while armed or waiting. */
  readonly still: StillState | null;
  /** The line the status shows for it. */
  readonly text: string;
}

const HANDS_OFF_IDLE: HandsOff = {
  phase: "off",
  slot: null,
  a: null,
  still: null,
  text: "",
};

const HANDS_OFF_TEXT = {
  still: "Hands off: photo B takes itself once the phone is still.",
  move: "Move the phone for photo B; it takes itself once the phone rests again.",
  waiting: "Hold still: photo B takes itself.",
  taking: "Taking photo B.",
  taken: "Photo B took itself.",
  refused: "Photo B was not taken by itself. Tap to take it.",
  failed: "Photo B could not be taken by itself. Tap to take it.",
  lost: "No motion readings: tap to take photo B.",
} as const;

/**
 * The guided view's Download all: "preparing" while the zip is packed,
 * then saved, failed, or "idle" again (the save dialog was closed).
 */
interface RunZip {
  readonly phase: "idle" | "preparing" | "saved" | "failed";
  /** The line under the button; empty shows the estimate. */
  readonly text: string;
}

/**
 * A single file of the guided view's measure sheet: "preparing" holds the
 * page busy ("saving") like the run zip; the text is the line beside the
 * file buttons.
 */
interface FileSave {
  readonly preparing: boolean;
  readonly text: string;
}

/** Where the page's last camera start stands, for the finder chip. */
type CameraStart = "idle" | "starting" | "failed";
const CAMERA_STARTS: readonly string[] = ["idle", "starting", "failed"];

/** The take a plan run measured, and its results once it ended. */
interface PlanRun {
  readonly slot: string;
  readonly seq: number;
  /** Side table key of the results; null while running or with none. */
  readonly resultsId: string | null;
}

export interface FeatureMatchState {
  /** This page load's token for the saved JSON (no time, no place). */
  readonly session: string;
  readonly progress: {
    /** The newest pair's running number; kept across reloads. */
    readonly sequence: number;
  };
  readonly camera: boolean;
  readonly busy: Busy;
  readonly running: RunKind | null;
  readonly status: Readonly<Record<StatusSlot, string>>;
  readonly table: readonly TableRow[];
  readonly report: string;
  readonly log: readonly string[];
  /** Errors since the last run started, for its report. */
  readonly errors: readonly string[];
  readonly options: BenchOptions;
  readonly speedOptions: SpeedOptions;
  readonly flat: FlatState;
  /** The photo test run of the plan-driven views (`run-plan.ts`). */
  readonly plan: RunPlan;
  readonly guided: GuidedState;
  readonly handsOff: HandsOff;
  readonly planRun: PlanRun | null;
  readonly runZip: RunZip;
  readonly fileSave: FileSave;
  readonly cameraStart: CameraStart;
  /** A plan photo the browser's database refused is not stored yet. */
  readonly photoStoreFailing: boolean;
}

/** The options as the page's controls start. */
const DEFAULT_OPTIONS: BenchOptions = {
  methods: { sift: true, xfeat: true, aliked: true, siftLightGlue: false },
  backends: ["webgpu", "wasm"],
  models: ["fp16", "fp32"],
  sizes: ["320", "480", "640"],
  runs: "5",
};

const DEFAULT_SPEED_OPTIONS: SpeedOptions = {
  xfeat: true,
  siftLightGlue: true,
  dinoInt8: true,
  dinoQ4f16: true,
  backends: ["webgpu", "wasm"],
  edge: "640",
  cap: "512",
  runs: "10",
};

export interface InitialInput {
  readonly session: string;
  readonly progress?: { readonly sequence: number };
  readonly flat?: FlatProgress;
  readonly plan?: RunPlan;
}

/**
 * The first state. The running number starts above every number the stored plan holds, so
 * a stored plan and stored progress that disagree never reuse a name.
 */
export function initialFeatureMatchState(i: InitialInput): FeatureMatchState {
  const plan = i.plan ?? EMPTY_PLAN;
  const sequence = Math.max(i.progress?.sequence ?? 0, maxSequence(plan));
  return {
    session: i.session,
    plan,
    guided: { retake: null, count: null },
    handsOff: HANDS_OFF_IDLE,
    planRun: null,
    runZip: { phase: "idle", text: "" },
    fileSave: { preparing: false, text: "" },
    cameraStart: "idle",
    photoStoreFailing: false,
    progress: { sequence },
    camera: false,
    busy: "idle",
    running: null,
    status: { run: "", synthetic: "", speed: "", copy: "" },
    table: [],
    report: "",
    log: [],
    errors: [],
    options: DEFAULT_OPTIONS,
    speedOptions: DEFAULT_SPEED_OPTIONS,
    flat: {
      open: false,
      camera: false,
      progress: i.flat ?? EMPTY_PROGRESS,
      pose: POSES[0]!.id,
      still: null,
      taps: [],
      preview: null,
      countdown: null,
      saving: false,
      classPicked: false,
      prepared: null,
      status: "",
    },
  };
}

// --- selectors ------------------------------------------------------------

/** The log as one text, one line each. */
export const logText = (s: FeatureMatchState): string =>
  s.log.map((l) => `${l}\n`).join("");

export const currentSurface = (f: FlatState): SurfaceProgress | null =>
  f.progress.surfaces.find((s) => s.id === f.progress.current) ?? null;

/** Which step of a surface is on screen. */
export type FlatPhase = "overview" | "ref-live" | "corners" | "check" | "poses";

export function flatPhase(f: FlatState): FlatPhase {
  const s = currentSurface(f);
  if (!s) {
    return "overview";
  }
  if (s.reference !== null) {
    return "poses";
  }
  if (f.still === null) {
    return "ref-live";
  }
  return f.preview ? "check" : "corners";
}

/**
 * Whether photo B is due to take itself: the setting is "auto", the
 * camera on, nothing busy and no countdown or retake; the current pair is
 * one the motion sensor can judge (`handsOffKind`), its photo A is taken
 * and B is missing; and this photo A was not armed before.
 */
export function handsOffDue(s: FeatureMatchState): boolean {
  const slot = planSlots(s.plan)[s.plan.current];
  const rec = slot ? s.plan.slots[slot.id] : undefined;
  const h = s.handsOff;
  return (
    s.plan.settings.capture === "auto" &&
    s.camera &&
    s.busy === "idle" &&
    s.guided.count === null &&
    s.guided.retake === null &&
    slot !== undefined &&
    handsOffKind(slot.key) !== null &&
    shotDue(rec, null) === "b" &&
    !(h.slot === slot.id && h.a === rec?.a?.id)
  );
}

/** The first pose not yet complete, else the first. */
const firstOpenPose = (s: SurfaceProgress): PoseId =>
  (POSES.find((p) => !poseSummary(s, p.id).complete) ?? POSES[0]!).id;

// --- reducers -------------------------------------------------------------

type Draft = { -readonly [K in keyof FeatureMatchState]: FeatureMatchState[K] };
type FlatDraft = { -readonly [K in keyof FlatState]: FlatState[K] };

const plain = <T>(v: T): T => (isDraft(v) ? current(v as ImmerDraft<T>) : v);

/** The status line a run writes to. */
const statusOf = (k: RunKind): StatusSlot => (k === "plan" ? "run" : k);

function setStatus(s: Draft, slot: StatusSlot, text: string): void {
  s.status = { ...s.status, [slot]: text };
}

/** Applies a progress action, keeping the prepared zip only while valid. */
function applyFlat(f: FlatDraft, a: FlatAction): void {
  f.progress = flatReducer(plain(f.progress), a);
}

/** A prepared zip is dropped once the surface, its shots or the step changed. */
function settleFlat(f: FlatDraft): void {
  const p = f.prepared;
  if (!p) {
    return;
  }
  const s = currentSurface(f);
  if (
    flatPhase(f) !== "poses" ||
    !s ||
    p.surface !== s.id ||
    p.shots !== s.shots.length
  ) {
    f.prepared = null;
  }
}

function clearMarking(f: FlatDraft): void {
  f.still = null;
  f.taps = [];
  f.preview = null;
}

const flatCase =
  <P>(fn: (f: FlatDraft, payload: P) => void) =>
  (s: Draft, a: PayloadAction<P>): void => {
    const f = s.flat as FlatDraft;
    fn(f, a.payload);
    settleFlat(f);
  };

/**
 * A slice case over `planReducer`. A refused plan action leaves the draft
 * untouched, so the state keeps its identity; a photo is also refused
 * while a run or save is going (it would change the pair under it).
 */
const planCase =
  <P>(make: (payload: P) => PlanAction) =>
  (s: Draft, a: PayloadAction<P>): void => {
    const action = make(a.payload);
    if (
      (action.type === "photo" || action.type === "reset") &&
      s.busy !== "idle"
    ) {
      return;
    }
    const before = plain(s.plan);
    const next = planReducer(before, s.progress.sequence, action);
    if (next.plan === before) {
      return;
    }
    s.plan = next.plan;
    if (next.sequence !== s.progress.sequence) {
      s.progress = { ...s.progress, sequence: next.sequence };
    }
    if (TARGET_CHANGES.has(action.type)) {
      s.guided = { retake: null, count: null };
    }
    if (action.type === "photo") {
      endHandsOff(s);
    } else if (TARGET_CHANGES.has(action.type)) {
      s.handsOff = HANDS_OFF_IDLE;
    }
    if (
      (action.type === "photo" && s.planRun?.slot === action.slot) ||
      action.type === "reset" ||
      action.type === "size"
    ) {
      s.planRun = null;
    }
    // A saved or failed zip no longer holds the plan's photos.
    if (
      STALE_ZIP.has(action.type) &&
      s.runZip.phase !== "preparing" &&
      (s.runZip.phase !== "idle" || s.runZip.text !== "")
    ) {
      s.runZip = { phase: "idle", text: "" };
    }
    // The single-file line names one pair's file; a file being prepared
    // keeps its own line until it ends.
    if (
      FILE_LINE_STALE.has(action.type) &&
      !s.fileSave.preparing &&
      s.fileSave.text !== ""
    ) {
      s.fileSave = { preparing: false, text: "" };
    }
  };

/** Plan actions after which the single-file line names another pair's file. */
const FILE_LINE_STALE: ReadonlySet<PlanAction["type"]> = new Set([
  "photo",
  "lost",
  "move",
  "size",
  "reset",
]);

/** Plan actions after which a zip made before holds other photos. */
const STALE_ZIP: ReadonlySet<PlanAction["type"]> = new Set([
  "photo",
  "lost",
  "size",
  "reset",
]);

/** Plan actions after which a retake target or countdown means another photo. */
const TARGET_CHANGES: ReadonlySet<PlanAction["type"]> = new Set([
  "photo",
  "move",
  "size",
  "reset",
]);

/** Ends an armed or waiting hands-off photo; that photo A stays named. */
function endHandsOff(s: Draft): void {
  const p = s.handsOff.phase;
  if (p === "armed" || p === "waiting") {
    s.handsOff = { ...s.handsOff, phase: "off", still: null, text: "" };
  }
}

/** The current plan slot and its record, if any. */
function currentSlot(s: Draft) {
  const slot = planSlots(s.plan)[s.plan.current];
  return { slot, rec: slot ? s.plan.slots[slot.id] : undefined };
}

const slice = createSlice({
  name: "featureMatch",
  initialState: initialFeatureMatchState({ session: "" }),
  reducers: {
    cameraChanged(s: Draft, a: PayloadAction<boolean>) {
      s.camera = a.payload;
      const p = s.handsOff.phase;
      if (!a.payload && (p === "armed" || p === "waiting")) {
        s.handsOff = HANDS_OFF_IDLE;
      }
    },
    /** A run or the speed test starts; refused unless idle. */
    runStarted(s: Draft, a: PayloadAction<RunKind>) {
      if (s.busy !== "idle") {
        return;
      }
      const kind = a.payload;
      if (kind === "plan") {
        const { slot, rec } = currentSlot(s);
        const st = slotStatus(rec);
        if (!slot || !rec || (st !== "done" && st !== "retake")) {
          return;
        }
        s.planRun = { slot: slot.id, seq: rec.seq, resultsId: null };
        s.guided = { ...s.guided, count: null };
      }
      endHandsOff(s);
      s.busy = "running";
      s.running = kind;
      setStatus(s, statusOf(kind), "running");
    },
    /** A line from the run in progress, shown on its status. */
    runProgressed(s: Draft, a: PayloadAction<string>) {
      if (s.running === null) {
        return;
      }
      setStatus(s, statusOf(s.running), `running: ${a.payload}`);
    },
    /** The run in progress ended; a plan run keeps its results' id. */
    runFinished(
      s: Draft,
      a: PayloadAction<{ text: string; resultsId: string | null }>,
    ) {
      const kind = s.running;
      if (s.busy !== "running" || kind === null) {
        return;
      }
      s.busy = "idle";
      s.running = null;
      setStatus(s, statusOf(kind), a.payload.text);
      if (kind === "plan" && s.planRun) {
        s.planRun = { ...s.planRun, resultsId: a.payload.resultsId };
      }
    },
    statusSet(s: Draft, a: PayloadAction<{ slot: StatusSlot; text: string }>) {
      setStatus(s, a.payload.slot, a.payload.text);
    },
    tableSet(s: Draft, a: PayloadAction<readonly TableRow[]>) {
      s.table = a.payload;
    },
    reportSet(s: Draft, a: PayloadAction<string>) {
      s.report = a.payload;
    },
    /** A finished log line (the view stamps the time). */
    logged(s: Draft, a: PayloadAction<string>) {
      s.log = [...s.log, a.payload];
    },
    /** A failure: kept for the run's report and logged as ERROR. */
    failed(s: Draft, a: PayloadAction<{ line: string; stamped: string }>) {
      s.errors = [...s.errors, a.payload.line];
      s.log = [...s.log, a.payload.stamped];
    },
    errorsCleared(s: Draft) {
      s.errors = [];
    },
    planSized: planCase((p: { spots: number; extra: number }) => ({
      type: "size",
      ...p,
    })),
    planMoved: planCase((index: number) => ({ type: "move", index })),
    planPhotoTaken: planCase(
      (p: { slot: string; which: "a" | "b"; photo: PhotoMeta }) => ({
        type: "photo",
        ...p,
      }),
    ),
    planPhotoLost: planCase((p: { slot: string; which: "a" | "b" }) => ({
      type: "lost",
      ...p,
    })),
    planFileKept: planCase((p: { id: string; name: string; slot: string }) => ({
      type: "keep",
      ...p,
    })),
    planFilesDownloaded: planCase((ids: readonly string[]) => ({
      type: "downloaded",
      ids,
    })),
    planRunDownloaded: planCase((_: void) => ({ type: "run-downloaded" })),
    planKeptDropped: planCase((_: void) => ({ type: "drop-downloaded" })),
    planSettingsChanged: planCase(
      (settings: Readonly<Record<string, unknown>>) => ({
        type: "settings",
        settings,
      }),
    ),
    planReset: planCase((_: void) => ({ type: "reset" })),
    /**
     * Tap on thumbnail A or B: that photo is retaken next, a second tap
     * takes it back. Refused while counting or busy, and for a photo the
     * current pair does not hold.
     */
    guidedRetakeToggled(s: Draft, a: PayloadAction<"a" | "b">) {
      const which = a.payload;
      const { rec } = currentSlot(s);
      if (
        s.guided.count !== null ||
        s.busy !== "idle" ||
        (which !== "a" && which !== "b") ||
        !rec?.[which]
      ) {
        return;
      }
      s.guided = {
        ...s.guided,
        retake: s.guided.retake === which ? null : which,
      };
      endHandsOff(s);
    },
    /**
     * A countdown second, or null to end it (taken or cancelled). Refused
     * while busy, for a photo that is not the one due, and for a count
     * that is not a whole number of at least 1.
     */
    guidedCountSet(
      s: Draft,
      a: PayloadAction<{ shot: "a" | "b"; left: number } | null>,
    ) {
      const c = a.payload;
      if (c === null) {
        if (s.guided.count !== null) {
          s.guided = { ...s.guided, count: null };
        }
        return;
      }
      const { rec } = currentSlot(s);
      if (
        s.busy !== "idle" ||
        !Number.isInteger(c.left) ||
        c.left < 1 ||
        shotDue(rec, s.guided.retake) !== c.shot
      ) {
        return;
      }
      s.guided = { ...s.guided, count: { shot: c.shot, left: c.left } };
      endHandsOff(s);
    },
    /**
     * Photo B starts waiting to take itself, from page time `t`; refused
     * unless `handsOffDue` and `t` is finite.
     */
    handsOffArmed(s: Draft, a: PayloadAction<number>) {
      const t = a.payload;
      if (!Number.isFinite(t) || !handsOffDue(s)) {
        return;
      }
      const { slot, rec } = currentSlot(s);
      const kind = slot ? handsOffKind(slot.key) : null;
      if (!slot || !rec?.a || kind === null) {
        return;
      }
      s.handsOff = {
        phase: "armed",
        slot: slot.id,
        a: rec.a.id,
        still: stillStart(t, kind === "move"),
        text: HANDS_OFF_TEXT[kind],
      };
    },
    /**
     * A motion reading, or a missing one (rate null) from the page's
     * watchdog: only while armed or waiting and idle. The detector
     * validates it; readings lost end the wait as "failed".
     */
    handsOffSample(s: Draft, a: PayloadAction<MotionSample>) {
      const h = s.handsOff;
      const p = a.payload as MotionSample | null;
      if (
        (h.phase !== "armed" && h.phase !== "waiting") ||
        !h.still ||
        s.busy !== "idle" ||
        !p ||
        typeof p.t !== "number"
      ) {
        return;
      }
      const before = plain(h.still);
      const st = stillStep(before, p);
      if (readingsLost(st, p.t)) {
        s.handsOff = {
          ...h,
          phase: "failed",
          still: null,
          text: HANDS_OFF_TEXT.lost,
        };
        return;
      }
      const phase =
        !st.seen || !st.moved ? "armed" : isStill(st) ? "taking" : "waiting";
      if (st === before && phase === h.phase) {
        return;
      }
      s.handsOff = {
        ...h,
        phase,
        still: phase === "taking" ? null : st,
        text:
          phase === "armed"
            ? h.text
            : phase === "taking"
              ? HANDS_OFF_TEXT.taking
              : HANDS_OFF_TEXT.waiting,
      };
    },
    /** How the photo the wait asked for went; only while "taking". */
    handsOffShot(s: Draft, a: PayloadAction<"taken" | "refused" | "failed">) {
      const r = a.payload;
      if (
        s.handsOff.phase !== "taking" ||
        (r !== "taken" && r !== "refused" && r !== "failed")
      ) {
        return;
      }
      s.handsOff = { ...s.handsOff, phase: r, text: HANDS_OFF_TEXT[r] };
    },
    /** The drawer opened: the wait stops, and arms again once it closes. */
    handsOffPaused(s: Draft) {
      const p = s.handsOff.phase;
      if (p === "armed" || p === "waiting") {
        s.handsOff = HANDS_OFF_IDLE;
      }
    },
    /** Download all starts packing; refused unless idle with a complete pair. */
    runZipStarted(s: Draft) {
      if (
        s.busy !== "idle" ||
        doneCount(planSlots(s.plan), s.plan.slots) === 0
      ) {
        return;
      }
      s.busy = "saving";
      s.runZip = {
        phase: "preparing",
        text: "Packing the photos. Keep this page open.",
      };
    },
    /** The zip was saved, failed, or not saved ("idle": the dialog was closed). */
    runZipEnded(
      s: Draft,
      a: PayloadAction<{ phase: "idle" | "saved" | "failed"; text: string }>,
    ) {
      if (s.busy !== "saving" || s.runZip.phase !== "preparing") {
        return;
      }
      s.busy = "idle";
      s.runZip = { phase: a.payload.phase, text: a.payload.text };
    },
    /** One file of the measure sheet is prepared; refused unless idle. */
    planFileSaveStarted(s: Draft) {
      if (s.busy !== "idle") {
        return;
      }
      s.busy = "saving";
      s.fileSave = { preparing: true, text: "preparing..." };
    },
    /** That file was saved, not saved or failed, as the text says. */
    planFileSaveEnded(s: Draft, a: PayloadAction<string>) {
      if (s.busy !== "saving" || !s.fileSave.preparing) {
        return;
      }
      s.busy = "idle";
      s.fileSave = { preparing: false, text: a.payload };
    },
    cameraStartSet(s: Draft, a: PayloadAction<CameraStart>) {
      if (CAMERA_STARTS.includes(a.payload)) {
        s.cameraStart = a.payload;
      }
    },
    photoStoreChanged(s: Draft, a: PayloadAction<boolean>) {
      s.photoStoreFailing = a.payload;
    },
    optionsChanged(s: Draft, a: PayloadAction<BenchOptions>) {
      s.options = a.payload;
    },
    speedOptionsChanged(s: Draft, a: PayloadAction<SpeedOptions>) {
      s.speedOptions = a.payload;
    },

    // --- flat target capture --------------------------------------------

    flatOpened: flatCase((f, _: void) => {
      if (f.open) {
        return;
      }
      f.open = true;
      const s = currentSurface(f);
      if (s) {
        f.pose = firstOpenPose(s);
      }
    }),
    flatClosed: flatCase((f, _: void) => {
      f.open = false;
      f.countdown = null;
    }),
    flatCameraChanged: flatCase((f, on: boolean) => {
      f.camera = on;
    }),
    flatSurfaceAdded: flatCase(
      (f, p: { cls: SurfaceClass; original: boolean }) => {
        applyFlat(f, { type: "add-surface", cls: p.cls, original: p.original });
        f.classPicked = false;
        clearMarking(f);
        f.status = "";
      },
    ),
    flatSurfaceSelected: flatCase((f, id: number) => {
      applyFlat(f, { type: "select", id });
      const s = currentSurface(f);
      if (s && s.id === id) {
        f.pose = firstOpenPose(s);
      }
    }),
    /** Back to the overview: the countdown and any marking are dropped. */
    flatOverview: flatCase((f, _: void) => {
      f.countdown = null;
      clearMarking(f);
      applyFlat(f, { type: "select", id: null });
      f.status = "";
    }),
    flatClassPicked: flatCase((f, _: void) => {
      f.classPicked = true;
    }),
    flatPoseChosen: flatCase((f, pose: PoseId) => {
      if (POSES.some((p) => p.id === pose)) {
        f.pose = pose;
      }
    }),
    flatCountdown: flatCase((f, left: number | null) => {
      f.countdown = left;
    }),
    flatStatus: flatCase((f, text: string) => {
      f.status = text;
    }),
    /** The reference photo of the current surface, to be marked. */
    flatReferenceTaken: flatCase((f, still: FrameMeta) => {
      if (flatPhase(f) !== "ref-live") {
        return;
      }
      f.still = still;
      f.taps = [];
      f.preview = null;
      f.status = `reference taken, ${String(still.width)}x${String(still.height)}`;
    }),
    /** A retake of the reference shows the live camera first. */
    flatReferenceDropped: flatCase((f, _: void) => {
      clearMarking(f);
      f.status = "aim again, then tap Take reference";
    }),
    flatTapped: flatCase((f, p: Point) => {
      if (
        flatPhase(f) !== "corners" ||
        f.taps.length >= 4 ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y)
      ) {
        return;
      }
      f.taps = [...f.taps, { x: p.x, y: p.y }];
    }),
    flatPreviewMade: flatCase((f, preview: FrameMeta) => {
      if (flatPhase(f) !== "corners" || f.taps.length !== 4) {
        return;
      }
      f.preview = preview;
      f.status = `straightened: ${String(preview.width)}x${String(preview.height)}`;
    }),
    flatCornersRedone: flatCase((f, _: void) => {
      f.taps = [];
      f.preview = null;
      f.status = `tap the ${CORNERS[0]} corner`;
    }),
    /** Use this reference: taps and sizes into the progress, then the poses. */
    flatReferenceAccepted: flatCase((f, _: void) => {
      const s = currentSurface(f);
      if (!s || !f.still || !f.preview || flatPhase(f) !== "check") {
        return;
      }
      applyFlat(f, {
        type: "set-reference",
        id: s.id,
        reference: {
          corners: plain(f.taps),
          width: f.still.width,
          height: f.still.height,
          rectified: { width: f.preview.width, height: f.preview.height },
        },
      });
      clearMarking(f);
      f.pose = POSES[0]!.id;
      f.status = "reference kept: now the poses";
    }),
    flatShotTaken: flatCase((f, greyMean: number) => {
      const s = currentSurface(f);
      if (!s) {
        return;
      }
      applyFlat(f, { type: "add-shot", id: s.id, pose: f.pose, greyMean });
    }),
    flatShotRemoved: flatCase((f, _: void) => {
      const s = currentSurface(f);
      if (!s) {
        return;
      }
      applyFlat(f, { type: "remove-last-shot", id: s.id, pose: f.pose });
    }),
    flatSavingStarted: flatCase((f, _: void) => {
      const s = currentSurface(f);
      if (f.saving || !s || !s.reference) {
        return;
      }
      f.saving = true;
      f.prepared = null;
      f.status = "preparing the zip...";
    }),
    flatSavingEnded: flatCase(
      (f, p: { prepared: FlatPrepared | null; status: string }) => {
        if (!f.saving) {
          return;
        }
        f.saving = false;
        f.prepared = p.prepared;
        f.status = p.status;
      },
    ),
    /** The prepared zip was tapped: its surface's photos count as downloaded. */
    flatSaved: flatCase((f, _: void) => {
      const s = currentSurface(f);
      if (!f.prepared || !s || f.prepared.surface !== s.id) {
        return;
      }
      applyFlat(f, { type: "saved", id: s.id });
      f.status = `downloaded ${f.prepared.name}: ${f.prepared.text}`;
    }),
  },
});

export const featureMatchActions = slice.actions;
export const featureMatchReducer = slice.reducer;
export type FeatureMatchAction = ReturnType<
  (typeof featureMatchActions)[keyof typeof featureMatchActions]
>;
