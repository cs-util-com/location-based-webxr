/**
 * The worker spike's state: one Redux slice for the run status (camera
 * starting, ready, running, done or failed), the current step, the pair
 * times, the live camera verdict, the result card, the plain error and
 * the log. The reducers own the rules: Start only once the camera is on
 * and only once, steps only while running, the pair count capped at the
 * plan. The raw frame gaps, the camera, the workers and the photos live
 * outside, in `worker-spike.ts`.
 *
 * @see worker-spike-slice.ts.md
 */
import {
  configureStore,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";

import type {
  CameraVerdict,
  PlainError,
  SpikePlan,
  SpikeResult,
  SpikeStep,
} from "./worker-spike-model";

export type SpikePhase = "starting" | "ready" | "running" | "done" | "failed";

export interface WorkerSpikeState {
  readonly phase: SpikePhase;
  readonly plan: SpikePlan;
  readonly step: SpikeStep | null;
  /** `performance.now()` when the step (or the current pair) began. */
  readonly stepStartedAt: number;
  readonly pairMs: readonly number[];
  readonly live: CameraVerdict;
  readonly result: SpikeResult | null;
  readonly error: PlainError | null;
  readonly log: readonly string[];
}

const initial = (plan: SpikePlan): WorkerSpikeState => ({
  phase: "starting",
  plan,
  step: null,
  stepStartedAt: 0,
  pairMs: [],
  live: "unknown",
  result: null,
  error: null,
  log: [],
});

const slice = createSlice({
  name: "workerSpike",
  initialState: initial({ baselineMs: 1, pairs: 1, photoGapMs: 0, sizes: [] }),
  reducers: {
    cameraOn(s) {
      if (s.phase === "starting") {
        s.phase = "ready";
      }
    },
    cameraFailed(s, a: PayloadAction<PlainError>) {
      if (s.phase === "starting" || s.phase === "ready") {
        s.phase = "failed";
        s.error = a.payload;
      }
    },
    runStarted(s, a: PayloadAction<number>) {
      if (s.phase === "ready") {
        s.phase = "running";
        s.step = { kind: "baseline" };
        s.stepStartedAt = a.payload;
      }
    },
    stepBegan(s, a: PayloadAction<{ step: SpikeStep; now: number }>) {
      if (s.phase === "running") {
        s.step = a.payload.step;
        s.stepStartedAt = a.payload.now;
      }
    },
    photoTaken(s) {
      if (s.phase === "running" && s.step?.kind === "photos") {
        s.step = { kind: "photos", taken: s.step.taken + 1 };
      }
    },
    pairMeasured(s, a: PayloadAction<{ ms: number; now: number }>) {
      if (s.phase === "running" && s.step?.kind === "pairs") {
        s.step = {
          kind: "pairs",
          done: Math.min(s.plan.pairs, s.step.done + 1),
        };
        s.pairMs.push(a.payload.ms);
        s.stepStartedAt = a.payload.now;
      }
    },
    liveVerdict(s, a: PayloadAction<CameraVerdict>) {
      s.live = a.payload;
    },
    finished(s, a: PayloadAction<SpikeResult>) {
      if (s.phase === "running") {
        s.phase = "done";
        // Immer's draft drops `readonly`; the payload is stored as given.
        s.result = a.payload as typeof s.result;
      }
    },
    runFailed(s, a: PayloadAction<PlainError>) {
      if (s.phase === "running") {
        s.phase = "failed";
        s.error = a.payload;
      }
    },
    logged(s, a: PayloadAction<string>) {
      s.log.push(a.payload);
    },
  },
});

export const workerSpikeActions = slice.actions;

/** The spike's store, for one run of `plan`. */
export function createWorkerSpikeStore(plan: SpikePlan) {
  return configureStore({
    reducer: slice.reducer,
    preloadedState: initial(plan),
  });
}
