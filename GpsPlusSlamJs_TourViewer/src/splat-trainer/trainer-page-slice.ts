/**
 * The splat trainer page's state: one Redux slice for the one page. The
 * reducers own every rule of the run - which stretch trains next, what a
 * stop keeps, what "train again" queues, what a save writes - so the rules
 * are testable without a page or a trainer. The recording's File, its
 * decoded inputs, preview pictures, trained splats and the running job's
 * AbortController live outside the store, in side tables keyed by the ids
 * this state holds (`trainer-page-store.ts`).
 *
 * @see trainer-page-slice.ts.md
 */

import { createSlice, type Draft, type PayloadAction } from "@reduxjs/toolkit";

import type {
  GpuProbe,
  TrainOutcome,
  Verdict,
  WindowJudgement,
  WindowMetrics,
} from "./trainer-adapter.js";
import type { StretchSummary } from "./window-plan.js";

type Phase =
  "start" | "reading" | "census" | "training" | "stopped" | "done" | "refused";

type RefusalKind = "phone" | "no-webgpu" | "recording";

type WindowStatus = "waiting" | "training" | "stopped" | "queued" | "done";

type Decision = "keep" | "discard";

/** The numbers of the recording the census card speaks about. */
interface CensusSummary {
  readonly frames: number;
  readonly skippedFrames: number;
  readonly pathM: number;
  readonly medianSpacingM: number | null;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly depthSamples: number;
}

export interface WindowState {
  readonly id: string;
  readonly index: number;
  readonly fromM: number;
  readonly toM: number;
  readonly frames: number;
  readonly status: WindowStatus;
  /** 1 for the first try; each "train again" adds one. */
  readonly attempt: number;
  /** 0 to 1 while training; 0 otherwise until done (then 1). */
  readonly progress: number;
  readonly secondsLeft: number | null;
  readonly nextPreviewInS: number | null;
  /** How many previews arrived for this attempt (the picture is a side table's). */
  readonly previews: number;
  readonly outcome: TrainOutcome | null;
  readonly metrics: WindowMetrics | null;
  readonly judgement: WindowJudgement | null;
  readonly trainingS: number | null;
  readonly decision: Decision | null;
}

type GpuStatus = "probing" | GpuProbe["kind"];

export interface TrainerPageState {
  readonly phase: Phase;
  readonly refusal: {
    readonly kind: RefusalKind;
    readonly reason: string | null;
  } | null;
  readonly gpu: {
    readonly status: GpuStatus;
    /** The user chose to train on built-in graphics anyway. */
    readonly accepted: boolean;
  };
  readonly trainer: "practice" | "unavailable";
  readonly recording: {
    readonly id: string;
    readonly name: string;
    readonly census: CensusSummary | null;
  } | null;
  readonly windows: readonly WindowState[];
  /** The stretch training now, or null. */
  readonly current: string | null;
  /** The stretches still to train, in order (never `current`, never done). */
  readonly queue: readonly string[];
  /**
   * The stretch the stop dialog was opened for, while it is open. A
   * stretch that finishes while the dialog is open does not start the
   * next one (`held`): Stop then stops nothing new, and Keep training
   * starts it.
   */
  readonly stopDialog: string | null;
  readonly held: boolean;
  readonly banner: string | null;
  readonly save: {
    readonly status: "idle" | "saving" | "saved" | "failed";
    readonly error: string | null;
    /** How many stretches the last successful save wrote. */
    readonly savedCount: number | null;
  };
}

export const initialTrainerPageState = (
  trainer: TrainerPageState["trainer"],
): TrainerPageState => ({
  phase: "start",
  refusal: null,
  gpu: { status: "probing", accepted: false },
  trainer,
  recording: null,
  windows: [],
  current: null,
  queue: [],
  stopDialog: null,
  held: false,
  banner: null,
  save: { status: "idle", error: null, savedCount: null },
});

/** Stretch numbers as people count them. */
export const stretchNo = (w: Pick<WindowState, "index">): number => w.index + 1;

function freshWindow(p: StretchSummary): WindowState {
  return {
    id: p.id,
    index: p.index,
    fromM: p.fromM,
    toM: p.toM,
    frames: p.frames,
    status: "waiting",
    attempt: 1,
    progress: 0,
    secondsLeft: null,
    nextPreviewInS: null,
    previews: 0,
    outcome: null,
    metrics: null,
    judgement: null,
    trainingS: null,
    decision: null,
  };
}

type S = Draft<TrainerPageState>;
type WindowDraft = Draft<WindowState>;

const windowOf = (s: S, id: string): WindowDraft | undefined =>
  s.windows.find((w) => w.id === id);

const isRunning = (s: S, id: string, attempt: number): boolean =>
  s.current === id && windowOf(s, id)?.attempt === attempt;

const finite01 = (x: number): number | null =>
  Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null;

const finiteOrNull = (x: number | null): number | null =>
  x !== null && Number.isFinite(x) && x >= 0 ? x : null;

/** Takes the next queued stretch, or ends the run when none is left. */
function startNext(s: S): void {
  const id = s.queue.shift();
  const w = id === undefined ? undefined : windowOf(s, id);
  if (w === undefined) {
    s.current = null;
    s.queue = [];
    s.phase = "done";
    s.banner = null;
    return;
  }
  s.current = w.id;
  w.status = "training";
  w.progress = 0;
  w.secondsLeft = null;
  w.nextPreviewInS = null;
  w.previews = 0;
}

function markUnsaved(s: S): void {
  if (s.save.status === "saved") {
    s.save = { status: "idle", error: null, savedCount: s.save.savedCount };
  }
}

const canTrain = (s: S): boolean =>
  s.trainer === "practice" &&
  (s.gpu.status === "ready" ||
    (s.gpu.status === "integrated" && s.gpu.accepted));

const trainerPageSlice = createSlice({
  name: "splatTrainer",
  initialState: initialTrainerPageState("unavailable"),
  reducers: {
    probeFinished(s, a: PayloadAction<GpuProbe["kind"]>) {
      s.gpu.status = a.payload;
      if (a.payload === "no-webgpu" && s.phase !== "refused") {
        s.phase = "refused";
        s.refusal = { kind: "no-webgpu", reason: null };
      }
    },
    recheckRequested(s) {
      s.gpu.status = "probing";
    },
    integratedAccepted(s) {
      s.gpu.accepted = true;
    },
    phoneRefused(s) {
      s.phase = "refused";
      s.refusal = { kind: "phone", reason: null };
    },
    readingStarted(s, a: PayloadAction<{ id: string; name: string }>) {
      if (s.phase !== "start" && s.phase !== "census") return;
      s.phase = "reading";
      s.recording = { id: a.payload.id, name: a.payload.name, census: null };
      s.windows = [];
    },
    readFinished(
      s,
      a: PayloadAction<{
        id: string;
        census: CensusSummary;
        windows: readonly StretchSummary[];
      }>,
    ) {
      if (s.phase !== "reading" || s.recording?.id !== a.payload.id) return;
      if (a.payload.windows.length === 0) {
        s.phase = "refused";
        s.refusal = {
          kind: "recording",
          reason: "This recording has no photos with a camera position.",
        };
        return;
      }
      s.recording.census = a.payload.census;
      s.windows = a.payload.windows.map(freshWindow) as WindowDraft[];
      s.phase = "census";
    },
    readRefused(s, a: PayloadAction<{ id: string; reason: string }>) {
      if (s.phase !== "reading" || s.recording?.id !== a.payload.id) return;
      s.phase = "refused";
      s.refusal = { kind: "recording", reason: a.payload.reason };
    },
    /** Back to the drop area; only from a census or a recording refusal. */
    anotherRecordingChosen(s) {
      const fromRecordingRefusal =
        s.phase === "refused" && s.refusal?.kind === "recording";
      if (s.phase !== "census" && !fromRecordingRefusal) return;
      const keep = { gpu: s.gpu, trainer: s.trainer };
      Object.assign(s, initialTrainerPageState(keep.trainer), {
        gpu: keep.gpu,
      });
    },
    trainingStarted(s) {
      if (s.phase !== "census" || !canTrain(s)) return;
      s.phase = "training";
      s.queue = s.windows.map((w) => w.id);
      s.banner = null;
      startNext(s);
    },
    progressed(
      s,
      a: PayloadAction<{
        id: string;
        attempt: number;
        fraction: number;
        secondsLeft: number | null;
        nextPreviewInS: number | null;
      }>,
    ) {
      const p = a.payload;
      if (!isRunning(s, p.id, p.attempt)) return;
      const w = windowOf(s, p.id);
      const fraction = finite01(p.fraction);
      if (w === undefined || fraction === null) return;
      w.progress = Math.max(w.progress, fraction);
      w.secondsLeft = finiteOrNull(p.secondsLeft);
      w.nextPreviewInS = finiteOrNull(p.nextPreviewInS);
    },
    previewed(s, a: PayloadAction<{ id: string; attempt: number }>) {
      if (!isRunning(s, a.payload.id, a.payload.attempt)) return;
      const w = windowOf(s, a.payload.id);
      if (w !== undefined) w.previews += 1;
    },
    windowFinished(
      s,
      a: PayloadAction<{
        id: string;
        attempt: number;
        outcome: TrainOutcome;
        metrics: WindowMetrics | null;
        judgement: WindowJudgement;
        trainingS: number;
      }>,
    ) {
      const p = a.payload;
      if (p.outcome === "cancelled" || !isRunning(s, p.id, p.attempt)) return;
      const w = windowOf(s, p.id);
      if (w === undefined) return;
      w.status = "done";
      w.progress = 1;
      w.secondsLeft = null;
      w.nextPreviewInS = null;
      w.outcome = p.outcome;
      w.metrics = p.metrics;
      w.judgement = { ...p.judgement, reasons: [...p.judgement.reasons] };
      w.trainingS = Number.isFinite(p.trainingS) ? p.trainingS : null;
      w.decision = null;
      if (s.stopDialog !== null) {
        s.current = null;
        s.held = true;
        return;
      }
      startNext(s);
    },
    stopAsked(s) {
      if (s.phase === "training" && s.current !== null) {
        s.stopDialog = s.current;
      }
    },
    stopDismissed(s) {
      s.stopDialog = null;
      if (s.held) {
        s.held = false;
        startNext(s);
      }
    },
    /** Stops only the stretch the dialog was opened for. */
    stopConfirmed(s, a: PayloadAction<{ id: string }>) {
      if (s.stopDialog === null || s.stopDialog !== a.payload.id) return;
      s.stopDialog = null;
      s.held = false;
      s.phase = "stopped";
      s.banner = null;
      const w = s.current === null ? undefined : windowOf(s, s.current);
      if (w !== undefined && w.id === a.payload.id) {
        w.status = "stopped";
        w.progress = 0;
        w.previews = 0;
        w.secondsLeft = null;
        w.nextPreviewInS = null;
        s.queue.unshift(w.id);
      }
      s.current = null;
      if (s.queue.length === 0) s.phase = "done";
    },
    continued(s) {
      if (s.phase !== "stopped") return;
      const kept = s.windows.filter((w) => w.status === "done").length;
      const at = s.queue[0] === undefined ? undefined : windowOf(s, s.queue[0]);
      for (const id of s.queue) {
        const w = windowOf(s, id);
        if (w?.status === "stopped") w.status = "waiting";
      }
      s.phase = "training";
      startNext(s);
      if (at !== undefined) {
        s.banner = `Continued at stretch ${stretchNo(at)}. The ${kept} finished ${kept === 1 ? "stretch was" : "stretches were"} kept.`;
      }
    },
    trainAgainAsked(s, a: PayloadAction<{ id: string }>) {
      const w = windowOf(s, a.payload.id);
      if (w === undefined || !canTrainAgain(w)) return;
      if (s.phase !== "done" && s.phase !== "training" && s.phase !== "stopped")
        return;
      w.attempt += 1;
      w.status = "queued";
      w.progress = 0;
      w.previews = 0;
      w.outcome = null;
      w.metrics = null;
      w.judgement = null;
      w.trainingS = null;
      w.decision = null;
      s.queue.push(w.id);
      markUnsaved(s);
      if (s.phase === "done") {
        s.phase = "training";
        startNext(s);
        s.banner = `Training stretch ${stretchNo(w)} again, with twice the time.`;
      } else if (s.phase === "training") {
        s.banner = `Stretch ${stretchNo(w)} trains again, with twice the time, after the others.`;
      }
    },
    decided(s, a: PayloadAction<{ id: string; decision: Decision | null }>) {
      const w = windowOf(s, a.payload.id);
      if (w?.status !== "done" || w.judgement?.verdict !== "poor") return;
      w.decision = a.payload.decision;
      markUnsaved(s);
    },
    saveStarted(s) {
      s.save = { ...s.save, status: "saving", error: null };
    },
    saveSucceeded(s, a: PayloadAction<{ count: number }>) {
      s.save = { status: "saved", error: null, savedCount: a.payload.count };
    },
    saveFailed(s, a: PayloadAction<{ message: string }>) {
      s.save = { ...s.save, status: "failed", error: a.payload.message };
    },
    saveCancelled(s) {
      s.save = { ...s.save, status: "idle", error: null };
    },
  },
});

/** Poor stretches may always train again; weak ones once. */
export function canTrainAgain(
  w: Pick<WindowState, "status" | "judgement" | "attempt">,
): boolean {
  if (w.status !== "done" || w.judgement === null) return false;
  return (
    w.judgement.verdict === "poor" ||
    (w.judgement.verdict === "weak" && w.attempt === 1)
  );
}

export const trainerPageActions = trainerPageSlice.actions;
export const trainerPageReducer = trainerPageSlice.reducer;

/* ---------- selectors (plain functions of the state) ---------- */

export const currentWindow = (s: TrainerPageState): WindowState | undefined =>
  s.current === null ? undefined : s.windows.find((w) => w.id === s.current);

export const finishedWindows = (s: TrainerPageState): WindowState[] =>
  s.windows.filter((w) => w.status === "done");

/** What a save writes: finished, not discarded, poor only when kept. */
export const windowsInFile = (s: TrainerPageState): WindowState[] =>
  finishedWindows(s).filter(
    (w) =>
      w.decision !== "discard" &&
      (w.judgement?.verdict !== "poor" || w.decision === "keep"),
  );

/** Finished stretches judged not good enough that nobody decided on. */
export const undecidedWindows = (s: TrainerPageState): WindowState[] =>
  finishedWindows(s).filter(
    (w) => w.judgement?.verdict === "poor" && w.decision === null,
  );

export function verdictCounts(s: TrainerPageState): Record<Verdict, number> {
  const c: Record<Verdict, number> = { good: 0, weak: 0, poor: 0 };
  for (const w of finishedWindows(s)) {
    if (w.judgement !== null) c[w.judgement.verdict] += 1;
  }
  return c;
}

/**
 * Seconds the whole run still needs: the training stretch's own estimate
 * plus, for each queued stretch, the average time a finished stretch took
 * (scaled for retries), or the training stretch's projected total before
 * any finished. Null while the trainer has not measured yet. A stand-in
 * until the trainer's own budgets give a better estimate.
 */
export function secondsLeftInRun(s: TrainerPageState): number | null {
  const cur = currentWindow(s);
  if (cur?.secondsLeft === null || cur === undefined) return null;
  const done = finishedWindows(s).filter((w) => w.trainingS !== null);
  const perAttempt =
    done.length > 0
      ? done.reduce((sum, w) => sum + (w.trainingS ?? 0) / w.attempt, 0) /
        done.length
      : cur.progress > 0.02
        ? cur.secondsLeft / (1 - cur.progress) / cur.attempt
        : null;
  if (perAttempt === null) return null;
  const rest = s.queue.reduce((sum, id) => {
    const w = s.windows.find((x) => x.id === id);
    return sum + perAttempt * (w?.attempt ?? 1);
  }, 0);
  return cur.secondsLeft + rest;
}
