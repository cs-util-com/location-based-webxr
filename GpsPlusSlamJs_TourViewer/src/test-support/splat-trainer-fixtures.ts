/**
 * Test-only: a splat trainer page store at a given point of a run, with
 * the plan, census and judgements the slice, property and page tests share.
 */
import { configureStore } from "@reduxjs/toolkit";

import type { WindowJudgement } from "../splat-trainer/trainer-adapter.js";
import {
  currentWindow,
  initialTrainerPageState,
  trainerPageActions as A,
  trainerPageReducer,
} from "../splat-trainer/trainer-page-slice.js";
import type { PlannedWindow } from "../splat-trainer/window-plan.js";

export const plan = (n: number): PlannedWindow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    index: i,
    fromM: i * 30,
    toM: (i + 1) * 30,
    frames: 5,
    window: {
      segment: 0,
      core: [0, 1, 2, 3, 4].map((f) => i * 5 + f),
      train: [0, 1, 2, 3].map((f) => i * 5 + f),
      holdouts: [i * 5 + 4],
      tooFewHoldouts: true,
      tooFewFrames: true,
    },
  }));

export const CENSUS = {
  frames: 40,
  skippedFrames: 0,
  pathM: 234,
  medianSpacingM: 6,
  frameWidth: 640,
  frameHeight: 480,
  depthSamples: 40,
};

export const judged = (
  verdict: WindowJudgement["verdict"],
): WindowJudgement => ({
  verdict,
  reasons: verdict === "good" ? [] : ["photos far apart"],
  say: "A sentence.",
});

export function storeAt(
  n = 4,
  trainer: "practice" | "unavailable" = "practice",
) {
  const store = configureStore({
    reducer: trainerPageReducer,
    preloadedState: initialTrainerPageState(trainer),
  });
  store.dispatch(A.probeFinished("ready"));
  store.dispatch(A.readingStarted({ id: "r1", name: "walk.zip" }));
  store.dispatch(
    A.readFinished({ id: "r1", census: CENSUS, windows: plan(n) }),
  );
  return store;
}

type Store = ReturnType<typeof storeAt>;

export function finishCurrent(
  store: Store,
  verdict: WindowJudgement["verdict"] = "good",
) {
  const cur = currentWindow(store.getState());
  if (cur === undefined) throw new Error("nothing is training");
  store.dispatch(
    A.windowFinished({
      id: cur.id,
      attempt: cur.attempt,
      outcome: "finished",
      metrics: { atCameraDb: 29, heldOutDb: 23, photosUsed: cur.frames },
      judgement: judged(verdict),
      trainingS: 60 * cur.attempt,
    }),
  );
}
