/**
 * The measuring queue: watches the store and hands the next ready pair to
 * the measuring worker, one at a time, while the tester goes on shooting.
 * The store decides which pair is next (`nextMeasureKey`) and whether the
 * queue may start (`queueStarted`); this module only reads the two photos,
 * waits for the worker and dispatches what came back. Its result's matches
 * JSON goes into the side table in the same step as `resultStored`.
 *
 * @see measure-queue.ts.md
 */
import { matchesInfo } from "./bench-export";
import { errorText } from "./bench-net";
import {
  featureMatchActions as A,
  nextMeasureKey,
  planResultKeys,
  type FeatureMatchAction,
  type FeatureMatchState,
  type RunContext,
} from "./feature-match-slice";
import { WorkerCrashed, type MeasureClient } from "./measure-client";
import type { MeasureDone } from "./measure-protocol";
import type { RunGuard } from "./run-guard";
import { shotFile } from "./run-zip";
import { turnOf } from "./rotation-square";

export interface MeasureQueueDeps {
  readonly store: {
    getState(): FeatureMatchState;
    dispatch(action: FeatureMatchAction): unknown;
    subscribe(listener: () => void): () => void;
  };
  /** A photo's PNG, from storage or memory; rejects when it cannot be read. */
  readonly readPhoto: (id: string) => Promise<Blob>;
  readonly client: Pick<MeasureClient, "measure">;
  /** Puts the matches JSON in the side table and dispatches `action`. */
  readonly putMatches: (
    key: string,
    json: string,
    action: FeatureMatchAction,
  ) => void;
  /** Holds the screen awake and watches the page while a pair measures. */
  readonly guard: () => Pick<RunGuard, "wasHidden" | "end">;
  readonly log: (line: string) => void;
}

const plural = (n: number, word: string): string =>
  `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** The result's short line: the time and the methods that could not load. */
function doneText(done: MeasureDone, notLoaded: number): string {
  const methods = plural(done.results.length, "method");
  const extra = notLoaded > 0 ? `, ${String(notLoaded)} could not load` : "";
  return `done in ${String(Math.round(done.measureMs))} ms (${methods}${extra})`;
}

/**
 * Starts the queue; returns the function that stops it (no pair starts
 * after; one in the worker still answers into the store).
 */
export function startMeasureQueue(deps: MeasureQueueDeps): () => void {
  const { store, log } = deps;
  let stopped = false;

  const measure = async (key: string, s: FeatureMatchState): Promise<void> => {
    const pair = planResultKeys(s.plan).get(key)!;
    const ra = s.plan.shots[pair.a]!;
    const rb = s.plan.shots[pair.b]!;
    const o = s.options;
    const context: RunContext = s.camera ? "beside-camera" : "idle";
    const methods = {
      sift: o.methods.sift,
      aliked: o.methods.aliked,
      siftLightGlue: o.methods.siftLightGlue,
    };
    const sizes = o.sizes
      .map(Number)
      .filter((v) => Number.isFinite(v) && v > 0);
    // Every outcome is logged too: the run zip's log says what the phone
    // measured.
    const said = (text: string): string => {
      log(`${pair.id}: ${text}`);
      return text;
    };
    const failed = (text: string) =>
      store.dispatch(
        A.resultFailed({ key, text: said(text), persisted: false }),
      );
    const guard = deps.guard();
    try {
      let a: Blob;
      let b: Blob;
      try {
        [a, b] = await Promise.all([
          deps.readPhoto(ra.photo.id),
          deps.readPhoto(rb.photo.id),
        ]);
      } catch (e) {
        failed(`not measured: a photo could not be read (${errorText(e)})`);
        return;
      }
      log(`${pair.id}: measuring ${context}`);
      const done = await deps.client.measure(
        { a, b, turn: turnOf(pair.kind), methods, sizes, pair: pair.legacy },
        (line) => log(`${pair.id}: ${line}`),
      );
      const notLoaded = done.results.filter((r) => r.error !== null);
      if (notLoaded.length === done.results.length) {
        failed(`not measured: ${notLoaded[0]?.error ?? "no method ran"}`);
        return;
      }
      const hidden = guard.wasHidden();
      const json = matchesInfo(done.results, done.frames, {
        files: { a: shotFile(pair.a, ra.take), b: shotFile(pair.b, rb.take) },
        context,
        hidden,
        settings: done.settings,
        methods,
        sizes,
      });
      deps.putMatches(
        key,
        json,
        A.resultStored({
          key,
          text: said(doneText(done, notLoaded.length)),
          // A method that could not load (a download) is not a measured
          // outcome: a reload measures the pair again.
          persisted: notLoaded.length === 0,
          measureMs: done.measureMs,
          context,
          ...(hidden ? { hidden } : {}),
        }),
      );
    } catch (e) {
      if (e instanceof WorkerCrashed) {
        store.dispatch(
          A.workerCrashed({ key, text: said(`not measured: ${e.message}`) }),
        );
      } else {
        failed(`not measured: ${errorText(e)}`);
      }
    } finally {
      guard.end();
    }
  };

  const tick = (): void => {
    if (stopped) {
      return;
    }
    const s = store.getState();
    const key = nextMeasureKey(s);
    if (key === null) {
      return;
    }
    store.dispatch(A.queueStarted(key));
    if (store.getState().queue.running === key) {
      void measure(key, s);
    }
  };

  const unsubscribe = store.subscribe(tick);
  tick();
  return () => {
    stopped = true;
    unsubscribe();
  };
}
