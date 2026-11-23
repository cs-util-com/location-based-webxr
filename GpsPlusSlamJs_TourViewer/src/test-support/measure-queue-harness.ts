/**
 * The measuring queue's test harness: a real feature-match store, a fake
 * worker client whose calls a test answers by hand, and the photo reader,
 * matches writer and run guard as fakes. Shared by the queue's unit and
 * model-based tests.
 */
import { configureStore } from "@reduxjs/toolkit";

import type { MethodResult } from "../checks/feature-match/bench-run";
import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  planResultKeys,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "../checks/feature-match/feature-match-slice";
import type {
  MeasureDone,
  MeasureJob,
} from "../checks/feature-match/measure-protocol";
import { startMeasureQueue } from "../checks/feature-match/measure-queue";
import type { PhotoMeta } from "../checks/feature-match/run-plan";
import { turnOf } from "../checks/feature-match/rotation-square";

interface Call {
  /**
   * The result key the job's own content names (its two photos, legacy
   * pair key and turn) in the plan when it was sent; null when no ready
   * pair, or more than one, matches it.
   */
  readonly key: string | null;
  readonly job: MeasureJob;
  readonly resolve: (d: MeasureDone) => void;
  readonly reject: (e: unknown) => void;
}

const photo = (id: string): PhotoMeta => ({
  id,
  width: 640,
  height: 480,
  source: { width: 1920, height: 1080 },
  greyMean: 120,
});

export const shot = (id: string, p: string): FeatureMatchAction =>
  A.planShotTaken({ shot: id, photo: photo(p) });

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

export function result(id: string, error: string | null = null): MethodResult {
  return {
    id,
    label: id,
    backend: "wasm",
    downloads: [],
    initMs: 9,
    notes: [],
    sizes: [],
    error,
  };
}

export const doneOf = (
  results: MethodResult[],
  measureMs = 40,
): MeasureDone => ({
  results,
  frames: { a: { width: 640, height: 480 }, b: { width: 640, height: 480 } },
  settings: "runs: 1, no warm-up, backends wasm",
  measureMs,
});

export function harness(
  over: { unreadable?: ReadonlySet<string>; hidden?: boolean } = {},
) {
  const store = configureStore({
    reducer: featureMatchReducer,
    preloadedState: initialFeatureMatchState({ session: "s1" }),
    middleware: (d) => d({ serializableCheck: false, immutableCheck: false }),
  });
  const calls: Call[] = [];
  // The photo id behind each Blob the reader handed out, so a call's key
  // comes from what the job carries, not from the store's own record.
  const idOf = new WeakMap<Blob, string>();
  const keyOf = (job: MeasureJob): string | null => {
    const ab = `@${idOf.get(job.a) ?? "?"}+${idOf.get(job.b) ?? "?"}`;
    const found = [...planResultKeys(store.getState().plan)].filter(
      ([k, p]) =>
        k === `${p.id}${ab}` &&
        p.legacy === job.pair &&
        turnOf(p.kind) === job.turn,
    );
    return found.length === 1 ? found[0]![0] : null;
  };
  const matches = new Map<string, string>();
  const lines: string[] = [];
  let guards = 0;
  let ended = 0;
  const stop = startMeasureQueue({
    store,
    readPhoto: (id) => {
      if (over.unreadable?.has(id)) {
        return Promise.reject(new Error(`the photo ${id} is not stored`));
      }
      const blob = new Blob([id], { type: "image/png" });
      idOf.set(blob, id);
      return Promise.resolve(blob);
    },
    client: {
      measure: (job, onLine) =>
        new Promise<MeasureDone>((resolve, reject) => {
          onLine?.("SIFT: loading");
          calls.push({
            key: keyOf(job),
            job,
            resolve,
            reject,
          });
        }),
    },
    putMatches: (key, json, action) => {
      matches.set(key, json);
      store.dispatch(action);
    },
    guard: () => {
      guards++;
      return {
        wasHidden: () => over.hidden === true,
        end: () => {
          ended++;
        },
      };
    },
    log: (line) => lines.push(line),
  });
  const state = (): FeatureMatchState => store.getState();
  return {
    store,
    calls,
    matches,
    lines,
    state,
    stop,
    guards: () => guards,
    ended: () => ended,
  };
}
