/**
 * The page's side of the asset optimizer's module Worker: an
 * `OptimizerHost` that spawns the Worker on the first run that needs it,
 * correlates answers by job, forwards progress, cancels on abort, and
 * after a crash rejects every run it held with `OptimizerCrashed` and
 * spawns a fresh Worker for the next one. A Worker that holds runs and
 * sends nothing for `OPTIMIZER_SILENCE_MS` counts as crashed, because a
 * Worker killed out of memory does not reliably fire its error event. The
 * transport logic (`createOptimizerHost`) is tested with a fake Worker;
 * the device seam (`spawnOptimizerWorker`) only constructs the real one.
 *
 * @see optimizer-client.ts.md
 */

import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourMediaTypeOf } from "gps-plus-slam-app-framework/ar/tour-media";

import {
  OptimizerCrashed,
  type OptimizeControl,
  type OptimizeOutcome,
  type OptimizerHost,
} from "./asset-optimizers.js";
import type { ModelReport } from "./model-step.js";
import type {
  OptimizerInbound,
  OptimizerOutbound,
} from "./optimizer-protocol.js";

/** How long a Worker holding runs may send nothing (no progress, no
 *  answer) before it counts as crashed: 2 minutes. A healthy model run
 *  reports progress after each step of its level-of-detail pass, so its
 *  longest silent stretch is one such step; the measured gaps and their
 *  margin are in optimizer-client.ts.md. Progress restarts the wait, so a
 *  long run that keeps reporting is never cut. */
export const OPTIMIZER_SILENCE_MS = 120_000;

/** Said when the Worker stopped answering. */
const SILENT = `the optimizer stopped answering for ${OPTIMIZER_SILENCE_MS / 60_000} minutes`;

/** The part of the page the watchdog reads, so a test can fake it: the
 *  wait pauses while the page is hidden. */
export interface OptimizerPage extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

/** The part of a `Worker` the client uses, so a test can fake it. */
export interface OptimizerWorker {
  postMessage(message: OptimizerInbound, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

interface Pending {
  /** The kind the run was asked for: a smaller file must be of it. */
  readonly kind: TourAssetKind;
  readonly resolve: (outcome: OptimizeOutcome) => void;
  readonly reject: (error: unknown) => void;
  readonly control: OptimizeControl;
  readonly onAbort: () => void;
}

function aborted(): DOMException {
  return new DOMException("the optimization was stopped", "AbortError");
}

/** Said when the Worker's smaller file is not one the tour takes for the
 *  run's kind (no Blob, an extension of another kind or none the format
 *  allows, an image size that is no positive whole number). */
const BAD_FILE = "the optimizer answered with a file the tour cannot take";
/** Said when the Worker kept or failed a run without words. */
const NO_REASON = "the optimizer answered with no reason";

/** An answer of a known type whose fields do not read: its run fails. */
interface Malformed {
  readonly type: "malformed";
  readonly job: number;
  readonly reason: string;
}

function isPixelCount(n: unknown): boolean {
  return n === undefined || (Number.isSafeInteger(n) && (n as number) > 0);
}

const TEXTURE_FIELDS = [
  "changed",
  "kept",
  "bytesBefore",
  "bytesAfter",
  "largestSide",
] as const;
const QUANTIZE_FIELDS = [
  "positions",
  "normals",
  "tangents",
  "texcoords",
  "indices",
  "positionError",
  "normalErrorDeg",
  "texcoordError",
] as const;

const LOD_FIELDS = [
  "primitives",
  "trianglesBefore",
  "trianglesAfter",
  "deviation",
  "size",
] as const;
const CHOICE_FIELDS = ["share", "triangles", "deviation"] as const;

/** Whether `value` is an object whose `fields` are all finite numbers. */
function numbersAt(value: unknown, fields: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Partial<Record<string, unknown>>;
  return fields.every((f) => Number.isFinite(o[f]));
}

/** Whether `value` reads as a level-of-detail report: its counts, its
 *  reason (a string or null), its flag and every slider stop. */
function isLodReport(value: unknown): boolean {
  if (!numbersAt(value, LOD_FIELDS)) return false;
  const r = value as Partial<Record<string, unknown>>;
  return (
    (r.skipped === null || typeof r.skipped === "string") &&
    typeof r.automatic === "boolean" &&
    Array.isArray(r.choices) &&
    r.choices.every((c) => numbersAt(c, CHOICE_FIELDS))
  );
}

/** `value` as a model's report, or undefined when it does not read: the
 *  report is advisory, so the checked file lands without it. */
function modelReportOf(value: unknown): ModelReport | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Partial<Record<string, unknown>>;
  return numbersAt(r.textures, TEXTURE_FIELDS) &&
    isLodReport(r.lod) &&
    numbersAt(r.quantize, QUANTIZE_FIELDS)
    ? (value as ModelReport)
    : undefined;
}

/** `data` as an answer of the protocol for a run of `kindOf(job)`; one of
 *  a known type whose fields do not read is `Malformed`; null for
 *  anything else (no job number, an unknown type, a progress that is no
 *  number). */
function answerOf(
  data: unknown,
  kindOf: (job: number) => TourAssetKind | undefined,
): OptimizerOutbound | Malformed | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<Record<string, unknown>>;
  if (typeof m.job !== "number") return null;
  const job = m.job;
  switch (m.type) {
    case "progress":
      return typeof m.fraction === "number"
        ? (data as OptimizerOutbound)
        : null;
    case "done": {
      const kind = kindOf(job);
      const fits =
        m.blob instanceof Blob &&
        typeof m.extension === "string" &&
        kind !== undefined &&
        tourMediaTypeOf(m.extension)?.kind === kind &&
        isPixelCount(m.width) &&
        isPixelCount(m.height);
      return fits
        ? (data as OptimizerOutbound)
        : { type: "malformed", job, reason: BAD_FILE };
    }
    case "kept":
    case "failed":
      return typeof m.reason === "string"
        ? (data as OptimizerOutbound)
        : { type: "malformed", job, reason: NO_REASON };
    default:
      return null;
  }
}

export function createOptimizerHost(
  spawn: () => OptimizerWorker,
  page: OptimizerPage | null = globalThis.document ?? null,
): OptimizerHost {
  let worker: OptimizerWorker | null = null;
  const pending = new Map<number, Pending>();
  let seq = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  /** (Re)starts the silence watchdog while the Worker holds runs and the
   *  page is shown, and stops it otherwise: a hidden tab's timers are
   *  throttled or frozen, and one that came due while frozen could fire
   *  on resume before the Worker's queued progress is read. */
  function watch(): void {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
    if (worker === null || pending.size === 0) return;
    if (page?.visibilityState === "hidden") return;
    watchdog = setTimeout(() => {
      watchdog = null;
      dropAll(() => new OptimizerCrashed(SILENT));
    }, OPTIMIZER_SILENCE_MS);
  }

  function settle(job: number): Pending | undefined {
    const run = pending.get(job);
    if (run === undefined) return undefined;
    pending.delete(job);
    run.control.signal.removeEventListener("abort", run.onAbort);
    if (pending.size === 0) watch();
    return run;
  }

  /** Showing the page again starts the wait afresh; hiding it pauses it. */
  const onVisibility = () => watch();

  /** Every run rejects with `error`; the Worker goes. */
  function dropAll(error: () => unknown): void {
    const dead = worker;
    worker = null;
    page?.removeEventListener("visibilitychange", onVisibility);
    for (const job of [...pending.keys()]) settle(job)?.reject(error());
    dead?.terminate();
    watch();
  }

  function onAnswer(event: MessageEvent): void {
    const answer = answerOf(event.data, (job) => pending.get(job)?.kind);
    if (answer === null) return;
    if (answer.type === "progress") {
      pending.get(answer.job)?.control.progress(answer.fraction);
      return;
    }
    const run = settle(answer.job);
    if (run === undefined) return;
    if (answer.type === "failed" || answer.type === "malformed") {
      run.reject(new Error(answer.reason));
    } else if (answer.type === "kept") {
      run.resolve({ kind: "kept", reason: answer.reason });
    } else {
      const model = modelReportOf(answer.model);
      run.resolve({
        kind: "optimized",
        blob: answer.blob,
        extension: answer.extension,
        ...(answer.width === undefined ? {} : { width: answer.width }),
        ...(answer.height === undefined ? {} : { height: answer.height }),
        ...(model === undefined ? {} : { model }),
      });
    }
  }

  function live(): OptimizerWorker {
    if (worker !== null) return worker;
    const spawned = spawn();
    spawned.onmessage = (event) => {
      // any word from the live Worker shows it is alive
      if (worker === spawned) watch();
      onAnswer(event);
    };
    spawned.onerror = () => {
      if (worker === spawned) dropAll(() => new OptimizerCrashed());
    };
    worker = spawned;
    page?.addEventListener("visibilitychange", onVisibility);
    return spawned;
  }

  return {
    run(kind, payload, settings, control, transfer = []) {
      if (control.signal.aborted) return Promise.reject(aborted());
      return new Promise<OptimizeOutcome>((resolve, reject) => {
        const job = ++seq;
        let target: OptimizerWorker;
        try {
          target = live();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const onAbort = () => {
          if (settle(job) === undefined) return;
          target.postMessage({ type: "cancel", job });
          reject(aborted());
        };
        pending.set(job, { kind, resolve, reject, control, onAbort });
        control.signal.addEventListener("abort", onAbort, { once: true });
        // a new run is no sign of life: it starts the wait, never restarts it
        if (watchdog === null) watch();
        try {
          target.postMessage({ type: "run", job, kind, payload, settings }, [
            ...transfer,
          ]);
        } catch (err) {
          // a payload that cannot be copied: no run was started
          settle(job);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    close() {
      dropAll(aborted);
    },
  };
}

/** The device seam: the real module Worker (not unit-tested). */
export function spawnOptimizerWorker(): OptimizerWorker {
  return new Worker(new URL("./asset-optimizer.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as OptimizerWorker;
}
