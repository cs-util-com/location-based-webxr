/**
 * The feature matching check page's state: one Redux slice for the whole
 * page session, shared by every view of the page. The reducers own the
 * rules of the photo-pair flow (which pair a photo belongs to, when a
 * retake gets a new running number, when the selector moves on, one run or
 * save at a time), the run and speed test status, the options and the flat
 * target capture (its progress through `flatReducer`, the reference being
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

import {
  FLAT_MODE,
  lightCheck,
  NO_PAIR,
  nextPair,
  PAIRS,
  pairTag,
  parseSpot,
  type LightCheck,
  type PairTag,
  type SelectorKey,
} from "./bench-export";
import type { TableRow } from "./bench-report";
import type { FlowState } from "./bench-steps";
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

/** Save's label after a camera run that measured nothing. */
export const NOTHING_MEASURED =
  "nothing measured: tap to save the photos anyway";
/** Save's label before there is anything to save. */
const AFTER_THE_RUN = "after the run";

/** One action at a time: a run (benchmark or speed test) or a save. */
type Busy = "idle" | "running" | "saving";
type RunKind = "camera" | "synthetic" | "speed";
/** The page's one-line status texts. */
export type StatusSlot =
  "a" | "b" | "run" | "synthetic" | "speed" | "save" | "copy";

/** A taken photo; its pixels are the side table's, under `id`. */
export interface PhotoMeta {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** The camera stream's size when it was taken. */
  readonly source: Size;
  /** Grey mean 0 to 255, for the light check. */
  readonly greyMean: number;
}

/** What the pair line under the selector says. */
export type PairNote =
  | { readonly kind: "now"; readonly tag: PairTag }
  | { readonly kind: "kept"; readonly tag: PairTag }
  | {
      readonly kind: "next";
      readonly tag: PairTag;
      readonly next: { readonly key: string; readonly spot: number };
    };

/** An offered download; its Blob URL is the side table's, under `id`. */
export interface Offered {
  readonly id: string;
  readonly file: string;
  readonly text: string;
}

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

export interface FeatureMatchState {
  /** This page load's token for the saved JSON (no time, no place). */
  readonly session: string;
  readonly progress: {
    /** The newest pair's running number; kept across reloads. */
    readonly sequence: number;
    readonly pair: SelectorKey;
    readonly spot: number;
    /** The newest pair any of whose files was downloaded. */
    readonly advancedFor: number;
    /** The pair picked before the flat mode, for its Exit. */
    readonly lastPair: SelectorKey;
  };
  readonly camera: boolean;
  /** The pair of the current photos, fixed at photo A. */
  readonly pairInProgress: PairTag | null;
  readonly pairNote: PairNote | null;
  readonly photos: {
    readonly a: PhotoMeta | null;
    readonly b: PhotoMeta | null;
  };
  /** The current pair's light check, set at photo B; null otherwise. */
  readonly light: LightCheck | null;
  readonly cameraRun: FlowState["run"];
  /** Side table key of the camera run's results; null with none. */
  readonly resultsId: string | null;
  readonly saved: boolean;
  readonly busy: Busy;
  readonly running: RunKind | null;
  readonly offered: readonly Offered[];
  readonly status: Readonly<Record<StatusSlot, string>>;
  readonly table: readonly TableRow[];
  readonly report: string;
  readonly log: readonly string[];
  /** Errors since the last run started, for its report. */
  readonly errors: readonly string[];
  readonly options: BenchOptions;
  readonly speedOptions: SpeedOptions;
  readonly flat: FlatState;
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

const SELECTOR_KEYS: readonly string[] = [
  ...PAIRS.map((p) => p.key),
  NO_PAIR.key,
  FLAT_MODE.key,
];
const isSelectorKey = (k: unknown): k is SelectorKey =>
  typeof k === "string" && SELECTOR_KEYS.includes(k);
const isSpot = (n: unknown): n is number =>
  typeof n === "number" && parseSpot(String(n)) === n;
const isSize = (n: unknown): boolean =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
const isMean = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 255;

export interface InitialInput {
  readonly session: string;
  readonly progress?: {
    readonly sequence: number;
    readonly pair: SelectorKey;
    readonly spot: number;
  };
  readonly flat?: FlatProgress;
}

/** The first state; a stored pair of `flat` keeps the first pair for Exit. */
export function initialFeatureMatchState(i: InitialInput): FeatureMatchState {
  const p = i.progress ?? { sequence: 0, pair: "1a", spot: 1 };
  return {
    session: i.session,
    progress: {
      sequence: p.sequence,
      pair: p.pair,
      spot: p.spot,
      advancedFor: p.sequence,
      lastPair: p.pair === FLAT_MODE.key ? PAIRS[0].key : p.pair,
    },
    camera: false,
    pairInProgress: null,
    pairNote: null,
    photos: { a: null, b: null },
    light: null,
    cameraRun: "none",
    resultsId: null,
    saved: false,
    busy: "idle",
    running: null,
    offered: [],
    status: {
      a: "not taken",
      b: "not taken",
      run: "waiting for photo B",
      synthetic: "",
      speed: "",
      save: AFTER_THE_RUN,
      copy: "",
    },
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

/** The camera pair's flow, for the step marks. */
export const flowState = (s: FeatureMatchState): FlowState => ({
  a: s.photos.a !== null,
  b: s.photos.b !== null,
  run: s.cameraRun,
  saved: s.saved,
});

/** Save is possible once the camera pair's run has ended, whatever it came to. */
export const canSave = (s: FeatureMatchState): boolean =>
  s.busy === "idle" &&
  s.photos.a !== null &&
  s.photos.b !== null &&
  (s.cameraRun === "done" || s.cameraRun === "failed");

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

/** The first pose not yet complete, else the first. */
const firstOpenPose = (s: SurfaceProgress): PoseId =>
  (POSES.find((p) => !poseSummary(s, p.id).complete) ?? POSES[0]!).id;

// --- reducers -------------------------------------------------------------

type Draft = { -readonly [K in keyof FeatureMatchState]: FeatureMatchState[K] };
type FlatDraft = { -readonly [K in keyof FlatState]: FlatState[K] };

const plain = <T>(v: T): T => (isDraft(v) ? current(v as ImmerDraft<T>) : v);

/** Withdraws the offered files (their URLs are revoked by the store). */
function clearSaved(s: Draft, text: string): void {
  s.offered = [];
  s.saved = false;
  setStatus(s, "save", text);
}

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

const slice = createSlice({
  name: "featureMatch",
  initialState: initialFeatureMatchState({ session: "" }),
  reducers: {
    /** The pair selector or the spot field changed. */
    selectorChanged(
      s: Draft,
      a: PayloadAction<{ pair: unknown; spot: unknown }>,
    ) {
      const { pair, spot } = a.payload;
      if (!isSelectorKey(pair) || !isSpot(spot)) {
        return;
      }
      s.progress = {
        ...s.progress,
        pair,
        spot,
        lastPair: pair === FLAT_MODE.key ? s.progress.lastPair : pair,
      };
    },
    /** Exit of the flat mode: the pair picked before it comes back. */
    flatExited(s: Draft) {
      s.progress = { ...s.progress, pair: s.progress.lastPair };
    },
    cameraChanged(s: Draft, a: PayloadAction<boolean>) {
      s.camera = a.payload;
    },
    /**
     * A photo was taken. Photo A starts a new pair (new running number,
     * photo B cleared); photo B of a pair any of whose files was
     * downloaded is a new take (new running number), and gets the light
     * check. Either withdraws the run and its files. Refused while busy,
     * for photo B without A, in the flat mode, and for bad sizes.
     */
    photoTaken(
      s: Draft,
      a: PayloadAction<{ which: "a" | "b"; photo: PhotoMeta }>,
    ) {
      const { which, photo } = a.payload;
      if (
        s.busy !== "idle" ||
        s.progress.pair === FLAT_MODE.key ||
        (which === "b" && (s.photos.a === null || s.pairInProgress === null)) ||
        !isSize(photo.width) ||
        !isSize(photo.height) ||
        !isMean(photo.greyMean)
      ) {
        return;
      }
      setStatus(
        s,
        which,
        `taken, ${String(photo.width)}x${String(photo.height)}`,
      );
      s.cameraRun = "none";
      s.resultsId = null;
      clearSaved(s, AFTER_THE_RUN);
      s.light = null;
      if (which === "a") {
        const sequence = s.progress.sequence + 1;
        s.progress = { ...s.progress, sequence };
        s.pairInProgress = pairTag(s.progress.pair, s.progress.spot, sequence);
        s.pairNote = { kind: "now", tag: s.pairInProgress };
        s.photos = { a: photo, b: null };
        setStatus(s, "b", "not taken");
        setStatus(s, "run", "waiting for photo B");
        return;
      }
      s.photos = { ...s.photos, b: photo };
      const tag = s.pairInProgress!;
      if (tag.sequence <= s.progress.advancedFor) {
        const sequence = s.progress.sequence + 1;
        s.progress = { ...s.progress, sequence };
        s.pairInProgress = { ...tag, sequence };
        s.pairNote = { kind: "now", tag: s.pairInProgress };
      }
      s.light = lightCheck(
        s.pairInProgress!.pair,
        s.photos.a!.greyMean,
        photo.greyMean,
      );
    },
    /** A run or the speed test starts; refused unless idle. */
    runStarted(s: Draft, a: PayloadAction<RunKind>) {
      if (s.busy !== "idle") {
        return;
      }
      const kind = a.payload;
      if (kind === "camera" && (s.photos.a === null || s.photos.b === null)) {
        return;
      }
      s.busy = "running";
      s.running = kind;
      if (kind === "camera") {
        s.cameraRun = "running";
        s.resultsId = null;
        clearSaved(s, AFTER_THE_RUN);
      }
      setStatus(s, kind === "camera" ? "run" : kind, "running");
    },
    /** A line from the run in progress, shown on its status. */
    runProgressed(s: Draft, a: PayloadAction<string>) {
      if (s.running === null) {
        return;
      }
      setStatus(
        s,
        s.running === "camera" ? "run" : s.running,
        `running: ${a.payload}`,
      );
    },
    /**
     * The synthetic run or the speed test replaces what Results shows, so
     * the camera run it hides is withdrawn with its offered files.
     */
    cameraRunWithdrawn(s: Draft) {
      if (s.cameraRun !== "done" && s.cameraRun !== "failed") {
        return;
      }
      s.cameraRun = "none";
      s.resultsId = null;
      clearSaved(s, AFTER_THE_RUN);
      setStatus(s, "run", "replaced by the synthetic run: tap Run again");
    },
    /**
     * The run in progress ended. A camera run with results is "done" and
     * offers its files; without results (nothing measured, or it threw)
     * it is "failed" and Save offers the photos alone.
     */
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
      setStatus(s, kind === "camera" ? "run" : kind, a.payload.text);
      if (kind === "camera") {
        s.cameraRun = a.payload.resultsId !== null ? "done" : "failed";
        s.resultsId = a.payload.resultsId;
        setStatus(
          s,
          "save",
          a.payload.resultsId !== null
            ? "ready: tap to prepare the files"
            : NOTHING_MEASURED,
        );
      }
    },
    saveStarted(s: Draft) {
      if (!canSave(s)) {
        return;
      }
      clearSaved(s, "preparing...");
      s.busy = "saving";
    },
    saveFinished(s: Draft, a: PayloadAction<readonly Offered[]>) {
      if (s.busy !== "saving") {
        return;
      }
      s.busy = "idle";
      s.offered = a.payload;
      s.saved = true;
      setStatus(s, "save", "ready: tap Download all (zip), or each file");
    },
    saveFailed(s: Draft) {
      if (s.busy !== "saving") {
        return;
      }
      s.busy = "idle";
      clearSaved(s, "failed (see log)");
    },
    /**
     * Any offered file was downloaded. The first time per pair the
     * selector moves on to the next pair, unless the light check failed:
     * that pair stays, to be taken again.
     */
    filesDownloaded(s: Draft) {
      const tag = s.pairInProgress;
      if (
        s.offered.length === 0 ||
        !tag ||
        tag.sequence <= s.progress.advancedFor
      ) {
        return;
      }
      if (s.light !== null && s.light !== "ok") {
        s.progress = { ...s.progress, advancedFor: tag.sequence };
        s.pairNote = { kind: "kept", tag };
        return;
      }
      const next = nextPair(tag.pair, tag.spot);
      s.progress = {
        ...s.progress,
        advancedFor: tag.sequence,
        pair: isSelectorKey(next.key) ? next.key : s.progress.pair,
        spot: next.spot,
        lastPair: isSelectorKey(next.key) ? next.key : s.progress.lastPair,
      };
      s.pairNote = { kind: "next", tag, next };
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
          corners: f.taps,
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
