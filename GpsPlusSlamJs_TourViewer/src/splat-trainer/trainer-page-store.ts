/**
 * The splat trainer page's store and its side effects. The slice decides
 * what happens; the listeners here make it happen: they read the dropped
 * recording, probe the graphics card, start the trainer on whichever
 * stretch the state says is training (and abort it the moment the state
 * says otherwise), and write the saved file. Things that are not state -
 * the File, the decoded recording, preview pictures, trained splats, the
 * running job's AbortController - live in side tables keyed by the ids the
 * state holds.
 *
 * @see trainer-page-store.ts.md
 */

import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import {
  releaseUnusedPick,
  type SaveFilePick,
} from "gps-plus-slam-app-framework/storage/save-target";

import type { SplatInputs, SplatInputsRead } from "./recording-reader.js";
import { buildPackage, packageFileName } from "./save-package.js";
import type {
  TrainerAdapter,
  TrainRequest,
  WindowJudgement,
  WindowTrainResult,
} from "./trainer-adapter.js";
import {
  attemptTimeScale,
  currentWindow,
  initialTrainerPageState,
  trainerPageActions as A,
  trainerPageReducer,
  type TrainerPageState,
  windowsInFile,
} from "./trainer-page-slice.js";
import {
  type PlannedWindow,
  summaryOf,
  type WindowPlanner,
} from "./window-plan.js";

export interface TrainerPageDeps {
  readonly adapter: TrainerAdapter;
  readonly read: (file: Blob) => Promise<SplatInputsRead>;
  readonly plan: WindowPlanner;
  /** Writes the saved file into a picked handle. */
  readonly write: (handle: FileSystemFileHandle, blob: Blob) => Promise<void>;
  /** Saves without a picked handle; false when the person cancelled. */
  readonly download: (blob: Blob, name: string) => Promise<boolean>;
}

/** What lives beside the store, keyed by recording or stretch id. */
export interface TrainerSideTables {
  readonly files: Map<string, Blob>;
  readonly inputs: Map<string, SplatInputs>;
  /** The planned windows of each recording, with their frame lists. */
  readonly plans: Map<string, readonly PlannedWindow[]>;
  /** The newest picture of each stretch's current attempt. */
  readonly previews: Map<string, CanvasImageSource>;
  readonly splats: Map<string, Blob>;
}

const FAILED_JUDGEMENT: WindowJudgement = {
  verdict: "poor",
  reasons: ["the trainer stopped"],
  say: "Training stopped with an error.",
};

/** What a failed save says of the file the person picked: the browser
 *  empties it as the dialog returns, and a new file and a replaced one
 *  cannot be told apart, so this must be true of both. */
const unwrittenPick = (name: string): string =>
  `The file "${name}" you picked was not written, and may now be empty.`;

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Lets go of a preview picture: an ImageBitmap holds its pixels until
 *  it is closed. */
function closePicture(picture: CanvasImageSource | undefined): void {
  const close = (picture as { close?: unknown } | undefined)?.close;
  if (typeof close === "function") {
    try {
      (close as () => void).call(picture);
    } catch {
      // A picture that cannot be closed is left to the garbage collector.
    }
  }
}

const runKeyOf = (s: TrainerPageState): string | null => {
  const w = currentWindow(s);
  return w === undefined ? null : `${w.id}#${w.attempt}`;
};

export function createTrainerPageStore(deps: TrainerPageDeps) {
  const listener = createListenerMiddleware<TrainerPageState>();
  const store = configureStore({
    reducer: trainerPageReducer,
    preloadedState: initialTrainerPageState(deps.adapter.kind),
    middleware: (getDefault) => getDefault().prepend(listener.middleware),
  });
  const sides: TrainerSideTables = {
    files: new Map(),
    inputs: new Map(),
    plans: new Map(),
    previews: new Map(),
    splats: new Map(),
  };
  let job: { key: string; ctrl: AbortController } | null = null;

  function setPreview(id: string, picture: CanvasImageSource): void {
    const old = sides.previews.get(id);
    if (old !== picture) closePicture(old);
    sides.previews.set(id, picture);
  }

  function dropPreview(id: string): void {
    closePicture(sides.previews.get(id));
    sides.previews.delete(id);
  }

  function dropAllPreviews(): void {
    for (const id of [...sides.previews.keys()]) dropPreview(id);
  }
  let nextRecording = 1;
  let disposed = false;

  async function probe(): Promise<void> {
    const found = await deps.adapter
      .probe()
      .catch(() => ({ kind: "no-webgpu" as const }));
    if (!disposed) store.dispatch(A.probeFinished(found.kind));
  }

  listener.startListening({
    actionCreator: A.recheckRequested,
    effect: () => probe(),
  });

  listener.startListening({
    actionCreator: A.readingStarted,
    effect: async ({ payload: { id } }, api) => {
      const file = sides.files.get(id);
      if (file === undefined) return;
      let read: SplatInputsRead;
      try {
        read = await deps.read(file);
      } catch (err) {
        read = { kind: "refused", reason: errorText(err) };
      }
      if (api.getState().recording?.id !== id) return;
      if (read.kind === "refused") {
        sides.files.delete(id);
        api.dispatch(
          A.readRefused(
            read.code === undefined
              ? { id, reason: read.reason }
              : { id, reason: read.reason, code: read.code },
          ),
        );
        return;
      }
      const { inputs } = read;
      let planned: readonly PlannedWindow[];
      try {
        planned = deps.plan(inputs);
      } catch (err) {
        // The planner's own words: an empty plan would claim the
        // recording has no camera positions.
        sides.files.delete(id);
        api.dispatch(A.readRefused({ id, reason: errorText(err) }));
        return;
      }
      sides.inputs.set(id, inputs);
      sides.plans.set(id, planned);
      const c = inputs.census;
      api.dispatch(
        A.readFinished({
          id,
          census: {
            frames: c.frames,
            skippedFrames: c.skippedFrames,
            pathM: c.pathM,
            medianSpacingM: c.medianSpacingM,
            frameWidth: c.frameWidth,
            frameHeight: c.frameHeight,
            depthSamples: c.depthSamples,
          },
          windows: planned.map(summaryOf),
        }),
      );
    },
  });

  listener.startListening({
    actionCreator: A.anotherRecordingChosen,
    effect: () => {
      sides.files.clear();
      sides.inputs.clear();
      sides.plans.clear();
      dropAllPreviews();
      sides.splats.clear();
    },
  });

  /** Keeps exactly one job running, for the state's training stretch. */
  listener.startListening({
    predicate: (_action, cur, prev) => runKeyOf(cur) !== runKeyOf(prev),
    effect: (_action, api) => {
      const state = api.getState();
      const key = runKeyOf(state);
      if (job !== null && job.key !== key) {
        job.ctrl.abort();
        job = null;
      }
      for (const w of state.windows) {
        if (w.status === "stopped" || w.status === "queued") dropPreview(w.id);
      }
      const w = currentWindow(state);
      const recording = state.recording;
      if (key === null || w === undefined || recording === null || job !== null)
        return;
      const inputs = sides.inputs.get(recording.id);
      const planned = sides.plans.get(recording.id)?.find((p) => p.id === w.id);
      if (inputs === undefined || planned === undefined) return;
      const ctrl = new AbortController();
      job = { key, ctrl };
      dropPreview(w.id);
      const request: TrainRequest = {
        window: planned,
        attempt: w.attempt,
        timeScale: attemptTimeScale(w.attempt),
        inputs,
      };
      void runJob(request, ctrl);
    },
  });

  async function runJob(
    request: TrainRequest,
    ctrl: AbortController,
  ): Promise<void> {
    const { id } = request.window;
    const attempt = request.attempt;
    const live = (): boolean => !ctrl.signal.aborted && !disposed;
    let result: WindowTrainResult;
    try {
      result = await deps.adapter.trainWindow(
        request,
        {
          onProgress: (p) => {
            if (live()) store.dispatch(A.progressed({ id, attempt, ...p }));
          },
          onPreview: (picture) => {
            if (!live()) {
              closePicture(picture);
              return;
            }
            setPreview(id, picture);
            store.dispatch(A.previewed({ id, attempt }));
          },
        },
        ctrl.signal,
      );
    } catch {
      result = { outcome: "failed", metrics: null, trainingS: 0, ply: null };
    }
    if (!live()) return;
    if (job?.ctrl === ctrl) job = null;
    // A cancel nobody asked for (the signal was not aborted) is a trainer
    // that gave up: judged like a failure, so the run goes on.
    if (result.outcome === "cancelled") {
      result = { ...result, outcome: "failed", ply: null };
    }
    let judgement: WindowJudgement;
    try {
      judgement =
        result.outcome === "failed"
          ? FAILED_JUDGEMENT
          : deps.adapter.judge(request, result);
    } catch {
      judgement = FAILED_JUDGEMENT;
    }
    if (result.ply !== null) sides.splats.set(id, result.ply);
    else sides.splats.delete(id);
    store.dispatch(
      A.windowFinished({
        id,
        attempt,
        outcome: result.outcome,
        metrics: result.metrics,
        judgement,
        trainingS: result.trainingS,
      }),
    );
  }

  /** Starts reading a recording the person chose or dropped. */
  function chooseRecording(file: File): void {
    const s = store.getState();
    if (s.phase !== "start" && s.phase !== "census") return;
    const id = `r${nextRecording++}`;
    sides.files.clear();
    sides.inputs.clear();
    sides.plans.clear();
    sides.files.set(id, file);
    store.dispatch(A.readingStarted({ id, name: file.name }));
  }

  /**
   * Saves the package to where `pick` says (asked for in the click, before
   * this awaits anything). A cancelled pick ends quietly; any failure ends
   * in the error state, naming what became of a picked file
   * (`releaseUnusedPick`: never deleted, but the browser may have emptied
   * it). The finished stretches stay on the page either way.
   */
  async function save(pick: Promise<SaveFilePick>): Promise<void> {
    if (store.getState().save.status === "saving") return;
    store.dispatch(A.saveStarted());
    try {
      const state = store.getState();
      const name = packageFileName(state.recording?.name ?? "");
      const blob = await buildPackage(state, sides.splats);
      const picked = await pick;
      if (picked.kind === "cancelled") {
        store.dispatch(A.saveCancelled());
        return;
      }
      if (picked.kind === "picked") {
        await deps.write(picked.handle, blob);
      } else if (!(await deps.download(blob, name))) {
        store.dispatch(A.saveCancelled());
        return;
      }
      store.dispatch(A.saveSucceeded({ count: windowsInFile(state).length }));
    } catch (err) {
      const left = await releaseUnusedPick(pick, unwrittenPick);
      store.dispatch(A.saveFailed({ message: errorText(err), left }));
    }
  }

  function dispose(): void {
    disposed = true;
    job?.ctrl.abort();
    job = null;
    dropAllPreviews();
    listener.clearListeners();
  }

  return { store, sides, probe, chooseRecording, save, dispose };
}
