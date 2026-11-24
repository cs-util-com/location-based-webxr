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
import type { MethodResult } from "./bench-run";
import { errorText } from "./bench-net";
import {
  featureMatchActions as A,
  nextMeasureKey,
  planResultKeys,
  type FeatureMatchAction,
  type FeatureMatchState,
  type RunContext,
} from "./feature-match-slice";
import { plural } from "./fm-helpers";
import { WorkerCrashed, type MeasureClient } from "./measure-client";
import type { RunGuard } from "./run-guard";
import { shotFile } from "./run-zip";
import { centreCrop, turnOf } from "./rotation-square";

export interface MeasureQueueDeps {
  readonly store: {
    getState(): FeatureMatchState;
    dispatch(action: FeatureMatchAction): unknown;
    subscribe(listener: () => void): () => void;
  };
  /** A photo's PNG, from storage or memory; rejects when it cannot be read. */
  readonly readPhoto: (id: string) => Promise<Blob>;
  readonly client: Pick<MeasureClient, "measure" | "close">;
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

/** The selection box of a worker method, by its id; null for SIFT. */
function boxOf(id: string): "aliked" | "siftLightGlue" | null {
  if (id.startsWith("aliked-lightglue-")) {
    return "aliked";
  }
  return id.startsWith("sift-lightglue-") ? "siftLightGlue" : null;
}

/** Ran (or asked to run) on WebGPU and failed to load or at a size. */
const failedOnGpu = (r: MethodResult): boolean =>
  r.backend.startsWith("webgpu") &&
  (r.error !== null || r.sizes.some((z) => z.error !== null));

/** A result's first error: its load's, else its first failed size's. */
const firstError = (r: MethodResult): string =>
  r.error ?? r.sizes.find((z) => z.error !== null)?.error ?? "";

/** The error of a method turned off for the run, in each later pair. */
const OFF_TEXT =
  "off for this run: it failed on WebGPU again after the worker restarted";

/** Restarts made for one method in a run; the next failure turns it off. */
const MAX_RESTARTS = 3;

/** The result of a method turned off for the run, on the backend it failed on. */
const offResult = (r: MethodResult): MethodResult => ({
  id: r.id,
  label: r.label,
  backend: r.backend,
  downloads: [],
  initMs: Number.NaN,
  notes: [],
  sizes: [],
  error: OFF_TEXT,
});

/** The result's short line: the time and the methods that could not load. */
function doneText(
  results: readonly MethodResult[],
  measureMs: number,
  notLoaded: number,
): string {
  const methods = plural(results.length, "method");
  const extra = notLoaded > 0 ? `, ${String(notLoaded)} could not load` : "";
  return `done in ${String(Math.round(measureMs))} ms (${methods}${extra})`;
}

/**
 * Starts the queue; returns the function that stops it (no pair starts
 * after; one in the worker still answers into the store).
 */
export function startMeasureQueue(deps: MeasureQueueDeps): () => void {
  const { store, log } = deps;
  let stopped = false;
  // The worker's WebGPU health, beside the client it describes rather than
  // in the store: it lasts as long as this queue (this page load), and
  // every pair it touches is stored for this load only, so a reload starts
  // afresh anyway.
  /** Methods that loaded at least once this run, in any worker. */
  const loadedOnce = new Set<string>();
  /** Restarts made for each method this run. */
  const restarts = new Map<string, number>();
  /** Methods restarted for and not measured well since: a failed size turns them off. */
  const retried = new Set<string>();
  /** Methods off for this run, by id (their failing result): measured no more. */
  const off = new Map<string, MethodResult>();

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
    // measured. A pair no longer in the plan (retaken, the run resized or
    // started over) has its outcome dropped by the store; the log says so.
    const said = (text: string): string => {
      const fresh = planResultKeys(store.getState().plan).has(key);
      log(
        `${pair.id}: ${fresh ? text : "discarded, the pair is no longer in the plan"}`,
      );
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
      const turn = turnOf(pair.kind);
      // Off turns the method's box off: its WASM twin is not tried instead.
      const offNow = [...off.values()].filter((r) => methods[boxOf(r.id)!]);
      const offBoxes = new Set(offNow.map((r) => boxOf(r.id)));
      const done = await deps.client.measure(
        {
          a,
          b,
          turn,
          methods: {
            sift: methods.sift,
            aliked: methods.aliked && !offBoxes.has("aliked"),
            siftLightGlue:
              methods.siftLightGlue && !offBoxes.has("siftLightGlue"),
          },
          sizes,
          pair: pair.legacy,
        },
        (line) => log(`${pair.id}: ${line}`),
      );
      // A failed size on WebGPU (a lost device, or an error the device
      // keeps giving), or a failed load of a method that loaded before in
      // this run (a device lost between pairs or in the new worker), is a
      // WebGPU failure. A first load failing is a download.
      const worker = done.results.filter(
        (r) => boxOf(r.id) !== null && !off.has(r.id),
      );
      const failures = worker.filter(
        (r) => failedOnGpu(r) && (r.error === null || loadedOnce.has(r.id)),
      );
      for (const r of worker) {
        if (r.error === null) {
          loadedOnce.add(r.id);
        }
        if (!failedOnGpu(r)) {
          retried.delete(r.id);
        }
      }
      // A failed size right after a restart for it (a failed load then may
      // be the new worker's download, so it stays retried), or a failure
      // after MAX_RESTARTS restarts, turns the method off for this run.
      for (const r of failures) {
        if (
          (retried.has(r.id) && r.error === null) ||
          (restarts.get(r.id) ?? 0) >= MAX_RESTARTS
        ) {
          off.set(r.id, r);
          retried.delete(r.id);
          log(`${r.label} is ${OFF_TEXT}`);
        }
      }
      // Any WebGPU failure restarts the worker, so the next pair gets a
      // fresh device, while a method still on runs on WebGPU; each method
      // still on that failed counts the restart and is retried.
      const restarting =
        failures.length > 0 &&
        worker.some((r) => !off.has(r.id) && r.backend.startsWith("webgpu"));
      if (restarting) {
        for (const r of failures.filter((f) => !off.has(f.id))) {
          restarts.set(r.id, (restarts.get(r.id) ?? 0) + 1);
          retried.add(r.id);
        }
        deps.client.close();
      }
      const results = [
        ...done.results,
        ...offNow
          .filter((o) => !done.results.some((r) => r.id === o.id))
          .map(offResult),
      ];
      const restart = restarting
        ? `; the worker restarts after ${failures.map((r) => r.label).join(", ")} failed on WebGPU (${firstError(failures[0]!)})`
        : "";
      const notLoaded = results.filter((r) => r.error !== null);
      if (notLoaded.length === results.length) {
        failed(
          `not measured: ${notLoaded[0]?.error ?? "no method ran"}${restart}`,
        );
        return;
      }
      const hidden = guard.wasHidden();
      const json = matchesInfo(results, done.frames, {
        files: { a: shotFile(pair.a, ra.take), b: shotFile(pair.b, rb.take) },
        context,
        hidden,
        settings: done.settings,
        methods,
        sizes,
        // A rotation pair is measured on the centre squares, B turned: its
        // keypoints are in those squares' pixels, not the shot files'.
        ...(turn === null
          ? {}
          : {
              square: {
                a: centreCrop(ra.photo.width, ra.photo.height),
                b: centreCrop(rb.photo.width, rb.photo.height),
                turn,
              },
            }),
      });
      deps.putMatches(
        key,
        json,
        A.resultStored({
          key,
          text: said(
            doneText(results, done.measureMs, notLoaded.length) + restart,
          ),
          // A method that could not load (a download) or failed on WebGPU
          // is not a measured outcome: a reload measures the pair again.
          persisted: notLoaded.length === 0 && failures.length === 0,
          measureMs: done.measureMs,
          context,
          ...(hidden ? { hidden } : {}),
        }),
      );
    } catch (e) {
      if (e instanceof WorkerCrashed) {
        // The client starts a new worker; `loadedOnce` holds across it.
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

  /** The state the queue last looked at: an unchanged one needs no look. */
  let last: FeatureMatchState | null = null;
  const tick = (): void => {
    if (stopped) {
      return;
    }
    const s = store.getState();
    if (s === last) {
      return;
    }
    last = s;
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
